import { Injectable } from '@nestjs/common';
import { config } from 'src/config';
import { ArticleProvider } from 'src/provider/article/article.provider';
import { ISRProvider } from 'src/provider/isr/isr.provider';
import { PipelineProvider } from 'src/provider/pipeline/pipeline.provider';
import { assertArticleHasPassword } from 'src/utils/articleAccess';
import { CreateArticleDto, UpdateArticleDto } from 'src/types/article.dto';

@Injectable()
export class ArticleWorkflow {
  constructor(
    protected readonly articleProvider: ArticleProvider,
    protected readonly isrProvider: ISRProvider,
    protected readonly pipelineProvider: PipelineProvider,
  ) {}

  async workflowUpdate(id: number, updateDto: UpdateArticleDto, expectedVersion?: number) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改文章！',
      };
    }
    const result = await this.pipelineProvider.dispatchEvent('beforeUpdateArticle', updateDto);
    if (result.length > 0) {
      const lastResult = result[result.length - 1];
      const lastOuput = lastResult.output;
      if (lastOuput) {
        updateDto = lastOuput;
      }
    }
    const before = await this.articleProvider.getById(id, 'admin');
    assertArticleHasPassword(updateDto, before);
    const data =
      expectedVersion === undefined
        ? await this.articleProvider.updateById(id, updateDto)
        : await this.articleProvider.updateById(id, updateDto, undefined, expectedVersion);
    this.isrProvider.activeAll('更新文章触发增量渲染！', undefined, {
      postId: id,
      previousPathname: before?.pathname,
    });
    const updatedArticle = await this.articleProvider.getById(id, 'admin');
    this.pipelineProvider.dispatchEvent('afterUpdateArticle', updatedArticle);
    return {
      statusCode: 200,
      data,
    };
  }

  async workflowCreate(req: any, createDto: CreateArticleDto) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止创建文章！',
      };
    }
    const author = req?.user?.nickname || undefined;
    if (!createDto.author) {
      createDto.author = author;
    }
    const result = await this.pipelineProvider.dispatchEvent('beforeUpdateArticle', createDto);
    if (result.length > 0) {
      const lastResult = result[result.length - 1];
      const lastOuput = lastResult.output;
      if (lastOuput) {
        createDto = lastOuput;
      }
    }
    assertArticleHasPassword(createDto, null);
    const data = await this.articleProvider.create(createDto);
    this.isrProvider.activeAll('创建文章触发增量渲染！', undefined, {
      postId: data.id,
    });
    this.pipelineProvider.dispatchEvent('afterUpdateArticle', data);
    return {
      statusCode: 200,
      data,
    };
  }

  async workflowDelete(id: number, expectedVersion?: number) {
    if (config.demo && config.demo == 'true') {
      return { statusCode: 401, message: '演示站禁止删除文章！' };
    }
    const toDeleteArticle = await this.articleProvider.getById(id, 'admin');

    const data =
      expectedVersion === undefined
        ? await this.articleProvider.deleteById(id)
        : await this.articleProvider.deleteById(id, expectedVersion);
    this.pipelineProvider.dispatchEvent('deleteArticle', toDeleteArticle);
    this.isrProvider.activeAll('删除文章触发增量渲染！', undefined, {
      postId: id,
      previousPathname: toDeleteArticle?.pathname,
    });
    return {
      statusCode: 200,
      data,
    };
  }
}
