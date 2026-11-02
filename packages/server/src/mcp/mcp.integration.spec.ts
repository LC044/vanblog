import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getModelToken } from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { createConnection, Connection } from 'mongoose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { json } from 'express';
import { config } from 'src/config';
import { Article, ArticleSchema } from 'src/scheme/article.schema';
import { Draft, DraftSchema } from 'src/scheme/draft.schema';
import { Token, TokenSchema } from 'src/scheme/token.schema';
import { Static, StaticSchema } from 'src/scheme/static.schema';
import { Category, CategorySchema } from 'src/scheme/category.schema';
import { ArticleProvider } from 'src/provider/article/article.provider';
import { DraftProvider } from 'src/provider/draft/draft.provider';
import { TokenProvider } from 'src/provider/token/token.provider';
import { MetaProvider } from 'src/provider/meta/meta.provider';
import { CategoryProvider } from 'src/provider/category/category.provider';
import { TagProvider } from 'src/provider/tag/tag.provider';
import { StaticProvider } from 'src/provider/static/static.provider';
import { LocalProvider } from 'src/provider/static/local.provider';
import { PicgoProvider } from 'src/provider/static/picgo.provider';
import { SettingProvider } from 'src/provider/setting/setting.provider';
import { VisitProvider } from 'src/provider/visit/visit.provider';
import { PipelineProvider } from 'src/provider/pipeline/pipeline.provider';
import { ISRProvider } from 'src/provider/isr/isr.provider';
import { CaddyProvider } from 'src/provider/caddy/caddy.provider';
import { LogProvider } from 'src/provider/log/log.provider';
import { InitProvider } from 'src/provider/init/init.provider';
import * as jwtUtils from 'src/utils/initJwt';
import { ArticleWorkflow } from 'src/provider/content/article.workflow';
import { DraftWorkflow } from 'src/provider/content/draft.workflow';
import { McpController } from './mcp.controller';
import { McpAuthGuard } from './mcp-auth.guard';
import { McpToolsService } from './mcp-tools.service';
import { McpImageService } from './mcp-image.service';
import { McpOperationService } from './mcp-operation.service';
import { McpOperation, McpOperationSchema } from './mcp-operation.schema';

// Opt in to a MongoDB instance; all data lives in a uniquely named temporary database.
const describeMongo = process.env.VANBLOG_MCP_TEST_MONGO_URL ? describe : describe.skip;
describeMongo('MCP HTTP + real MongoDB + existing API Token', () => {
  let app: INestApplication;
  let connection: Connection;
  let client: Client;
  let token: string;
  let url: string;
  let folder: string;
  const originalStaticPath = config.staticPath;
  const originalDemo = config.demo;
  const pipeline = { dispatchEvent: jest.fn().mockResolvedValue([]) };
  const isr = { activeAll: jest.fn() };

  beforeAll(async () => {
    connection = await createConnection(process.env.VANBLOG_MCP_TEST_MONGO_URL, {
      dbName: `vanblog_mcp_test_${process.pid}_${Date.now()}`,
    }).asPromise();
    folder = mkdtempSync(path.join(tmpdir(), 'vanblog-mcp-'));
    config.staticPath = folder;
    config.demo = false;
    mkdirSync(path.join(folder, 'img'));
    const definitions: Array<[any, any]> = [
      [Article, ArticleSchema],
      [Draft, DraftSchema],
      [Token, TokenSchema],
      [Static, StaticSchema],
      [Category, CategorySchema],
      [McpOperation, McpOperationSchema],
    ];
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'mcp-integration-only-secret' })],
      controllers: [McpController],
      providers: [
        ...definitions.map(([type, schema]) => ({
          provide: getModelToken(type.name),
          useValue: connection.model(type.name, schema),
        })),
        McpAuthGuard,
        McpToolsService,
        McpImageService,
        McpOperationService,
        ArticleProvider,
        DraftProvider,
        TokenProvider,
        ArticleWorkflow,
        DraftWorkflow,
        StaticProvider,
        LocalProvider,
        {
          provide: MetaProvider,
          useValue: {
            getSiteInfo: async () => ({
              siteName: 'Test blog',
              author: 'Author',
              baseUrl: 'https://blog.example.com',
            }),
            updateTotalWords: jest.fn(),
          },
        },
        { provide: CategoryProvider, useValue: { getAllCategories: async () => ['技术'] } },
        { provide: TagProvider, useValue: { getAllTags: async () => ['MCP'] } },
        {
          provide: SettingProvider,
          useValue: {
            getStaticSetting: async () => ({ storageType: 'local', enableWebp: 'false' }),
            getLoginSetting: async () => ({}),
          },
        },
        { provide: PicgoProvider, useValue: {} },
        { provide: VisitProvider, useValue: {} },
        { provide: PipelineProvider, useValue: pipeline },
        { provide: ISRProvider, useValue: isr },
      ],
    }).compile();
    app = module.createNestApplication({ bodyParser: false, logger: false });
    app.use(json({ limit: '50mb' }));
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/api/mcp`;
    token = await app.get(TokenProvider).createAPIToken('integration');
    client = new Client({ name: 'integration-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
  }, 30000);

  afterAll(async () => {
    await client?.close();
    if (connection?.name.startsWith('vanblog_mcp_test_')) await connection.dropDatabase();
    await app?.close();
    await connection?.close();
    if (folder) rmSync(folder, { recursive: true, force: true });
    config.staticPath = originalStaticPath;
    config.demo = originalDemo;
  });

  async function call(name: string, args: any = {}) {
    return client.callTool({ name, arguments: args });
  }
  async function success(name: string, args: any = {}) {
    const result: any = await call(name, args);
    expect(result.isError).not.toBe(true);
    return result.structuredContent || JSON.parse(result.content[0].text);
  }

  it('negotiates the protocol and lists exactly six tools', async () => {
    const list = await client.listTools();
    expect(list.tools.map((tool) => tool.name).sort()).toEqual(
      [
        'get_blog_info',
        'search_posts',
        'get_post',
        'save_post',
        'upload_image',
        'delete_post',
      ].sort(),
    );
    expect(await success('get_blog_info')).toMatchObject({
      siteName: 'Test blog',
      categories: ['技术'],
    });
  });

  it('rejects missing, forged, expired, login and revoked tokens and untrusted origins', async () => {
    await request(app.getHttpServer()).post('/api/mcp').send({}).expect(401);
    for (const bad of [
      'invalid',
      app.get(JwtService).sign({ sub: 0, role: 'admin' }, { expiresIn: -1 }),
      await app.get(TokenProvider).createToken({ sub: 0, username: 'login-only', role: 'admin' }),
    ])
      await request(app.getHttpServer())
        .post('/api/mcp')
        .set('Authorization', `Bearer ${bad}`)
        .send({})
        .expect(401);
    const revoked = await app.get(TokenProvider).createAPIToken('revoked');
    await app.get(TokenProvider).disableAPIToken(revoked);
    await request(app.getHttpServer())
      .post('/api/mcp')
      .set('Authorization', `Bearer ${revoked}`)
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(403);
    const response = await request(app.getHttpServer())
      .get('/api/mcp')
      .set('Authorization', `Bearer ${token}`)
      .expect(405);
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('uploads real image bytes through the configured local image storage', async () => {
    const buffer = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    const image = await success('upload_image', {
      source: 'base64',
      filename: 'photo.png',
      mimeType: 'image/png',
      data: buffer.toString('base64'),
    });
    expect(image).toMatchObject({ width: 8, height: 6 });
    expect(image.url).toMatch(/^https:\/\/blog.example.com\/static\/img\//);
    expect(await connection.model(Static.name).countDocuments({})).toBe(1);
    const rejected: any = await call('upload_image', {
      source: 'url',
      url: 'http://169.254.169.254/secret',
    });
    expect(rejected.isError).toBe(true);
  });

  it('creates, reads, searches, edits, publishes, withdraws, restores and soft deletes without changing article identity', async () => {
    const input = {
      title: 'MCP 示例',
      content: '摘要\n<!-- more -->\n正文 ![](/static/img/a.png)',
      category: '技术',
      tags: ['MCP'],
      idempotencyKey: 'create-post',
    };
    const draft = await success('save_post', input);
    expect(await success('save_post', input)).toEqual(draft);
    expect(await connection.model(Draft.name).countDocuments({})).toBe(1);
    const edited = await success('save_post', {
      type: 'draft',
      id: draft.id,
      title: 'MCP 更新',
      expectedVersion: draft.version,
    });
    expect(edited.version).toBe(draft.version + 1);
    const stale: any = await call('save_post', {
      type: 'draft',
      id: draft.id,
      content: 'stale',
      expectedVersion: draft.version,
    });
    expect(stale.isError).toBe(true);
    const found = await success('search_posts', { type: 'draft', keyword: '正文', tags: ['MCP'] });
    expect(found.total).toBe(1);
    expect(found.items[0].content).toBeUndefined();
    const publish = {
      type: 'draft',
      id: draft.id,
      action: 'publish',
      expectedVersion: edited.version,
      pathname: 'mcp-test',
      private: true,
      password: 'secret',
      idempotencyKey: 'publish-post',
    };
    const article = await success('save_post', publish);
    expect(article.url).toBe('https://blog.example.com/post/mcp-test');
    expect(article.password).toBeUndefined();
    expect(await success('save_post', publish)).toEqual(article);
    const withdrawn = await success('save_post', {
      type: 'article',
      id: article.id,
      action: 'unpublish',
      expectedVersion: article.version,
      idempotencyKey: 'withdraw-post',
    });
    expect((await call('get_post', { type: 'article', id: article.id })).isError).toBe(true);
    const restored = await success('save_post', {
      type: 'draft',
      id: withdrawn.id,
      action: 'publish',
      expectedVersion: withdrawn.version,
      idempotencyKey: 'restore-post',
    });
    expect(restored.id).toBe(article.id);
    expect(restored.url).toBe(article.url);
    expect(restored.private).toBe(true);
    expect(restored.password).toBeUndefined();
    expect(await connection.model(Article.name).countDocuments({})).toBe(1);
    expect(pipeline.dispatchEvent).toHaveBeenCalledWith('afterUpdateArticle', expect.anything());
    expect(isr.activeAll).toHaveBeenCalled();
    await success('delete_post', {
      type: 'article',
      id: restored.id,
      expectedVersion: restored.version,
    });
    expect(await connection.model(Article.name).findOne({ id: restored.id }).lean()).toMatchObject({
      deleted: true,
    });
  });

  it('detects REST edits and allows only one competing versioned update', async () => {
    const draft = await success('save_post', {
      title: 'Concurrent',
      category: '技术',
      idempotencyKey: 'concurrent-create',
    });
    await app.get(DraftWorkflow).workflowUpdate(draft.id, { title: 'REST edit' });
    expect(
      (
        await call('save_post', {
          type: 'draft',
          id: draft.id,
          title: 'overwrite',
          expectedVersion: draft.version,
        })
      ).isError,
    ).toBe(true);
    const latest = await success('get_post', { type: 'draft', id: draft.id });
    const results: any[] = await Promise.all(
      ['one', 'two'].map((title) =>
        call('save_post', { type: 'draft', id: draft.id, title, expectedVersion: latest.version }),
      ),
    );
    expect(results.filter((result) => result.isError)).toHaveLength(1);
    const mismatched: any = await call('save_post', {
      title: 'different',
      category: '技术',
      idempotencyKey: 'concurrent-create',
    });
    expect(mismatched.isError).toBe(true);
  });

  it('does not publish a draft twice when two distinct requests compete', async () => {
    const draft = await success('save_post', {
      title: 'Publish once',
      category: '技术',
      content: 'summary<!-- more -->body',
      idempotencyKey: 'publish-race-create',
    });
    const results: any[] = await Promise.all(
      ['a', 'b'].map((suffix) =>
        call('save_post', {
          type: 'draft',
          id: draft.id,
          action: 'publish',
          expectedVersion: draft.version,
          idempotencyKey: `publish-race-${suffix}`,
        }),
      ),
    );
    expect(results.filter((result) => result.isError)).toHaveLength(1);
    expect(await connection.model(Article.name).countDocuments({ title: 'Publish once' })).toBe(1);
  });

  it('resolves the production module graph and exposes MCP through the root application', async () => {
    const originalMongoUrl = config.mongoUrl;
    const target = new URL(process.env.VANBLOG_MCP_TEST_MONGO_URL);
    target.pathname = `/${connection.name}`;
    config.mongoUrl = target.href;
    const jwt = jest.spyOn(jwtUtils, 'initJwt').mockResolvedValue('mcp-integration-only-secret');
    let rootApp: INestApplication;
    try {
      const { AppModule } = await import('src/app.module');
      const { JwtStrategy } = await import('src/provider/auth/jwt.strategy');
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(JwtStrategy)
        .useValue({})
        .overrideProvider(CaddyProvider)
        .useValue({})
        .overrideProvider(LogProvider)
        .useValue({})
        .overrideProvider(PipelineProvider)
        .useValue(pipeline)
        .overrideProvider(PicgoProvider)
        .useValue({})
        .overrideProvider(InitProvider)
        .useValue({ checkHasInited: async () => true })
        .compile();
      rootApp = module.createNestApplication({ logger: false });
      await rootApp.init();
      const document = SwaggerModule.createDocument(
        rootApp,
        new DocumentBuilder().setTitle('VanBlog test').setVersion('1.0').build(),
      );
      expect(document.paths['/api/admin/article']).toBeDefined();
      await request(rootApp.getHttpServer())
        .get('/api/mcp')
        .set('Authorization', `Bearer ${token}`)
        .expect(405);
    } finally {
      await rootApp?.close();
      jwt.mockRestore();
      config.mongoUrl = originalMongoUrl;
    }
  });
});
