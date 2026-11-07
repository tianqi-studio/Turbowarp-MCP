#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f dist/index.js ]; then
  echo 'dist/index.js is missing. Run "npm install" and "npm run build" first.' >&2
  exit 1
fi
exec node dist/index.js --transport http "$@"
