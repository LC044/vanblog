import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { ArticleWorkflow } from './provider/content/article.workflow';
import { DraftWorkflow } from './provider/content/draft.workflow';
import { MongooseModule } from '@nestjs/mongoose';
import { config } from './config/index';
import { Article, ArticleSchema } from './scheme/article.schema';
import { Draft, DraftSchema } from './scheme/draft.schema';
import { Meta, MetaSchema } from './scheme/meta.schema';
import { ArticleProvider } from './provider/article/article.provider';
import { CategoryProvider } from './provider/category/category.provider';
import { DraftProvider } from './provider/draft/draft.provider';
import { MetaProvider } from './provider/meta/meta.provider';
import { TagProvider } from './provider/tag/tag.provider';
import { JwtModule } from '@nestjs/jwt';
import { UserProvider } from './provider/user/user.provider';
import { AuthProvider } from './provider/auth/auth.provider';
import { User, UserSchema } from './scheme/user.schema';
import { LocalStrategy } from './provider/auth/local.strategy';
import { JwtStrategy } from './provider/auth/jwt.strategy';
import { InitProvider } from './provider/init/init.provider';
import { ScheduleModule } from '@nestjs/schedule';
import { Viewer, ViewerSchema } from './scheme/viewer.schema';
import { ViewerProvider } from './provider/viewer/viewer.provider';
import { Visit, VisitSchema } from './scheme/visit.schema';
import { VisitProvider } from './provider/visit/visit.provider';
import { AnalysisProvider } from './provider/analysis/analysis.provider';
import { Setting, SettingSchema } from './scheme/setting.schema';
import { Static, StaticSchema } from './scheme/static.schema';
import { SettingProvider } from './provider/setting/setting.provider';
import { StaticProvider } from './provider/static/static.provider';
import { LocalProvider } from './provider/static/local.provider';
import { PicgoProvider } from './provider/static/picgo.provider';
import { ViewerTask } from './schedule/viewer.task';
import { CaddyProvider } from './provider/caddy/caddy.provider';
import { LogProvider } from './provider/log/log.provider';
import { ISRProvider } from './provider/isr/isr.provider';
import { WalineProvider } from './provider/waline/waline.provider';
import { CacheProvider } from './provider/cache/cache.provider';
import { LoginGuard } from './provider/auth/login.guard';
import { AccessGuard } from './provider/access/access.guard';
import { ISRTask } from './schedule/isr.task';
import { CustomPage, CustomPageSchema } from './scheme/customPage.schema';
import { CustomPageProvider } from './provider/customPage/customPage.provider';
import { RssProvider } from './provider/rss/rss.provider';
import { MarkdownProvider } from './provider/markdown/markdown.provider';
import { SiteMapProvider } from './provider/sitemap/sitemap.provider';
import { TokenProvider } from './provider/token/token.provider';
import { Token, TokenSchema } from './scheme/token.schema';
import { TokenGuard } from './provider/auth/token.guard';
import { WebsiteProvider } from './provider/website/website.provider';
import { Category, CategorySchema } from './scheme/category.schema';
import { Pipeline, PipelineSchema } from './scheme/pipeline.schema';
import { PipelineProvider } from './provider/pipeline/pipeline.provider';
import { initJwt } from './utils/initJwt';
@Module({
  imports: [
    MongooseModule.forRoot(config.mongoUrl, {
      autoIndex: true,
    }),
    MongooseModule.forFeature([
      { name: Article.name, schema: ArticleSchema },
      { name: Draft.name, schema: DraftSchema },
      { name: Meta.name, schema: MetaSchema },
      { name: User.name, schema: UserSchema },
      { name: Viewer.name, schema: ViewerSchema },
      { name: Visit.name, schema: VisitSchema },
      { name: Setting.name, schema: SettingSchema },
      { name: Static.name, schema: StaticSchema },
      { name: CustomPage.name, schema: CustomPageSchema },
      { name: Token.name, schema: TokenSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Pipeline.name, schema: PipelineSchema },
    ]),
    JwtModule.registerAsync({
      useFactory: async () => {
        return {
          secret: await initJwt(),
          signOptions: {
            expiresIn: 3600 * 24 * 7,
          },
        };
      },
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    ArticleWorkflow,
    DraftWorkflow,
    AppService,
    ArticleProvider,
    CategoryProvider,
    MetaProvider,
    DraftProvider,
    PicgoProvider,
    VisitProvider,
    TagProvider,
    UserProvider,
    AuthProvider,
    LocalStrategy,
    ViewerProvider,
    JwtStrategy,
    InitProvider,
    AnalysisProvider,
    SettingProvider,
    StaticProvider,
    LocalProvider,
    ViewerTask,
    CaddyProvider,
    LogProvider,
    ISRProvider,
    WalineProvider,
    CacheProvider,
    LoginGuard,
    AccessGuard,
    ISRTask,
    CustomPageProvider,
    RssProvider,
    MarkdownProvider,
    SiteMapProvider,
    TokenProvider,
    TokenGuard,
    WebsiteProvider,
    PipelineProvider,
  ],
  exports: [
    JwtModule,
    MongooseModule,
    AppService,
    ArticleProvider,
    CategoryProvider,
    MetaProvider,
    DraftProvider,
    PicgoProvider,
    VisitProvider,
    TagProvider,
    UserProvider,
    AuthProvider,
    LocalStrategy,
    ViewerProvider,
    JwtStrategy,
    InitProvider,
    AnalysisProvider,
    SettingProvider,
    StaticProvider,
    LocalProvider,
    ViewerTask,
    CaddyProvider,
    LogProvider,
    ISRProvider,
    WalineProvider,
    CacheProvider,
    LoginGuard,
    AccessGuard,
    ISRTask,
    CustomPageProvider,
    RssProvider,
    MarkdownProvider,
    SiteMapProvider,
    TokenProvider,
    TokenGuard,
    WebsiteProvider,
    PipelineProvider,
    ArticleWorkflow,
    DraftWorkflow,
  ],
})
export class BlogServicesModule {}
