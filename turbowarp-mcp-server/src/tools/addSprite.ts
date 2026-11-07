import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { log } from "../log.js";
import {
  DEFAULT_SPRITE_SVG,
  readCostumeFile,
  registerSvgAsset
} from "../scratch/assets.js";
import { nextLayerOrder, validateSpriteName } from "../scratch/project.js";
import type { Sb3Costume, Sb3Target } from "../scratch/types.js";
import { resolveUserPath } from "../utils/path.js";
import {
  assertConfirmation,
  getProject,
  runTool,
  targetDetail,
  targetDetailSchema,
  toolResult,
  type ServerContext
} from "./common.js";

const rotationStyleSchema = z.enum([
  "all around",
  "left-right",
  "don't rotate"
]);

const inputSchema = {
  name: z
    .string()
    .min(1)
    .describe(
      "Unique sprite name. Cannot be \"Stage\" or \"_stage_\", and is compared case-insensitively with existing target names."
    ),
  costume_path: z
    .string()
    .optional()
    .describe(
      "Optional path to a PNG or SVG costume. Relative paths resolve inside TW_MCP_WORKSPACE. If omitted, a built-in SVG sprite costume is used."
    ),
  costume_name: z
    .string()
    .optional()
    .describe(
      "Costume name. Defaults to the costume file basename, or \"costume1\" for the built-in costume."
    ),
  x: z.number().optional().describe("Initial X position. Defaults to 0."),
  y: z.number().optional().describe("Initial Y position. Defaults to 0."),
  size: z
    .number()
    .positive()
    .optional()
    .describe("Initial size percentage. Defaults to 100."),
  direction: z
    .number()
    .optional()
    .describe("Initial direction in degrees. Defaults to 90."),
  visible: z.boolean().optional().describe("Initial visibility. Defaults to true."),
  draggable: z
    .boolean()
    .optional()
    .describe("Whether the sprite can be dragged in the editor. Defaults to false."),
  rotation_style: rotationStyleSchema
    .optional()
    .describe('Initial rotation style. Defaults to "all around".'),
  confirm: z
    .boolean()
    .optional()
    .describe("Required when the confirmation policy gates this tool.")
};

const outputSchema = z.object({
  created: z.literal(true),
  dirty: z.literal(true),
  targetCount: z.number().int(),
  spriteCount: z.number().int(),
  sprite: targetDetailSchema
});

export function registerAddSprite(
  server: McpServer,
  context: ServerContext
): void {
  server.registerTool(
    "add_sprite",
    {
      title: "Add a sprite",
      description:
        "Add a new sprite to the active project. The sprite gets a PNG or SVG costume (or a built-in SVG costume when costume_path is omitted), " +
        "a new top layer order, and standard Scratch sprite properties. " +
        "Sprite names must be unique (case-insensitive). " +
        "This mutates the active project; call export_sb3 to write it to disk. " +
        "Returns the new sprite's properties and costume list.",
      inputSchema,
      outputSchema: outputSchema.shape,
      annotations: {
        title: "Add a sprite",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) =>
      runTool(async () => {
        assertConfirmation(context, "add_sprite", "mutating", args.confirm);

        const loaded = getProject(context);
        const project = loaded.project;
        const spriteName = validateSpriteName(project, args.name);

        let costume: Sb3Costume;
        if (args.costume_path) {
          const resolved = resolveUserPath(context.config, args.costume_path);
          const info = await readCostumeFile(resolved, {
            maxBytes: context.config.maxSb3Bytes,
            name: args.costume_name,
            assets: loaded.assets
          });
          costume = {
            name: info.name,
            assetId: info.assetId,
            dataFormat: info.dataFormat,
            md5ext: info.md5ext,
            rotationCenterX: info.rotationCenterX,
            rotationCenterY: info.rotationCenterY,
            ...(info.bitmapResolution !== undefined
              ? { bitmapResolution: info.bitmapResolution }
              : {})
          };
        } else {
          const record = registerSvgAsset(loaded.assets, DEFAULT_SPRITE_SVG);
          costume = {
            name: (args.costume_name ?? "").trim() || "costume1",
            assetId: record.assetId,
            dataFormat: "svg",
            md5ext: record.md5ext,
            rotationCenterX: 48,
            rotationCenterY: 50
          };
        }

        const sprite: Sb3Target = {
          isStage: false,
          name: spriteName,
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {},
          comments: {},
          currentCostume: 0,
          costumes: [costume],
          sounds: [],
          volume: 100,
          layerOrder: nextLayerOrder(project),
          visible: args.visible !== false,
          x: args.x ?? 0,
          y: args.y ?? 0,
          size: args.size ?? 100,
          direction: args.direction ?? 90,
          draggable: args.draggable === true,
          rotationStyle: args.rotation_style ?? "all around"
        };

        project.targets.push(sprite);
        loaded.dirty = true;

        const detail = targetDetail(sprite);
        log.info("Added sprite", {
          project: loaded.displayName,
          sprite: spriteName,
          costume: costume.name
        });

        return toolResult(
          {
            created: true as const,
            dirty: true as const,
            targetCount: project.targets.length,
            spriteCount: project.targets.filter((target) => !target.isStage).length,
            sprite: detail
          },
          `Added sprite "${spriteName}" with costume "${costume.name}". ` +
            `The project now has ${project.targets.length} target(s) including the Stage. ` +
            "The change is in memory; use export_sb3 to save it."
        );
      })
  );
}
