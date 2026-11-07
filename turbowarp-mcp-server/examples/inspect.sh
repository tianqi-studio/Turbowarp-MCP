#!/usr/bin/env sh
# Run the MCP Inspector against the local stdio server.
set -eu
server_root="$(cd "$(dirname "$0")/.." && pwd)"
entry="$server_root/dist/index.js"
if [ ! -f "$entry" ]; then
  echo "Missing $entry. Run 'npm install' and 'npm run build' first." >&2
  exit 1
fi
exec npx --yes @modelcontextprotocol/inspector node "$entry" --workspace "$server_root"
