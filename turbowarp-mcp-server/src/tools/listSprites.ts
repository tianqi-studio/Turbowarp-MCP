import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getStage, listSprites } from "../scratch/project.js";
import {
  getProject,
  runTool,
  targetDetail,
  targetDetailSchema,
  toolResult,
  type ServerContext
} from "./common.js";

const inputSchema = {
  include_stage: z
    .boolean()
    .optional()
    .describe(
      "Include the Stage entry in the response. Defaults to true. The Stage is never counted as a sprite."
    )
};

const outputSchema = z.object({
  displayName: z.string(),
  dirty: z.boolean(),
  targetCount: z.number().int(),
  spriteCount: z.number().int(),
  stage: targetDetailSchema.nullable(),
  sprites: z.array(targetDetailSchema)
});

export function registerListSprites(
  server: McpServer,
  context: ServerContext
): void {
  server.registerTool(
    "list_sprites",
    {
      title: "List sprites and Stage",
      description:
        "List every target in the active project with position, size, direction, costume/sound names, " +
        "block and script counts, and variable/list counts. " +
        "This is a read-only tool and never changes the project. " +
        "Use get_scripts to inspect the actual block stacks for a target.",
      inputSchema,
      outputSchema: outputSchema.shape,
      annotations: {
        title: "List sprites and Stage",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) =>
      runTool(async () => {
        const loaded = getProject(context);
        const project = loaded.project;
        const sprites = listSprites(project);
        const stage = args.include_stage === false ? null : targetDetail(getStage(project));
        const spriteDetails = sprites.map(targetDetail);

        const lines = [
          `"${loaded.displayName}": ${project.targets.length} target(s), ${sprites.length} sprite(s).`
        ];
        if (stage) {
          lines.push(
            `- Stage: ${stage.costumeCount} costume(s), ${stage.soundCount} sound(s), ` +
              `${stage.scriptCount} script(s) / ${stage.blockCount} block(s), ` +
              `${stage.variableCount} variable(s), ${stage.listCount} list(s)`
          );
        }
        for (const sprite of spriteDetails) {
          lines.push(
            `- ${sprite.name}: x=${sprite.x ?? 0}, y=${sprite.y ?? 0}, ` +
              `visible=${sprite.visible !== false}, ` +
              `${sprite.costumeCount} costume(s), ${sprite.soundCount} sound(s), ` +
              `${sprite.scriptCount} script(s) / ${sprite.blockCount} block(s)`
          );
        }

        return toolResult(
          {
            displayName: loaded.displayName,
            dirty: loaded.dirty,
            targetCount: project.targets.length,
            spriteCount: sprites.length,
            stage,
            sprites: spriteDetails
          },
          lines.join("\n")
        );
      })
  );
}
