# VanBlog CLI

完整的 VanBlog HTTP API 客户端，以及以文章发布为主的 Agent Skill。Node.js 18+，客户端脚本只依赖 Node.js 内置模块。

配置 `VANBLOG_URL` 与 `VANBLOG_API_TOKEN`（复用后台已有 API Token），不需要 MCP。

```sh
node packages/cli/skills/vanblog/scripts/vanblog.js --help
node packages/cli/skills/vanblog/scripts/vanblog.js info
node packages/cli/skills/vanblog/scripts/vanblog.js images upload ./photos --output ./images.json
node packages/cli/skills/vanblog/scripts/vanblog.js posts save --title "标题" --category "技术" --content-file ./article.md
node packages/cli/skills/vanblog/scripts/vanblog.js posts publish DRAFT_ID
```

图片从磁盘流式上传，返回 URL 清单，不经过模型 Base64 参数。正文从本地 Markdown 读取。
`posts save` 默认草稿；`--type article --id ID` 立即修改线上文章。发布检查 `<!-- more -->` 摘要分隔符。

全部 API 通过通用命令调用，支持任意 HTTP 方法、JSON 文件、查询/路径参数、multipart 文件和流式下载：

```sh
node packages/cli/skills/vanblog/scripts/vanblog.js api list --filter category
node packages/cli/skills/vanblog/scripts/vanblog.js api describe POST /api/admin/category
node packages/cli/skills/vanblog/scripts/vanblog.js api request POST /api/admin/category --json @category.json
node packages/cli/skills/vanblog/scripts/vanblog.js api request GET /api/admin/backup/export --output ./backup.json
```

也可以 `npm install -g ./packages/cli` 安装 `vanblog` 命令。仅使用 Skill 时，将整个 [skills/vanblog](skills/vanblog/SKILL.md) 目录复制至 Agent 的 skills 目录，例如 `~/.codex/skills/vanblog`；脚本与离线 API 索引随目录提供，可独立使用。

Skill 主文只描述发布工作流；其他能力按需查阅 [API 操作说明](skills/vanblog/references/api.md)，可使用 `--live` 查询部署实例 Swagger。
大型或敏感响应使用 `--output`，不要把 API Token、备份或完整设置输出到对话。

开发检查：

```sh
pnpm --filter vanblog-cli test
node scripts/generate-cli-api-index.cjs --check
```

原有 `resetHttps.js` 保留，用于服务器 HTTPS 重置维护。
