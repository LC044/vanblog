import { BlogServicesModule } from './blog-services.module';
import { McpModule } from './mcp/mcp.module';
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AppController } from './app.controller';
import { PublicController } from './controller/public/public.controller';
import { AboutMetaController } from './controller/admin/about/about.meta.controller';
import { LinkMetaController } from './controller/admin/link/link.meta.controller';
import { RewardMetaController } from './controller/admin/reward/reward.meta.controller';
import { SiteMetaController } from './controller/admin/site/site.meta.controller';
import { SocialMetaController } from './controller/admin/social/social.meta.controller';
import { TagController } from './controller/admin/tag/tag.controller';
import { ArticleController } from './controller/admin/article/article.controller';
import { DraftController } from './controller/admin/draft/draft.controller';
import { CategoryController } from './controller/admin/category/category.controller';
import { AuthController } from './controller/admin/auth/auth.controller';
import { InitController } from './controller/admin/init/init.controller';
import { InitMiddleware } from './provider/auth/init.middleware';
import { NoStoreCacheMiddleware } from './provider/cache/no-store.middleware';
import { BackupController } from './controller/admin/backup/backup.controller';
import { MenuMetaController } from './controller/admin/menu/menu.meta.controller';
import { MetaController } from './controller/admin/meta/meta.controller';
import { AnalysisController } from './controller/admin/analysis/analysis.controller';
import { ImgController } from './controller/admin/img/img.controller';
import { SettingController } from './controller/admin/setting/setting.controller';
import { CaddyController } from './controller/admin/caddy/caddy.controller';
import { LogController } from './controller/admin/log/log.controller';
import { CollaboratorController } from './controller/admin/collaborator/collaborator.controller';
import { ISRController } from './controller/admin/isr/isr.controller';
import { CustomPageController } from './controller/admin/customPage/customPage.controller';
import {
  PublicCustomPageController,
  PublicOldCustomPageRedirectController,
} from './controller/customPage/customPage.controller';
import { PipelineController } from './controller/admin/pipeline/pipeline.controller';
import { TokenController } from './controller/admin/token/token.controller';

@Module({
  imports: [BlogServicesModule, McpModule],
  controllers: [
    AppController,
    PublicController,
    AboutMetaController,
    LinkMetaController,
    RewardMetaController,
    SiteMetaController,
    SocialMetaController,
    TagController,
    ArticleController,
    DraftController,
    CategoryController,
    AuthController,
    InitController,
    MenuMetaController,
    BackupController,
    MetaController,
    AnalysisController,
    SettingController,
    ImgController,
    CaddyController,
    LogController,
    CollaboratorController,
    ISRController,
    CustomPageController,
    PublicCustomPageController,
    PublicOldCustomPageRedirectController,
    PipelineController,
    TokenController,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NoStoreCacheMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });
    consumer
      .apply(InitMiddleware)
      .exclude(
        { path: '/api/admin/img/upload', method: RequestMethod.POST },
        { path: '/api/admin/init/upload', method: RequestMethod.POST },
        { path: '/api/admin/caddy/ask', method: RequestMethod.GET },
      )
      .forRoutes({
        path: '*',
        method: RequestMethod.ALL,
      });
  }
}
