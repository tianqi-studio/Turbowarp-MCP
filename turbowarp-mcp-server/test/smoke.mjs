#!/usr/bin/env node
/**
 * End-to-end smoke test over the real stdio transport.
 *
 * It starts dist/index.js as a child process, exercises every tool, and
 * verifies the generated SB3 can be parsed, loaded again, and executed by the
 * headless VM.
 *
 * Run `npm run build` first, then `npm run smoke`.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const entry = path.join(root, "dist", "index.js");
const workspace = path.join(here, "tmp");

if (!fs.existsSync(entry)) {
  console.error(`Missing ${entry}. Run "npm run build" first.`);
  process.exit(1);
}

fs.rmSync(workspace, { recursive: true, force: true });
fs.mkdirSync(workspace, { recursive: true });

const stderrChunks = [];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry, "--workspace", workspace, "--confirm", "destructive"],
  cwd: root,
  env: {
    ...process.env,
    TW_MCP_LOG_LEVEL: "error",
    TW_MCP_WORKSPACE: workspace
  },
  stderr: "pipe"
});
transport.stderr?.on("data", (chunk) => {
  stderrChunks.push(chunk.toString("utf8"));
});

const client = new Client(
  { name: "turbowarp-mcp-smoke", version: "1.0.0" },
  { capabilities: {} }
);

const watchdog = setTimeout(() => {
  console.error("Smoke test timed out after 180 seconds.");
  console.error(stderrChunks.join(""));
  process.exit(2);
}, 180_000);
watchdog.unref();

function textOf(result) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function structured(result) {
  assert.ok(result.structuredContent, "Tool result is missing structuredContent");
  return result.structuredContent;
}

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`${name} failed:\n${textOf(result)}`);
  }
  return result;
}

async function main() {
  await client.connect(transport);
  console.log("connected to stdio server");

  const { tools } = await client.listTools();
  const names = new Set(tools.map((tool) => tool.name));
  const required = [
    "load_sb3",
    "new_project",
    "list_sprites",
    "add_sprite",
    "add_block",
    "get_scripts",
    "set_variable",
    "get_variable",
    "export_sb3",
    "run_headless",
    "list_blocks"
  ];
  for (const name of required) {
    assert.ok(names.has(name), `Missing tool: ${name}`);
  }
  assert.equal(tools.length, required.length, `Expected ${required.length} tools, got ${tools.length}`);
  for (const tool of tools) {
    assert.ok(tool.inputSchema, `${tool.name} is missing inputSchema`);
    assert.ok(tool.outputSchema, `${tool.name} is missing outputSchema`);
  }
  console.log(`tools/list: ${tools.length} tools with input and output schemas`);

  // Confirmation gate: the default/destructive policy must reject the call
  // before any mutation happens.
  const denied = await client.callTool({
    name: "new_project",
    arguments: { name: "Should Not Exist" }
  });
  assert.equal(denied.isError, true, "new_project without confirm should fail");
  assert.match(textOf(denied), /CONFIRMATION_REQUIRED/);
  assert.match(textOf(denied), /No changes were made/);
  console.log("confirmation gate: rejected new_project without confirm");

  const created = await call("new_project", {
    name: "Smoke Test",
    with_default_sprite: false,
    confirm: true
  });
  const createdOverview = structured(created);
  assert.equal(createdOverview.loaded, true);
  assert.equal(createdOverview.targetCount, 1);
  assert.equal(createdOverview.dirty, true);

  const spriteResult = await call("add_sprite", {
    name: "Runner",
    x: 10,
    y: 20,
    confirm: true
  });
  assert.equal(structured(spriteResult).sprite.name, "Runner");

  const listResult = await call("list_sprites", { include_stage: true });
  const listed = structured(listResult);
  assert.equal(listed.spriteCount, 1);
  assert.equal(listed.sprites[0].name, "Runner");

  const hat = await call("add_block", {
    target: "Runner",
    opcode: "event_whenflagclicked",
    confirm: true
  });
  const hatId = structured(hat).rootId;
  assert.ok(hatId);

  const setBlock = await call("add_block", {
    target: "Runner",
    opcode: "data_setvariableto",
    mode: "append",
    block_id: hatId,
    inputs: { VALUE: 100 },
    fields: { VARIABLE: { variable: "score", scope: "global" } },
    confirm: true
  });
  assert.ok(structured(setBlock).blockIds.length >= 1);

  const sayBlock = await call("add_block", {
    target: "Runner",
    opcode: "looks_say",
    mode: "append",
    block_id: structured(setBlock).rootId,
    inputs: {
      MESSAGE: {
        block: {
          opcode: "data_variable",
          fields: { VARIABLE: { variable: "score", scope: "global" } }
        }
      }
    },
    confirm: true
  });
  assert.ok(structured(sayBlock).blockIds.length >= 2);

  const scripts = structured(await call("get_scripts", { target: "Runner" }));
  assert.equal(scripts.targetCount, 1);
  assert.equal(scripts.totalScripts, 1);
  assert.ok(scripts.totalBlocks >= 4, `Expected nested blocks, got ${scripts.totalBlocks}`);
  assert.equal(scripts.truncated, false);

  const setVar = structured(
    await call("set_variable", {
      name: "score",
      value: 42,
      target: "Runner",
      scope: "global",
      confirm: true
    })
  );
  assert.equal(setVar.value, 42);
  assert.equal(setVar.scope, "global");

  const getVar = structured(
    await call("get_variable", { name: "score", scope: "global" })
  );
  assert.equal(getVar.found, true);
  assert.equal(getVar.variable.value, 42);

  const blocks = structured(await call("list_blocks", { category: "looks" }));
  assert.ok(blocks.count > 0);
  assert.ok(blocks.blocks.some((block) => block.opcode === "looks_say"));

  const exported = structured(
    await call("export_sb3", { path: "smoke-output.sb3", confirm: true })
  );
  assert.equal(exported.exported, true);
  assert.ok(fs.existsSync(exported.path), `Export missing: ${exported.path}`);
  assert.ok(exported.bytes > 0);

  const loaded = structured(
    await call("load_sb3", { path: "smoke-output.sb3", confirm: true })
  );
  assert.equal(loaded.targetCount, 2);
  assert.equal(loaded.dirty, false);

  const loadedVar = structured(
    await call("get_variable", { name: "score", scope: "global" })
  );
  assert.equal(loadedVar.found, true);
  assert.equal(loadedVar.variable.value, 42);

  const run = structured(await call("run_headless", { duration_ms: 5000 }));
  assert.equal(run.ran, true);
  assert.equal(run.timedOut, false, "Script should finish and become idle");
  assert.ok(
    run.say.some((event) => event.text === "100"),
    `Expected say "100", got ${JSON.stringify(run.say)}`
  );
  const score = run.variables.find(
    (variable) => variable.name === "score" && variable.owner === "Stage"
  );
  assert.ok(score, `Missing score variable in ${JSON.stringify(run.variables)}`);
  assert.equal(String(score.value), "100");
  console.log(`run_headless: ${run.say.length} say event(s), score=${score.value}`);

  await call("run_headless", { path: "smoke-output.sb3", duration_ms: 5000 });

  console.log("smoke test passed");
}

try {
  await main();
} catch (error) {
  console.error(`\nSMOKE TEST FAILED: ${error.message}`);
  if (stderrChunks.length > 0) {
    console.error("\nServer stderr:\n" + stderrChunks.join(""));
  }
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  try {
    await client.close();
  } catch {
    // Best effort.
  }
}
