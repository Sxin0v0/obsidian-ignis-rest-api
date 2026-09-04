# Obsidian Ignis REST API with MCP

[English](README.md) | 简体中文

![Version](https://img.shields.io/badge/version-1.0.0-informational)
![License](https://img.shields.io/badge/license-MIT-blue)
![Runtime](https://img.shields.io/badge/runtime-Ignis%20Server%20Plugin-6f42c1)

**Obsidian Ignis REST API** 是一个面向 Ignis Server Plugin 架构的第三方社区迁移项目，基于
[`coddingtonbear/obsidian-local-rest-api`](https://github.com/coddingtonbear/obsidian-local-rest-api)
的公开接口与行为模型，为 Ignis 托管的 Obsidian Vault 提供 REST、MCP、
结构化 Markdown 编辑、多 Vault 路由以及浏览器桥接能力。

## 项目状态

**发布版本：** `v1.0.0`
**上游兼容目标：** Obsidian Local REST API `5.1.x`
**运行环境：** 支持 Server Plugin 的自托管 Ignis

当前版本已经包含服务器兼容层和 MCP RPC 的自动化测试。实际部署仍会受到
Ignis 版本、反向代理、Vault 路径以及浏览器在线状态等环境因素影响。

## 重要说明

本项目为**独立的第三方社区维护项目**，并非 Obsidian Local REST API、
markdown-patch、Obsidian 或 Ignis 的官方发行版本，也不暗示获得任何上游
官方背书或合作授权。

原始 Local REST API 与 markdown-patch 由 Adam Coddington 开发维护。本仓库
保留了相关许可证和作者署名。详见[与上游项目的关系](#与上游项目的关系)
以及 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

迁移署名：**Sxin0v0 与 GPT（AI 辅助迁移）**。

## 为什么需要这个迁移版

上游 Obsidian 插件面向桌面版 Obsidian，插件自身会在 Node.js 环境中创建
HTTP/HTTPS listener。Ignis 的 Obsidian UI 运行在浏览器中，浏览器无法通过
`http.createServer()` / `https.createServer()` 监听本地 TCP 端口。

因此本项目把网络服务移动到 **Ignis Server Plugin**，只把确实需要实时
Obsidian App 状态的能力放到一个小型 **Browser Companion** 中。

```text
REST / MCP Client
       |
       v
Ignis HTTP Server
       |
       +-- Server Plugin --------------------+
       |   REST / MCP / 鉴权 / 文件 I/O      |
       |   搜索 / Document Map / Patch       |
       |                                     |
       +---------------- WebSocket ----------+
                                             v
                                      Browser Companion
                                             |
                                             v
                                      Obsidian App API
```

## 功能特性

### REST API

- Bearer Token 鉴权，可自定义鉴权 Header。
- 多 Vault：支持 `X-Ignis-Vault`、`?vault=`、默认 Vault 和 MCP `vault` 参数。
- `/vault/*`：`GET`、`PUT`、`POST`、`PATCH`、`DELETE`、`MOVE`、`COPY`。
- UTF-8 与二进制安全的整文件读写。
- 目录列表。
- Note Metadata 与 Document Map Media Type。
- Heading、Block Reference、Frontmatter URL Target。
- 结构化 Markdown Patch：`replace`、`prepend`、`append`、`delete`、`within`、
  `ifMatch`、自动创建 Target、Heading Move、Frontmatter 修改、Table Row 修改。
- 兼容旧版 Markdown Patch v1 Header 模式。
- JsonLogic 风格结构化搜索与简单全文搜索。
- Tags、Commands、Active File、Open File。
- `/openapi.yaml` OpenAPI 文档。

### MCP

`/mcp/` 暴露与上游工具命名模型一致的核心工具：

`vault_list`、`vault_read`、`vault_write`、`vault_read_binary`、
`vault_write_binary`、`vault_append`、`vault_patch`、`vault_delete`、
`vault_move`、`vault_copy`、`vault_get_document_map`、
`active_file_get_path`、`search_query`、`search_simple`、`tag_list`、
`command_list`、`command_execute`、`open_file`。

同时提供 OpenAPI MCP Resource：

```text
obsidian://local-rest-api/openapi.yaml
```

### 浏览器桥接

Browser Companion 负责必须依赖在线 Ignis/Obsidian Tab 的功能：

- 当前活动文件；
- Obsidian Command 列表与执行；
- 在 Workspace 中打开文件；
- Obsidian MarkdownRenderer；
- 可用时读取实时 Metadata；
- Extension API 注册的 Route / MCP Callback。

服务器侧 Vault CRUD、结构化 Patch、Document Map 和 fallback Search 不要求浏览器
持续在线。

## 环境要求

- 支持 Server Plugin 的自托管 Ignis。
- 可以访问容器或源码树中的 Ignis Server Plugin 目录。
- Ignis 运行时提供的 Node.js；本仓库以 Node.js 20+ 为目标。
- 如果向 localhost 之外暴露接口，应使用 Ignis 或反向代理提供 HTTPS。

本仓库不包含 Ignis 或 Obsidian 本体。

`server-plugin/obsidian/dist/` 中的小型 Browser Companion Bundle 会有意纳入
版本控制，因为 Ignis 会直接提供这些运行时文件；它属于可安装插件的一部分，
而不是无关的构建缓存。

## 安装

克隆社区仓库：

```bash
git clone https://github.com/Sxin0v0/obsidian-ignis-rest-api.git
cd obsidian-ignis-rest-api
```

### Docker / Bind Mount

把本仓库解压到 Ignis Compose 配置附近，然后把 `server-plugin` 挂载到 Ignis
插件目录：

```yaml
services:
  ignis:
    image: nobbe/ignis:latest
    environment:
      - PUID=1000
      - PGID=1000
      - IGNIS_LOCAL_REST_API_KEY=YOUR_API_KEY
    volumes:
      - ./vaults:/vaults
      - ./data:/app/data
      - obsidian-app:/app/obsidian-app
      - ./server-plugin:/app/apps/ignis-server/server/plugins/local-rest-api:ro
    restart: unless-stopped

volumes:
  obsidian-app:
```

完整示例见
[`docker-compose.mount.example.yml`](docker-compose.mount.example.yml)。

重启 Ignis：

```bash
docker compose up -d
docker compose logs -f ignis
```

打开 Ignis 网页版 Obsidian，并启用：

```text
Settings -> Ignis -> Core plugins -> Local REST API with MCP
```

### Ignis 源码目录安装

如果你直接运行 Ignis 源码：

```bash
./install.sh /path/to/ignis
```

脚本会把 `server-plugin` 复制到：

```text
apps/ignis-server/server/plugins/local-rest-api
```

之后重新启动或构建 Ignis。

## 配置

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `IGNIS_LOCAL_REST_API_KEY` | 建议显式设置 | 首次启动自动生成 | Bearer API 凭证。生产环境应使用足够长的随机值。 |
| `IGNIS_LOCAL_REST_API_AUTH_HEADER` | 否 | `Authorization` | Bearer 鉴权使用的 Header。 |
| `IGNIS_LOCAL_REST_API_DEFAULT_VAULT` | 否 | 无 | 多 Vault 场景下的默认 Vault ID。 |
| `IGNIS_LOCAL_REST_API_CORS_ORIGIN` | 否 | `*` | `Access-Control-Allow-Origin`。浏览器客户端建议按需限制来源。 |
| `IGNIS_LOCAL_REST_API_VERBOSE` | 否 | `false` | 是否启用详细诊断日志。 |
| `IGNIS_LOCAL_REST_API_BRIDGE_TIMEOUT_MS` | 否 | `5000` | Browser RPC 超时时间，单位毫秒。 |

如果未提供 API Key，插件会自动生成并以受限文件权限写入 Server Plugin 的数据
目录。生产环境建议使用外部 Secret 管理方式。

示例环境变量见 [`.env.example`](.env.example)，其中仅包含安全占位符。

## REST 使用方法

Base URL 示例：

```text
https://obsidian.example.com/api/ext/local-rest-api
```

### 健康检查

```bash
curl https://obsidian.example.com/api/ext/local-rest-api/
```

### 查询已启用 Vault

```bash
curl \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  https://obsidian.example.com/api/ext/local-rest-api/vaults
```

### 创建或覆盖 Markdown

```bash
curl -X PUT \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  -H 'Content-Type: text/markdown; charset=utf-8' \
  --data-binary $'# API Test\n\nCreated through the Ignis REST API.\n' \
  https://obsidian.example.com/api/ext/local-rest-api/vault/api-test.md
```

`v1.0.0` 已修复 Ignis / Express 环境中非 JSON Body 可能被错误识别成空对象 `{}`
并写入文件的问题。

### 读取文件

```bash
curl \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  https://obsidian.example.com/api/ext/local-rest-api/vault/api-test.md
```

### 获取 Document Map

```bash
curl \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  -H 'Accept: application/vnd.olrapi.document-map+json' \
  https://obsidian.example.com/api/ext/local-rest-api/vault/api-test.md
```

### 结构化 Patch

```bash
curl -X PATCH \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  -H 'Content-Type: application/json' \
  --data '{"targetType":"heading","target":["Log"],"operation":"append","content":"- new item"}' \
  https://obsidian.example.com/api/ext/local-rest-api/vault/notes/daily.md
```

### 移动文件

```bash
curl -X MOVE \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  -H 'Destination: archive/' \
  https://obsidian.example.com/api/ext/local-rest-api/vault/notes/example.md
```

## MCP 使用方法

Endpoint：

```text
https://obsidian.example.com/api/ext/local-rest-api/mcp/
```

支持自定义 HTTP Header 的 MCP Client 可配置：

```text
Authorization: Bearer YOUR_API_KEY
X-Ignis-Vault: YOUR_VAULT_ID   # 只有一个/已配置默认 Vault 时可省略
```

最小 `tools/list` 示例：

```bash
curl -X POST \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  https://obsidian.example.com/api/ext/local-rest-api/mcp/
```

不同 MCP Client 可能还会执行 `initialize`、携带 Protocol Version Header 或使用
Session。具体支持版本以服务端返回信息和兼容文档为准。

## 架构与目录

```text
server-plugin/
├── index.js                 Ignis Server Plugin 入口
├── lib/                     REST、MCP、Vault、Patch/Search、RPC
├── docs/openapi.yaml        运行时 OpenAPI Resource
└── obsidian/
    ├── manifest.json        Browser Companion Manifest
    └── dist/                Browser Companion Bundle

tests/                       Node.js 回归测试
scripts/                     发布与安全检查脚本
.github/                     CI 与贡献模板
```

## 兼容性

详细矩阵见 [`COMPATIBILITY.md`](COMPATIBILITY.md)。

Ignis 架构下的重要差异：

1. API 路径为 `/api/ext/local-rest-api`，这是 Ignis Server Plugin 的原生 Route
   Namespace。
2. TLS 由 Ignis 或反向代理负责，本插件不会再创建上游桌面插件的本地自签 CA。
3. UI 状态类能力需要目标 Vault 有在线浏览器 Tab。
4. 整文件 `application/json` 请求可能已经被 Ignis 全局 Express JSON 中间件解析；
   如果需要逐字节保留 JSON 文件，请使用 `application/octet-stream`。
5. Server 侧 Markdown/YAML 兼容层无额外 Runtime Dependency，并覆盖已测试的常见
   行为，但不声明所有 Parser 边界都与上游逐字节一致。

## 与上游项目的关系

本仓库是独立维护的运行环境适配项目：

- **上游项目：** Obsidian Local REST API with MCP
- **上游仓库：** https://github.com/coddingtonbear/obsidian-local-rest-api
- **上游作者：** Adam Coddington
- **相关 Parser 项目：** https://github.com/coddingtonbear/markdown-patch
- **本项目适配内容：** 把 HTTP/MCP 服务从桌面 Obsidian Node 进程迁移到 Ignis Node
  Server，并通过 WebSocket 把 UI 类操作桥接回浏览器。
- **兼容目标：** 在可行范围内保留上游 Client/Tool 的使用模型，并明确记录 Ignis
  特有差异。

本项目不暗示获得上游官方授权或背书。未来如同步上游功能，应先完成兼容性审核与
测试。

## 升级与迁移

从早期 `5.1.0-ignis.1` 开发包升级到 `v1.0.0`：

1. 用 `v1.0.0` 的 `server-plugin` 替换当前挂载目录。
2. 保留现有 `IGNIS_LOCAL_REST_API_KEY` 与 Vault 配置。
3. 重启 Ignis。
4. 如果 Ignis 版本重置了 per-vault Core Plugin 状态，重新启用插件。
5. 重新测试 `GET /vaults`、Markdown `PUT`/`GET` 和 MCP `tools/list`。

不需要迁移 Vault 内容。

## 常见问题

### 为什么不能直接运行原版 Community Plugin？

原插件会启动 Node HTTP/HTTPS Listener；浏览器 JavaScript 不能监听 TCP 端口，因此
这部分必须迁移到 Ignis Server 进程。

### 为什么 `/obsidian-local-rest-api.crt` 不提供证书？

HTTPS 已由 Ignis 或反向代理负责，应在该层配置证书和信任关系，不需要插件再次
创建 TLS Listener。

### 是否必须一直打开网页版 Obsidian？

Vault CRUD、Patch、Document Map、fallback Search 不需要。Active File、Command、
Open File、Obsidian 原生 Renderer 等能力需要在线 Tab。

## 故障排查

### 返回 `401`

确认发送：

```text
Authorization: Bearer YOUR_API_KEY
```

或者使用 `IGNIS_LOCAL_REST_API_AUTH_HEADER` 配置的自定义 Header。

### 启用了多个 Vault

发送：

```text
X-Ignis-Vault: YOUR_VAULT_ID
```

或者设置 `IGNIS_LOCAL_REST_API_DEFAULT_VAULT`。

### Browser Tool 返回 `503`

打开目标 Vault 的 Ignis 页面，并确认：

```text
Settings -> Ignis -> Core plugins -> Local REST API with MCP
```

已启用。

### 反向代理先于 Ignis 返回错误

检查 Body Size、`MOVE`/`COPY` Method、WebSocket 支持，以及自定义 Header 是否正确
透传。

## 开发

插件运行时不额外安装 npm Dependency，使用 Ignis 自身的 Node 运行环境。Node.js
20+ 下可执行：

```bash
npm test
npm run check
npm run security:scan
npm run build
```

`npm run build` 会在 `release/` 下生成发布 ZIP 与 `SHA256SUMS`。

## 贡献

请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。Bug Fix 应尽量附带回归测试，兼容性
变化应保持范围清晰。

## 安全

提交安全问题前请阅读 [`SECURITY.md`](SECURITY.md)。不要在公开 Issue 中提交真实
API Key、Cookie、私有 Vault 内容或内部服务地址。

## Roadmap

近期只规划可验证的兼容性工作：

- 扩展当前 Ignis 版本的集成测试覆盖；
- 补充 Markdown/YAML 边界 Fixture；
- 多 Vault / 多 Tab Browser Bridge 测试；
- 上游 API 或 MCP Protocol 变化后的兼容性复核。

## 许可证

本社区迁移项目使用 MIT License，见 [`LICENSE`](LICENSE)。

上游 MIT Notice 分别保存在 [`UPSTREAM_LICENSE.md`](UPSTREAM_LICENSE.md) 和
[`MARKDOWN_PATCH_LICENSE.md`](MARKDOWN_PATCH_LICENSE.md)。Ignis 是独立的
AGPL-3.0-or-later 项目，本仓库不包含 Ignis 本体。

## 致谢

- Adam Coddington — 原始 Obsidian Local REST API 与 markdown-patch。
- Nystik 与 Ignis Contributors — Ignis Server / Browser 架构。
- **Sxin0v0 与 GPT — AI 辅助的 Ignis 迁移与发布工程。**

所有产品名称、商标及相关权利归其各自权利人所有。
