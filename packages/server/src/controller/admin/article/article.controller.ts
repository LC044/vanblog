import { ArticleWorkflow } from 'src/provider/content/article.workflow';
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
import { CreateArticleDto, UpdateArticleDto } from 'src/types/article.dto';
import { SortOrder } from 'src/types/sort';
import { ArticleProvider } from 'src/provider/article/article.provider';
import { AdminGuard } from 'src/provider/auth/auth.guard';
import { ISRProvider } from 'src/provider/isr/isr.provider';
import { PipelineProvider } from 'src/provider/pipeline/pipeline.provider';
import { ApiToken } from 'src/provider/swagger/token';
import { sanitizePagination } from 'src/utils/pagination';
@ApiTags('article')
@ApiToken
@UseGuards(...AdminGuard)
@Controller('/api/admin/article')
export class ArticleController extends ArticleWorkflow {
  constructor(
    protected readonly articleProvider: ArticleProvider,
    protected readonly isrProvider: ISRProvider,
    protected readonly pipelineProvider: PipelineProvider,
  ) {
    super(articleProvider, isrProvider, pipelineProvider);
  }

  @Get('/')
  async getByOption(
    @Query('page') page: number,
    @Query('pageSize') pageSize = 5,
    @Query('toListView') toListView = false,
    @Query('regMatch') regMatch = true,
    @Query('category') category?: string,
    @Query('tags') tags?: string,
    @Query('title') title?: string,
    @Query('sortCreatedAt') sortCreatedAt?: SortOrder,
    @Query('sortTop') sortTop?: SortOrder,
    @Query('sortViewer') sortViewer?: SortOrder,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    const paging = sanitizePagination(page, pageSize, { allowUnlimited: true });
    const option = {
      page: paging.page,
      pageSize: paging.pageSize,
      category,
      tags,
      title,
      sortCreatedAt,
      sortTop,
      startTime,
      endTime,
      toListView,
      regMatch,
      sortViewer,
    };
    const data = await this.articleProvider.getByOption(option, false);
    return {
      statusCode: 200,
      data,
    };
  }

  @Get('/:id')
  async getOneByIdOrPathname(@Param('id') id: string) {
    const data = await this.articleProvider.getByIdOrPathname(id, 'admin');
    return {
      statusCode: 200,
      data,
    };
  }

  @Put('/:id')
  async update(@Param('id') id: number, @Body() updateDto: UpdateArticleDto) {
    return this.workflowUpdate(id, updateDto);
  }

  @Post()
  async create(@Req() req: any, @Body() createDto: CreateArticleDto) {
    return this.workflowCreate(req, createDto);
  }
  @Post('searchByLink')
  async searchArtcilesByLink(@Body() searchDto: { link: string }) {
    const data = await this.articleProvider.searchArticlesByLink(searchDto?.link || '');
    return {
      statusCode: 200,
      data,
    };
  }
  @Delete('/:id')
  async delete(@Param('id') id: number) {
    return this.workflowDelete(id);
  }
}
