# GitHub Container Registry 镜像

本仓库通过 `.github/workflows/docker-ghcr.yml` 构建完整 VanBlog 镜像，包含后台、博客前台、服务端和评论服务。

镜像地址自动使用小写仓库名称。`LC044/vanblog` 对应：

```text
ghcr.io/lc044/vanblog
```

## 自动构建条件

| 操作 | 生成标签 |
| --- | --- |
| 推送默认分支（master/main） | `edge`、`branch-master` 或 `branch-main`、`sha-<短提交号>` |
| 推送另一条 master/main 分支 | 对应 `branch-*`、`sha-*`，不覆盖 `edge` |
| 推送正式版本标签，例如 `v0.54.1` | `v0.54.1`、`0.54.1`、`0.54`、`latest`、`sha-*` |
| 推送预发布版本标签，例如 `v0.55.0-beta.1` | 原始版本标签、语义化版本标签、`sha-*`，不覆盖 `latest` |
| 发布 GitHub Release | 按该 Release 的标签构建；标记为预发布的 Release 不覆盖 `latest` |
| 手动运行 Docker GHCR | 按所选分支或标签生成标签 |
| 产品文件相关 Pull Request | 构建验证和测试，不登录镜像仓库、不推送镜像 |

`edge` 跟随默认分支的开发提交，`latest` 跟随正式版本发布。第一次只有分支构建时可使用 `edge`，正式版本发布后才会出现 `latest`。

标签推送和后续发布 Release 都会触发工作流；同一版本可能运行两次，构建缓存会被复用。

## 构建与权限

参考 TrailSnap 的构建方式，分别在原生 amd64、arm64 runner 上构建镜像，避免 QEMU 编译开销。两种架构构建成功、服务端与真实 MongoDB MCP 集成测试通过后，再合并并发布统一的多架构标签。每个架构使用独立的 GitHub Actions 构建缓存。

工作流使用内置 `GITHUB_TOKEN`，在镜像构建和发布任务中声明 `packages: write`，无需配置 Docker Hub Token 或额外的 PAT。镜像包含源码仓库、提交和版本 OCI 标签，并关联当前仓库。

首次发布后的 GHCR 包通常是 Private。如需服务器匿名拉取，在 GitHub 用户的 Packages 页面进入 `vanblog` 包设置，将可见性设为 Public。此操作由包管理员在 GitHub 中完成，工作流不会修改可见性。

如果已有同名 GHCR 包但出现 `permission_denied`，检查包的 Manage Actions access 是否允许当前仓库写入，以及组织是否限制工作流权限。

仓库原有 `release.yml` 依赖上游作者的 Docker Hub、版本服务和 Kubernetes 配置，因此只在上游作者的仓库运行。当前 Fork 的镜像发布使用 Docker GHCR 工作流。

## 拉取与部署

默认分支镜像：

```bash
docker pull ghcr.io/lc044/vanblog:edge
```

正式版本镜像：

```bash
docker pull ghcr.io/lc044/vanblog:latest
# 或固定版本
docker pull ghcr.io/lc044/vanblog:0.54.1
```

在已有 Compose 配置中替换 VanBlog 服务的 `image` 即可，MongoDB、端口及数据卷配置继续沿用现有部署：

```yaml
image: ghcr.io/lc044/vanblog:edge
```

如果镜像是私有包，拉取前需要使用具备 `read:packages` 的 GitHub 凭证登录 GHCR：

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
```

工作流只构建和发布镜像，不会自动更新正在运行的博客容器。

参考：[GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)、[Docker 多平台 GitHub Actions 构建](https://docs.docker.com/build/ci/github-actions/multi-platform/)。
