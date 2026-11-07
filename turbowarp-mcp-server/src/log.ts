import { recordLog } from "./telemetry.js";
import { safeJson } from "./utils/json.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

let currentLevel: LogLevel = "info";

export function configureLogging(level: LogLevel): void {
  currentLevel = level;
}

function write(level: LogLevel, message: string, data?: unknown): void {
  // Capture every level for the dashboard before applying the stderr filter.
  // The telemetry ring buffer is bounded and truncates large payloads.
  recordLog(level, message, data);

  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) {
    return;
  }
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] [turbowarp-mcp] ${level.toUpperCase()} ${message}`;
  if (data !== undefined) {
    try {
      line += ` ${safeJson(data)}`;
    } catch {
      line += " [unserializable data]";
    }
  }
  // All diagnostics must go to stderr. stdout is reserved for JSON-RPC when
  // using the stdio transport.
  process.stderr.write(`${line}\n`);
}

export const log = {
  debug: (message: string, data?: unknown) => write("debug", message, data),
  info: (message: string, data?: unknown) => write("info", message, data),
  warn: (message: string, data?: unknown) => write("warn", message, data),
  error: (message: string, data?: unknown) => write("error", message, data)
};

/**
 * Some dependencies (notably scratch-vm / minilog) may use console.log.
 * In stdio mode that would corrupt the MCP JSON-RPC stream, so redirect it
 * to stderr before any server code runs.
 */
export function installStdioConsoleGuard(): void {
  const toStderr = (...args: unknown[]) => {
    const text = args
      .map((value) => {
        if (typeof value === "string") {
          return value;
        }
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      })
      .join(" ");
    process.stderr.write(`${text}\n`);
  };

  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  // console.warn and console.error already write to stderr.
}
