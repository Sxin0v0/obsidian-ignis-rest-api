# Changelog

All notable changes to the community Ignis port are documented here.

## [1.0.0] - 2026-09-04

First public community release.

### Added

- Ignis Server Plugin implementation of the Local REST API and MCP service.
- Browser companion for active-file, command, rendering, open-file, metadata,
  and extension API operations.
- Multi-vault routing and Bearer-token authentication.
- REST file CRUD, MOVE/COPY, search, tags, document maps, and structured
  Markdown patching.
- MCP core tools matching the upstream tool naming model.
- Bilingual English/Chinese documentation and public-release project files.

### Fixed

- Fixed whole-file `PUT`/`POST` raw-body handling under Ignis when the global
  Express JSON middleware leaves an empty-object `req.body` placeholder. Text
  Markdown and binary bodies are now read from the request stream instead of
  being serialized as `{}`.
- Generated API keys are no longer printed to server logs.
- Environment-provided API keys now clear stale generated keys from persisted config.
- Unauthenticated health checks no longer disclose enabled vault IDs or extension summaries.
- The required Ignis browser-companion `dist/` bundle is now tracked so a clean Git checkout is directly installable.

### Known differences

- TLS is terminated by Ignis or the reverse proxy; this plugin does not create
  the upstream self-signed local CA.
- The API is mounted under `/api/ext/local-rest-api`.
- UI-dependent operations require an online Ignis browser tab for the target
  vault.
- The dependency-free Markdown/YAML compatibility layer covers tested common
  paths but is not claimed to be byte-for-byte identical to every edge case of
  the upstream parser libraries.
