import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { log } from "../log.js";
import { createEmptyProject } from "../scratch/project.js";
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
  name: z
    .string()
    .optional()
    .describe('Project display name. Defaults to "Untitled".'),
  with_default_sprite: z
    .boolean()
    .optional()
    .describe(
      "Create a default Sprite1 with a built-in SVG costume. Defaults to true."
    ),
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Required when the confirmation policy gates this tool. Creating a project replaces the active project."
    )
};

export function registerNewProject(
  server: McpServer,
  context: ServerContext
): void {
  server.registerTool(
    "new_project",
    {
      title: "Create a new project",
      description:
        "Create a new, empty Scratch 3 project in memory and make it the active project. " +
        "A white 480x360 SVG backdrop and (by default) a Sprite1 with a built-in SVG costume are added. " +
        "No files are written until export_sb3 is called. " +
        "This replaces any currently loaded project, so it is a destructive operation. " +
        "Returns a project overview.",
      inputSchema,
      outputSchema: projectOverviewSchema.shape,
      annotations: {
        title: "Create a new project",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) =>
      runTool(async () => {
        assertConfirmation(context, "new_project", "mutating", args.confirm);

        const created = createEmptyProject({
          displayName: args.name ?? "Untitled",
          withDefaultSprite: args.with_default_sprite !== false
        });

        const hadProject = context.state.loaded !== null;
        const loaded = {
          project: created.project,
          assets: created.assets,
          sourcePath: null,
          displayName: created.displayName,
          dirty: true,
          loadedAt: new Date().toISOString()
        };
        context.state.loaded = loaded;

        const overview = buildProjectOverview(loaded);
        log.info("Created new project", {
          name: overview.displayName,
          targets: overview.targetCount
        });

        return toolResult(
          overview,
          projectOverviewText(overview) +
            (hadProject ? "\nThe previous active project was replaced." : "") +
            '\nNothing has been written to disk yet. Use export_sb3 when ready.'
        );
      })
  );
}
