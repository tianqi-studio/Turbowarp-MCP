import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AppError } from "../errors.js";
import { log } from "../log.js";
import { insertBlocks } from "../scratch/blocks.js";
import type {
  BlockInputValue,
  BlockSpec,
  FieldInputValue,
  InsertMode
} from "../scratch/blocks.js";
import { countBlocks, listScripts } from "../scratch/project.js";
import { isPlainObject } from "../utils/json.js";
import {
  assertConfirmation,
  getProject,
  runTool,
  selectTarget,
  toolResult,
  warningSchema,
  type ServerContext
} from "./common.js";

const modeSchema = z.enum(["new", "append", "start", "after", "substack"]);
const positionSchema = z.enum(["start", "end"]);

const inputSchema = {
  opcode: z
    .string()
    .min(1)
    .describe(
      'Block opcode or friendly alias, for example "looks_say", "control_repeat", or "say". Unknown opcodes are accepted with a warning; pass raw inputs for them.'
    ),
  target: z
    .string()
    .optional()
    .describe(
      "Target name that receives the block. Defaults to the first sprite, or the Stage when no sprites exist."
    ),
  inputs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Input map. Values may be literals, {\"variable\":\"score\"}, {\"list\":\"items\"}, " +
        '{"broadcast":"start"}, {"menu":"Sprite2"} (uses the documented menu), ' +
        '{"menu":"costume1","opcode":"looks_costume"}, a nested {"block":{...}} reporter, or {"raw":[1,[10,"text"]]}.'
    ),
  fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Field map. Values may be literals or {\"variable\":\"score\"}, {\"list\":\"items\"}, {\"broadcast\":\"start\"}. " +
        "Raw Scratch field tuples such as [\"name\",\"id\"] are also accepted."
    ),
  substacks: z
    .record(z.string(), z.array(z.record(z.string(), z.unknown())))
    .optional()
    .describe(
      'Substack map, for example {"SUBSTACK":[...blocks...], "SUBSTACK2":[...]} for control_if_else. ' +
        "Each entry is a chain of block spec objects. " +
        "Nested values use the same shape as this tool's arguments (opcode/inputs/fields/substacks/mutation)."
    ),
  mutation: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Raw SB3 mutation object for custom blocks and unusual extension blocks. Passed through unchanged."
    ),
  mode: modeSchema
    .optional()
    .default("new")
    .describe(
      "new = new top-level script; append = after the last block of the anchor script; " +
        "after = immediately after block_id; start = immediately before block_id; " +
        "substack = add inside a C-block substack."
    ),
  block_id: z
    .string()
    .optional()
    .describe(
      'Anchor block id for modes "append", "after", "start", and "substack". Use get_scripts to find ids.'
    ),
  substack: z
    .string()
    .optional()
    .describe(
      'Substack input name for mode "substack". Defaults to "SUBSTACK"; control_if_else also has "SUBSTACK2".'
    ),
  position: positionSchema
    .optional()
    .default("end")
    .describe(
      'Where to insert inside a substack: "start" or "end". Defaults to "end".'
    ),
  x: z
    .number()
    .optional()
    .describe("Script x position for a new top-level script."),
  y: z
    .number()
    .optional()
    .describe("Script y position for a new top-level script."),
  confirm: z
    .boolean()
    .optional()
    .describe("Required when the confirmation policy gates this tool.")
};

const outputSchema = z.object({
  target: z.string(),
  mode: modeSchema,
  rootId: z.string(),
  blockIds: z.array(z.string()),
  warnings: z.array(warningSchema),
  blockCount: z.number().int(),
  scriptCount: z.number().int(),
  dirty: z.literal(true)
});

function assertBlockSpec(
  value: unknown,
  where: string,
  depth = 0
): asserts value is BlockSpec {
  if (depth > 200) {
    throw new AppError(
      "BLOCK_NESTING_TOO_DEEP",
      `Block spec nesting is too deep at ${where}. Split the script into smaller add_block calls.`
    );
  }
  if (!isPlainObject(value)) {
    throw new AppError("INVALID_BLOCK_SPEC", `${where} must be an object.`);
  }
  if (typeof value.opcode !== "string" || value.opcode.trim() === "") {
    throw new AppError(
      "INVALID_BLOCK_SPEC",
      `${where}.opcode must be a non-empty string.`
    );
  }

  if (value.inputs !== undefined && !isPlainObject(value.inputs)) {
    throw new AppError(
      "INVALID_BLOCK_SPEC",
      `${where}.inputs must be an object when present.`
    );
  }
  if (value.fields !== undefined && !isPlainObject(value.fields)) {
    throw new AppError(
      "INVALID_BLOCK_SPEC",
      `${where}.fields must be an object when present.`
    );
  }
  if (value.mutation !== undefined && !isPlainObject(value.mutation)) {
    throw new AppError(
      "INVALID_BLOCK_SPEC",
      `${where}.mutation must be an object when present.`
    );
  }

  for (const [name, input] of Object.entries(value.inputs ?? {})) {
    if (!isPlainObject(input)) {
      continue;
    }
    if ("block" in input) {
      assertBlockSpec(
        input.block,
        `${where}.inputs.${name}.block`,
        depth + 1
      );
    }
    if ("raw" in input && !Array.isArray(input.raw)) {
      throw new AppError(
        "INVALID_BLOCK_SPEC",
        `${where}.inputs.${name}.raw must be an SB3 input tuple such as [1,[10,"text"]].`
      );
    }
    if ("menu" in input && !["string", "number"].includes(typeof input.menu)) {
      throw new AppError(
        "INVALID_BLOCK_SPEC",
        `${where}.inputs.${name}.menu must be a string or number.`
      );
    }
  }

  if (value.substacks !== undefined) {
    if (!isPlainObject(value.substacks)) {
      throw new AppError(
        "INVALID_BLOCK_SPEC",
        `${where}.substacks must be an object when present.`
      );
    }
    for (const [name, chain] of Object.entries(value.substacks)) {
      if (!Array.isArray(chain)) {
        throw new AppError(
          "INVALID_BLOCK_SPEC",
          `${where}.substacks.${name} must be an array of block specs.`
        );
      }
      chain.forEach((item, index) => {
        assertBlockSpec(
          item,
          `${where}.substacks.${name}[${index}]`,
          depth + 1
        );
      });
    }
  }
}

export function registerAddBlock(
  server: McpServer,
  context: ServerContext
): void {
  server.registerTool(
    "add_block",
    {
      title: "Add a block",
      description:
        "Insert one Scratch 3 block into the active project's Stage or a sprite, either as a new script or attached to an existing script. " +
        "Built-in defaults and menu shadows are created for known opcodes. Nested reporters, variables, lists, broadcasts, and C-block substacks are supported. " +
        "Use get_scripts to inspect block ids before appending, inserting, or extending a substack. " +
        "Unknown extension opcodes are allowed but produce a warning; provide raw inputs when the default metadata is insufficient. " +
        "This mutates the active project; export_sb3 writes it to disk.",
      inputSchema,
      outputSchema: outputSchema.shape,
      annotations: {
        title: "Add a block",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) =>
      runTool(async () => {
        assertConfirmation(context, "add_block", "mutating", args.confirm);

        const loaded = getProject(context);
        const project = loaded.project;
        const target = selectTarget(project, args.target);

        const spec: BlockSpec = {
          opcode: args.opcode,
          ...(args.inputs
            ? { inputs: args.inputs as Record<string, BlockInputValue> }
            : {}),
          ...(args.fields
            ? { fields: args.fields as Record<string, FieldInputValue> }
            : {}),
          ...(args.substacks
            ? {
                substacks: Object.fromEntries(
                  Object.entries(args.substacks).map(([name, chain]) => {
                    const validated = chain.map((item, index) => {
                      assertBlockSpec(item, `substacks.${name}[${index}]`);
                      return item;
                    });
                    return [name, validated];
                  })
                )
              }
            : {}),
          ...(args.mutation
            ? { mutation: args.mutation as Record<string, unknown> }
            : {})
        };

        assertBlockSpec(spec, "block");

        const mode = args.mode as InsertMode;
        const result = insertBlocks({
          project,
          target,
          mode,
          blocks: [spec],
          ...(args.block_id ? { blockId: args.block_id } : {}),
          ...(args.substack ? { substack: args.substack } : {}),
          position: args.position,
          ...(args.x !== undefined ? { x: args.x } : {}),
          ...(args.y !== undefined ? { y: args.y } : {})
        });

        loaded.dirty = true;
        const blockCount = countBlocks(target);
        const scriptCount = listScripts(target).length;

        log.info("Added block", {
          project: loaded.displayName,
          target: target.name,
          opcode: args.opcode,
          mode,
          rootId: result.rootId
        });

        const warningText =
          result.warnings.length > 0
            ? `\nWarnings:\n${result.warnings
                .map((warning) => `- ${warning.code}: ${warning.message}`)
                .join("\n")}`
            : "";

        return toolResult(
          {
            target: target.name,
            mode,
            rootId: result.rootId,
            blockIds: result.ids,
            warnings: result.warnings,
            blockCount,
            scriptCount,
            dirty: true as const
          },
          `Added ${args.opcode} to "${target.name}" in mode "${mode}". ` +
            `rootId=${result.rootId}. The target now has ${scriptCount} script(s) and ${blockCount} block(s).` +
            warningText
        );
      })
  );
}
