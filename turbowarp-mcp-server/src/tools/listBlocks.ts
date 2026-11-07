import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { blockCatalog } from "../scratch/registry.js";
import {
  runTool,
  toolResult,
  type ServerContext
} from "./common.js";

const categorySchema = z.enum([
  "motion",
  "looks",
  "sound",
  "events",
  "control",
  "sensing",
  "operators",
  "data",
  "procedures"
]);

const inputSchema = {
  category: categorySchema
    .optional()
    .describe("Only return blocks from this category."),
  turbo_warp_only: z
    .boolean()
    .optional()
    .describe(
      "When true, return only blocks marked as TurboWarp-specific. Defaults to false (all blocks)."
    )
};

const blockSchema = z.object({
  opcode: z.string(),
  shape: z.enum(["hat", "stack", "cap", "reporter", "boolean", "menu"]),
  category: z.string(),
  description: z.string(),
  inputs: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      default: z.union([z.string(), z.number()]).optional(),
      menu: z.string().optional()
    })
  ),
  fields: z.array(
    z.object({
      name: z.string(),
      default: z.string(),
      kind: z.string(),
      options: z.array(z.string()).optional()
    })
  ),
  substacks: z.array(z.string()),
  turboWarpOnly: z.boolean(),
  aliases: z.array(z.string())
});

const outputSchema = z.object({
  count: z.number().int(),
  category: categorySchema.nullable(),
  blocks: z.array(blockSchema)
});

export function registerListBlocks(
  server: McpServer,
  context: ServerContext
): void {
  server.registerTool(
    "list_blocks",
    {
      title: "List known block opcodes",
      description:
        "List the built-in block registry used by add_block: opcodes, shapes, categories, input names, field names/defaults/options, substacks, aliases, and TurboWarp-only flags. " +
        "The registry covers the standard Scratch 3 categories plus common TurboWarp blocks, but it is not exhaustive. " +
        "Unknown extension opcodes can still be inserted with add_block and raw inputs. This is a read-only tool.",
      inputSchema,
      outputSchema: outputSchema.shape,
      annotations: {
        title: "List known block opcodes",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) =>
      runTool(async () => {
        const all = blockCatalog();
        const filtered = all.filter((entry) => {
          if (args.category && entry.category !== args.category) {
            return false;
          }
          if (args.turbo_warp_only === true && !entry.turboWarpOnly) {
            return false;
          }
          return true;
        });

        const lines = [
          `${filtered.length} block(s)${args.category ? ` in ${args.category}` : ""}` +
            (args.turbo_warp_only ? " (TurboWarp-only)" : "") +
            ":"
        ];
        for (const entry of filtered) {
          const inputs =
            entry.inputs.length > 0
              ? ` inputs=${entry.inputs.map((input) => input.name).join(",")}`
              : "";
          const fields =
            entry.fields.length > 0
              ? ` fields=${entry.fields.map((field) => field.name).join(",")}`
              : "";
          lines.push(
            `- ${entry.opcode} [${entry.shape}/${entry.category}] ${entry.description}${inputs}${fields}`
          );
        }

        return toolResult(
          {
            count: filtered.length,
            category: args.category ?? null,
            blocks: filtered
          },
          lines.join("\n")
        );
      })
  );
}
