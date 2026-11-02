import { versionFilter, assertVersionMatched } from 'src/utils/contentVersion';
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateArticleDto } from 'src/types/article.dto';
import {
  CreateDraftDto,
  PublishDraftDto,
  SearchDraftOption,
  UpdateDraftDto,
} from 'src/types/draft.dto';
import { Draft, DraftDocument } from 'src/scheme/draft.schema';
import { ArticleProvider } from '../article/article.provider';
import { parseNumericId } from 'src/utils/numericId';
import { sanitizePagination } from 'src/utils/pagination';
import { sleep } from 'src/utils/sleep';
import {
  prepareRewriteBases,
  rewriteBaseUrlInDocuments,
  RewriteBaseUrlCount,
} from 'src/utils/rewriteBaseUrl';
import { assertArticleHasPassword } from 'src/utils/articleAccess';
export type DraftView = 'admin' | 'public' | 'list';
@Injectable()
export class DraftProvider {
  idLock = false;
  constructor(
    @InjectModel('Draft') private draftModel: Model<DraftDocument>,
    private readonly articleProvider: ArticleProvider,
  ) {}
  publicView = {
    title: 1,
    content: 1,
    tags: 1,
    category: 1,
    version: 1,
    updatedAt: 1,
    createdAt: 1,
    author: 1,
    id: 1,
    _id: 0,
  };

  adminView = {
    title: 1,
    content: 1,
    tags: 1,
    category: 1,
    version: 1,
    updatedAt: 1,
    createdAt: 1,
    author: 1,
    id: 1,
    _id: 0,
  };

  listView = {
    title: 1,
    tags: 1,
    category: 1,
    version: 1,
    updatedAt: 1,
    createdAt: 1,
    author: 1,
    id: 1,
    _id: 0,
  };

  getView(view: DraftView) {
    let thisView: any = this.adminView;
    switch (view) {
      case 'admin':
        thisView = this.adminView;
        break;
      case 'list':
        thisView = this.listView;
        break;
      case 'public':
        thisView = this.publicView;
    }
    return thisView;
  }
  async create(createDraftDto: CreateDraftDto): Promise<Draft> {
    const createdData = new this.draftModel(createDraftDto);
    const newId = await this.getNewId();
    createdData.id = newId;
    return createdData.save();
  }
  async importDrafts(drafts: Draft[]) {
    // 题目相同就合并，以导入的优先
    // for (let i = 0; i < drafts.length; i++) {
    //   const newId = await this.getNewId();
    //   drafts[i].id = newId;
    // }
    for (const draft of drafts) {
      const { id, ...createDto } = draft;
      const title = draft.title;
      const oldDraft = await this.findOneByTitle(title);
      if (oldDraft) {
        this.updateById(oldDraft.id, { ...createDto, deleted: false });
      } else {
        await this.create(createDto);
      }
    }
  }

  async rewriteBaseUrl(oldBase?: string, newBase?: string): Promise<RewriteBaseUrlCount> {
    const bases = prepareRewriteBases(oldBase, newBase);
    if (!bases) {
      return { updated: 0, replacements: 0 };
    }
    const drafts = await this.draftModel.find({
      $or: [
        {
          deleted: false,
        },
        {
          deleted: { $exists: false },
        },
      ],
    });
    return rewriteBaseUrlInDocuments(
      drafts || [],
      async (id, content) => {
        await this.draftModel.updateOne(
          { id },
          { $set: { content, updatedAt: new Date() }, $inc: { version: 1 } },
        );
      },
      bases.oldBase,
      bases.newBase,
    );
  }

  async getByOption(option: SearchDraftOption): Promise<{ drafts: Draft[]; total: number }> {
    const query: any = {};
    const $and: any = [
      {
        $or: [
          {
            deleted: false,
          },
          {
            deleted: { $exists: false },
          },
        ],
      },
    ];
    const and = [];
    const sort: any = { createdAt: -1 };
    if (option.sortCreatedAt) {
      if (option.sortCreatedAt == 'asc') {
        sort.createdAt = 1;
      }
    }
    if (option.tags) {
      const tags = option.tags.split(',');
      const or: any = [];
      tags.forEach((t) => {
        or.push({
          tags: { $regex: `${t}`, $options: 'i' },
        });
      });
      and.push({ $or: or });
    }
    if (option.category) {
      and.push({
        category: { $regex: `${option.category}`, $options: 'i' },
      });
    }
    if (option.title) {
      and.push({
        title: { $regex: `${option.title}`, $options: 'i' },
      });
    }
    if (option.startTime || option.endTime) {
      const obj: any = {};
      if (option.startTime) {
        obj['$gte'] = new Date(option.startTime);
      }
      if (option.endTime) {
        obj['$lte'] = new Date(option.endTime);
      }
      $and.push({ createdAt: obj });
    }

    if (and.length) {
      $and.push({ $and: and });
    }

    query.$and = $and;
    const view = option.toListView ? this.listView : this.adminView;

    const paging = sanitizePagination(option.page, option.pageSize);
    const drafts = await this.draftModel
      .find(query, view)
      .sort(sort)
      .skip(paging.skip)
      .limit(paging.pageSize)
      .exec();
    const total = await this.draftModel.count(query).exec();

    return {
      drafts,
      total,
    };
  }
  async publish(id: number, options: PublishDraftDto, expectedVersion?: number) {
    const filter: any = {
      ...versionFilter(parseNumericId(id), expectedVersion),
      deleted: false,
      publishing: { $ne: true },
    };
    const draft = await this.draftModel.findOneAndUpdate(
      filter,
      { $set: { publishing: true } },
      { new: true },
    );
    if (!draft) throw new ConflictException('VERSION_CONFLICT: 草稿已修改、已删除或正在发布。');
    let writeStarted = false;
    try {
      if (!(draft.content || '').includes('<!-- more -->'))
        throw new ForbiddenException('未包含 more 标记，请修改后再发布！');
      const articleOptions = { ...(draft.articleOptions || {}), ...options };
      assertArticleHasPassword(articleOptions, null);
      const dto: any = {
        ...articleOptions,
        title: draft.title,
        content: draft.content,
        tags: draft.tags,
        category: draft.category,
        author: draft.author,
      };
      let article: any;
      if (draft.publishedArticleId) {
        article = await this.articleProvider.getById(draft.publishedArticleId, 'admin');
        if (!article)
          throw new ConflictException('OPERATION_INCOMPLETE: 已发布文章不可用，请检查博客状态。');
      } else if (draft.sourceArticleId) {
        writeStarted = true;
        await this.articleProvider.updateById(
          draft.sourceArticleId,
          { ...dto, deleted: false },
          false,
          draft.sourceArticleVersion,
        );
        article = await this.articleProvider.getById(draft.sourceArticleId, 'admin');
      } else {
        writeStarted = true;
        article = await this.articleProvider.create(dto);
      }
      await this.draftModel.updateOne(
        { id: draft.id },
        {
          $set: {
            publishedArticleId: article.id,
            deleted: true,
            publishing: false,
            updatedAt: new Date(),
          },
          $inc: { version: 1 },
        },
      );
      return article;
    } catch (error) {
      // Once a write may have happened, keep the lock on uncertain failures.
      // An operator must reconcile it rather than risk publishing a second article.
      if (!writeStarted)
        await this.draftModel.updateOne({ id: draft.id }, { $set: { publishing: false } });
      throw error;
    }
  }

  async unpublish(articleId: number, expectedVersion: number) {
    const article = await this.articleProvider.getById(articleId, 'admin');
    if (!article) throw new NotFoundException('找不到文章');
    if ((article.version || 0) !== expectedVersion)
      throw new ConflictException('VERSION_CONFLICT: 文章已修改。');
    const {
      title,
      content,
      tags,
      category,
      author,
      pathname,
      private: isPrivate,
      password,
      hidden,
      copyright,
      cover,
      top,
    } = article;
    const draft = await this.create({
      title,
      content,
      tags,
      category,
      author,
      sourceArticleId: articleId,
      sourceArticleVersion: expectedVersion + 1,
      articleOptions: { pathname, private: isPrivate, password, hidden, copyright, cover, top },
    } as any);
    try {
      await this.articleProvider.deleteById(articleId, expectedVersion);
    } catch (error) {
      if (error instanceof ConflictException) await this.deleteById(draft.id);
      throw error;
    }
    return draft;
  }

  async getAll(): Promise<Draft[]> {
    return this.draftModel.find({ deleted: false }).exec();
  }

  async getById(id: number | string): Promise<Draft> {
    const numericId = parseNumericId(id);
    return this.draftModel.findOne({ id: numericId, deleted: false }).exec();
  }
  async findById(id: number | string): Promise<Draft> {
    const numericId = parseNumericId(id);
    return this.draftModel.findOne({ id: numericId }).exec();
  }
  async findOneByTitle(title: string): Promise<Draft> {
    return this.draftModel.findOne({ title }).exec();
  }

  async searchByString(str: string): Promise<Draft[]> {
    return this.draftModel
      .find({
        $or: [
          { content: { $regex: `*${str}*`, $options: 'i' } },
          { title: { $regex: `*${str}*`, $options: 'i' } },
        ],
      })
      .exec();
  }

  async findAll(): Promise<Draft[]> {
    return this.draftModel.find().exec();
  }
  async deleteById(id: number | string, expectedVersion?: number) {
    const numericId = parseNumericId(id);
    const result = await this.draftModel
      .updateOne(
        { ...versionFilter(numericId, expectedVersion), publishing: { $ne: true } },
        { $set: { deleted: true, updatedAt: new Date() }, $inc: { version: 1 } },
      )
      .exec();
    assertVersionMatched(result, expectedVersion);
    if (result.matchedCount === 0)
      throw new ConflictException('VERSION_CONFLICT: 草稿不存在或正在发布。');
    return result;
  }

  async updateCategoryName(oldName: string, newName: string) {
    if (!oldName || !newName || oldName === newName) {
      return { modifiedCount: 0 };
    }
    return this.draftModel.updateMany(
      { category: oldName },
      { $set: { category: newName, updatedAt: new Date() }, $inc: { version: 1 } },
    );
  }

  async updateById(id: number | string, updateDraftDto: UpdateDraftDto, expectedVersion?: number) {
    const numericId = parseNumericId(id);
    const { version: _version, ...changes } = updateDraftDto as UpdateDraftDto & {
      version?: number;
    };
    const result = await this.draftModel.updateOne(
      { ...versionFilter(numericId, expectedVersion), publishing: { $ne: true } },
      { $set: { ...changes, updatedAt: new Date() }, $inc: { version: 1 } },
    );
    assertVersionMatched(result, expectedVersion);
    if (result.matchedCount === 0)
      throw new ConflictException('VERSION_CONFLICT: 草稿不存在或正在发布。');
    return result;
  }

  async getNewId() {
    while (this.idLock) {
      await sleep(10);
    }
    this.idLock = true;
    const maxObj = await this.draftModel.find({}).sort({ id: -1 }).limit(1);
    let res = 1;
    if (maxObj.length) {
      res = maxObj[0].id + 1;
    }
    this.idLock = false;
    return res;
  }
}
