# Obsidian Ignis REST API v1.0.0

First public community release of the Ignis Server Plugin adaptation of
[coddingtonbear/obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api).

> This is an independent third-party community release. It is not an official release
> of the upstream Obsidian Local REST API project or of Ignis.

## Highlights

- REST API and MCP endpoint hosted by the Ignis Node server under `/api/ext/local-rest-api`.
- Browser companion for active-file, command, open-file, metadata and extension-API operations.
- Multi-vault routing, file CRUD, MOVE/COPY, binary access, search and tags.
- Structured Markdown editing with heading, block and frontmatter targeting.
- MCP core tools compatible with the migration target from upstream 5.1.x.
- Extension API v2 compatibility bridge for browser-side Obsidian plugins.

## Fixes included before v1

- Fixed whole-file `PUT`/`POST` raw request-body handling when Ignis has already run
  its global JSON middleware. Text/Markdown and binary payloads are now read as raw
  bytes rather than being mistaken for an empty parsed object.
- Added regression coverage for Markdown, JSON and arbitrary binary request bodies.
- Hardened generated-key handling so generated API keys are stored with restrictive file permissions but are never printed to server logs.
- Reduced unauthenticated health-check disclosure: vault IDs and extension summaries are returned only after successful API authentication.
- When an environment API key is configured, stale generated keys are removed from persisted plugin configuration.
- The required browser-companion `dist/` runtime bundle is included in source control and release archives, so installation does not depend on untracked local files.

## Installation

Extract the release archive and bind-mount its `server-plugin` directory into:

```text
/app/apps/ignis-server/server/plugins/local-rest-api
```

Set `IGNIS_LOCAL_REST_API_KEY` to a strong secret and enable **Local REST API with MCP**
from **Settings → Ignis → Core plugins** for each desired vault.

See `README.md` or `README.zh-CN.md` for complete instructions.

## Credits

- Upstream Local REST API: Adam Coddington
- Ignis: Nystik and contributors
- Ignis migration: Sxin0v0 & GPT (AI-assisted migration)
