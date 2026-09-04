# Compatibility matrix — upstream 5.1.x -> Ignis Server Plugin

`1.0.0` 的目标是把上游“可观察的核心 REST/MCP 功能”迁到 Ignis，而不是在浏览器里复刻一个不存在的 Node listener。

| Upstream feature | Ignis port | 说明 |
|---|---|---|
| HTTPS listener `27124` | 架构替换 | 由 Ignis / reverse proxy 负责 HTTPS |
| HTTP listener `27123` | 架构替换 | API 跑在 Ignis HTTP server 上 |
| 自签名 CA / cert download | 不适用 | cert endpoint 返回 410；信任 reverse proxy 证书 |
| Bearer API key | 完整 | 支持自定义 Header |
| CORS / expose headers | 完整 | 默认 `*`，可配置 origin |
| Vault directory list | 完整 | 目录名带 `/` |
| Raw file GET | 完整 | Buffer/二进制 |
| Whole-file PUT | 完整核心 | v1 修复 Ignis 全局 JSON middleware 下的 raw Markdown / binary body 处理 |
| Whole-file POST append | 完整 | text body |
| DELETE / permanent | 完整 | 默认 `.trash`，永久删除可选 |
| MOVE / COPY | 完整 | Destination / Allow-Overwrite / directory target |
| URL heading target | 完整 | nested heading path |
| URL block target | 完整 | block id，含 duplicate disambiguation |
| URL frontmatter target | 完整 | top-level key |
| Targeted GET scopes | 完整 | content / marker / markerAndContent |
| Targeted PUT / POST | 完整 | v2 path semantics + legacy v1 header semantics |
| PATCH v2 JSON instruction | 完整核心代数 | heading/block/frontmatter + table rows + move |
| PATCH v2 raw-content | 完整核心 | path/header target + Operation/Scope/Within/If-Match 等 |
| PATCH `within` | 完整核心 | positive/negative body-block index |
| `ifMatch` | 完整 | SHA-256 前 6 hex，与上游 map token 规则一致 |
| `createTargetIfMissing` | 完整核心 | heading chain、block、frontmatter |
| `rejectIfContentPreexists` | 完整核心 | heading/block text insertion guard |
| Heading move `parent` | 完整核心 | move + re-level + placement |
| Frontmatter list/dict/string merge | 完整核心 | prepend/append |
| Structured table-row patch | 完整核心 | `value: string[][]` |
| PATCH v1 header mode | 兼容 | 带 deprecation header |
| v2 document map | 完整核心 | nested headings / duplicate keys / blocks / version |
| legacy document map | 兼容 | `Markdown-Patch-Version: 1` |
| Note JSON metadata | 完整在线 / fallback | 在线优先使用 Obsidian metadataCache；离线 server parser fallback |
| Resolved links/backlinks | 完整在线 / fallback | 在线最接近 Obsidian；离线用 Markdown link resolver fallback |
| `Accept: text/html` | 完整在线 | 通过 Obsidian MarkdownRenderer，需在线 Tab |
| Simple search | 完整在线 / fallback | 在线使用 Obsidian `prepareSimpleSearch`；离线 server full-text fallback |
| JsonLogic search | 核心完整 | 常用标准运算 + `glob`/`regexp` |
| Tags | 完整在线 / fallback | 在线使用 Obsidian `getAllTags`；离线 parser fallback |
| Active file | 完整在线 | 需在线 Ignis Tab |
| Commands list/execute | 完整在线 | 需在线 Ignis Tab |
| Open file | 完整在线 | 需在线 Ignis Tab |
| MCP HTTP endpoint | 已迁移 | Streamable HTTP/JSON-RPC 风格，支持核心 revisions |
| MCP OpenAPI resource | 完整 | `obsidian://local-rest-api/openapi.yaml` |
| 18 upstream core MCP tools | 完整 | 工具名保持一致 |
| MCP binary ceiling | 完整 | 1 MiB |
| Public extension API v2 | 已迁移 | addRoute/addPublicRoute/addMcpTool/unregister，经 WS bridge |
| Upstream plugin ID for `getAPI()` | 兼容 | companion 注入 `obsidian-local-rest-api` registry ID |
| Multi-vault | 增强 | Header/query/default/tool argument |

## “完整”的边界

功能层面的主路径已经迁完，但有三类场景不应描述成 byte-for-byte upstream identity：

- 上游依赖完整 `marked` + `yaml` + `markdown-patch` 语法模型；本包为了可直接 bind-mount 到 Ignis 镜像，采用无新增 npm dependency 的 clean-room server engine。常用语法与 patch algebra 已有单测，病理级 Markdown/YAML 边角可能存在差异。
- API Extension route callback 通过 WebSocket 代理；绝大多数使用 `req`/`res` 常用方法的 extension 可工作，但它不是把整个 Express object 跨进程序列化过去，因此依赖非常冷门 Express internals 的 extension 不能保证透明。
- MCP transport 是针对 Local REST API 使用场景实现的兼容端点，而不是把上游当前 MCP SDK 的所有内部实现细节逐行复制过来。

## Browser online / headless matrix

无需浏览器在线：

- `/vault/*` CRUD / MOVE / COPY
- document map / PATCH
- server fallback search / tags / metadata
- MCP vault_list/read/write/binary/append/patch/delete/move/copy/document-map/search/tag tools

需要对应 Vault 至少有一个 Ignis Tab 在线：

- `/active/*`
- `/commands/*`
- `/open/*`
- `Accept: text/html` MarkdownRenderer
- MCP `active_file_get_path`、`command_list`、`command_execute`、`open_file`
- 第三方 Local REST API extension route / custom MCP callback
