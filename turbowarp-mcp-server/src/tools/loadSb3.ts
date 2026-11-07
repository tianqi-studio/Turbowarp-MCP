import * as path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { log } from "../log.js";
import { parseProjectBuffer, readSb3File } from "../scratch/parser.js";
import { normalizeProject } from "../scratch/project.js";
import { resolveUserPath } from "../utils/path.js";
import {
  assertConfirmation,
  buildProjectOverview,
  projectOverviewSchema,
  projectOverviewText,
  runTool,
  toolResult,
  type ServerContext
} from "./common.js";

const inputSchema = {
  path: z
    .string()
    .min(1)
    .describe(
      "Path to an SB3 file. Relative paths are resolved inside TW_MCP_WORKSPACE; absolute paths must also be inside it unless --allow-any-path is set. Windows paths with backslashes are accepted."
    ),
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Required when the configured confirmation policy gates this tool. Replaces the active project, so confirmation is recommended."
    )
};

export function registerLoadSb3(
  server: McpServer,
  context: ServerContext
): void {
  server.registerTool(
    "load_sb3",
    {
      title: "Load SB3 project",
      description:
        "Open an existing Scratch 3 / TurboWarp .sb3 file and make it the active project. " +
        "The file is parsed and validated with TurboWarp's scratch-parser fork; assets are kept in memory for later export. " +
        "This replaces any currently loaded project, so it is a destructive operation. " +
        "Only SB3 (projectVersion 3) is supported; export SB2/SB1 projects as SB3 in TurboWarp Desktop first. " +
        "Returns a project overview and any missing asset references.",
      inputSchema,
      outputSchema: projectOverviewSchema.shape,
      annotations: {
        title: "Load SB3 project",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) =>
      runTool(async () => {
        assertConfirmation(context, "load_sb3", "mutating", args.confirm);

        const resolved = resolveUserPath(context.config, args.path);
        const { buffer, assets } = await readSb3File(
          resolved,
          context.config.maxSb3Bytes
        );
        const parsed = await parseProjectBuffer(buffer);
        const project = normalizeProject(parsed);

        const displayName =
          path.basename(resolved, path.extname(resolved)).trim() || "Untitled";
        const loaded = {
          project,
          assets,
          sourcePath: resolved,
          displayName,
          dirty: false,
          loadedAt: new Date().toISOString()
        };

        const hadProject = context.state.loaded !== null;
        context.state.loaded = loaded;

        const overview = buildProjectOverview(loaded);
        log.info("Loaded SB3 project", {
          path: resolved,
          targets: overview.targetCount,
          blocks: overview.blockCount,
          missingAssets: overview.missingAssets.length
        });

        return toolResult(
          overview,
          projectOverviewText(overview) +
            (hadProject ? "\nThe previous active project was replaced." : "")
        );
      })
  );
}
