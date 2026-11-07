# Run the MCP Inspector against the local stdio server.
# Usage: powershell -ExecutionPolicy Bypass -File examples\inspect.ps1
$ErrorActionPreference = "Stop"
$serverRoot = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $serverRoot "dist\index.js"
if (-not (Test-Path $entry)) {
    throw "Missing $entry. Run 'npm install' and 'npm run build' first."
}
npx --yes @modelcontextprotocol/inspector node $entry --workspace $serverRoot
