import * as path from "node:path";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config.js";
import { AppError, asAppError, errorMessage } from "../errors.js";
import { getStage, findTarget, requireTarget } from "../scratch/project.js";
import {
  countBlocks,
  listScripts,
  targetSummary
} from "../scratch/project.js";
import { findMissingAssets } from "../scratch/parser.js";
import type {
  LoadedProject,
  Sb3Costume,
  Sb3Project,
  Sb3Scalar,
  Sb3Sound,
  Sb3Target,
  TargetSummary
} from "../scratch/types.js";
import { safeJson } from "../utils/json.js";

export type ConfirmPolicy = "mutating" | "risky";

export interface ServerState {
  loaded: LoadedProject | null;
}

export interface ServerContext {
  config: ServerConfig;
  state: ServerState;
}

export function createServerContext(config: ServerConfig): ServerContext {
  return {
    config,
    state: { loaded: null }
  };
}

export function getProject(context: ServerContext): LoadedProject {
  const loaded = context.state.loaded;
  if (!loaded) {
    throw new AppError(
      "NO_PROJECT",
      "No project is loaded. Call load_sb3 to open an existing file, or new_project to create one."
    );
  }
  return loaded;
}

export function markDirty(context: ServerContext): LoadedProject {
  const loaded = getProject(context);
  loaded.dirty = true;
  return loaded;
}

export function markSaved(context: ServerContext): LoadedProject {
  const loaded = getProject(context);
  loaded.dirty = false;
  return loaded;
}

/**
 * Confirmation is enforced by the server, not just suggested in the description.
 *
 * - mode "all": every non-read-only tool requires confirm: true
 * - mode "destructive": all tools that mutate the active project or write files
 * - mode "none": no gate (use only in a trusted, scripted environment)
 */
export function assertConfirmation(
  context: ServerContext,
  tool: string,
  policy: ConfirmPolicy,
  confirm: boolean | undefined
): void {
  const mode = context.config.confirmMode;
  if (mode === "none" || confirm === true) {
    return;
  }

  const gated =
    mode === "all" || (mode === "destructive" && policy === "mutating");
  if (!gated) {
    return;
  }

  throw new AppError(
    "CONFIRMATION_REQUIRED",
    `${tool} needs explicit confirmation (TW_MCP_CONFIRM=${mode}). ` +
      `Review the requested change, then call the tool again with "confirm": true.`,
    { tool, confirmMode: mode, policy }
  );
}

export function confirmationHint(tool: string, policy: ConfirmPolicy): string {
  if (policy === "risky") {
    return `This tool executes project code. It requires "confirm": true when TW_MCP_CONFIRM=all.`;
  }
  return `This tool changes server state. Retry ${tool} with "confirm": true. Set TW_MCP_CONFIRM=none to disable the gate.`;
}

export function toolResult<T extends Record<string, unknown>>(
  structured: T,
  text: string
): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: structured
  };
}

export function toolError(error: unknown): CallToolResult {
  const app = asAppError(error);
  let text = `${app.code}: ${app.message}`;

  if (app.code === "CONFIRMATION_REQUIRED") {
    text +=
      "\nNo changes were made. Review the request first, then repeat it with `\"confirm\": true`.";
  } else if (app.details !== undefined) {
    try {
      const details = safeJson(app.details);
      if (details && details !== "{}") {
        text += `\nDetails: ${details.slice(0, 2000)}`;
      }
    } catch {
      // Ignore unserializable details.
    }
  }

  return {
    content: [{ type: "text", text }],
    isError: true
  };
}

export async function runTool(
  operation: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await operation();
  } catch (error) {
    return toolError(error);
  }
}

export const scalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null()
]);

export const warningSchema = z.object({
  code: z.string(),
  message: z.string()
});

export const targetBriefSchema = z.object({
  name: z.string(),
  isStage: z.boolean(),
  blockCount: z.number().int(),
  scriptCount: z.number().int(),
  variableCount: z.number().int(),
  listCount: z.number().int(),
  costumeCount: z.number().int(),
  soundCount: z.number().int()
});

const costumeNameSchema = z.object({
  name: z.string(),
  dataFormat: z.string(),
  assetId: z.string(),
  md5ext: z.string().optional()
});

const soundNameSchema = z.object({
  name: z.string(),
  dataFormat: z.string(),
  assetId: z.string(),
  md5ext: z.string().optional()
});

export const targetDetailSchema = z.object({
  name: z.string(),
  isStage: z.boolean(),
  visible: z.boolean().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  size: z.number().optional(),
  direction: z.number().optional(),
  draggable: z.boolean().optional(),
  rotationStyle: z.string().optional(),
  currentCostume: z.number().int(),
  currentCostumeName: z.string().nullable(),
  costumeCount: z.number().int(),
  soundCount: z.number().int(),
  blockCount: z.number().int(),
  scriptCount: z.number().int(),
  variableCount: z.number().int(),
  listCount: z.number().int(),
  costumes: z.array(costumeNameSchema),
  sounds: z.array(soundNameSchema)
});

export const projectOverviewSchema = z.object({
  loaded: z.literal(true),
  displayName: z.string(),
  sourcePath: z.string().nullable(),
  dirty: z.boolean(),
  targetCount: z.number().int(),
  spriteCount: z.number().int(),
  blockCount: z.number().int(),
  scriptCount: z.number().int(),
  variableCount: z.number().int(),
  listCount: z.number().int(),
  broadcastCount: z.number().int(),
  extensions: z.array(z.string()),
  missingAssets: z.array(z.string()),
  targets: z.array(targetBriefSchema)
});

export type ProjectOverview = z.infer<typeof projectOverviewSchema>;

function targetBrief(target: Sb3Target): z.infer<typeof targetBriefSchema> {
  const summary = targetSummary(target);
  return {
    name: summary.name,
    isStage: summary.isStage,
    blockCount: summary.blockCount,
    scriptCount: summary.scriptCount,
    variableCount: summary.variableCount,
    listCount: summary.listCount,
    costumeCount: summary.costumeCount,
    soundCount: summary.soundCount
  };
}

export function targetDetail(target: Sb3Target): z.infer<typeof targetDetailSchema> {
  const summary: TargetSummary = targetSummary(target);
  return {
    name: summary.name,
    isStage: summary.isStage,
    ...(summary.isStage
      ? {}
      : {
          visible: summary.visible,
          x: summary.x,
          y: summary.y,
          size: summary.size,
          direction: summary.direction,
          draggable: target.draggable,
          rotationStyle: target.rotationStyle
        }),
    currentCostume: summary.currentCostume,
    currentCostumeName: summary.currentCostumeName,
    costumeCount: summary.costumeCount,
    soundCount: summary.soundCount,
    blockCount: summary.blockCount,
    scriptCount: summary.scriptCount,
    variableCount: summary.variableCount,
    listCount: summary.listCount,
    costumes: (summary.costumes as Sb3Costume[]).map((costume) => ({
      name: costume.name,
      dataFormat: costume.dataFormat,
      assetId: costume.assetId,
      ...(costume.md5ext ? { md5ext: costume.md5ext } : {})
    })),
    sounds: (summary.sounds as Sb3Sound[]).map((sound) => ({
      name: sound.name,
      dataFormat: sound.dataFormat,
      assetId: sound.assetId,
      ...(sound.md5ext ? { md5ext: sound.md5ext } : {})
    }))
  };
}

export function buildProjectOverview(loaded: LoadedProject): ProjectOverview {
  const project = loaded.project;
  const blocks = project.targets.reduce(
    (total, target) => total + countBlocks(target),
    0
  );
  const scripts = project.targets.reduce(
    (total, target) => total + listScripts(target).length,
    0
  );
  const variables = project.targets.reduce(
    (total, target) => total + Object.keys(target.variables ?? {}).length,
    0
  );
  const lists = project.targets.reduce(
    (total, target) => total + Object.keys(target.lists ?? {}).length,
    0
  );

  return {
    loaded: true,
    displayName: loaded.displayName,
    sourcePath: loaded.sourcePath,
    dirty: loaded.dirty,
    targetCount: project.targets.length,
    spriteCount: project.targets.filter((target) => !target.isStage).length,
    blockCount: blocks,
    scriptCount: scripts,
    variableCount: variables,
    listCount: lists,
    broadcastCount: Object.keys(getStage(project).broadcasts ?? {}).length,
    extensions: [...(project.extensions ?? [])],
    missingAssets: findMissingAssets(project, loaded.assets),
    targets: project.targets.map(targetBrief)
  };
}

export function projectOverviewText(overview: ProjectOverview): string {
  const lines = [
    `${overview.loaded ? "Project" : ""} "${overview.displayName}"` +
      (overview.sourcePath ? ` loaded from ${overview.sourcePath}` : " created in memory") +
      ".",
    `${overview.targetCount} target(s): ${overview.spriteCount} sprite(s) + Stage; ` +
      `${overview.blockCount} block(s), ${overview.scriptCount} script(s), ` +
      `${overview.variableCount} variable(s), ${overview.listCount} list(s).`
  ];
  if (overview.extensions.length > 0) {
    lines.push(`Extensions: ${overview.extensions.join(", ")}`);
  }
  if (overview.missingAssets.length > 0) {
    lines.push(
      `WARNING: ${overview.missingAssets.length} referenced asset(s) are missing from the archive: ` +
        overview.missingAssets.slice(0, 10).join(", ")
    );
  }
  lines.push(`Dirty: ${overview.dirty ? "yes" : "no"}`);
  return lines.join("\n");
}

export function selectTarget(project: Sb3Project, name?: string): Sb3Target {
  if (name && name.trim()) {
    return requireTarget(project, name.trim());
  }
  return (
    project.targets.find((target) => !target.isStage) ?? getStage(project)
  );
}

export function findTargetOrNull(
  project: Sb3Project,
  name: string
): Sb3Target | undefined {
  return findTarget(project, name);
}

export function normalizeScalar(value: unknown): Sb3Scalar {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AppError(
        "INVALID_VALUE",
        "Variable values must be finite numbers, strings, booleans, or null."
      );
    }
    return value;
  }
  throw new AppError(
    "INVALID_VALUE",
    "Variable values must be strings, numbers, booleans, or null. " +
      "Use a list-aware tool for array values."
  );
}

export function formatScalar(value: Sb3Scalar): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  return String(value);
}

export function scalarEquals(left: Sb3Scalar, right: Sb3Scalar): boolean {
  return left === right;
}

export function sanitizeFileName(input: string): string {
  const cleaned = input
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned || "Untitled";
}

export function defaultExportFileName(displayName: string): string {
  return `${sanitizeFileName(displayName)}.sb3`;
}

export function joinDefaultExportPath(
  workspace: string,
  displayName: string
): string {
  return path.join(workspace, defaultExportFileName(displayName));
}

export function describeError(error: unknown): string {
  return errorMessage(error);
}
