import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Article } from 'src/scheme/article.schema';
import { Draft } from 'src/scheme/draft.schema';
import { MetaProvider } from 'src/provider/meta/meta.provider';
import { CategoryProvider } from 'src/provider/category/category.provider';
import { TagProvider } from 'src/provider/tag/tag.provider';
import { ArticleWorkflow } from 'src/provider/content/article.workflow';
import { DraftWorkflow } from 'src/provider/content/draft.workflow';
import { DraftProvider } from 'src/provider/draft/draft.provider';
import { PipelineProvider } from 'src/provider/pipeline/pipeline.provider';
import { ISRProvider } from 'src/provider/isr/isr.provider';
import { config } from 'src/config';
import { McpImageService } from './mcp-image.service';
import { McpOperationService } from './mcp-operation.service';
import { SavePostInput, toolSchemas } from './mcp.schemas';

const fields = [
  'title',
  'content',
  'category',
  'tags',
  'author',
  'pathname',
  'cover',
  'hidden',
  'private',
  'password',
  'copyright',
];
const draftFields = ['title', 'content', 'category', 'tags', 'author'];
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class McpToolsService {
  constructor(
    @InjectModel(Article.name) private readonly articles: Model<Article>,
    @InjectModel(Draft.name) private readonly drafts: Model<Draft>,
    private readonly meta: MetaProvider,
    private readonly categories: CategoryProvider,
    private readonly tags: TagProvider,
    private readonly articleWorkflow: ArticleWorkflow,
    private readonly draftWorkflow: DraftWorkflow,
    private readonly draftProvider: DraftProvider,
    private readonly pipeline: PipelineProvider,
    private readonly isr: ISRProvider,
    private readonly images: McpImageService,
    private readonly operations: McpOperationService,
  ) {}

  async execute(name: string, raw: unknown, identity: string, user: any) {
    const schema = toolSchemas[name];
    if (!schema) throw new BadRequestException('UNKNOWN_TOOL: 未知工具。');
    const input = schema.parse(raw || {});
    switch (name) {
      case 'get_blog_info':
        return this.info();
      case 'search_posts':
        return this.search(input);
      case 'get_post':
        return this.present(input.type, await this.read(input.type, input.id));
    }
    if (config.demo === 'true') throw new ForbiddenException('演示站禁止 MCP 写入。');
    if (name === 'upload_image') return this.images.upload(input);
    if (name === 'delete_post') {
      const before = await this.read(input.type, input.id);
      this.checkVersion(before, input.expectedVersion);
      const workflow = input.type === 'article' ? this.articleWorkflow : this.draftWorkflow;
      this.unwrap(await workflow.workflowDelete(input.id, input.expectedVersion));
      return { type: input.type, id: input.id, deleted: true };
    }
    if (name === 'save_post') {
      this.validateSave(input);
      const run = () => this.save(input, user);
      return input.idempotencyKey
        ? this.operations.run(identity, input.idempotencyKey, input, run)
        : run();
    }
  }

  private model(type: string): Model<any> {
    return type === 'article' ? (this.articles as any) : (this.drafts as any);
  }

  async read(type: string, id: number): Promise<any> {
    const post = await this.model(type)
      .findOne({ id, deleted: { $ne: true } })
      .lean();
    if (!post) throw new NotFoundException('NOT_FOUND: 找不到文章或草稿。');
    return post;
  }

  private checkVersion(post: any, expectedVersion: number) {
    if ((post.version || 0) !== expectedVersion)
      throw new ConflictException('VERSION_CONFLICT: 内容已修改，请重新读取。');
  }

  private async info() {
    const [site, categories, tags] = await Promise.all([
      this.meta.getSiteInfo(),
      this.categories.getAllCategories(),
      this.tags.getAllTags(true),
    ]);
    return {
      siteName: site?.siteName,
      description: site?.siteDesc,
      baseUrl: site?.baseUrl,
      author: site?.author,
      categories,
      tags,
      rules: {
        format: 'Markdown',
        summarySeparator: '<!-- more -->',
        maxImageBytes: 10485760,
        maxPageSize: 50,
        newPostsAreDrafts: true,
      },
      permissions: 'API Token 管理员权限，可读取和管理文章、草稿及图片。',
    };
  }

  private async search(input: any) {
    const query: any = { deleted: { $ne: true } };
    if (input.keyword)
      query.$or = ['title', 'content'].map((field) => ({
        [field]: { $regex: escapeRegex(input.keyword), $options: 'i' },
      }));
    if (input.category) query.category = input.category;
    if (input.tags?.length) query.tags = { $all: input.tags };
    const model = this.model(input.type);
    const [posts, total] = await Promise.all([
      model
        .find(query, {
          id: 1,
          title: 1,
          content: 1,
          category: 1,
          tags: 1,
          pathname: 1,
          author: 1,
          hidden: 1,
          private: 1,
          createdAt: 1,
          updatedAt: 1,
          version: 1,
          _id: 0,
        })
        .sort({ createdAt: -1, id: -1 })
        .skip((input.page - 1) * input.pageSize)
        .limit(input.pageSize)
        .lean(),
      model.countDocuments(query),
    ]);
    return {
      type: input.type,
      page: input.page,
      pageSize: input.pageSize,
      total,
      items: posts.map((post) => {
        const { content, ...metadata } = post;
        return {
          ...metadata,
          version: post.version || 0,
          excerpt: String(content || '')
            .split('<!-- more -->')[0]
            .slice(0, 300),
        };
      }),
    };
  }

  private async present(type: string, post: any, renderStatus?: string) {
    const plain = post.toObject ? post.toObject() : post;
    const result: any = {
      type,
      id: plain.id,
      version: plain.version || 0,
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
    };
    for (const field of fields.filter((field) => field !== 'password'))
      if (plain[field] !== undefined) result[field] = plain[field];
    if (type === 'article') {
      const site = await this.meta.getSiteInfo();
      const path = `/post/${encodeURIComponent(plain.pathname || plain.id)}`;
      result.url = site?.baseUrl ? new URL(path, site.baseUrl).href : path;
    }
    if (renderStatus) result.renderStatus = renderStatus;
    return result;
  }

  private validateSave(input: SavePostInput) {
    const issues: string[] = [];
    if (!input.id) {
      if (input.type !== 'draft' || input.action !== 'save')
        issues.push('新建仅支持草稿，action 必须为 save。');
      if (!input.title || !input.category) issues.push('新建草稿必须提供 title 和 category。');
    } else if (input.expectedVersion === undefined)
      issues.push('操作已有内容必须提供 expectedVersion。');
    if ((!input.id || input.action !== 'save') && !input.idempotencyKey)
      issues.push('创建、发布和撤回必须提供 idempotencyKey。');
    if (input.action === 'publish' && input.type !== 'draft') issues.push('publish 只接受 draft。');
    if (input.action === 'unpublish' && input.type !== 'article')
      issues.push('unpublish 只接受 article。');
    if (input.action !== 'save' && draftFields.some((field) => input[field] !== undefined))
      issues.push('发布或撤回时不能同时修改正文或元数据，请先 save。');
    if (input.action === 'unpublish' && fields.some((field) => input[field] !== undefined))
      issues.push('撤回不接受内容字段。');
    if (
      input.type === 'draft' &&
      input.action === 'save' &&
      fields
        .filter((field) => !draftFields.includes(field))
        .some((field) => input[field] !== undefined)
    )
      issues.push('草稿保存仅支持标题、正文、分类、标签和作者；发布设置请在 publish 时提供。');
    if (issues.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', issues });
  }

  private unwrap(result: any) {
    if (result.statusCode !== 200) throw new ForbiddenException(result.message || '操作被拒绝。');
    return result.data;
  }

  private async checkPath(pathname?: string, id?: number) {
    if (!pathname) return;
    const alternatives: any[] = [{ pathname }];
    if (/^\d+$/.test(pathname)) alternatives.push({ id: Number(pathname) });
    const conflict = await this.articles.exists({ id: { $ne: id }, $or: alternatives });
    if (conflict) throw new ConflictException('PATH_CONFLICT: 该文章路径已被占用。');
  }

  private async save(input: SavePostInput, user: any) {
    const before = input.id ? await this.read(input.type, input.id) : undefined;
    if (before) this.checkVersion(before, input.expectedVersion);
    const patch: any = {};
    for (const field of fields) if (input[field] !== undefined) patch[field] = input[field];
    if (input.action === 'unpublish') {
      const draft = await this.draftProvider.unpublish(input.id, input.expectedVersion);
      this.pipeline.dispatchEvent('deleteArticle', before);
      this.pipeline.dispatchEvent('afterUpdateDraft', draft);
      this.isr.activeAll('MCP 撤回文章触发增量渲染！', undefined, {
        postId: input.id,
        previousPathname: before.pathname,
      });
      return this.present('draft', draft, 'queued');
    }
    if (input.action === 'publish') {
      if (!String(before.content || '').includes('<!-- more -->'))
        throw new BadRequestException('VALIDATION_FAILED: 正文必须包含 <!-- more --> 摘要标记。');
      await this.checkPath(
        input.pathname || before.articleOptions?.pathname,
        before.sourceArticleId,
      );
      const article = this.unwrap(
        await this.draftWorkflow.workflowPublish(input.id, patch, input.expectedVersion),
      );
      return this.present('article', article, 'queued');
    }
    if (input.type === 'article') {
      await this.checkPath(input.pathname, input.id);
      this.unwrap(
        await this.articleWorkflow.workflowUpdate(input.id, patch, input.expectedVersion),
      );
    } else if (input.id)
      this.unwrap(await this.draftWorkflow.workflowUpdate(input.id, patch, input.expectedVersion));
    else {
      const draft = this.unwrap(await this.draftWorkflow.workflowCreate({ user }, patch));
      return this.present('draft', draft);
    }
    return this.present(
      input.type,
      await this.read(input.type, input.id),
      input.type === 'article' ? 'queued' : undefined,
    );
  }
}
