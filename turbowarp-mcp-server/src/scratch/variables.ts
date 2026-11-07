import { AppError } from "../errors.js";
import { newUniqueId } from "../utils/ids.js";
import { getStage } from "./project.js";
import type {
  Sb3ListEntry,
  Sb3Project,
  Sb3Scalar,
  Sb3Target,
  Sb3VariableEntry
} from "./types.js";

export type VariableScope = "auto" | "global" | "local";
export type ResolvedScope = "global" | "local";

export interface VariableInfo {
  id: string;
  name: string;
  value: Sb3Scalar;
  isCloud: boolean;
  owner: string;
  scope: ResolvedScope;
  entry: Sb3VariableEntry;
}

export interface ListInfo {
  id: string;
  name: string;
  value: Sb3Scalar[];
  owner: string;
  scope: ResolvedScope;
  entry: Sb3ListEntry;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new AppError("INVALID_NAME", "Variable/list/broadcast name must not be empty.");
  }
  return trimmed;
}

function matchByIdOrName<T>(
  map: Record<string, T>,
  name: string,
  describe: (entry: T) => string,
  kind: string
): { id: string; entry: T } | null {
  const wanted = normalizeName(name);
  if (Object.prototype.hasOwnProperty.call(map, wanted)) {
    return { id: wanted, entry: map[wanted] };
  }

  const exact = Object.entries(map).filter(([, entry]) => describe(entry) === wanted);
  if (exact.length === 1) {
    return { id: exact[0][0], entry: exact[0][1] };
  }
  if (exact.length > 1) {
    throw new AppError(
      "AMBIGUOUS_NAME",
      `More than one ${kind} named "${wanted}" exists. This should not happen in a valid project.`
    );
  }

  const lower = wanted.toLowerCase();
  const loose = Object.entries(map).filter(([, entry]) => describe(entry).toLowerCase() === lower);
  if (loose.length === 1) {
    return { id: loose[0][0], entry: loose[0][1] };
  }
  if (loose.length > 1) {
    throw new AppError(
      "AMBIGUOUS_NAME",
      `More than one ${kind} matches "${wanted}" case-insensitively: ${loose
        .map(([, entry]) => describe(entry))
        .join(", ")}. Use the exact name.`
    );
  }
  return null;
}

function variableInfo(
  id: string,
  entry: Sb3VariableEntry,
  owner: Sb3Target,
  scope: ResolvedScope
): VariableInfo {
  return {
    id,
    name: String(entry?.[0] ?? ""),
    value: entry?.[1] ?? 0,
    isCloud: entry?.[2] === true,
    owner: owner.isStage ? "Stage" : owner.name,
    scope,
    entry
  };
}

function listInfo(
  id: string,
  entry: Sb3ListEntry,
  owner: Sb3Target,
  scope: ResolvedScope
): ListInfo {
  return {
    id,
    name: String(entry?.[0] ?? ""),
    value: Array.isArray(entry?.[1]) ? entry[1] : [],
    owner: owner.isStage ? "Stage" : owner.name,
    scope,
    entry
  };
}

export function findVariableInTarget(target: Sb3Target, name: string): { id: string; entry: Sb3VariableEntry } | null {
  return matchByIdOrName(target.variables ?? {}, name, (entry) => String(entry?.[0] ?? ""), "variable");
}

export function findListInTarget(target: Sb3Target, name: string): { id: string; entry: Sb3ListEntry } | null {
  return matchByIdOrName(target.lists ?? {}, name, (entry) => String(entry?.[0] ?? ""), "list");
}

/**
 * Resolve a variable using Scratch's scoping rules: a sprite-local variable
 * shadows a global variable with the same name.
 */
export function resolveVariable(
  project: Sb3Project,
  target: Sb3Target,
  name: string,
  scope: VariableScope = "auto"
): VariableInfo | null {
  const stage = getStage(project);

  if (scope === "local") {
    if (target.isStage) {
      throw new AppError("INVALID_SCOPE", "The Stage cannot own local variables.");
    }
    const match = findVariableInTarget(target, name);
    return match ? variableInfo(match.id, match.entry, target, "local") : null;
  }

  if (scope === "global") {
    const match = findVariableInTarget(stage, name);
    return match ? variableInfo(match.id, match.entry, stage, "global") : null;
  }

  if (!target.isStage) {
    const local = findVariableInTarget(target, name);
    if (local) {
      return variableInfo(local.id, local.entry, target, "local");
    }
  }
  const global = findVariableInTarget(stage, name);
  return global ? variableInfo(global.id, global.entry, stage, "global") : null;
}

export function resolveList(
  project: Sb3Project,
  target: Sb3Target,
  name: string,
  scope: VariableScope = "auto"
): ListInfo | null {
  const stage = getStage(project);

  if (scope === "local") {
    if (target.isStage) {
      throw new AppError("INVALID_SCOPE", "The Stage cannot own local lists.");
    }
    const match = findListInTarget(target, name);
    return match ? listInfo(match.id, match.entry, target, "local") : null;
  }

  if (scope === "global") {
    const match = findListInTarget(stage, name);
    return match ? listInfo(match.id, match.entry, stage, "global") : null;
  }

  if (!target.isStage) {
    const local = findListInTarget(target, name);
    if (local) {
      return listInfo(local.id, local.entry, target, "local");
    }
  }
  const global = findListInTarget(stage, name);
  return global ? listInfo(global.id, global.entry, stage, "global") : null;
}

export function ensureVariable(
  project: Sb3Project,
  target: Sb3Target,
  name: string,
  scope: VariableScope = "auto",
  initialValue: Sb3Scalar = 0
): VariableInfo & { created: boolean } {
  const existing = resolveVariable(project, target, name, scope);
  if (existing) {
    return { ...existing, created: false };
  }

  const normalized = normalizeName(name);
  const stage = getStage(project);
  const owner = scope === "local" ? target : stage;
  if (owner.isStage && scope === "local") {
    throw new AppError("INVALID_SCOPE", "The Stage cannot own local variables.");
  }

  owner.variables ??= {};
  const id = newUniqueId({
    has: (candidate: string) => Object.prototype.hasOwnProperty.call(owner.variables, candidate)
  });
  const entry: Sb3VariableEntry = [normalized, initialValue];
  owner.variables[id] = entry;
  return {
    ...variableInfo(id, entry, owner, owner.isStage ? "global" : "local"),
    created: true
  };
}

export function ensureList(
  project: Sb3Project,
  target: Sb3Target,
  name: string,
  scope: VariableScope = "auto"
): ListInfo & { created: boolean } {
  const existing = resolveList(project, target, name, scope);
  if (existing) {
    return { ...existing, created: false };
  }

  const normalized = normalizeName(name);
  const stage = getStage(project);
  const owner = scope === "local" ? target : stage;

  owner.lists ??= {};
  const id = newUniqueId({
    has: (candidate: string) => Object.prototype.hasOwnProperty.call(owner.lists, candidate)
  });
  const entry: Sb3ListEntry = [normalized, []];
  owner.lists[id] = entry;
  return {
    ...listInfo(id, entry, owner, owner.isStage ? "global" : "local"),
    created: true
  };
}

export interface BroadcastInfo {
  id: string;
  name: string;
  created: boolean;
}

export function findBroadcast(project: Sb3Project, name: string): BroadcastInfo | null {
  const stage = getStage(project);
  stage.broadcasts ??= {};
  const wanted = normalizeName(name);
  const exact = Object.entries(stage.broadcasts).filter(([, value]) => value === wanted);
  if (exact.length === 1) {
    return { id: exact[0][0], name: exact[0][1], created: false };
  }
  if (exact.length > 1) {
    throw new AppError(
      "AMBIGUOUS_NAME",
      `More than one broadcast is named "${wanted}". This should not happen in a valid project.`
    );
  }
  const lower = wanted.toLowerCase();
  const loose = Object.entries(stage.broadcasts).filter(([, value]) => value.toLowerCase() === lower);
  if (loose.length === 1) {
    return { id: loose[0][0], name: loose[0][1], created: false };
  }
  if (loose.length > 1) {
    throw new AppError(
      "AMBIGUOUS_NAME",
      `More than one broadcast matches "${wanted}" case-insensitively: ${loose
        .map(([, value]) => value)
        .join(", ")}.`
    );
  }
  return null;
}

export function ensureBroadcast(project: Sb3Project, name = "message1"): BroadcastInfo {
  const stage = getStage(project);
  stage.broadcasts ??= {};
  const existing = findBroadcast(project, name);
  if (existing) {
    return existing;
  }
  const normalized = normalizeName(name);
  const id = newUniqueId({
    has: (candidate: string) => Object.prototype.hasOwnProperty.call(stage.broadcasts, candidate)
  });
  stage.broadcasts[id] = normalized;
  return { id, name: normalized, created: true };
}

export function listVariables(project: Sb3Project): VariableInfo[] {
  const result: VariableInfo[] = [];
  for (const target of project.targets) {
    for (const [id, entry] of Object.entries(target.variables ?? {})) {
      result.push(variableInfo(id, entry, target, target.isStage ? "global" : "local"));
    }
  }
  return result;
}

export function listLists(project: Sb3Project): ListInfo[] {
  const result: ListInfo[] = [];
  for (const target of project.targets) {
    for (const [id, entry] of Object.entries(target.lists ?? {})) {
      result.push(listInfo(id, entry, target, target.isStage ? "global" : "local"));
    }
  }
  return result;
}

/**
 * Resolve a variable when no target was supplied: prefer the unique global
 * variable, then fall back to a unique sprite-local variable.
 */
export function resolveVariableAnywhere(project: Sb3Project, name: string): VariableInfo | null {
  const stage = getStage(project);
  const global = findVariableInTarget(stage, name);
  if (global) {
    return variableInfo(global.id, global.entry, stage, "global");
  }

  const matches: VariableInfo[] = [];
  for (const target of project.targets) {
    if (target.isStage) {
      continue;
    }
    const match = findVariableInTarget(target, name);
    if (match) {
      matches.push(variableInfo(match.id, match.entry, target, "local"));
    }
  }
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new AppError(
      "AMBIGUOUS_VARIABLE",
      `Variable "${name}" exists on multiple sprites: ${matches
        .map((match) => `${match.owner}.${match.name}`)
        .join(", ")}. Pass the target parameter to choose one.`
    );
  }
  return null;
}

/** Field value for data_variable/data_setvariableto style blocks. */
export function variableField(info: VariableInfo): [string, string] {
  return [info.name, info.id];
}

/** Field value for data_listcontents/data_addtolist style blocks. */
export function listField(info: ListInfo): [string, string] {
  return [info.name, info.id];
}

/** Field value for event_broadcast_menu / event_whenbroadcastreceived. */
export function broadcastField(info: BroadcastInfo): [string, string] {
  return [info.name, info.id];
}
