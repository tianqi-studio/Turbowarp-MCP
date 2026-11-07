import { randomUUID } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { errorMessage } from "./errors.js";
import type { LogLevel } from "./log.js";
import { safeJson, truncate } from "./utils/json.js";

export type ConnectionTransport = "stdio" | "streamable-http" | "sse";

export interface TelemetryLogEntry {
  seq: number;
  time: string;
  level: LogLevel;
  message: string;
  dataText: string | null;
}

export interface ToolCallRecord {
  seq: number;
  id: string;
  time: string;
  tool: string;
  connectionId: string;
  sessionId: string | null;
  transport: ConnectionTransport | "unknown";
  durationMs: number;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  argumentsPreview: string | null;
  resultPreview: string | null;
}

export interface ConnectionInfo {
  id: string;
  transport: ConnectionTransport;
  sessionId: string | null;
  clientName: string | null;
  clientVersion: string | null;
  connectedAt: string;
  lastActivityAt: string;
  closedAt: string | null;
  status: "connected" | "closed";
  toolCalls: number;
  toolErrors: number;
}

export interface TelemetrySnapshot {
  startedAt: string;
  uptimeMs: number;
  pid: number;
  counters: {
    logsRecorded: number;
    toolCalls: number;
    toolErrors: number;
    connectionsOpened: number;
  };
  tools: {
    available: string[];
  };
  connections: ConnectionInfo[];
  toolCalls: ToolCallRecord[];
  logs: TelemetryLogEntry[];
}

const MAX_LOGS = 500;
const MAX_TOOL_CALLS = 200;
const MAX_CONNECTIONS = 100;
const MAX_LOG_DATA_CHARS = 4000;
const MAX_PREVIEW_CHARS = 2000;

const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();

let sequence = 0;
let logsRecorded = 0;
let toolCallsRecorded = 0;
let toolErrorsRecorded = 0;
let connectionsOpened = 0;

const logs: TelemetryLogEntry[] = [];
const toolCalls: ToolCallRecord[] = [];
const connections: ConnectionInfo[] = [];
const toolNames = new Set<string>();

export function registerToolNames(names: readonly string[]): void {
  for (const name of names) {
    toolNames.add(name);
  }
}

/** Maps an McpServer instance to the telemetry connection it represents. */
const serverConnections = new WeakMap<object, string>();

function nowIso(): string {
  return new Date().toISOString();
}

function nextSequence(): number {
  sequence += 1;
  return sequence;
}

function preview(value: unknown, maxChars = MAX_PREVIEW_CHARS): string | null {
  if (value === undefined) {
    return null;
  }
  try {
    const text = safeJson(value);
    if (typeof text !== "string" || text.length === 0) {
      return null;
    }
    return truncate(text, maxChars);
  } catch {
    return null;
  }
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return truncate(line, 500);
}

function findConnection(id: string): ConnectionInfo | undefined {
  return connections.find((connection) => connection.id === id);
}

function pruneConnections(): void {
  while (connections.length >= MAX_CONNECTIONS) {
    const index = connections.findIndex(
      (connection) => connection.status === "closed"
    );
    if (index === -1) {
      return;
    }
    connections.splice(index, 1);
  }
}

/**
 * Record every log line, including levels that are filtered out of stderr.
 * The dashboard is meant to be an observability surface; its ring buffer is
 * bounded and log payloads are truncated.
 */
export function recordLog(
  level: LogLevel,
  message: string,
  data?: unknown
): void {
  try {
    const entry: TelemetryLogEntry = {
      seq: nextSequence(),
      time: nowIso(),
      level,
      message,
      dataText: preview(data, MAX_LOG_DATA_CHARS)
    };
    logs.push(entry);
    logsRecorded += 1;
    if (logs.length > MAX_LOGS) {
      logs.splice(0, logs.length - MAX_LOGS);
    }
  } catch {
    // Telemetry must never break logging or the MCP server.
  }
}

export interface RegisterConnectionOptions {
  transport: ConnectionTransport;
  sessionId?: string | null;
}

export function registerConnection(
  options: RegisterConnectionOptions
): string {
  pruneConnections();
  const timestamp = nowIso();
  const connection: ConnectionInfo = {
    id: randomUUID(),
    transport: options.transport,
    sessionId: options.sessionId ?? null,
    clientName: null,
    clientVersion: null,
    connectedAt: timestamp,
    lastActivityAt: timestamp,
    closedAt: null,
    status: "connected",
    toolCalls: 0,
    toolErrors: 0
  };
  connections.push(connection);
  connectionsOpened += 1;
  return connection.id;
}

export function attachServerConnection(
  server: object,
  connectionId: string
): void {
  serverConnections.set(server, connectionId);
}

export function getServerConnectionId(
  server: object
): string | undefined {
  return serverConnections.get(server);
}

export function setConnectionSessionId(
  connectionId: string,
  sessionId: string | null
): void {
  const connection = findConnection(connectionId);
  if (connection && sessionId) {
    connection.sessionId = sessionId;
  }
}

export function updateConnectionClient(
  connectionId: string,
  client: { name?: string; version?: string } | null | undefined
): void {
  const connection = findConnection(connectionId);
  if (!connection) {
    return;
  }
  if (client?.name) {
    connection.clientName = client.name;
  }
  if (client?.version) {
    connection.clientVersion = client.version;
  }
  connection.lastActivityAt = nowIso();
}

export function touchConnection(connectionId: string): void {
  const connection = findConnection(connectionId);
  if (connection && connection.status === "connected") {
    connection.lastActivityAt = nowIso();
  }
}

export function closeConnection(connectionId: string): void {
  const connection = findConnection(connectionId);
  if (!connection || connection.status === "closed") {
    return;
  }
  connection.status = "closed";
  connection.closedAt = nowIso();
}

export function closeServerConnection(server: object): void {
  const connectionId = serverConnections.get(server);
  if (connectionId) {
    closeConnection(connectionId);
  }
}

export interface RecordToolCallOptions {
  tool: string;
  connectionId: string;
  sessionId?: string | null;
  durationMs: number;
  ok: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  argumentsValue?: unknown;
  resultText?: string;
}

export function recordToolCall(options: RecordToolCallOptions): void {
  const connection = findConnection(options.connectionId);
  const sessionId =
    options.sessionId ?? connection?.sessionId ?? null;
  const record: ToolCallRecord = {
    seq: nextSequence(),
    id: randomUUID(),
    time: nowIso(),
    tool: options.tool,
    connectionId: options.connectionId,
    sessionId,
    transport: connection?.transport ?? "unknown",
    durationMs: Math.max(0, Math.round(options.durationMs)),
    ok: options.ok,
    errorCode: options.errorCode ?? null,
    errorMessage: options.errorMessage ?? null,
    argumentsPreview: preview(options.argumentsValue),
    resultPreview: options.resultText
      ? truncate(options.resultText, MAX_PREVIEW_CHARS)
      : null
  };
  toolCalls.push(record);
  toolCallsRecorded += 1;
  if (toolCalls.length > MAX_TOOL_CALLS) {
    toolCalls.splice(0, toolCalls.length - MAX_TOOL_CALLS);
  }
  if (!record.ok) {
    toolErrorsRecorded += 1;
  }
  if (connection) {
    connection.toolCalls += 1;
    if (!record.ok) {
      connection.toolErrors += 1;
    }
    if (connection.status === "connected") {
      connection.lastActivityAt = record.time;
    }
    if (sessionId) {
      connection.sessionId = sessionId;
    }
  }
}

export function clearTelemetry(): void {
  logs.length = 0;
  toolCalls.length = 0;
  logsRecorded = 0;
  toolCallsRecorded = 0;
  toolErrorsRecorded = 0;
}

interface ToolHandlerLike {
  (args: unknown, extra: unknown): Promise<CallToolResult> | CallToolResult;
}

interface RegisterToolLike {
  (name: string, config: unknown, handler: ToolHandlerLike): unknown;
}

function resultDetails(result: CallToolResult): {
  ok: boolean;
  errorCode: string | null;
  text: string;
} {
  const textItem = result.content?.find(
    (item) => item.type === "text" && typeof item.text === "string"
  );
  const text =
    textItem && "text" in textItem && typeof textItem.text === "string"
      ? textItem.text
      : "";
  if (!result.isError) {
    return { ok: true, errorCode: null, text };
  }
  const match = /^([A-Z][A-Z0-9_]{2,}):/.exec(text);
  return { ok: false, errorCode: match ? match[1] : null, text };
}

/**
 * Monkey-patch registerTool so every tool call is recorded without touching
 * each tool module. This also records handler-level throws.
 */
export function instrumentServerTools(
  server: McpServer,
  connectionId: string
): void {
  const target = server as unknown as { registerTool: RegisterToolLike };
  const original = target.registerTool.bind(server);

  target.registerTool = (name, config, handler) => {
    toolNames.add(name);
    const wrapped: ToolHandlerLike = async (args, extra) => {
      const started = Date.now();
      touchConnection(connectionId);
      try {
        const result = await handler(args, extra);
        const details = resultDetails(result);
        const extraSessionId =
          extra && typeof extra === "object"
            ? (extra as { sessionId?: unknown }).sessionId
            : undefined;
        recordToolCall({
          tool: name,
          connectionId,
          sessionId:
            typeof extraSessionId === "string" ? extraSessionId : null,
          durationMs: Date.now() - started,
          ok: details.ok,
          errorCode: details.errorCode,
          errorMessage: details.ok ? null : firstLine(details.text),
          argumentsValue: args,
          resultText: details.text
        });
        return result;
      } catch (error) {
        recordToolCall({
          tool: name,
          connectionId,
          durationMs: Date.now() - started,
          ok: false,
          errorCode: "TOOL_THREW",
          errorMessage: errorMessage(error),
          argumentsValue: args
        });
        throw error;
      }
    };
    return original(name, config, wrapped);
  };
}

export function getTelemetrySnapshot(): TelemetrySnapshot {
  return {
    startedAt,
    uptimeMs: Date.now() - startedAtMs,
    pid: process.pid,
    counters: {
      logsRecorded,
      toolCalls: toolCallsRecorded,
      toolErrors: toolErrorsRecorded,
      connectionsOpened
    },
    tools: {
      available: [...toolNames].sort()
    },
    connections: connections.map((connection) => ({ ...connection })),
    toolCalls: toolCalls.map((call) => ({ ...call })),
    logs: logs.map((entry) => ({ ...entry }))
  };
}
