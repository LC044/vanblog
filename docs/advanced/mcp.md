# MCP 接入

VanBlog 提供 Streamable HTTP MCP 接口，让支持 MCP 的 Agent 查询文章、编写草稿、上传配图、发布和管理内容。

## 连接

在后台创建一个现有的 API Token，配置到 MCP 客户端：

```json
{
  "mcpServers": {
    "vanblog": {
      "url": "https://你的博客域名/api/mcp",
      "headers": {
        "Authorization": "Bearer <后台创建的 API Token>"
      }
    }
  }
}
```

使用已有 API Token 的管理员权限，不需要注册新的 MCP 账号或 Token。撤销 API Token 后，后续 MCP 请求立即失效。普通登录 Token 不用于 MCP。原有 REST API 的 `token` 请求头不变。

端点采用无状态 Streamable HTTP，POST 支持初始化、工具发现和调用；不提供独立 GET SSE 流或 DELETE 会话。客户端必须支持远程 HTTP 连接及自定义认证请求头。不支持 OAuth 自动登录或旧版 HTTP+SSE。

如客户端携带 Origin，其值必须等于博客配置的公开地址 origin。额外允许的 origin 可通过 `VANBLOG_MCP_ALLOWED_ORIGINS` 设置，多个完整 origin 用英文逗号分隔。不携带 Origin 的服务器客户端可直接接入。

## 六个工具

| 工具 | 用途 |
| --- | --- |
| `get_blog_info` | 博客公开信息、分类、标签和 Markdown 规则 |
| `search_posts` | 按文章/草稿、关键词、分类、标签分页查询，返回摘要 |
| `get_post` | 读取正文和版本，不返回文章密码 |
| `save_post` | 创建草稿、修改内容、发布或撤回 |
| `upload_image` | 上传 Base64 图片或转存公开 HTTP(S) 图片 |
| `delete_post` | 软删除文章或草稿 |

文章和草稿通过 `type: article | draft` 区分。查询默认文章，每页 10 条，上限 50 条；关键词搜索标题和正文，分类精确匹配，标签匹配全部指定标签。

## 写作与发布

创建草稿：

```json
{
  "type": "draft",
  "action": "save",
  "title": "用 MCP 管理博客",
  "content": "文章摘要\n\n<!-- more -->\n\n正文",
  "category": "技术",
  "tags": ["MCP"],
  "idempotencyKey": "draft-20261102-001"
}
```

`save_post` 返回草稿 ID 和整数 `version`。修改已有内容只传需要修改的字段，但必须携带读取到的 `expectedVersion`。版本不符时返回 `VERSION_CONFLICT`，应重新读取后合并修改。

```json
{
  "type": "draft",
  "id": 12,
  "action": "save",
  "content": "修改后的摘要\n\n<!-- more -->\n\n正文",
  "expectedVersion": 0
}
```

发布草稿，使用最新版本：

```json
{
  "type": "draft",
  "id": 12,
  "action": "publish",
  "pathname": "blog-with-mcp",
  "expectedVersion": 1,
  "idempotencyKey": "publish-draft-12-v1"
}
```

发布前检查摘要分隔符、路径和加密密码等条件。发布不能同时修改标题或正文，应先保存。发布设置支持 `pathname`、`hidden`、`private`、`password`、`copyright` 和 `cover`。草稿保存仅接受标题、正文、分类、标签和作者。

修改已发布文章使用 `type: article` 和 `action: save`，会直接影响线上文章。撤回使用 `type: article`、`action: unpublish`、`id`、`expectedVersion` 和 `idempotencyKey`；返回新的草稿 ID。再次发布该草稿会恢复原文章 ID、路径、访问数据及原有发布设置。

创建、发布和撤回必须提供 `idempotencyKey`。幂等结果持久保存在数据库中，同一 Token 和幂等键重试返回原结果；同一个键不能换参数使用。发生进程中断或写入结果不确定时返回 `OPERATION_INCOMPLETE`，需要先检查后台和服务端日志，勿换键反复执行。发布可能已经开始的失败会保留草稿发布锁，需管理员核对文章和草稿后处理。

发布或文章修改结果中的 `renderStatus: queued` 表示已触发 ISR，不表示页面刷新已经完成。

## 上传配图

通过 `upload_image` 转存远程图片：

```json
{ "source": "url", "url": "https://example.com/photo.jpg", "alt": "文章配图" }
```

或者上传图片原始字节的 Base64：

```json
{
  "source": "base64",
  "filename": "photo.png",
  "mimeType": "image/png",
  "data": "<不含 data: 前缀的 Base64>",
  "alt": "文章配图"
}
```

支持 PNG、JPEG、GIF、WebP、AVIF，单张上限 10 MiB。返回 `url`、`width`、`height` 和 `markdown`，将图片引用插入正文后再保存。图片复用现有图床、压缩和水印配置，水印默认请求开启，仍需后台设置已开启；可传 `withWaterMark: false` 关闭本次水印。

远程转存只接受公开 HTTP(S) 地址，逐次校验 DNS 解析和重定向，不允许访问内网、回环及保留地址。远程服务不能读取 Agent 电脑的本地文件路径。

## 开发验证

普通单元测试会跳过需要 MongoDB 的集成测试。指定 MongoDB 地址运行真实协议和存储集成测试：

```powershell
$env:VANBLOG_MCP_TEST_MONGO_URL='mongodb://127.0.0.1:27017'
pnpm --filter @vanblog/server exec jest --runInBand mcp
```

测试自动创建独立的 `vanblog_mcp_test_` 数据库和临时图床目录，结束后清理。运行环境需支持 Node.js fetch。
