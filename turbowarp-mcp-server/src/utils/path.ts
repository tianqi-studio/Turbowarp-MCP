import * as os from "node:os";
import * as path from "node:path";

import { AppError } from "../errors.js";
import type { ServerConfig } from "../config.js";

export interface ResolvePathOptions {
  mustExist?: boolean;
  /** If true, the parent directory is created later by the caller. */
  forWrite?: boolean;
}

function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function isInsideWorkspace(workspace: string, candidate: string): boolean {
  const relative = path.relative(workspace, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve a user supplied path relative to the configured workspace.
 *
 * By default the server is sandboxed to TW_MCP_WORKSPACE. Set
 * TW_MCP_ALLOW_ANY_PATH=1 (or pass --allow-any-path) for an unrestricted
 * local-only server.
 */
export function resolveUserPath(
  config: ServerConfig,
  input: string,
  options: ResolvePathOptions = {}
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AppError("INVALID_PATH", "Path must not be empty.");
  }

  const expanded = expandHome(trimmed);
  const absolute = path.isAbsolute(expanded)
    ? path.normalize(expanded)
    : path.resolve(config.workspace, expanded);

  if (!config.allowAnyPath && !isInsideWorkspace(config.workspace, absolute)) {
    throw new AppError(
      "PATH_OUTSIDE_WORKSPACE",
      `Path is outside the configured workspace.\n` +
        `  workspace: ${config.workspace}\n` +
        `  requested: ${absolute}\n` +
        `Set TW_MCP_WORKSPACE to a parent directory, or set TW_MCP_ALLOW_ANY_PATH=1 to disable this guard.`
    );
  }

  if (options.mustExist) {
    // Defer the actual existence check to fs so callers get an ENOENT that
    // includes the exact path they passed in.
  }

  return absolute;
}

export function ensureSb3Extension(input: string): string {
  if (input.toLowerCase().endsWith(".sb3")) {
    return input;
  }
  return `${input}.sb3`;
}

/** Convert a Windows path to a form that is easy to paste into JSON text. */
export function jsonPath(input: string): string {
  return input.replace(/\\/g, "\\\\");
}
