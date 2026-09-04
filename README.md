# Obsidian Ignis REST API with MCP

English | [简体中文](README.zh-CN.md)

![Version](https://img.shields.io/badge/version-1.0.0-informational)
![License](https://img.shields.io/badge/license-MIT-blue)
![Runtime](https://img.shields.io/badge/runtime-Ignis%20Server%20Plugin-6f42c1)

**Obsidian Ignis REST API** is a community-maintained Ignis Server Plugin adaptation of
[`coddingtonbear/obsidian-local-rest-api`](https://github.com/coddingtonbear/obsidian-local-rest-api),
providing REST, MCP, structured Markdown editing, multi-vault routing, and an
Obsidian browser bridge for Ignis-hosted vaults.

## Project status

**Release:** `v1.0.0`
**Upstream compatibility target:** Obsidian Local REST API `5.1.x`
**Runtime target:** self-hosted Ignis with Server Plugin support

This release has automated coverage for the server-side compatibility layer and
MCP RPC behavior. Deployment-specific integration still depends on the Ignis
version, reverse proxy, vault layout, and browser state.

## Important notice

This project is an **independent third-party community-maintained adaptation**.
It is **not** an official release of Obsidian Local REST API, markdown-patch,
Obsidian, or Ignis, and no upstream endorsement is implied.

The original Local REST API project and markdown-patch are authored and
maintained by Adam Coddington. Their license notices are preserved in this
repository. See [Relationship with upstream](#relationship-with-upstream) and
[Third-party notices](THIRD_PARTY_NOTICES.md).

Migration credit: **Sxin0v0 & GPT (AI-assisted migration)**. See [AUTHORS.md](AUTHORS.md).

## Why this port exists

The upstream Obsidian plugin is designed for desktop Obsidian and starts its own
Node.js HTTP/HTTPS listener. Ignis runs the Obsidian UI in a browser, where
`http.createServer()` / `https.createServer()` cannot listen on a local TCP
port.

This port moves the network-facing service into an **Ignis Server Plugin** and
uses a small **browser companion** only for features that genuinely need the
live Obsidian application state.

```text
REST / MCP client
       |
       v
Ignis HTTP server
       |
       +-- Server Plugin --------------------+
       |   REST / MCP / auth / file I/O      |
       |   search / document map / patch     |
       |                                     |
       +---------------- WebSocket ----------+
                                             v
                                      Browser companion
                                             |
                                             v
                                      Obsidian App API
```

## Features

### REST API

- Bearer-token authentication and configurable authorization header.
- Multi-vault routing through `X-Ignis-Vault`, `?vault=`, a configured default,
  or the optional MCP `vault` argument.
- `/vault/*`: `GET`, `PUT`, `POST`, `PATCH`, `DELETE`, `MOVE`, `COPY`.
- UTF-8 and binary-safe whole-file reads/writes.
- Directory listing.
- Note metadata and document-map media types.
- URL targets for headings, block references, and frontmatter fields.
- Structured Markdown patching with `replace`, `prepend`, `append`, `delete`,
  `within`, `ifMatch`, target creation, heading moves, frontmatter updates, and
  table-row edits.
- Legacy Markdown Patch v1 header mode for compatibility.
- JsonLogic-style structured search and simple text search.
- Tags, command listing/execution, active-file routes, and open-file routes.
- OpenAPI document at `/openapi.yaml`.

### MCP

The `/mcp/` endpoint exposes the core tool names used by the upstream project:

`vault_list`, `vault_read`, `vault_write`, `vault_read_binary`,
`vault_write_binary`, `vault_append`, `vault_patch`, `vault_delete`,
`vault_move`, `vault_copy`, `vault_get_document_map`, `active_file_get_path`,
`search_query`, `search_simple`, `tag_list`, `command_list`,
`command_execute`, and `open_file`.

The OpenAPI specification is also available as the MCP resource:

```text
obsidian://local-rest-api/openapi.yaml
```

### Browser bridge

The companion plugin handles operations that require a live Ignis/Obsidian tab:

- current active file;
- Obsidian command registry and command execution;
- opening a file in the workspace;
- Obsidian Markdown rendering;
- live metadata where available;
- extension routes/tools registered through the compatibility API.

Server-only file CRUD, structured patching, document maps, and fallback search
continue to work without an open browser tab.

## Requirements

- A self-hosted Ignis deployment with Server Plugin support.
- Access to the Ignis server-plugin directory inside the container or source
  tree.
- Node.js provided by the Ignis runtime. This repository targets Node.js 20+.
- A reverse proxy or Ignis HTTPS endpoint if the API is exposed beyond
  localhost.

This repository does not bundle Ignis or Obsidian.

The small `server-plugin/obsidian/dist/` bundle is intentionally committed because
Ignis serves it directly as the browser companion; it is part of the installable
plugin rather than an unrelated build cache.

## Installation

Clone the community repository:

```bash
git clone https://github.com/Sxin0v0/obsidian-ignis-rest-api.git
cd obsidian-ignis-rest-api
```

### Docker / bind mount

Copy or extract this repository next to your Ignis Compose configuration, then
mount `server-plugin` into the Ignis plugin directory:

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

A complete example is available in
[`docker-compose.mount.example.yml`](docker-compose.mount.example.yml).

Restart Ignis:

```bash
docker compose up -d
docker compose logs -f ignis
```

Then open the Ignis-hosted Obsidian UI and enable:

```text
Settings -> Ignis -> Core plugins -> Local REST API with MCP
```

### Source-tree installation

If you run Ignis from a source checkout:

```bash
./install.sh /path/to/ignis
```

The script copies `server-plugin` to:

```text
apps/ignis-server/server/plugins/local-rest-api
```

Restart/rebuild Ignis afterward.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `IGNIS_LOCAL_REST_API_KEY` | Recommended | generated on first start | Bearer API credential. Use a long random secret. |
| `IGNIS_LOCAL_REST_API_AUTH_HEADER` | No | `Authorization` | Header used for Bearer authentication. |
| `IGNIS_LOCAL_REST_API_DEFAULT_VAULT` | No | none | Default vault ID when multiple vaults enable the plugin. |
| `IGNIS_LOCAL_REST_API_CORS_ORIGIN` | No | `*` | `Access-Control-Allow-Origin` value. Restrict this for browser clients when practical. |
| `IGNIS_LOCAL_REST_API_VERBOSE` | No | `false` | Enables verbose diagnostics. |
| `IGNIS_LOCAL_REST_API_BRIDGE_TIMEOUT_MS` | No | `5000` | Browser RPC timeout in milliseconds. |

If no API key is supplied, the plugin generates one and stores it in its
server-plugin data directory with restrictive file permissions. For production,
prefer an externally managed secret.

See [`.env.example`](.env.example) for placeholder values only.

## REST usage

Base URL example:

```text
https://obsidian.example.com/api/ext/local-rest-api
```

### Health check

```bash
curl https://obsidian.example.com/api/ext/local-rest-api/
```

### List enabled vaults

```bash
curl \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  https://obsidian.example.com/api/ext/local-rest-api/vaults
```

### Create or overwrite a Markdown file

```bash
curl -X PUT \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  -H 'Content-Type: text/markdown; charset=utf-8' \
  --data-binary $'# API Test\n\nCreated through the Ignis REST API.\n' \
  https://obsidian.example.com/api/ext/local-rest-api/vault/api-test.md
```

`v1.0.0` includes a regression fix for Ignis/Express deployments where a
non-JSON request body could previously be mistaken for an empty `{}` object.

### Read a file

```bash
curl \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  https://obsidian.example.com/api/ext/local-rest-api/vault/api-test.md
```

### Read a document map

```bash
curl \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  -H 'Accept: application/vnd.olrapi.document-map+json' \
  https://obsidian.example.com/api/ext/local-rest-api/vault/api-test.md
```

### Structured patch

```bash
curl -X PATCH \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  -H 'Content-Type: application/json' \
  --data '{"targetType":"heading","target":["Log"],"operation":"append","content":"- new item"}' \
  https://obsidian.example.com/api/ext/local-rest-api/vault/notes/daily.md
```

### Move a file

```bash
curl -X MOVE \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  -H 'Destination: archive/' \
  https://obsidian.example.com/api/ext/local-rest-api/vault/notes/example.md
```

## MCP usage

Endpoint:

```text
https://obsidian.example.com/api/ext/local-rest-api/mcp/
```

For clients that support custom HTTP headers, configure:

```text
Authorization: Bearer YOUR_API_KEY
X-Ignis-Vault: YOUR_VAULT_ID   # optional with one enabled/default vault
```

A minimal JSON-RPC tool-list request:

```bash
curl -X POST \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Ignis-Vault: YOUR_VAULT_ID' \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  https://obsidian.example.com/api/ext/local-rest-api/mcp/
```

Different MCP clients may require an `initialize` request, protocol-version
headers, or session handling. The endpoint supports the protocol revisions
listed by the server response and compatibility documentation.

## Architecture and project structure

```text
server-plugin/
├── index.js                 Ignis Server Plugin entry point
├── lib/                     REST, MCP, vault, patch/search, RPC layers
├── docs/openapi.yaml        Runtime OpenAPI resource
└── obsidian/
    ├── manifest.json        Browser companion manifest
    └── dist/                Browser companion bundle

tests/                       Node.js regression tests
scripts/                     Release/security utilities
.github/                     CI and contribution templates
```

## Compatibility

See [`COMPATIBILITY.md`](COMPATIBILITY.md) for the detailed capability matrix.

Important architectural differences from upstream:

1. The API lives under `/api/ext/local-rest-api` because that is the Ignis
   Server Plugin route namespace.
2. TLS is terminated by Ignis or a reverse proxy. The upstream local CA
   certificate endpoint is intentionally not reproduced.
3. UI-state operations require an online browser tab for the target vault.
4. Whole-file `application/json` requests may already be parsed by Ignis's
   global Express JSON middleware; use `application/octet-stream` when exact
   byte preservation of a JSON file matters.
5. The server-side Markdown/YAML compatibility layer is dependency-free and
   tested against common behaviors, but it is not claimed to reproduce every
   parser edge case byte-for-byte.

## Relationship with upstream

This repository is independently maintained and adapts the upstream project to
a different runtime architecture.

- **Upstream project:** Obsidian Local REST API with MCP
- **Upstream repository:** https://github.com/coddingtonbear/obsidian-local-rest-api
- **Upstream author:** Adam Coddington
- **Related parser project:** https://github.com/coddingtonbear/markdown-patch
- **What this port changes:** moves HTTP/MCP service ownership from the desktop
  Obsidian process to the Ignis Node server and bridges live UI operations back
  to the browser.
- **Compatibility goal:** preserve the upstream client/tool usage model where
  practical while documenting Ignis-specific differences.

This repository does not claim upstream approval or official status. Future
upstream changes may be incorporated after compatibility review and testing.

## Upgrade / migration

From the pre-release `5.1.0-ignis.1` artifact:

1. Replace the mounted `server-plugin` directory with the `v1.0.0` version.
2. Keep your existing `IGNIS_LOCAL_REST_API_KEY` and vault configuration.
3. Restart Ignis.
4. Re-enable the Core Plugin if your Ignis version resets per-vault plugin
   state.
5. Re-run `GET /vaults`, a Markdown `PUT`/`GET` smoke test, and MCP `tools/list`.

No vault content migration is required.

## FAQ

### Why not run the original community plugin directly in Ignis?

The upstream plugin starts a Node HTTP/HTTPS listener. Browser JavaScript cannot
listen on a TCP port, so that responsibility belongs in the Ignis server
process.

### Why does `/obsidian-local-rest-api.crt` not return a certificate?

Ignis or the reverse proxy owns HTTPS. Configure trust and certificates at that
layer instead of generating a second TLS listener inside the plugin.

### Do I need to keep an Obsidian browser tab open?

Not for server-side vault CRUD, patching, document maps, and fallback search.
You do need a live tab for active-file state, commands, open-file actions, and
Obsidian-native rendering/metadata paths.

## Troubleshooting

### `401` / authorization required

Confirm the client sends exactly:

```text
Authorization: Bearer YOUR_API_KEY
```

or the custom header configured with `IGNIS_LOCAL_REST_API_AUTH_HEADER`.

### Multiple vaults are enabled

Add:

```text
X-Ignis-Vault: YOUR_VAULT_ID
```

or configure `IGNIS_LOCAL_REST_API_DEFAULT_VAULT`.

### Browser-dependent tool returns `503`

Open the target vault in Ignis and confirm **Local REST API with MCP** is
enabled under Ignis Core Plugins.

### Reverse proxy returns errors before Ignis

Check body-size limits, request methods (`MOVE`/`COPY`), WebSocket support, and
whether custom headers are forwarded.

## Development

No extra runtime dependency is installed by this plugin. Run the local
server-side checks with Node.js 20+:

```bash
npm test
npm run check
npm run security:scan
npm run build
```

`npm run build` produces a release ZIP and `SHA256SUMS` under `release/`.

The release workflow validates `main` and automatically publishes a GitHub Release when the version in `package.json` does not yet have a matching `v<version>` tag. Version bumps therefore require updating `package.json`, `CHANGELOG.md`, and `RELEASE_NOTES.md` together.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Please keep compatibility changes
focused and include tests for bug fixes.

## Security

Read [`SECURITY.md`](SECURITY.md) before reporting a vulnerability. Never post
real API keys, cookies, private vault content, or private service URLs in public
issues.

## Roadmap

Near-term work is intentionally limited to measurable compatibility tasks:

- broader integration coverage against current Ignis releases;
- additional Markdown/YAML edge-case fixtures;
- multi-vault and multi-tab browser-bridge tests;
- compatibility review when upstream APIs or MCP protocol behavior changes.

## License

This community port is released under the MIT License. See [`LICENSE`](LICENSE).

Upstream MIT notices are preserved in
[`UPSTREAM_LICENSE.md`](UPSTREAM_LICENSE.md) and
[`MARKDOWN_PATCH_LICENSE.md`](MARKDOWN_PATCH_LICENSE.md). Ignis is a separate
AGPL-3.0-or-later project and is not bundled here.

## Credits

- Adam Coddington — original Obsidian Local REST API and markdown-patch work.
- Nystik and Ignis contributors — Ignis server/browser architecture.
- **Sxin0v0 & GPT — AI-assisted Ignis migration and release engineering.**

All product names and trademarks belong to their respective owners.
