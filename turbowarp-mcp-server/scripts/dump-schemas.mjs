#!/usr/bin/env node
/**
 * Write docs/tools.schema.json from the live server. Run `npm run build`
 * first. This keeps the documented input/output JSON Schemas in sync with the
 * actual registered tools.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const entry = path.join(root, "dist", "index.js");
const output = path.join(root, "docs", "tools.schema.json");

if (!fs.existsSync(entry)) {
  console.error(`Missing ${entry}. Run "npm run build" first.`);
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry, "--confirm", "none", "--log-level", "error"],
  cwd: root,
  env: { ...process.env, TW_MCP_LOG_LEVEL: "error" },
  stderr: "pipe"
});

const client = new Client(
  { name: "turbowarp-mcp-schema-dump", version: "1.0.0" },
  { capabilities: {} }
);

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const document = {
    generatedAt: new Date().toISOString(),
    protocolVersion: "2025",
    toolCount: tools.length,
    tools
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(`Wrote ${output} (${tools.length} tools).`);
} finally {
  try {
    await client.close();
  } catch {
    // Best effort.
  }
}
