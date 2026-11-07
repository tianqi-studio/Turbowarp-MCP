#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  helpText,
  isHelpRequested,
  isVersionRequested,
  parseConfig,
  type ServerConfig,
  type TransportKind
} from "./config.js";
import { errorMessage } from "./errors.js";
import {
  startDashboardServer,
  startHttpServer,
  type DashboardServerHandle,
  type HttpServerHandle
} from "./http.js";
import { configureLogging, installStdioConsoleGuard, log } from "./log.js";
import { createMcpServer } from "./server.js";
import { createServerContext } from "./tools/common.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

function print(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function runStdio(config: ServerConfig): Promise<void> {
  installStdioConsoleGuard();
  configureLogging(config.logLevel);

  const context = createServerContext(config);
  const server = createMcpServer(config, context);
  const transport = new StdioServerTransport();

  let dashboardHandle: DashboardServerHandle | null = null;
  if (config.dashboardPort !== null) {
    try {
      dashboardHandle = await startDashboardServer(config, context);
      print(`MCP dashboard: ${dashboardHandle.dashboardUrl}`);
    } catch (error) {
      log.warn("Failed to start MCP dashboard", {
        port: config.dashboardPort,
        error: errorMessage(error)
      });
    }
  }

  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info("Shutting down", { reason });
    try {
      await server.close();
    } catch (error) {
      log.warn("Error while closing MCP server", {
        error: errorMessage(error)
      });
    }
    if (dashboardHandle) {
      try {
        await dashboardHandle.close();
      } catch (error) {
        log.warn("Error while closing MCP dashboard", {
          error: errorMessage(error)
        });
      }
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });
  process.stdin.on("end", () => {
    void shutdown("stdin closed").finally(() => process.exit(0));
  });

  await server.connect(transport);

  log.info(`${SERVER_NAME} ${SERVER_VERSION} ready on stdio`, {
    workspace: config.workspace,
    confirmMode: config.confirmMode,
    allowAnyPath: config.allowAnyPath,
    vmModule: config.vmModule
  });
}

async function runHttp(
  config: ServerConfig,
  kind: Exclude<TransportKind, "stdio">
): Promise<void> {
  configureLogging(config.logLevel);

  const handle: HttpServerHandle = await startHttpServer(config);

  if (kind === "sse") {
    print(`Legacy SSE endpoint: ${handle.sseUrl}`);
    print(`Legacy SSE messages endpoint: ${handle.url}/messages?sessionId=<id>`);
    print(`Streamable HTTP endpoint is also available at ${handle.mcpUrl}`);
  } else {
    print(`MCP Streamable HTTP endpoint: ${handle.mcpUrl}`);
    print(`Legacy SSE endpoint (optional): ${handle.sseUrl}`);
  }
  print(`Health check: ${handle.healthUrl}`);
  print(`MCP dashboard: ${handle.dashboardUrl}`);
  print(`Workspace: ${config.workspace}`);
  print(`Confirmation policy: ${config.confirmMode}`);

  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info("Shutting down HTTP server", { reason });
    try {
      await handle.close();
    } catch (error) {
      log.warn("Error while closing HTTP server", {
        error: errorMessage(error)
      });
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (isHelpRequested(argv)) {
    process.stdout.write(helpText());
    return;
  }
  if (isVersionRequested(argv)) {
    process.stdout.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);
    return;
  }

  const config = parseConfig(argv);
  if (config.transport === "stdio") {
    await runStdio(config);
    return;
  }
  await runHttp(config, config.transport);
}

main().catch((error: unknown) => {
  process.stderr.write(`${SERVER_NAME}: ${errorMessage(error)}\n`);
  if (process.env.TW_MCP_DEBUG === "1" && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.stderr.write("Run with --help for usage.\n");
  process.exitCode = 1;
});
