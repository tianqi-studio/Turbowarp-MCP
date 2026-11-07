import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ServerConfig } from "./config.js";
import { log } from "./log.js";
import {
  attachServerConnection,
  instrumentServerTools,
  registerConnection,
  registerToolNames,
  updateConnectionClient,
  type ConnectionTransport
} from "./telemetry.js";
import { SERVER_DESCRIPTION, SERVER_NAME, SERVER_VERSION } from "./version.js";

export const TOOL_NAMES = [
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
] as const;

// The dashboard should list the tool catalog even before the first client
// connects (HTTP mode creates McpServer instances lazily).
registerToolNames(TOOL_NAMES);
import { registerAddBlock } from "./tools/addBlock.js";
import { registerAddSprite } from "./tools/addSprite.js";
import { createServerContext, type ServerContext } from "./tools/common.js";
import { registerExportSb3 } from "./tools/exportSb3.js";
import { registerGetScripts } from "./tools/getScripts.js";
import { registerGetVariable } from "./tools/getVariable.js";
import { registerListBlocks } from "./tools/listBlocks.js";
import { registerListSprites } from "./tools/listSprites.js";
import { registerLoadSb3 } from "./tools/loadSb3.js";
import { registerNewProject } from "./tools/newProject.js";
import { registerRunHeadless } from "./tools/runHeadless.js";
import { registerSetVariable } from "./tools/setVariable.js";

const INSTRUCTIONS = `\
TurboWarp MCP edits Scratch 3 / TurboWarp SB3 projects.

Typical workflow:
1. new_project or load_sb3 (one active project is held in memory).
2. list_sprites and get_scripts to inspect targets, block ids, and scripts.
3. add_sprite, add_block, and set_variable to edit. add_block modes: new, append, after, start, substack.
4. export_sb3 to write a real SB3 archive.
5. run_headless for logic smoke tests, then inspect say/think events and variable snapshots.

Mutating tools (load_sb3, new_project, add_sprite, add_block, set_variable, export_sb3) require "confirm": true under the default TW_MCP_CONFIRM=destructive policy. run_headless requires it under TW_MCP_CONFIRM=all. Read-only tools are list_sprites, get_scripts, get_variable, and list_blocks.

Paths are sandboxed to TW_MCP_WORKSPACE unless --allow-any-path is used. Windows paths are accepted. Headless runs have no renderer, audio, camera, microphone, cloud variables, or TurboWarp-only extensions; use it for logic, not visual or audio validation.`;

export interface CreateMcpServerOptions {
  transport?: ConnectionTransport;
  sessionId?: string | null;
}

/**
 * Create a fresh MCP server. HTTP/SSE transports pass a shared ServerContext so
 * all clients edit the same active project.
 */
export function createMcpServer(
  config: ServerConfig,
  context: ServerContext = createServerContext(config),
  options: CreateMcpServerOptions = {}
): McpServer {
  const connectionId = registerConnection({
    transport: options.transport ?? "stdio",
    sessionId: options.sessionId ?? null
  });

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      description: SERVER_DESCRIPTION
    },
    {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS
    }
  );

  attachServerConnection(server, connectionId);
  instrumentServerTools(server, connectionId);

  server.server.oninitialized = () => {
    const client = server.server.getClientVersion();
    updateConnectionClient(connectionId, client);
    log.info("MCP client initialized", {
      connectionId,
      transport: options.transport ?? "stdio",
      client: client?.name ?? null,
      clientVersion: client?.version ?? null
    });
  };

  log.info("MCP connection opened", {
    connectionId,
    transport: options.transport ?? "stdio",
    sessionId: options.sessionId ?? null
  });

  registerLoadSb3(server, context);
  registerNewProject(server, context);
  registerListSprites(server, context);
  registerAddSprite(server, context);
  registerAddBlock(server, context);
  registerGetScripts(server, context);
  registerSetVariable(server, context);
  registerGetVariable(server, context);
  registerExportSb3(server, context);
  registerRunHeadless(server, context);
  registerListBlocks(server, context);

  return server;
}

export type { ServerContext };
