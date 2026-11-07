#!/usr/bin/env node
/**
 * HTTP transport smoke test:
 * - starts dist/index.js with --http on a free loopback port
 * - waits for /health
 * - performs an MCP initialize + tools/list + new_project over Streamable HTTP
 * - verifies a second session shares the same active project
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const entry = path.join(root, "dist", "index.js");
const workspace = path.join(here, "tmp-http");

if (!fs.existsSync(entry)) {
  console.error(`Missing ${entry}. Run "npm run build" first.`);
  process.exit(1);
}

fs.rmSync(workspace, { recursive: true, force: true });
fs.mkdirSync(workspace, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForJson(url, child, label = url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function makeClient() {
  return new Client(
    { name: "turbowarp-mcp-http-smoke", version: "1.0.0" },
    { capabilities: {} }
  );
}

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const stderrChunks = [];
  const child = spawn(
    process.execPath,
    [
      entry,
      "--http",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--workspace",
      workspace,
      "--confirm",
      "none",
      "--log-level",
      "error"
    ],
    { cwd: root, env: { ...process.env, TW_MCP_LOG_LEVEL: "error" } }
  );
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk.toString("utf8")));

  try {
    const health = await waitForJson(`${base}/health`, child, "/health");
    assert.equal(health.ok, true);
    assert.equal(health.name, "turbowarp-mcp-server");
    assert.equal(health.dashboard, `${base}/dashboard`);
    console.log(`/health: ok, transports=${health.transports.join(",")}`);

    const client = makeClient();
    const transport = new StreamableHTTPClientTransport(
      new URL(`${base}/mcp`)
    );
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 11);
    console.log(`Streamable HTTP tools/list: ${tools.length} tools`);

    const created = await client.callTool({
      name: "new_project",
      arguments: { name: "HTTP Test" }
    });
    assert.ok(!created.isError, created.content?.[0]?.text);
    assert.equal(created.structuredContent.loaded, true);

    await client.close();

    // A second session must see the same in-memory project because the HTTP
    // server shares one ServerContext between sessions.
    const client2 = makeClient();
    const transport2 = new StreamableHTTPClientTransport(
      new URL(`${base}/mcp`)
    );
    await client2.connect(transport2);
    const listed = await client2.callTool({
      name: "list_sprites",
      arguments: {}
    });
    assert.ok(!listed.isError, listed.content?.[0]?.text);
    assert.equal(listed.structuredContent.displayName, "HTTP Test");
    console.log("second HTTP session sees the shared active project");

    const dashboardResponse = await fetch(`${base}/api/dashboard`);
    assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json();
    assert.equal(dashboard.ok, true);
    assert.equal(dashboard.server.transport, "http");
    assert.ok(dashboard.tools.available.includes("new_project"));
    assert.ok(
      dashboard.connections.some(
        (connection) =>
          connection.transport === "streamable-http" &&
          connection.status === "connected"
      )
    );
    assert.ok(
      dashboard.connections.some(
        (connection) => connection.clientName === "turbowarp-mcp-http-smoke"
      )
    );
    assert.ok(
      dashboard.toolCalls.some(
        (call) => call.tool === "new_project" && call.ok
      )
    );
    assert.ok(dashboard.logs.length > 0);
    console.log(
      `/api/dashboard: ${dashboard.connections.length} connections, ` +
        `${dashboard.toolCalls.length} calls, ${dashboard.logs.length} logs`
    );

    const pageResponse = await fetch(`${base}/dashboard`);
    assert.equal(pageResponse.status, 200);
    assert.match(
      pageResponse.headers.get("content-type") ?? "",
      /text\/html/
    );
    const pageHtml = await pageResponse.text();
    assert.match(pageHtml, /TurboWarp MCP/);
    console.log("/dashboard: HTML served");

    const clearResponse = await fetch(`${base}/api/dashboard/clear`, {
      method: "POST"
    });
    assert.equal(clearResponse.status, 200);
    const cleared = await (
      await fetch(`${base}/api/dashboard`)
    ).json();
    assert.equal(cleared.logs.length, 0);
    assert.equal(cleared.toolCalls.length, 0);
    console.log("/api/dashboard/clear: ok");

    await client2.close();

    // Legacy SSE transport.
    const sseClient = makeClient();
    const sseTransport = new SSEClientTransport(new URL(`${base}/sse`));
    await sseClient.connect(sseTransport);
    const sseTools = await sseClient.listTools();
    assert.equal(sseTools.tools.length, 11);
    const sseListed = await sseClient.callTool({
      name: "list_sprites",
      arguments: {}
    });
    assert.ok(!sseListed.isError, sseListed.content?.[0]?.text);
    assert.equal(sseListed.structuredContent.displayName, "HTTP Test");
    const sseDashboard = await (
      await fetch(`${base}/api/dashboard`)
    ).json();
    assert.ok(
      sseDashboard.connections.some(
        (connection) =>
          connection.transport === "sse" && connection.status === "connected"
      )
    );
    assert.ok(
      sseDashboard.toolCalls.some((call) => call.tool === "list_sprites")
    );
    console.log("legacy SSE tools/list and shared project: ok");
    await sseClient.close();
  } finally {
    child.kill();
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (child.exitCode !== null && child.exitCode !== 0) {
      console.error(stderrChunks.join(""));
    }
  }

  await testStdioDashboard();
}

async function testStdioDashboard() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const stderrChunks = [];
  const child = spawn(
    process.execPath,
    [
      entry,
      "--workspace",
      workspace,
      "--confirm",
      "none",
      "--dashboard-port",
      String(port),
      "--log-level",
      "error"
    ],
    { cwd: root, env: { ...process.env, TW_MCP_LOG_LEVEL: "error" } }
  );
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk.toString("utf8")));

  try {
    const dashboard = await waitForJson(
      `${base}/api/dashboard`,
      child,
      "stdio dashboard"
    );
    assert.equal(dashboard.ok, true);
    assert.equal(dashboard.server.transport, "stdio");
    assert.equal(dashboard.server.http.dashboardUrl, `${base}/dashboard`);
    assert.ok(
      dashboard.connections.some(
        (connection) =>
          connection.transport === "stdio" && connection.status === "connected"
      )
    );
    const health = await waitForJson(`${base}/health`, child, "stdio /health");
    assert.equal(health.dashboard, `${base}/dashboard`);
    const pageResponse = await fetch(`${base}/dashboard`);
    assert.equal(pageResponse.status, 200);
    assert.match(
      pageResponse.headers.get("content-type") ?? "",
      /text\/html/
    );
    console.log("stdio --dashboard-port: ok");
  } finally {
    child.kill();
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (child.exitCode !== null && child.exitCode !== 0) {
      console.error(stderrChunks.join(""));
    }
  }
}

main().catch((error) => {
  console.error(`HTTP smoke test failed: ${error.stack ?? error}`);
  process.exitCode = 1;
});
