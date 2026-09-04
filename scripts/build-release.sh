#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=$(node -p "require('$ROOT/package.json').version")
NAME="obsidian-ignis-rest-api-v${VERSION}"
OUT="$ROOT/release"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT INT TERM

mkdir -p "$OUT" "$STAGE/$NAME"

# Package the exact source needed to install, audit and rebuild the release.
for item in \
  server-plugin tests scripts .github \
  README.md README.zh-CN.md CHANGELOG.md COMPATIBILITY.md MIGRATION_NOTES.md VALIDATION.md \
  LICENSE UPSTREAM_LICENSE.md MARKDOWN_PATCH_LICENSE.md THIRD_PARTY_NOTICES.md NOTICE.md \
  SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md AUTHORS.md package.json .gitignore .env.example \
  docker-compose.mount.example.yml install.sh RELEASE_NOTES.md; do
  if [ -e "$ROOT/$item" ]; then
    cp -R "$ROOT/$item" "$STAGE/$NAME/"
  fi
done

rm -f "$OUT/$NAME.zip" "$OUT/SHA256SUMS"
(
  cd "$STAGE"
  zip -qr "$OUT/$NAME.zip" "$NAME"
)
(
  cd "$OUT"
  sha256sum "$NAME.zip" > SHA256SUMS
)

printf 'Built %s\n' "$OUT/$NAME.zip"
cat "$OUT/SHA256SUMS"
