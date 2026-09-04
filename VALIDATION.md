# Validation report

Version under test: `1.0.0`

This report describes checks run against the source tree prepared for the public v1 release.
It does not claim that every possible Ignis version, reverse proxy, Markdown edge case, or
third-party extension has been tested.

## Static validation

Run:

```bash
npm run check
```

This checks JavaScript syntax in `server-plugin/`, `tests/`, and `scripts/` with `node --check`.

## Automated tests

Run:

```bash
npm test
```

The v1 release suite currently contains **42 tests** covering:

- Extension route path compilation and MCP extension registration.
- MCP initialization, resources, core tool discovery and protocol handling.
- SHA-256 six-character document version tokens.
- Nested heading maps and duplicate heading/block disambiguation.
- Targeted heading/frontmatter/block reads.
- Heading re-leveling and structural moves.
- PATCH replace/prepend/append/delete operations.
- `within`, target creation, `ifMatch`, and content-preexists guards.
- Frontmatter merge/rename/collision behavior.
- Block marker/full-content patching.
- Structured table-row writes.
- Legacy v1 document-map/PATCH compatibility.
- Vault traversal protection, trash/permanent deletion, move/copy and overwrite behavior.
- Search response shape, tags, metadata fallback, backlinks and JsonLogic operators.
- Raw HTTP body preservation for Markdown, parsed JSON and arbitrary binary payloads.
- API-key logging/persistence hardening and unauthenticated health-response privacy.
- Presence of the required browser-companion runtime bundle in a clean source checkout.

The raw-body regression specifically covers the v1 bug fix for Ignis installations where
an upstream middleware leaves an empty-object body placeholder before the plugin receives a
non-JSON request.

## Security / privacy scan

Run:

```bash
npm run security:scan
```

The repository-local scanner rejects common credential formats, private keys, JWT-shaped
values, private IPv4 addresses, user-home absolute paths, and suspicious secret assignments.
It supplements, rather than replaces, GitHub secret scanning or a dedicated security scanner.

## Release packaging

Run:

```bash
npm run build
```

This creates a source/install archive under `release/` and a `SHA256SUMS` file. The release
archive contains the server plugin, browser companion, tests, documentation, licenses, and
installation examples, but excludes local Git metadata, caches, logs and environment files.

The required `server-plugin/obsidian/dist/` browser companion is intentionally tracked and
scanned because Ignis serves it directly at runtime; a clean Git checkout therefore remains
installable without relying on an untracked local build artifact.

## Recommended integration smoke test

After mounting the release in a disposable Ignis installation:

```bash
BASE='https://obsidian.example.com/api/ext/local-rest-api'
KEY='YOUR_API_KEY'
VAULT='YOUR_VAULT_ID'

curl "$BASE/"
curl \
  -H "Authorization: Bearer $KEY" \
  -H "X-Ignis-Vault: $VAULT" \
  "$BASE/vault/"
```

Create a disposable Markdown note to verify the v1 raw-body path:

```bash
curl -X PUT \
  -H "Authorization: Bearer $KEY" \
  -H "X-Ignis-Vault: $VAULT" \
  -H 'Content-Type: text/markdown; charset=utf-8' \
  --data-binary $'# Smoke\n\nRaw Markdown body.\n' \
  "$BASE/vault/__obsidian_ignis_rest_api_smoke.md"

curl \
  -H "Authorization: Bearer $KEY" \
  -H "X-Ignis-Vault: $VAULT" \
  "$BASE/vault/__obsidian_ignis_rest_api_smoke.md"
```

The GET response must contain the Markdown text exactly, not `{}`.

Then remove the disposable file:

```bash
curl -X DELETE \
  -H "Authorization: Bearer $KEY" \
  -H "X-Ignis-Vault: $VAULT" \
  "$BASE/vault/__obsidian_ignis_rest_api_smoke.md?permanent=true"
```

For browser-bridge features, keep the same vault open in an Ignis browser tab and separately
test `active_file_get_path`, `command_list`, `command_execute`, and `open_file`.
