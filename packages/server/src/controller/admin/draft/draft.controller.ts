import { DraftWorkflow } from 'src/provider/content/draft.workflow';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateDraftDto, PublishDraftDto, UpdateDraftDto } from 'src/types/draft.dto';
import { SortOrder } from 'src/types/sort';
import { AdminGuard } from 'src/provider/auth/auth.guard';
import { DraftProvider } from 'src/provider/draft/draft.provider';
import { ISRProvider } from 'src/provider/isr/isr.provider';
import { PipelineProvider } from 'src/provider/pipeline/pipeline.provider';
import { ApiToken } from 'src/provider/swagger/token';
import { sanitizePagination } from 'src/utils/pagination';

@ApiTags('draft')
@UseGuards(...AdminGuard)
@ApiToken
@Controller('/api/admin/draft')
export class DraftController extends DraftWorkflow {
  constructor(
    protected readonly draftProvider: DraftProvider,
    protected readonly isrProvider: ISRProvider,
    protected readonly pipelineProvider: PipelineProvider,
  ) {
    super(draftProvider, isrProvider, pipelineProvider);
  }

  @Get('/')
  async getByOption(
    @Query('page') page: number,
    @Query('pageSize') pageSize = 5,
    @Query('toListView') toListView = false,
    @Query('category') category?: string,
    @Query('tags') tags?: string,
    @Query('title') title?: string,
    @Query('sortCreatedAt') sortCreatedAt?: SortOrder,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    const paging = sanitizePagination(page, pageSize);
    const option = {
      page: paging.page,
      pageSize: paging.pageSize,
      category,
      tags,
      title,
      sortCreatedAt,
      startTime,
      endTime,
      toListView,
    };
    const data = await this.draftProvider.getByOption(option);
    return {
      statusCode: 200,
      data,
    };
  }

  @Get('/:id')
  async getOne(@Param('id') id: number) {
    const data = await this.draftProvider.findById(id);
    return {
      statusCode: 200,
      data,
    };
  }

  @Put('/:id')
  async update(@Param('id') id: number, @Body() updateDto: UpdateDraftDto) {
    return this.workflowUpdate(id, updateDto);
  }

  @Post()
  async create(@Req() req: any, @Body() createDto: CreateDraftDto) {
    return this.workflowCreate(req, createDto);
  }
  @Post('/publish')
  async publish(@Query('id') id: number, @Body() publishDto: PublishDraftDto) {
    return this.workflowPublish(id, publishDto);
  }
  @Delete('/:id')
  async delete(@Param('id') id: number) {
    return this.workflowDelete(id);
  }
}
