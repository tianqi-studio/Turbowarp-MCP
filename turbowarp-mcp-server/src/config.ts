import * as path from "node:path";

import { AppError } from "./errors.js";
import type { LogLevel } from "./log.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

export type TransportKind = "stdio" | "http" | "sse";
export type ConfirmMode = "all" | "destructive" | "none";

export interface ServerConfig {
  transport: TransportKind;
  host: string;
  port: number;
  /**
   * Optional dashboard-only HTTP port. When set in stdio mode, the server
   * exposes /dashboard and /api/dashboard without exposing /mcp.
   */
  dashboardPort: number | null;
  workspace: string;
  allowAnyPath: boolean;
  confirmMode: ConfirmMode;
  maxSb3Bytes: number;
  logLevel: LogLevel;
  /**
   * Optional override for the headless VM module. Defaults to "scratch-vm".
   * Advanced users can point this at a built TurboWarp scratch-vm bundle.
   */
  vmModule: string;
}

const VALID_TRANSPORTS: TransportKind[] = ["stdio", "http", "sse"];
const VALID_CONFIRM_MODES: ConfirmMode[] = ["all", "destructive", "none"];
const VALID_LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function parseInteger(name: string, value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AppError(
      "INVALID_ARGUMENT",
      `${name} must be an integer between ${min} and ${max}, got "${value}".`
    );
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function takeValue(argv: string[], index: number, flag: string): [string, number] {
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("--")) {
    throw new AppError("INVALID_ARGUMENT", `${flag} requires a value.`);
  }
  return [next, index + 1];
}

export interface ParsedArgv {
  values: Map<string, string>;
  flags: Set<string>;
}

export function parseArgv(argv: string[]): ParsedArgv {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new AppError("INVALID_ARGUMENT", `Unexpected positional argument: ${argument}`);
    }

    if (argument.includes("=")) {
      const separator = argument.indexOf("=");
      const key = argument.slice(2, separator);
      const value = argument.slice(separator + 1);
      values.set(key, value);
      continue;
    }

    const key = argument.slice(2);

    switch (key) {
      case "transport":
      case "host":
      case "port":
      case "dashboard-port":
      case "workspace":
      case "confirm":
      case "max-sb3-mb":
      case "log-level":
      case "vm-module": {
        const [value, nextIndex] = takeValue(argv, index, argument);
        values.set(key, value);
        index = nextIndex;
        break;
      }
      case "allow-any-path":
      case "http":
      case "sse":
      case "stdio":
      case "help":
      case "version":
        flags.add(key);
        break;
      default:
        throw new AppError("INVALID_ARGUMENT", `Unknown option: ${argument}`);
    }
  }

  return { values, flags };
}

export function parseConfig(argv: string[]): ServerConfig {
  const { values, flags } = parseArgv(argv);

  let transport = (envValue("TW_MCP_TRANSPORT") ?? "stdio").toLowerCase() as TransportKind;
  if (flags.has("http")) {
    transport = "http";
  }
  if (flags.has("sse")) {
    transport = "sse";
  }
  if (flags.has("stdio")) {
    transport = "stdio";
  }
  if (values.has("transport")) {
    transport = values.get("transport")!.toLowerCase() as TransportKind;
  }
  if (!VALID_TRANSPORTS.includes(transport)) {
    throw new AppError(
      "INVALID_ARGUMENT",
      `Invalid transport "${transport}". Expected one of: ${VALID_TRANSPORTS.join(", ")}.`
    );
  }

  const host = values.get("host") ?? envValue("TW_MCP_HOST") ?? "127.0.0.1";
  const port = parseInteger(
    "port",
    values.get("port") ?? envValue("TW_MCP_PORT") ?? "3000",
    0,
    65535
  );

  const dashboardPortValue =
    values.get("dashboard-port") ?? envValue("TW_MCP_DASHBOARD_PORT");
  const dashboardPort =
    dashboardPortValue === undefined
      ? null
      : parseInteger("dashboard-port", dashboardPortValue, 0, 65535);

  const workspaceInput =
    values.get("workspace") ?? envValue("TW_MCP_WORKSPACE") ?? process.cwd();
  const workspace = path.resolve(workspaceInput);

  const allowAnyPath =
    flags.has("allow-any-path") ||
    parseBoolean(envValue("TW_MCP_ALLOW_ANY_PATH")) === true;

  const confirmMode = (
    values.get("confirm") ??
    envValue("TW_MCP_CONFIRM") ??
    "destructive"
  ).toLowerCase() as ConfirmMode;
  if (!VALID_CONFIRM_MODES.includes(confirmMode)) {
    throw new AppError(
      "INVALID_ARGUMENT",
      `Invalid confirm mode "${confirmMode}". Expected one of: ${VALID_CONFIRM_MODES.join(", ")}.`
    );
  }

  const maxSb3Mb = parseInteger(
    "max-sb3-mb",
    values.get("max-sb3-mb") ?? envValue("TW_MCP_MAX_SB3_MB") ?? "512",
    1,
    8192
  );

  const logLevel = (
    values.get("log-level") ??
    envValue("TW_MCP_LOG_LEVEL") ??
    "info"
  ).toLowerCase() as LogLevel;
  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    throw new AppError(
      "INVALID_ARGUMENT",
      `Invalid log level "${logLevel}". Expected one of: ${VALID_LOG_LEVELS.join(", ")}.`
    );
  }

  const vmModule = values.get("vm-module") ?? envValue("TW_MCP_VM_MODULE") ?? "scratch-vm";

  return {
    transport,
    host,
    port,
    dashboardPort,
    workspace,
    allowAnyPath,
    confirmMode,
    maxSb3Bytes: maxSb3Mb * 1024 * 1024,
    logLevel,
    vmModule
  };
}

export function isHelpRequested(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function isVersionRequested(argv: string[]): boolean {
  return argv.includes("--version") || argv.includes("-v");
}

export function helpText(): string {
  return `\
${SERVER_NAME} ${SERVER_VERSION}

Usage:
  node dist/index.js [options]

Options:
  --transport <stdio|http|sse>  Transport to use (default: stdio)
  --stdio                       Shorthand for --transport stdio
  --http                        Shorthand for --transport http
  --sse                         Shorthand for --transport sse
  --host <host>                 HTTP/SSE bind host (default: 127.0.0.1)
  --port <port>                 HTTP/SSE port (default: 3000, 0 = random)
  --dashboard-port <port>       Extra dashboard-only HTTP server, useful in
                                stdio mode (0 = random). HTTP mode always
                                serves /dashboard on --port.
  --workspace <dir>             Sandbox root for relative paths (default: cwd)
  --allow-any-path              Disable workspace path sandboxing
  --confirm <all|destructive|none>
                                Confirmation policy for mutating tools
                                (default: destructive)
  --max-sb3-mb <n>              Maximum SB3 file size in MiB (default: 512)
  --log-level <debug|info|warn|error>
  --vm-module <module>          Headless VM module (default: scratch-vm)
  -h, --help                    Show this help
  -v, --version                 Show the version

Environment variables:
  TW_MCP_TRANSPORT, TW_MCP_HOST, TW_MCP_PORT, TW_MCP_DASHBOARD_PORT,
  TW_MCP_WORKSPACE, TW_MCP_ALLOW_ANY_PATH, TW_MCP_CONFIRM,
  TW_MCP_MAX_SB3_MB, TW_MCP_LOG_LEVEL, TW_MCP_VM_MODULE

Notes:
  * stdio is the default because it is the most reliable transport for
    Claude Desktop, OpenCode, and MCP Inspector.
  * All logs are written to stderr, never stdout.
  * The HTTP transport implements MCP Streamable HTTP at /mcp.
  * The legacy SSE transport is available at /sse + /messages.
`;
}
