import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AppError } from "../errors.js";
import { log } from "../log.js";
import { getStage, requireTarget } from "../scratch/project.js";
import type { Sb3Scalar } from "../scratch/types.js";
import {
  ensureVariable,
  resolveVariable,
  resolveVariableAnywhere,
  type ResolvedScope,
  type VariableInfo,
  type VariableScope
} from "../scratch/variables.js";
import {
  assertConfirmation,
  formatScalar,
  getProject,
  normalizeScalar,
  runTool,
  scalarSchema,
  toolResult,
  type ServerContext
} from "./common.js";

const scopeSchema = z.enum(["auto", "global", "local"]);

const inputSchema = {
  name: z
    .string()
    .min(1)
    .describe(
      "Variable name. Lookup is exact first, then case-insensitive when unambiguous."
    ),
  value: scalarSchema.describe(
    "New value: a string, finite number, boolean, or null. Arrays/objects are not variable values."
  ),
  target: z
    .string()
    .optional()
    .describe(
      "Target name used for scope resolution. With scope=auto, a local variable on this target shadows a global one. Omit to update a unique variable anywhere."
    ),
  scope: scopeSchema
    .optional()
    .default("auto")
    .describe(
      "auto = target-local first, then Stage-global; global = only the Stage's variable; local = only the target's variable (target required)."
    ),
  create: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Create the variable when it does not exist. New variables are global on the Stage unless target+local is requested. Defaults to true."
    ),
  confirm: z
    .boolean()
    .optional()
    .describe("Required when the confirmation policy gates this tool.")
};

const outputSchema = z.object({
  set: z.literal(true),
  name: z.string(),
  id: z.string(),
  scope: z.enum(["global", "local"]),
  owner: z.string(),
  previousValue: scalarSchema,
  value: scalarSchema,
  created: z.boolean(),
  dirty: z.literal(true)
});

export function registerSetVariable(
  server: McpServer,
  context: ServerContext
): void {
  server.registerTool(
    "set_variable",
    {
      title: "Set a variable",
      description:
        "Set the value of a Scratch variable in the active project, optionally creating it. " +
        "Scratch scoping is respected: sprite-local variables shadow global variables, and the Stage owns global variables. " +
        "Use scope=local with a target to keep a variable private to a sprite, or scope=global to force the Stage's variable. " +
        "This changes the in-memory project only; export_sb3 writes it to disk.",
      inputSchema,
      outputSchema: outputSchema.shape,
      annotations: {
        title: "Set a variable",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) =>
      runTool(async () => {
        assertConfirmation(context, "set_variable", "mutating", args.confirm);

        const loaded = getProject(context);
        const project = loaded.project;
        const value: Sb3Scalar = normalizeScalar(args.value);
        const scope = args.scope as VariableScope;

        let info: VariableInfo & { created: boolean };
        if (args.target) {
          const target = requireTarget(project, args.target);
          if (target.isStage && scope === "local") {
            throw new AppError(
              "INVALID_SCOPE",
              "The Stage cannot own local variables. Remove target or use scope=global/auto."
            );
          }
          const existing = resolveVariable(project, target, args.name, scope);
          if (!existing && args.create === false) {
            throw new AppError(
              "VARIABLE_NOT_FOUND",
              `Variable "${args.name}" does not exist for target "${target.name}" with scope "${scope}". ` +
                'Pass "create": true to create it.'
            );
          }
          info = existing
            ? { ...existing, created: false }
            : ensureVariable(project, target, args.name, scope, value);
        } else {
          if (scope === "local") {
            throw new AppError(
              "MISSING_TARGET",
              'scope=local requires a target. Pass "target": "SpriteName".'
            );
          }
          const existing =
            scope === "global"
              ? resolveVariable(project, getStage(project), args.name, "global")
              : resolveVariableAnywhere(project, args.name);
          if (!existing && args.create === false) {
            throw new AppError(
              "VARIABLE_NOT_FOUND",
              `Variable "${args.name}" does not exist. Pass "create": true to create it.`
            );
          }
          info = existing
            ? { ...existing, created: false }
            : ensureVariable(
                project,
                getStage(project),
                args.name,
                "global",
                value
              );
        }

        const previousValue = info.entry[1];
        info.entry[1] = value;
        loaded.dirty = true;

        const resultScope: ResolvedScope = info.scope;
        log.info("Set variable", {
          project: loaded.displayName,
          name: info.name,
          scope: info.scope,
          owner: info.owner
        });

        return toolResult(
          {
            set: true as const,
            name: info.name,
            id: info.id,
            scope: resultScope,
            owner: info.owner,
            previousValue,
            value,
            created: info.created,
            dirty: true as const
          },
          `Set ${info.scope} variable "${info.name}" on ${info.owner} ` +
            `from ${formatScalar(previousValue)} to ${formatScalar(value)}` +
            (info.created ? " (newly created)." : ".")
        );
      })
  );
}
