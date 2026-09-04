# Migration architecture notes

## Why this is a Server Plugin

Upstream Local REST API is a desktop-only Obsidian plugin whose runtime owns a Node HTTP/HTTPS server. Ignis community plugins execute in the browser compatibility layer, so a raw server listener cannot exist there.

The migration therefore uses three pieces:

```text
REST / MCP client
       |
       v
Ignis Node server
  server/plugins/local-rest-api
       |
       +------ direct filesystem / patch / search -----> Vault
       |
       +------ Ignis WebSocket RPC --------------------> Browser companion
                                                         |
                                                         v
                                                     Obsidian App
```

### Server Plugin responsibilities

- Authentication / CORS.
- REST routing.
- Multi-vault selection.
- File CRUD, MOVE, COPY, trash.
- Document map and patch engine.
- Search / tags / metadata fallback.
- MCP endpoint and 18 core tools.
- API Extension route/tool registry.

### Browser companion responsibilities

- Active-file path.
- Obsidian commands.
- Open file in workspace.
- Exact Obsidian metadata cache / tags when online.
- `prepareSimpleSearch` when online.
- MarkdownRenderer HTML.
- Obsidian-aware rename/copy/trash when online.
- Compatibility host for `getAPI()` / extension API v2.

## API path migration

Upstream:

```text
https://127.0.0.1:27124/vault/...
https://127.0.0.1:27124/mcp/
```

Ignis native:

```text
https://obsidian.example.com/api/ext/local-rest-api/vault/...
https://obsidian.example.com/api/ext/local-rest-api/mcp/
```

If a client cannot change its base URL, add explicit reverse-proxy rewrites for only the Local REST API paths.

## TLS migration

Do not attempt to restore upstream `https.createServer()` inside the browser. The Ignis HTTP server/reverse proxy is the correct TLS boundary. This is why the certificate endpoint intentionally returns 410 instead of manufacturing a second certificate chain that the outer reverse proxy would never serve.

## Persistent config

Plugin config is stored at the Ignis Server Plugin data directory as `config.json`. The bind-mounted source folder may stay read-only.

Recommended production setup: define `IGNIS_LOCAL_REST_API_KEY` in container secrets/environment rather than relying on the generated key.
