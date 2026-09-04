#!/usr/bin/env sh
set -eu
IGNIS_ROOT="${1:-.}"
TARGET="$IGNIS_ROOT/apps/ignis-server/server/plugins/local-rest-api"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ ! -d "$IGNIS_ROOT/apps/ignis-server/server/plugins" ]; then
  echo "Ignis server plugin directory not found under: $IGNIS_ROOT" >&2
  exit 1
fi

rm -rf "$TARGET"
mkdir -p "$(dirname "$TARGET")"
cp -R "$SCRIPT_DIR/server-plugin" "$TARGET"

echo "Installed Local REST API with MCP 1.0.0 to:"
echo "  $TARGET"
echo "Restart/rebuild Ignis, then enable 'Local REST API with MCP' in Settings -> Ignis Core Plugins for each desired vault."
