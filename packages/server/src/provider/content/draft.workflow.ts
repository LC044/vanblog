import { Injectable, ForbiddenException } from '@nestjs/common';
import { config } from 'src/config';
import { DraftProvider } from 'src/provider/draft/draft.provider';
import { ISRProvider } from 'src/provider/isr/isr.provider';
import { PipelineProvider } from 'src/provider/pipeline/pipeline.provider';
import { CreateDraftDto, UpdateDraftDto, PublishDraftDto } from 'src/types/draft.dto';

@Injectable()
export class DraftWorkflow {
  constructor(
    protected readonly draftProvider: DraftProvider,
    protected readonly isrProvider: ISRProvider,
    protected readonly pipelineProvider: PipelineProvider,
  ) {}

  async workflowUpdate(id: number, updateDto: UpdateDraftDto, expectedVersion?: number) {
    if (config.demo === 'true') throw new ForbiddenException('演示站禁止修改内容！');
    const result = await this.pipelineProvider.dispatchEvent('beforeUpdateDraft', updateDto);
    if (result.length > 0) {
      const lastResult = result[result.length - 1];
      const lastOuput = lastResult.output;
      if (lastOuput) {
        updateDto = lastOuput;
      }
    }
    const data =
      expectedVersion === undefined
        ? await this.draftProvider.updateById(id, updateDto)
        : await this.draftProvider.updateById(id, updateDto, expectedVersion);
    const updated = await this.draftProvider.findById(id);
    this.pipelineProvider.dispatchEvent('afterUpdateDraft', updated);
    return {
      statusCode: 200,
      data,
    };
  }

  async workflowCreate(req: any, createDto: CreateDraftDto) {
    if (config.demo === 'true') throw new ForbiddenException('演示站禁止修改内容！');
    const author = req?.user?.nickname || undefined;
    if (!createDto.author) {
      createDto.author = author;
    }
    const result = await this.pipelineProvider.dispatchEvent('beforeUpdateDraft', createDto);
    if (result.length > 0) {
      const lastResult = result[result.length - 1];
      const lastOuput = lastResult.output;
      if (lastOuput) {
        createDto = lastOuput;
      }
    }
    const data = await this.draftProvider.create(createDto);
    this.pipelineProvider.dispatchEvent('afterUpdateDraft', data);
    return {
      statusCode: 200,
      data,
    };
  }

  async workflowDelete(id: number, expectedVersion?: number) {
    if (config.demo === 'true') throw new ForbiddenException('演示站禁止修改内容！');
    const toDeleteDraft = await this.draftProvider.findById(id);
    const data =
      expectedVersion === undefined
        ? await this.draftProvider.deleteById(id)
        : await this.draftProvider.deleteById(id, expectedVersion);
    this.pipelineProvider.dispatchEvent('deleteDraft', toDeleteDraft);
    return {
      statusCode: 200,
      data,
    };
  }

  async workflowPublish(id: number, publishDto: PublishDraftDto, expectedVersion?: number) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止发布草稿！',
      };
    }
    const result = await this.pipelineProvider.dispatchEvent('beforeUpdateArticle', publishDto);
    if (result.length > 0) {
      const lastResult = result[result.length - 1];
      const lastOuput = lastResult.output;
      if (lastOuput) {
        publishDto = lastOuput;
      }
    }
    const data =
      expectedVersion === undefined
        ? await this.draftProvider.publish(id, publishDto)
        : await this.draftProvider.publish(id, publishDto, expectedVersion);
    this.isrProvider.activeAll('发布草稿触发增量渲染！');
    this.pipelineProvider.dispatchEvent('afterUpdateArticle', data);
    return {
      statusCode: 200,
      data,
    };
  }
}
