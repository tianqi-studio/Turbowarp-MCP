import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  runProjectHeadless,
  type HeadlessResult
} from "../headless/runner.js";
import { log } from "../log.js";
import { readSb3File, serializeProject } from "../scratch/parser.js";
import { resolveUserPath } from "../utils/path.js";
import {
  assertConfirmation,
  getProject,
  runTool,
  toolResult,
  type ServerContext
} from "./common.js";

const inputSchema = {
  path: z
    .string()
    .optional()
    .describe(
      "SB3 file to run. When omitted, the active in-memory project is serialized and run. Relative paths resolve inside TW_MCP_WORKSPACE."
    ),
  duration_ms: z
    .number()
    .int()
    .min(100)
    .max(120000)
    .optional()
    .default(3000)
    .describe(
      "Maximum wall-clock run time in milliseconds. Defaults to 3000; maximum 120000."
    ),
  turbo: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Enable scratch-vm turbo mode so loops run without frame pacing. Defaults to true."
    ),
  stop_when_idle: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Stop early once all scripts have finished and no threads remain. Defaults to true. Forever loops still run until duration_ms."
    ),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'Executes project code. Required when TW_MCP_CONFIRM=all; optional under the default "destructive" policy.'
    )
};

const outputSchema = z.object({
  ran: z.literal(true),
  projectSource: z.string(),
  durationMs: z.number().int(),
  timedOut: z.boolean(),
  targetCount: z.number().int(),
  threadCount: z.number().int(),
  say: z.array(
    z.object({
      target: z.string(),
      type: z.string(),
      text: z.string(),
      atMs: z.number().int()
    })
  ),
  variables: z.array(
    z.object({
      name: z.string(),
      owner: z.string(),
      value: z.unknown(),
      isCloud: z.boolean()
    })
  ),
  lists: z.array(
    z.object({
      name: z.string(),
      owner: z.string(),
      value: z.array(z.unknown())
    })
  ),
  monitors: z.array(
    z.object({
      id: z.string(),
      opcode: z.string(),
      owner: z.string().nullable(),
      value: z.unknown(),
      visible: z.boolean()
    })
  ),
  errors: z.array(z.string())
});

function resultText(
  source: string,
  result: HeadlessResult,
  sayLimit = 50,
  variableLimit = 50
): string {
  const lines = [
    `Ran ${source} for ${result.durationMs} ms` +
      (result.timedOut
        ? ` (stopped at the time limit; ${result.threadCount} thread(s) still active).`
        : " (all scripts became idle)."),
    `${result.targetCount} target(s), ${result.say.length} say/think event(s), ` +
      `${result.variables.length} variable(s), ${result.lists.length} list(s), ` +
      `${result.monitors.length} monitor(s).`
  ];

  if (result.say.length > 0) {
    lines.push("Say/think:");
    for (const event of result.say.slice(0, sayLimit)) {
      lines.push(
        `- [${event.atMs} ms] ${event.target} ${event.type}: ${JSON.stringify(event.text)}`
      );
    }
    if (result.say.length > sayLimit) {
      lines.push(`- ... ${result.say.length - sayLimit} more`);
    }
  }

  if (result.variables.length > 0) {
    lines.push("Variables:");
    for (const variable of result.variables.slice(0, variableLimit)) {
      lines.push(
        `- ${variable.owner}.${variable.name} = ${JSON.stringify(variable.value)}` +
          (variable.isCloud ? " (cloud)" : "")
      );
    }
    if (result.variables.length > variableLimit) {
      lines.push(`- ... ${result.variables.length - variableLimit} more`);
    }
  }

  if (result.errors.length > 0) {
    lines.push("Errors:");
    for (const error of result.errors.slice(0, 20)) {
      lines.push(`- ${error}`);
    }
  }

  return lines.join("\n");
}

export function registerRunHeadless(
  server: McpServer,
  context: ServerContext
): void {
  server.registerTool(
    "run_headless",
    {
      title: "Run project headlessly",
      description:
        "Run an SB3 project with scratch-vm in Node (no renderer, audio, camera, or video). " +
        "Triggers the green flag, captures say/think events, variable and list snapshots, and monitor values, then stops the VM. " +
        "Use this to smoke-test logic, not to validate visuals or sound. " +
        "TurboWarp-only extensions, custom extensions, cloud variables, camera/video, microphone, and platform-specific blocks are not available. " +
        "Forever loops run until duration_ms; stop_when_idle ends ordinary scripts early.",
      inputSchema,
      outputSchema: outputSchema.shape,
      annotations: {
        title: "Run project headlessly",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) =>
      runTool(async () => {
        assertConfirmation(context, "run_headless", "risky", args.confirm);

        let archive: Buffer;
        let source: string;
        if (args.path && args.path.trim()) {
          const resolved = resolveUserPath(context.config, args.path);
          const read = await readSb3File(resolved, context.config.maxSb3Bytes);
          archive = read.buffer;
          source = resolved;
        } else {
          const loaded = getProject(context);
          archive = Buffer.from(
            serializeProject(loaded.project, loaded.assets, false)
          );
          source = `active project "${loaded.displayName}"`;
        }

        const result = await runProjectHeadless(archive, {
          durationMs: args.duration_ms,
          turbo: args.turbo,
          stopWhenIdle: args.stop_when_idle,
          vmModule: context.config.vmModule
        });

        log.info("Ran project headlessly", {
          source,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          say: result.say.length,
          threads: result.threadCount
        });

        return toolResult(
          {
            ran: true as const,
            projectSource: source,
            ...result
          },
          resultText(source, result)
        );
      })
  );
}
