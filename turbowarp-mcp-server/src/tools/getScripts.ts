import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { buildScripts } from "../scratch/ast.js";
import { requireTarget } from "../scratch/project.js";
import type {
  BlockAst,
  InputAst,
  Sb3FieldValue,
  ScriptAst
} from "../scratch/types.js";
import {
  getProject,
  runTool,
  toolResult,
  type ServerContext
} from "./common.js";

const fieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().nullable())
]);

const inputAstSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("literal"),
      value: z.unknown(),
      primitiveType: z.string()
    }),
    z.object({
      type: z.literal("menu"),
      value: z.unknown(),
      opcode: z.string().optional(),
      fields: z.record(z.string(), fieldValueSchema).optional()
    }),
    z.object({
      type: z.literal("block"),
      block: blockAstSchema,
      shadow: inputAstSchema.optional()
    }),
    z.object({
      type: z.literal("stack"),
      stack: z.array(blockAstSchema)
    }),
    z.object({
      type: z.literal("empty")
    }),
    z.object({
      type: z.literal("shadowBlock"),
      block: blockAstSchema
    })
  ])
);

const blockAstSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    id: z.string(),
    opcode: z.string(),
    shadow: z.boolean(),
    fields: z.record(z.string(), fieldValueSchema),
    inputs: z.record(z.string(), inputAstSchema),
    mutation: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional()
  })
);

const scriptAstSchema = z.object({
  index: z.number().int(),
  kind: z.enum(["script", "reporter"]),
  rootId: z.string(),
  x: z.number(),
  y: z.number(),
  stack: z.array(blockAstSchema)
});

const targetScriptsSchema = z.object({
  name: z.string(),
  isStage: z.boolean(),
  scriptCount: z.number().int(),
  blockCount: z.number().int(),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
  scripts: z.array(scriptAstSchema)
});

const outputSchema = z.object({
  displayName: z.string(),
  dirty: z.boolean(),
  targetCount: z.number().int(),
  totalScripts: z.number().int(),
  totalBlocks: z.number().int(),
  truncated: z.boolean(),
  targets: z.array(targetScriptsSchema)
});

const inputSchema = {
  target: z
    .string()
    .optional()
    .describe(
      "Target name (Stage or a sprite). When omitted, scripts from every target are returned."
    ),
  include_stage: z
    .boolean()
    .optional()
    .describe(
      "When target is omitted, include the Stage. Defaults to true. Ignored when target is set."
    ),
  max_blocks: z
    .number()
    .int()
    .min(1)
    .max(50000)
    .optional()
    .describe(
      "Maximum number of blocks to parse across all returned targets. Defaults to 2000. Increase only when needed; the response can become very large."
    )
};

function formatLiteral(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatField(value: Sb3FieldValue): string {
  if (Array.isArray(value)) {
    return formatLiteral(value[0]);
  }
  return formatLiteral(value);
}

function inlineInput(input: InputAst): string {
  switch (input.type) {
    case "literal":
      return formatLiteral(input.value);
    case "menu":
      return `[${formatLiteral(input.value)}]`;
    case "block":
      return inlineBlock(input.block);
    case "stack":
      return `{${input.stack.length} block(s)}`;
    case "empty":
      return "_";
    case "shadowBlock":
      return inlineBlock(input.block);
    default:
      return "?";
  }
}

function blockHeader(block: BlockAst): string {
  const parts = [block.opcode];
  for (const [name, value] of Object.entries(block.fields)) {
    parts.push(`${name}=${formatField(value)}`);
  }
  for (const [name, input] of Object.entries(block.inputs)) {
    if (input.type === "stack") {
      continue;
    }
    parts.push(`${name}:${inlineInput(input)}`);
  }
  if (block.error) {
    parts.push(`ERROR(${block.error})`);
  }
  return parts.join(" ");
}

function inlineBlock(block: BlockAst): string {
  const parts = [block.opcode];
  for (const [name, value] of Object.entries(block.fields)) {
    parts.push(`${name}=${formatField(value)}`);
  }
  for (const [name, input] of Object.entries(block.inputs)) {
    if (input.type !== "stack") {
      parts.push(`${name}:${inlineInput(input)}`);
    }
  }
  return `(${parts.join(" ")})`;
}

function renderChain(
  chain: BlockAst[],
  indent: string,
  lines: string[]
): void {
  for (const block of chain) {
    lines.push(`${indent}${blockHeader(block)}`);
    for (const [name, input] of Object.entries(block.inputs)) {
      if (input.type === "stack" && input.stack.length > 0) {
        lines.push(`${indent}  [${name}]`);
        renderChain(input.stack, `${indent}    `, lines);
      }
    }
  }
}

function renderScripts(scripts: ScriptAst[], maxLines = 600): string {
  const lines: string[] = [];
  for (const script of scripts) {
    lines.push(
      `  #${script.index} ${script.kind} @(${script.x},${script.y}) root=${script.rootId}`
    );
    renderChain(script.stack, "    ", lines);
    if (lines.length >= maxLines) {
      lines.push(`  ... (rendering stopped after ${maxLines} lines)`);
      break;
    }
  }
  return lines.join("\n");
}

export function registerGetScripts(
  server: McpServer,
  context: ServerContext
): void {
  server.registerTool(
    "get_scripts",
    {
      title: "Read scripts",
      description:
        "Read the scripts of the active project as a structured AST plus a compact text rendering. " +
        "Each block includes its id, opcode, fields, inputs, mutation, and nested reporter/substack structure. " +
        "Use block ids from this tool with add_block modes after/start/append/substack. " +
        "Set target to inspect one Stage/sprite, or omit it to read every target (optionally excluding the Stage). " +
        "This is a read-only tool.",
      inputSchema,
      outputSchema: outputSchema.shape,
      annotations: {
        title: "Read scripts",
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

        const selected = args.target
          ? [requireTarget(project, args.target)]
          : project.targets.filter(
              (target) => args.include_stage !== false || !target.isStage
            );

        const maxBlocks = args.max_blocks ?? 2000;
        let remaining = maxBlocks;
        let totalScripts = 0;
        let totalBlocks = 0;
        let anyTruncated = false;
        const targets = selected.map((target) => {
          if (remaining <= 0) {
            anyTruncated = true;
            return {
              name: target.name,
              isStage: target.isStage,
              scriptCount: 0,
              blockCount: 0,
              truncated: true,
              warnings: ["Block budget exhausted before this target."],
              scripts: [] as ScriptAst[]
            };
          }

          const result = buildScripts(target, { maxBlocks: remaining });
          remaining = Math.max(0, remaining - result.blockCount);
          anyTruncated ||= result.truncated;
          totalScripts += result.scripts.length;
          totalBlocks += result.blockCount;

          return {
            name: target.name,
            isStage: target.isStage,
            scriptCount: result.scripts.length,
            blockCount: result.blockCount,
            truncated: result.truncated,
            warnings: result.warnings,
            scripts: result.scripts
          };
        });

        const sections = targets.map((target) => {
          const header =
            `Target "${target.name}"${target.isStage ? " (Stage)" : ""}: ` +
            `${target.scriptCount} script(s), ${target.blockCount} block(s)` +
            (target.truncated ? " [truncated]" : "");
          const warningText =
            target.warnings.length > 0
              ? `\n  Warnings:\n${target.warnings
                  .slice(0, 20)
                  .map((warning) => `  - ${warning}`)
                  .join("\n")}`
              : "";
          return `${header}\n${renderScripts(target.scripts)}${warningText}`;
        });

        const text = [
          `"${loaded.displayName}": ${totalScripts} script(s), ${totalBlocks} block(s) parsed` +
            (anyTruncated ? " (truncated)" : ""),
          ...sections
        ].join("\n\n");

        return toolResult(
          {
            displayName: loaded.displayName,
            dirty: loaded.dirty,
            targetCount: selected.length,
            totalScripts,
            totalBlocks,
            truncated: anyTruncated,
            targets
          },
          text
        );
      })
  );
}
