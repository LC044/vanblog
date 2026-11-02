# 完整 API 访问

以下命令前缀为 `node <skill-dir>/scripts/vanblog.js`；全局参数 `--url URL` 可覆盖 `VANBLOG_URL`，`--timeout SECONDS` 默认 60 秒。
现有 API Token 从 `VANBLOG_API_TOKEN` 读取，经 `token` 请求头发送。服务端权限、演示站限制和业务校验照常生效。
REST API 的 `token` 请求头与 MCP 的 Bearer 认证不同；此 CLI 不经过 MCP。

## 发现接口与字段

```sh
api list --filter setting
api describe PUT /api/admin/category/{name}
api list --live --filter backup
api describe POST /api/admin/draft --live
api schema --output ./swagger.json
api describe POST /api/admin/draft --schema ./swagger.json
```

离线索引 `api-index.json` 从仓库所有 NestJS 控制器路由和请求 DTO 声明生成，包括兼容路径；不包含 MCP 协议端点。
`describe` 展开所需引用定义。离线 DTO 保留 TypeScript 声明；部分 DTO 依赖其他类型，必要时查同版本仓库源码。
在线文档来自实例 `/swagger-json`，浏览器文档为 `/swagger`。若线上 Swagger 缺少字段，以对应版本控制器和 DTO 为准。
仓库更新接口后运行 `node scripts/generate-cli-api-index.cjs`；CI 用 `--check` 验证同步。

接口包括文章、草稿、分类、标签、图片、自定义页面、站点元信息、设置、用户、API Token、访问统计、审计、备份、Caddy、流水线及公共查询等。
`api request` 没有路由白名单，即使索引尚未更新也能调用新接口；它提供完整 HTTP 传输能力，并不为每个接口另造命令。

## 请求格式

```sh
api request GET /api/admin/category/all --query detail=true
api request GET /api/admin/category/{name} --param "name=摄影 随笔"
api request POST /api/admin/category --json @category.json
api request PUT /api/admin/article/{id} --param id=12 --json @changes.json
api request DELETE /api/admin/tag/{name} --param "name=旧标签"
```

`category.json` 示例：`{"name":"摄影"}`。变更内容应写入本地 JSON，避免 shell 引号与转义问题。
支持任意 HTTP 方法，以及 JSON 对象、数组、标量。`--query key=value`、`--param key=value`、`--header 'Name: value'` 可以重复。
路径支持 `{name}` 和 `:name` 占位符，参数自动 URL 编码。传入完整的 `/api/...` 路径；不要传完整外部 URL。
自定义请求头用于接口要求的额外字段；不要在命令行传 Token。不会跟随 HTTP 重定向，以避免错误站点接收凭证。
接口有子路径部署时，`VANBLOG_URL` 可以包含站点前缀。

## 二进制、表单与下载

```sh
api request POST /api/admin/img/upload --query withWaterMark=false --form "file=@./照片.png"
api request POST /api/admin/customPage/upload --query path=demo --query name=index.html --form "file=@./demo.html"
api request GET /api/admin/backup/export --output ./backup.json
api request POST /api/admin/backup/import --form "file=@./backup.json"
api request PUT /api/example --body-file ./payload.bin --content-type application/octet-stream
```

自定义页面上传等接口的具体参数以 `api describe` 为准。备份导入仅用于用户明确要求的恢复操作。
`--form name=value` 是普通表单字段，`--form name=@path` 是文件，多个字段可重复组合，CLI 自动计算 multipart boundary 与长度并流式发送文件。
`--body-file` 发送原始字节。`--json`、`--form`、`--body-file` 三者互斥。
二进制响应必须 `--output`；下载流式写入临时文件，成功后替换目标。失败响应不覆盖现有目标文件。
普通 JSON 响应保持服务端结构。超过 128 KiB 的终端输出被拒绝；较大响应使用 `--output` 保存。敏感设置或备份也应保存文件，勿全量打印。

## 错误处理

退出码：0 成功；1 API/网络错误；2 参数或本地文件错误；3 批量图片部分失败。
HTTP 错误和 HTTP 200 中 `statusCode >= 400` 的业务错误均返回失败；233 表示博客未初始化。
写入请求没有自动重试。连接中断时可能已经写入，先查实际状态再重试，尤其是创建和发布操作。
`posts` 便利命令返回元信息；`api request` 则保留原始响应，适合按需获取便利命令未提供的数据。
