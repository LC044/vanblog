---
name: vanblog
description: 使用现有 API Token 操作 VanBlog 博客。适用于把本地 Markdown 与多张图片发布到博客、保存或修改草稿、更新文章，以及按需查询 API 完成分类、标签、设置、备份和自定义页面等操作。图片由本地 CLI 读取并以二进制上传，无需向模型传递 Base64。
---

# VanBlog 发布工作流

需要 Node.js 18+。将下文 `<skill-dir>` 替换为本 SKILL.md 所在目录的绝对路径。
CLI 与接口索引随 Skill 提供，独立复制此目录即可使用，不依赖仓库或 npm 安装。

## 连接

从运行环境读取 `VANBLOG_URL`（博客根地址）和 `VANBLOG_API_TOKEN`（后台生成的现有 API Token）。
凭证缺失时请用户在本地配置环境变量；不要要求把 Token 粘贴进对话，也不要打印凭证。
CLI 自动通过现有 REST API 的 `token` 请求头认证。

```sh
node <skill-dir>/scripts/vanblog.js info
```

获取分类、标签及站点信息，选择合适的已有分类。不要自行创建用户未要求的分类或标签。
执行前明确用户想保存草稿、发布新文章还是修改线上文章；用户已经授权发布时继续完成，不重复确认。

## 1. 上传本地图片

```sh
node <skill-dir>/scripts/vanblog.js images upload "./文章图片" --recursive --output ./upload-manifest.json
```

也可在 `upload` 后传入多个图片路径。目录默认只处理当前层，`--recursive` 包含子目录。
图片按文件流上传，不读取或打印 Base64；不要通过读取整张图片文件来构造请求参数。
读取清单中的 `images[].file`、`url`、`markdown`，按对应关系插入正文。上传命令标准输出只有清单位置与大小。
默认允许站点配置的水印；明确需要原图时使用 `--watermark false`。
退出码 3 表示部分失败，保留成功 URL，只对 `failed` 中的失败文件重试。认证或网络错误会停止剩余上传。

## 图片地址约束

所有写入文章的图片地址必须使用完整的 HTTP(S) URL；站内图片必须包含 `VANBLOG_URL` 前缀，禁止直接使用 `/static/img/...` 等相对路径或 `//...` 协议相对地址。
此约束适用于 Markdown 图片、引用式图片定义、HTML `<img src>` 和封面字段，也适用于修改已有文章和通过通用 API 写入正文。
优先使用上传清单中的完整 `url` 或 `markdown`。若接口或原文只有相对路径，将去掉末尾 `/` 的 `VANBLOG_URL` 与以 `/` 开头的图片路径拼接；已有完整 URL 不重复添加前缀。
例如 `VANBLOG_URL=https://blog.example.com` 时，`/static/img/preview.webp` 必须写为 `https://blog.example.com/static/img/preview.webp`。
保存草稿、更新文章及发布前，检查所有图片引用并补齐地址；不得为缩短正文而改回相对路径。

## 2. 写正文并保存草稿

将正文写入本地 Markdown 文件，保留用户要求的内容及图片位置。文章包含摘要与正文时使用 `<!-- more -->` 分隔。
`posts publish` 会检查此分隔符；不要自动截断正文或为了通过检查插入空摘要。

```sh
node <skill-dir>/scripts/vanblog.js posts save --title "文章标题" --category "已有分类" --tag "已有标签" --content-file ./article.md --output ./draft-result.json
```

`save` 默认创建草稿。读取结果的 `id`，后续修改同一草稿使用 `--id ID`，避免重复创建。
更多字段通过本地 JSON 文件传入 `--fields @metadata.json`；命令行显式字段覆盖 JSON 同名字段。
结果只返回元信息，不回显整篇正文或文章密码。

## 3. 发布与核验

用户要求发布时，检查标题、分类、摘要、图片 URL 后执行：

```sh
node <skill-dir>/scripts/vanblog.js posts publish DRAFT_ID --output ./published-result.json
node <skill-dir>/scripts/vanblog.js posts get ARTICLE_ID --output ./verified-result.json
```

`ARTICLE_ID` 来自发布结果，不能假设与草稿 ID 相同。发布会软删除草稿，并新建文章或恢复该草稿关联的原文章。
返回文章链接与核验结果；需要检查正文时用 `--content-output ./verified.md` 保存到文件再按需阅读。
网络中断或超时后，先通过 `posts list --type article --title "标题"` 和草稿状态核实结果，再决定是否重试；写操作不会自动重试。

## 修改已有内容

先 `posts get ID --content-output ./article.md` 读取本地正文并修改，再使用：

```sh
node <skill-dir>/scripts/vanblog.js posts save --type article --id ID --content-file ./article.md
```

`--type article` 会立即更新线上文章；编辑草稿必须指定 `--type draft`。只提交需要改变的字段。
列举草稿可用 `posts list --type draft`。删除、导入备份、重置或修改站点配置等操作仅在用户明确要求的范围内执行。

## 其他 API 操作

CLI 的 `api request` 可访问全部现有 HTTP API，不受 MCP 工具集合限制。
先阅读 [API 操作说明](references/api.md)，再按关键词查询需要的接口，不要一次加载全部索引：

```sh
node <skill-dir>/scripts/vanblog.js api list --filter category
node <skill-dir>/scripts/vanblog.js api describe POST /api/admin/category
```

随附索引对应仓库版本；部署版本不同时加 `--live` 查询实例 Swagger。优先按接口的参数、请求体类型与响应约定构造本地文件。
大型或含敏感信息的响应用 `--output` 保存，按需读取必要字段，避免整份备份、设置或正文进入上下文。
