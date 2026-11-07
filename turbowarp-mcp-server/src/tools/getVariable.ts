import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AppError } from "../errors.js";
import { getStage, requireTarget } from "../scratch/project.js";
import type { VariableScope } from "../scratch/variables.js";
import {
  resolveVariable,
  resolveVariableAnywhere
} from "../scratch/variables.js";
import {
  formatScalar,
  getProject,
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
      "Variable name. Exact match wins; otherwise a unique case-insensitive match is accepted."
    ),
  target: z
    .string()
    .optional()
    .describe(
      "Target name used for scope resolution. With scope=auto, a local variable on this target shadows a global one. Omit to search globally and then uniquely across sprites."
    ),
  scope: scopeSchema
    .optional()
    .default("auto")
    .describe(
      "auto = target-local first, then Stage-global; global = only the Stage's variable; local = only the target's variable (target required)."
    )
};

const variableSchema = z.object({
  id: z.string(),
  name: z.string(),
  value: scalarSchema,
  scope: z.enum(["global", "local"]),
  owner: z.string(),
  isCloud: z.boolean()
});

const outputSchema = z.object({
  found: z.boolean(),
  variable: variableSchema.nullable()
});

export function registerGetVariable(
  server: McpServer,
  context: ServerContext
): void {
  server.registerTool(
    "get_variable",
    {
      title: "Read a variable",
      description:
        "Read a Scratch variable from the active project, including its id, scope, owner target, cloud flag, and current value. " +
        "Scratch scoping is respected: sprite-local variables shadow global ones for that sprite. " +
        "Returns found=false instead of an error when the variable does not exist. This is a read-only tool.",
      inputSchema,
      outputSchema: outputSchema.shape,
      annotations: {
        title: "Read a variable",
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
        const scope = args.scope as VariableScope;

        let info = null;
        if (args.target) {
          const target = requireTarget(project, args.target);
          info = resolveVariable(project, target, args.name, scope);
        } else if (scope === "local") {
          throw new AppError(
            "MISSING_TARGET",
            'scope=local requires a target. Pass "target": "SpriteName".'
          );
        } else if (scope === "global") {
          info = resolveVariable(project, getStage(project), args.name, "global");
        } else {
          info = resolveVariableAnywhere(project, args.name);
        }

        if (!info) {
          return toolResult(
            { found: false, variable: null },
            `Variable "${args.name}" was not found.`
          );
        }

        return toolResult(
          {
            found: true,
            variable: {
              id: info.id,
              name: info.name,
              value: info.value,
              scope: info.scope,
              owner: info.owner,
              isCloud: info.isCloud
            }
          },
          `${info.scope} variable "${info.name}" on ${info.owner} = ${formatScalar(
            info.value
          )} (id=${info.id}${info.isCloud ? ", cloud" : ""}).`
        );
      })
  );
}
