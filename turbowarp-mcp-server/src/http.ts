import { randomUUID } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { ServerConfig } from "./config.js";
import {
  buildDashboardSnapshot,
  DASHBOARD_HTML,
  type DashboardHttpInfo
} from "./dashboard.js";
import { AppError, errorMessage } from "./errors.js";
import { log } from "./log.js";
import { createMcpServer } from "./server.js";
import {
  clearTelemetry,
  closeServerConnection,
  getServerConnectionId,
  setConnectionSessionId
} from "./telemetry.js";
import {
  createServerContext,
  type ServerContext
} from "./tools/common.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const LOOPBACK_ORIGIN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

interface StreamableSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

interface SseSession {
  server: McpServer;
  transport: SSEServerTransport;
}

export interface HttpServerHandle {
  server: http.Server;
  url: string;
  mcpUrl: string;
  sseUrl: string;
  healthUrl: string;
  dashboardUrl: string;
  dashboardApiUrl: string;
  close(): Promise<void>;
}

export interface DashboardServerHandle {
  server: http.Server;
  url: string;
  dashboardUrl: string;
  dashboardApiUrl: string;
  healthUrl: string;
  close(): Promise<void>;
}

class HttpError extends AppError {
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(code, message);
    this.name = "HttpError";
    this.status = status;
  }
}

function extraAllowedOrigins(): Set<string> {
  return new Set(
    (process.env.TW_MCP_ALLOW_ORIGIN ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }
  if (LOOPBACK_ORIGIN.test(origin)) {
    return true;
  }
  return extraAllowedOrigins().has(origin) || extraAllowedOrigins().has("*");
}

function applyCors(
  req: http.IncomingMessage,
  res: http.ServerResponse
): boolean {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (origin && !isOriginAllowed(origin)) {
    return false;
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  return true;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, html: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'"
  });
  res.end(html);
}

function sendRpcError(
  res: http.ServerResponse,
  status: number,
  code: number,
  message: string
): void {
  sendJson(res, status, {
    jsonrpc: "2.0",
    id: null,
    error: { code, message }
  });
}

async function readJsonBody(
  req: http.IncomingMessage
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_JSON_BYTES) {
      throw new HttpError(
        413,
        "REQUEST_TOO_LARGE",
        `JSON-RPC request body exceeds ${MAX_JSON_BYTES} bytes.`
      );
    }
    chunks.push(buffer);
  }
  if (total === 0) {
    return undefined;
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
}

function headerValue(
  req: http.IncomingMessage,
  name: string
): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function formatHttpUrl(host: string, port: number): string {
  let displayHost = host;
  if (host === "0.0.0.0") {
    displayHost = "127.0.0.1";
  } else if (host === "::" || host === "::0") {
    displayHost = "::1";
  }
  if (displayHost.includes(":") && !displayHost.startsWith("[")) {
    displayHost = `[${displayHost}]`;
  }
  return `http://${displayHost}:${port}`;
}

function healthPayload(
  config: ServerConfig,
  context: ServerContext,
  dashboardUrl: string | null
): Record<string, unknown> {
  return {
    ok: true,
    name: SERVER_NAME,
    version: SERVER_VERSION,
    transport: config.transport,
    transports:
      config.transport === "stdio"
        ? ["stdio"]
        : ["streamable-http", "sse"],
    confirmMode: config.confirmMode,
    workspace: config.workspace,
    dashboard: dashboardUrl,
    activeProject: context.state.loaded
      ? {
          displayName: context.state.loaded.displayName,
          sourcePath: context.state.loaded.sourcePath,
          dirty: context.state.loaded.dirty
        }
      : null
  };
}

async function handleDashboardRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  config: ServerConfig,
  context: ServerContext,
  getHttpInfo: () => DashboardHttpInfo | null
): Promise<boolean> {
  if (url.pathname === "/dashboard" && req.method === "GET") {
    sendHtml(res, DASHBOARD_HTML);
    return true;
  }

  if (url.pathname === "/api/dashboard" && req.method === "GET") {
    sendJson(
      res,
      200,
      buildDashboardSnapshot(config, context, getHttpInfo())
    );
    return true;
  }

  if (url.pathname === "/api/dashboard/clear" && req.method === "POST") {
    clearTelemetry();
    sendJson(res, 200, { ok: true, cleared: true });
    return true;
  }

  if (url.pathname === "/" && req.method === "GET") {
    res.writeHead(302, { Location: "/dashboard" });
    res.end();
    return true;
  }

  return false;
}

export async function startHttpServer(
  config: ServerConfig
): Promise<HttpServerHandle> {
  const context: ServerContext = createServerContext(config);
  const streamableSessions = new Map<string, StreamableSession>();
  const sseSessions = new Map<string, SseSession>();
  const allServers = new Set<McpServer>();
  let dashboardInfo: DashboardHttpInfo | null = null;

  const createStreamableSession = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: unknown
  ): Promise<void> => {
    const mcpServer = createMcpServer(config, context, {
      transport: "streamable-http"
    });
    let sessionId: string | undefined;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (initializedId) => {
        sessionId = initializedId;
        streamableSessions.set(initializedId, {
          server: mcpServer,
          transport
        });
        const connectionId = getServerConnectionId(mcpServer);
        if (connectionId) {
          setConnectionSessionId(connectionId, initializedId);
        }
        log.info("HTTP MCP session initialized", { sessionId: initializedId });
      }
    });

    transport.onclose = () => {
      if (sessionId) {
        streamableSessions.delete(sessionId);
      }
      closeServerConnection(mcpServer);
    };
    transport.onerror = (error) => {
      log.warn("Streamable HTTP transport error", {
        sessionId,
        error: errorMessage(error)
      });
    };

    allServers.add(mcpServer);
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (sessionId) {
        streamableSessions.delete(sessionId);
      }
      closeServerConnection(mcpServer);
      allServers.delete(mcpServer);
      try {
        await transport.close();
      } catch {
        // Best effort.
      }
      try {
        await mcpServer.close();
      } catch {
        // Best effort.
      }
      throw error;
    }
  };

  const handleStreamable = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    const method = req.method ?? "GET";
    const sessionId = headerValue(req, "mcp-session-id");

    if (method === "POST") {
      const body = await readJsonBody(req);
      if (sessionId) {
        const session = streamableSessions.get(sessionId);
        if (!session) {
          sendRpcError(res, 404, -32000, `Unknown MCP session: ${sessionId}`);
          return;
        }
        await session.transport.handleRequest(req, res, body);
        return;
      }
      await createStreamableSession(req, res, body);
      return;
    }

    if (method === "GET" || method === "DELETE") {
      if (!sessionId) {
        sendRpcError(
          res,
          400,
          -32600,
          "Mcp-Session-Id is required for GET/DELETE on /mcp."
        );
        return;
      }
      const session = streamableSessions.get(sessionId);
      if (!session) {
        sendRpcError(res, 404, -32000, `Unknown MCP session: ${sessionId}`);
        return;
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    sendJson(res, 405, {
      error: "Method not allowed",
      allow: ["GET", "POST", "DELETE", "OPTIONS"]
    });
  };

  const handleSseOpen = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    const mcpServer = createMcpServer(config, context, {
      transport: "sse",
      sessionId
    });

    sseSessions.set(sessionId, { server: mcpServer, transport });
    allServers.add(mcpServer);

    const cleanup = (): void => {
      sseSessions.delete(sessionId);
      allServers.delete(mcpServer);
      closeServerConnection(mcpServer);
    };
    transport.onclose = cleanup;
    transport.onerror = (error) => {
      log.warn("SSE transport error", {
        sessionId,
        error: errorMessage(error)
      });
    };
    res.on("close", cleanup);

    try {
      await mcpServer.connect(transport);
      log.info("Legacy SSE session initialized", { sessionId });
    } catch (error) {
      cleanup();
      closeServerConnection(mcpServer);
      try {
        await transport.close();
      } catch {
        // Best effort.
      }
      try {
        await mcpServer.close();
      } catch {
        // Best effort.
      }
      throw error;
    }
  };

  const handleSseMessage = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> => {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      sendRpcError(res, 400, -32600, "sessionId query parameter is required.");
      return;
    }
    const session = sseSessions.get(sessionId);
    if (!session) {
      sendRpcError(res, 404, -32000, `Unknown SSE session: ${sessionId}`);
      return;
    }
    const body = await readJsonBody(req);
    await session.transport.handlePostMessage(req, res, body);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "127.0.0.1"}`
    );

    if (!applyCors(req, res)) {
      sendJson(res, 403, {
        error: "Origin not allowed",
        hint: "Use localhost/127.0.0.1, or add the origin to TW_MCP_ALLOW_ORIGIN."
      });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const run = async (): Promise<void> => {
      if (
        await handleDashboardRoute(
          req,
          res,
          url,
          config,
          context,
          () => dashboardInfo
        )
      ) {
        return;
      }

      if (url.pathname === "/health" && req.method === "GET") {
        sendJson(
          res,
          200,
          healthPayload(config, context, dashboardInfo?.dashboardUrl ?? null)
        );
        return;
      }

      if (url.pathname === "/mcp") {
        await handleStreamable(req, res);
        return;
      }

      if (url.pathname === "/sse" && req.method === "GET") {
        await handleSseOpen(req, res);
        return;
      }

      if (url.pathname === "/messages" && req.method === "POST") {
        await handleSseMessage(req, res, url);
        return;
      }

      sendJson(res, 404, {
        error: "Not found",
        endpoints: {
          mcp: "/mcp",
          sse: "/sse",
          messages: "/messages?sessionId=<id>",
          health: "/health",
          dashboard: "/dashboard",
          dashboardApi: "/api/dashboard"
        }
      });
    };

    void run().catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const code =
        error instanceof HttpError ? error.code : "INTERNAL_HTTP_ERROR";
      log.error("HTTP request failed", {
        method: req.method,
        path: url.pathname,
        error: errorMessage(error)
      });
      if (res.headersSent) {
        res.end();
        return;
      }
      if (status === 400 || status === 413) {
        sendRpcError(
          res,
          status,
          status === 413 ? -32600 : -32700,
          errorMessage(error)
        );
        return;
      }
      sendJson(res, status, {
        error: code,
        message: errorMessage(error)
      });
    });
  });

  server.on("clientError", (error, socket) => {
    log.warn("HTTP client error", { error: errorMessage(error) });
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });

  const address = server.address() as AddressInfo;
  const url = formatHttpUrl(config.host, address.port);
  const dashboardUrl = `${url}/dashboard`;
  dashboardInfo = {
    url,
    dashboardUrl,
    mcpUrl: `${url}/mcp`,
    sseUrl: `${url}/sse`,
    healthUrl: `${url}/health`
  };
  const handle: HttpServerHandle = {
    server,
    url,
    mcpUrl: `${url}/mcp`,
    sseUrl: `${url}/sse`,
    healthUrl: `${url}/health`,
    dashboardUrl,
    dashboardApiUrl: `${url}/api/dashboard`,
    close: async () => {
      for (const session of streamableSessions.values()) {
        try {
          await session.server.close();
        } catch {
          // Best effort.
        }
        closeServerConnection(session.server);
      }
      for (const session of sseSessions.values()) {
        try {
          await session.server.close();
        } catch {
          // Best effort.
        }
        closeServerConnection(session.server);
      }
      streamableSessions.clear();
      sseSessions.clear();
      allServers.clear();

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        server.closeAllConnections?.();
      });
    }
  };

  log.info("HTTP server listening", {
    url,
    mcp: handle.mcpUrl,
    sse: handle.sseUrl,
    health: handle.healthUrl,
    dashboard: handle.dashboardUrl,
    confirmMode: config.confirmMode,
    workspace: config.workspace
  });

  if (config.host !== "127.0.0.1" && config.host !== "localhost" && config.host !== "::1") {
    log.warn(
      "HTTP transport is bound beyond loopback without authentication. " +
        "Only expose it on a trusted network; paths are still sandboxed by TW_MCP_WORKSPACE."
    );
  }

  return handle;
}

/**
 * Dashboard-only HTTP server used by stdio mode when --dashboard-port is set.
 * It shares the same ServerContext and telemetry as the stdio MCP server.
 */
export async function startDashboardServer(
  config: ServerConfig,
  context: ServerContext = createServerContext(config)
): Promise<DashboardServerHandle> {
  let dashboardInfo: DashboardHttpInfo | null = null;

  const server = http.createServer((req, res) => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "127.0.0.1"}`
    );

    if (!applyCors(req, res)) {
      sendJson(res, 403, {
        error: "Origin not allowed",
        hint: "Use localhost/127.0.0.1, or add the origin to TW_MCP_ALLOW_ORIGIN."
      });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const run = async (): Promise<void> => {
      if (
        await handleDashboardRoute(
          req,
          res,
          url,
          config,
          context,
          () => dashboardInfo
        )
      ) {
        return;
      }

      if (url.pathname === "/health" && req.method === "GET") {
        sendJson(
          res,
          200,
          healthPayload(config, context, dashboardInfo?.dashboardUrl ?? null)
        );
        return;
      }

      sendJson(res, 404, {
        error: "Not found",
        endpoints: {
          dashboard: "/dashboard",
          dashboardApi: "/api/dashboard",
          health: "/health"
        }
      });
    };

    void run().catch((error: unknown) => {
      log.error("Dashboard request failed", {
        method: req.method,
        path: url.pathname,
        error: errorMessage(error)
      });
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, 500, {
        error: "INTERNAL_HTTP_ERROR",
        message: errorMessage(error)
      });
    });
  });

  server.on("clientError", (error, socket) => {
    log.warn("Dashboard client error", { error: errorMessage(error) });
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.dashboardPort ?? config.port, config.host);
  });

  const address = server.address() as AddressInfo;
  const url = formatHttpUrl(config.host, address.port);
  const dashboardUrl = `${url}/dashboard`;
  const healthUrl = `${url}/health`;
  dashboardInfo = { url, dashboardUrl, healthUrl };

  const handle: DashboardServerHandle = {
    server,
    url,
    dashboardUrl,
    dashboardApiUrl: `${url}/api/dashboard`,
    healthUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        server.closeAllConnections?.();
      });
    }
  };

  log.info("MCP dashboard listening", {
    url,
    dashboard: dashboardUrl,
    api: handle.dashboardApiUrl,
    mcpTransport: config.transport
  });

  if (config.host !== "127.0.0.1" && config.host !== "localhost" && config.host !== "::1") {
    log.warn(
      "Dashboard is bound beyond loopback without authentication. " +
        "Only expose it on a trusted network."
    );
  }

  return handle;
}
