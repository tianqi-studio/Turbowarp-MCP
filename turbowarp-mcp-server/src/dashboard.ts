import type { ServerConfig } from "./config.js";
import type { ServerContext } from "./tools/common.js";
import { getTelemetrySnapshot } from "./telemetry.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

export interface DashboardHttpInfo {
  url: string;
  dashboardUrl: string;
  mcpUrl?: string;
  sseUrl?: string;
  healthUrl?: string;
}

export function buildDashboardSnapshot(
  config: ServerConfig,
  context: ServerContext,
  http: DashboardHttpInfo | null
): Record<string, unknown> {
  const telemetry = getTelemetrySnapshot();
  const activeProject = context.state.loaded
    ? {
        displayName: context.state.loaded.displayName,
        sourcePath: context.state.loaded.sourcePath,
        dirty: context.state.loaded.dirty
      }
    : null;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    server: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      transport: config.transport,
      host: config.host,
      port: config.port,
      confirmMode: config.confirmMode,
      workspace: config.workspace,
      allowAnyPath: config.allowAnyPath,
      logLevel: config.logLevel,
      vmModule: config.vmModule,
      http
    },
    activeProject,
    startedAt: telemetry.startedAt,
    uptimeMs: telemetry.uptimeMs,
    pid: telemetry.pid,
    counters: telemetry.counters,
    tools: telemetry.tools,
    connections: telemetry.connections,
    toolCalls: telemetry.toolCalls,
    logs: telemetry.logs
  };
}

/**
 * Self-contained dashboard. It intentionally has no build step and no external
 * dependencies so it can be served directly by the MCP server.
 */
export const DASHBOARD_HTML = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TurboWarp MCP 监控面板</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0d12;
    --panel: #141821;
    --panel-2: #191e29;
    --border: #272e3d;
    --text: #e8ecf4;
    --muted: #8e99ad;
    --accent: #a78bfa;
    --accent-2: #7c3aed;
    --ok: #34d399;
    --warn: #fbbf24;
    --err: #fb7185;
    --debug: #60a5fa;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: radial-gradient(1200px 600px at 20% -10%, #241b3f 0%, var(--bg) 55%);
    color: var(--text);
    font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    font-size: 14px;
    min-height: 100vh;
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 20px 28px;
    border-bottom: 1px solid var(--border);
    background: rgba(11, 13, 18, 0.82);
    backdrop-filter: blur(12px);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .logo {
    width: 46px; height: 46px; border-radius: 13px;
    display: grid; place-items: center;
    background: linear-gradient(145deg, var(--accent-2), #4c1d95);
    color: white; font-weight: 800; font-size: 12px; letter-spacing: 0.08em;
    box-shadow: 0 8px 24px rgba(124, 58, 237, 0.35);
    flex: none;
  }
  h1 { font-size: 18px; margin: 0 0 3px; font-weight: 650; letter-spacing: 0.01em; }
  .subtitle { margin: 0; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
  button, select, input {
    font: inherit; color: var(--text); background: var(--panel-2);
    border: 1px solid var(--border); border-radius: 9px; padding: 7px 11px;
    outline: none;
  }
  button { cursor: pointer; transition: border-color 0.15s, background 0.15s; }
  button:hover { border-color: #3c465c; background: #202636; }
  button.danger { color: #fecdd3; border-color: #4c2431; }
  button.danger:hover { background: #2a1720; }
  input::placeholder { color: #667287; }
  select:focus, input:focus { border-color: var(--accent-2); }
  .check { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; user-select: none; }
  .check input { accent-color: var(--accent-2); }
  .pill {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 7px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;
    border: 1px solid var(--border); background: var(--panel-2); color: var(--muted);
  }
  .pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .pill.online { color: #bbf7d0; border-color: #14532d; background: rgba(22, 101, 52, 0.28); }
  .pill.online .dot { background: var(--ok); box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.12); }
  .pill.offline { color: #fecdd3; border-color: #4c2431; background: rgba(127, 29, 29, 0.25); }
  .pill.offline .dot { background: var(--err); }
  .banner {
    margin: 14px 28px 0; padding: 12px 16px; border-radius: 11px;
    border: 1px solid #4c2431; background: rgba(127, 29, 29, 0.18);
    color: #fecdd3; font-size: 13px;
  }
  .banner.hidden { display: none; }
  main { padding: 22px 28px 40px; max-width: 1600px; margin: 0 auto; }
  .cards {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px; margin-bottom: 16px;
  }
  .card {
    background: linear-gradient(160deg, rgba(25, 30, 41, 0.95), rgba(20, 24, 33, 0.95));
    border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px;
    position: relative; overflow: hidden;
  }
  .card::after {
    content: ""; position: absolute; inset: auto -40px -60px auto;
    width: 130px; height: 130px; border-radius: 50%;
    background: radial-gradient(circle, rgba(167, 139, 250, 0.14), transparent 70%);
  }
  .card-label { color: var(--muted); font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; }
  .card-value { font-size: 27px; font-weight: 750; margin-top: 7px; letter-spacing: -0.02em; }
  .card-note { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr); gap: 16px; margin-bottom: 16px; }
  .panel {
    background: rgba(20, 24, 33, 0.92); border: 1px solid var(--border);
    border-radius: 14px; overflow: hidden; margin-bottom: 16px;
  }
  .grid .panel { margin-bottom: 0; }
  .panel-head {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 14px 18px; border-bottom: 1px solid var(--border);
  }
  .panel-head h2 { margin: 0; font-size: 14px; font-weight: 650; letter-spacing: 0.02em; }
  .panel-head .meta, .panel-head span { color: var(--muted); font-size: 12px; }
  .table-wrap { overflow: auto; max-height: 430px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid rgba(39, 46, 61, 0.65); white-space: nowrap; }
  th { color: var(--muted); font-weight: 550; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; position: sticky; top: 0; background: #171b25; z-index: 1; }
  tbody tr:hover { background: rgba(167, 139, 250, 0.045); }
  tbody tr.closed { opacity: 0.55; }
  td.empty { color: var(--muted); text-align: center; padding: 26px; }
  .mono { font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace; font-size: 12px; }
  .muted { color: var(--muted); }
  .tag {
    display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 650; border: 1px solid var(--border); background: var(--panel-2);
  }
  .tag.ok { color: #bbf7d0; border-color: #14532d; background: rgba(22, 101, 52, 0.25); }
  .tag.err { color: #fecdd3; border-color: #4c2431; background: rgba(127, 29, 29, 0.22); }
  .tag.warn { color: #fde68a; border-color: #713f12; background: rgba(113, 63, 18, 0.22); }
  .tag.muted { color: var(--muted); }
  .project-name { font-size: 20px; font-weight: 700; margin: 16px 18px 4px; }
  .project-path { color: var(--muted); font-size: 12px; margin: 0 18px 6px; word-break: break-all; }
  .project-state { margin: 0 18px 16px; }
  .chips { display: flex; flex-wrap: wrap; gap: 7px; padding: 14px 18px 18px; }
  .chip {
    font-family: "Cascadia Code", Consolas, monospace; font-size: 11px;
    color: #ddd6fe; background: rgba(124, 58, 237, 0.13);
    border: 1px solid rgba(124, 58, 237, 0.32); border-radius: 7px; padding: 4px 8px;
  }
  .filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .filters input { width: 190px; }
  .logs { max-height: 520px; overflow: auto; padding: 6px 0; }
  .log-row {
    display: grid; grid-template-columns: 78px 62px minmax(0, 1fr);
    gap: 10px; padding: 8px 18px; border-bottom: 1px solid rgba(39, 46, 61, 0.42);
    align-items: start;
  }
  .log-row:hover { background: rgba(167, 139, 250, 0.04); }
  .log-time { color: var(--muted); font-family: "Cascadia Code", Consolas, monospace; font-size: 11px; padding-top: 2px; }
  .log-level { font-size: 10px; font-weight: 750; letter-spacing: 0.06em; padding-top: 3px; }
  .level-debug .log-level { color: var(--debug); }
  .level-info .log-level { color: var(--ok); }
  .level-warn .log-level { color: var(--warn); }
  .level-error .log-level { color: var(--err); }
  .log-message { white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
  .log-data { margin: 5px 0 0; }
  .log-data summary { color: var(--muted); font-size: 11px; cursor: pointer; }
  .log-data pre {
    margin: 6px 0 0; padding: 9px 11px; border-radius: 8px; max-height: 220px;
    overflow: auto; background: #0e1118; border: 1px solid var(--border);
    color: #c7d2fe; font-size: 11px; white-space: pre-wrap; word-break: break-word;
  }
  .empty-state { color: var(--muted); padding: 26px 18px; text-align: center; }
  footer { color: var(--muted); font-size: 11px; padding: 0 28px 26px; max-width: 1600px; margin: 0 auto; }
  .hidden { display: none !important; }
  @media (max-width: 1050px) {
    .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 680px) {
    .topbar { align-items: flex-start; flex-direction: column; padding: 16px; }
    main { padding: 16px; }
    .cards { grid-template-columns: 1fr; }
    .filters input { width: 100%; }
    .log-row { grid-template-columns: 64px 52px minmax(0, 1fr); padding: 8px 12px; }
    .banner { margin: 12px 16px 0; }
  }
</style>
</head>
<body>
<header class="topbar">
  <div class="brand">
    <div class="logo">MCP</div>
    <div>
      <h1>TurboWarp MCP 监控面板</h1>
      <p class="subtitle" id="server-line">正在连接服务器...</p>
    </div>
  </div>
  <div class="actions">
    <span class="pill offline" id="status-pill"><span class="dot"></span><span id="status-text">离线</span></span>
    <label class="check"><input type="checkbox" id="auto" checked> 自动刷新</label>
    <button type="button" id="refresh">刷新</button>
    <button type="button" class="danger" id="clear">清空日志</button>
  </div>
</header>

<div class="banner hidden" id="offline-banner"></div>

<main>
  <section class="cards">
    <div class="card">
      <div class="card-label">活动连接</div>
      <div class="card-value" id="stat-connections">—</div>
      <div class="card-note" id="stat-connections-note">等待数据</div>
    </div>
    <div class="card">
      <div class="card-label">工具调用</div>
      <div class="card-value" id="stat-calls">—</div>
      <div class="card-note" id="stat-calls-note">本次进程累计</div>
    </div>
    <div class="card">
      <div class="card-label">错误</div>
      <div class="card-value" id="stat-errors">—</div>
      <div class="card-note">工具返回 isError 或抛出异常</div>
    </div>
    <div class="card">
      <div class="card-label">运行时长</div>
      <div class="card-value" id="stat-uptime">—</div>
      <div class="card-note" id="stat-pid">PID —</div>
    </div>
  </section>

  <section class="grid">
    <div class="panel">
      <div class="panel-head">
        <h2>连接状态</h2>
        <span id="connection-count">0 个连接</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>传输</th>
              <th>会话</th>
              <th>客户端</th>
              <th>连接时间</th>
              <th>最近活动</th>
              <th>调用</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody id="connections"></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>活动项目</h2>
        <span id="project-state"></span>
      </div>
      <div id="project"></div>
      <div class="panel-head" style="border-top: 1px solid var(--border);">
        <h2>可用工具</h2>
        <span id="tool-count">0 个</span>
      </div>
      <div class="chips" id="tool-list"></div>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>工具调用</h2>
      <span id="call-count">最近 0 条</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>工具</th>
            <th>耗时</th>
            <th>结果</th>
            <th>传输 / 会话</th>
          </tr>
        </thead>
        <tbody id="calls"></tbody>
      </table>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>日志</h2>
      <div class="filters">
        <select id="level">
          <option value="">全部级别</option>
          <option value="debug">DEBUG</option>
          <option value="info">INFO</option>
          <option value="warn">WARN</option>
          <option value="error">ERROR</option>
        </select>
        <input type="search" id="search" placeholder="搜索日志...">
        <span id="log-count">0 / 0</span>
      </div>
    </div>
    <div class="logs" id="logs"></div>
  </section>
</main>

<footer id="footer">TurboWarp MCP Server</footer>

<script>
(function () {
  'use strict';

  var POLL_MS = 1500;
  var MAX_RENDERED_LOGS = 300;
  var IDLE_MS = 60000;
  var timer = null;
  var inflight = false;
  var autoRefresh = true;
  var lastData = null;
  var lastSuccessAt = null;

  function byId(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function formatClock(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleTimeString([], {hour12: false});
  }

  function formatDuration(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }

  function formatUptime(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '—';
    var seconds = Math.floor(ms / 1000);
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor((seconds % 86400) / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return days + '天 ' + hours + '时';
    if (hours > 0) return hours + '时 ' + minutes + '分';
    if (minutes > 0) return minutes + '分 ' + (seconds % 60) + '秒';
    return seconds + '秒';
  }

  function shortId(id) {
    if (!id) return '—';
    return String(id).slice(0, 8);
  }

  function transportLabel(transport) {
    if (transport === 'streamable-http') return 'HTTP';
    if (transport === 'sse') return 'SSE';
    if (transport === 'stdio') return 'STDIO';
    return String(transport || '未知');
  }

  function isIdleConnection(connection) {
    if (connection.status !== 'connected') return false;
    var time = Date.parse(connection.lastActivityAt);
    return isFinite(time) && (Date.now() - time > IDLE_MS);
  }

  function setStatus(online, message) {
    var pill = byId('status-pill');
    var text = byId('status-text');
    if (online) {
      pill.className = 'pill online';
      text.textContent = '在线';
      byId('offline-banner').classList.add('hidden');
    } else {
      pill.className = 'pill offline';
      text.textContent = '离线';
      var banner = byId('offline-banner');
      banner.textContent = message;
      banner.classList.remove('hidden');
    }
  }

  function serverLine(data) {
    var server = data.server || {};
    var http = server.http || null;
    var parts = [server.name || 'TurboWarp MCP Server', server.version || ''];
    parts.push(transportLabel(server.transport));
    if (http && http.dashboardUrl) parts.push(http.dashboardUrl);
    return parts.filter(Boolean).join(' · ');
  }

  function renderProject(data) {
    var project = byId('project');
    clearNode(project);
    var active = data.activeProject;
    if (!active) {
      project.appendChild(el('div', 'empty-state', '没有活动项目。调用 new_project 或 load_sb3 后显示在这里。'));
      byId('project-state').textContent = '';
      return;
    }
    project.appendChild(el('div', 'project-name', active.displayName || '(未命名项目)'));
    project.appendChild(el('div', 'project-path', active.sourcePath || '仅存在于内存中，尚未导出'));
    var state = el('div', 'project-state');
    var tag = el('span', 'tag ' + (active.dirty ? 'warn' : 'ok'), active.dirty ? '有未导出的修改' : '已保存 / 无修改');
    state.appendChild(tag);
    project.appendChild(state);
    byId('project-state').textContent = '';
  }

  function renderTools(data) {
    var list = byId('tool-list');
    clearNode(list);
    var tools = (data.tools && data.tools.available) || [];
    for (var i = 0; i < tools.length; i += 1) {
      list.appendChild(el('span', 'chip', tools[i]));
    }
    byId('tool-count').textContent = tools.length + ' 个';
  }

  function renderConnections(data) {
    var tbody = byId('connections');
    clearNode(tbody);
    var list = data.connections || [];
    if (list.length === 0) {
      var emptyRow = el('tr');
      var emptyCell = el('td', 'empty', '还没有 MCP 客户端连接。');
      emptyCell.colSpan = 7;
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    } else {
      list.sort(function (a, b) {
        if (a.status !== b.status) return a.status === 'connected' ? -1 : 1;
        return String(b.connectedAt).localeCompare(String(a.connectedAt));
      });
      for (var i = 0; i < list.length; i += 1) {
        var c = list[i];
        var tr = el('tr', c.status === 'closed' ? 'closed' : '');
        tr.appendChild(el('td', 'mono', transportLabel(c.transport)));
        tr.appendChild(el('td', 'mono', shortId(c.sessionId)));
        tr.appendChild(el('td', '', c.clientName ? c.clientName + (c.clientVersion ? ' ' + c.clientVersion : '') : (c.status === 'connected' ? '等待 initialize' : '—')));
        tr.appendChild(el('td', 'mono', formatClock(c.connectedAt)));
        tr.appendChild(el('td', 'mono', formatClock(c.lastActivityAt)));
        tr.appendChild(el('td', 'mono', String(c.toolCalls || 0) + (c.toolErrors ? ' / ' + c.toolErrors + ' 错' : '')));
        var statusCell = el('td');
        var idle = isIdleConnection(c);
        var statusTag = el(
          'span',
          'tag ' + (c.status !== 'connected' ? 'muted' : (idle ? 'warn' : 'ok')),
          c.status !== 'connected' ? '已断开' : (idle ? '空闲' : '已连接')
        );
        if (idle) {
          statusTag.title = '超过 60 秒没有活动。会话仍在服务器内存中，直到客户端发送 DELETE 或服务器重启。';
        }
        statusCell.appendChild(statusTag);
        tr.appendChild(statusCell);
        tbody.appendChild(tr);
      }
    }
    var activeCount = list.filter(function (c) { return c.status === 'connected' && !isIdleConnection(c); }).length;
    var idleCount = list.filter(isIdleConnection).length;
    byId('connection-count').textContent =
      activeCount + ' 活动' +
      (idleCount ? ' / ' + idleCount + ' 空闲' : '') +
      ' / ' + list.length + ' 总计';
  }

  function renderCalls(data) {
    var tbody = byId('calls');
    clearNode(tbody);
    var list = (data.toolCalls || []).slice().reverse();
    if (list.length === 0) {
      var emptyRow = el('tr');
      var emptyCell = el('td', 'empty', '还没有工具调用。');
      emptyCell.colSpan = 5;
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    } else {
      for (var i = 0; i < list.length; i += 1) {
        var call = list[i];
        var tr = el('tr');
        var titleParts = [];
        if (call.argumentsPreview) titleParts.push('参数:\n' + call.argumentsPreview);
        if (call.resultPreview) titleParts.push('结果:\n' + call.resultPreview);
        if (call.errorMessage) titleParts.push('错误:\n' + call.errorMessage);
        tr.title = titleParts.join('\n\n');
        tr.appendChild(el('td', 'mono', formatClock(call.time)));
        tr.appendChild(el('td', 'mono', call.tool));
        tr.appendChild(el('td', 'mono', formatDuration(call.durationMs)));
        var resultCell = el('td');
        resultCell.appendChild(el('span', 'tag ' + (call.ok ? 'ok' : 'err'), call.ok ? '成功' : (call.errorCode || '错误')));
        tr.appendChild(resultCell);
        tr.appendChild(el('td', 'muted mono', transportLabel(call.transport) + (call.sessionId ? ' / ' + shortId(call.sessionId) : '')));
        tbody.appendChild(tr);
      }
    }
    byId('call-count').textContent = (data.counters && data.counters.toolCalls || 0) + ' 次调用 · 最近 ' + list.length + ' 条';
  }

  function renderLogs(data) {
    var level = byId('level').value;
    var query = byId('search').value.trim().toLowerCase();
    var list = data.logs || [];
    var filtered = [];
    for (var i = list.length - 1; i >= 0 && filtered.length < MAX_RENDERED_LOGS; i -= 1) {
      var entry = list[i];
      if (level && entry.level !== level) continue;
      if (query) {
        var haystack = String(entry.message || '').toLowerCase();
        if (entry.dataText) haystack += '\n' + String(entry.dataText).toLowerCase();
        if (haystack.indexOf(query) === -1) continue;
      }
      filtered.push(entry);
    }
    var container = byId('logs');
    clearNode(container);
    if (filtered.length === 0) {
      container.appendChild(el('div', 'empty-state', list.length === 0 ? '还没有日志。' : '没有匹配当前过滤条件的日志。'));
    } else {
      for (var j = 0; j < filtered.length; j += 1) {
        var log = filtered[j];
        var row = el('div', 'log-row level-' + log.level);
        row.appendChild(el('div', 'log-time', formatClock(log.time)));
        row.appendChild(el('div', 'log-level', String(log.level || '').toUpperCase()));
        var body = el('div');
        body.appendChild(el('div', 'log-message', log.message));
        if (log.dataText) {
          var details = el('details', 'log-data');
          details.appendChild(el('summary', '', '查看数据'));
          details.appendChild(el('pre', '', log.dataText));
          body.appendChild(details);
        }
        row.appendChild(body);
        container.appendChild(row);
      }
    }
    byId('log-count').textContent = filtered.length + ' / ' + list.length;
  }

  function render(data) {
    lastData = data;
    lastSuccessAt = new Date();
    var connections = data.connections || [];
    var activeConnections = connections.filter(function (c) { return c.status === 'connected' && !isIdleConnection(c); }).length;
    var idleConnections = connections.filter(isIdleConnection).length;
    var counters = data.counters || {};
    byId('stat-connections').textContent = String(activeConnections);
    byId('stat-connections-note').textContent =
      connections.length + ' 个连接记录' +
      (idleConnections ? '，' + idleConnections + ' 个空闲' : '');
    byId('stat-calls').textContent = String(counters.toolCalls || 0);
    byId('stat-errors').textContent = String(counters.toolErrors || 0);
    byId('stat-uptime').textContent = formatUptime(data.uptimeMs);
    byId('stat-pid').textContent = 'PID ' + (data.pid || '—');
    byId('server-line').textContent = serverLine(data);
    setStatus(true, '');
    renderProject(data);
    renderTools(data);
    renderConnections(data);
    renderCalls(data);
    renderLogs(data);
    var server = data.server || {};
    var http = server.http || null;
    byId('footer').textContent =
      '生成于 ' + formatClock(data.generatedAt) +
      ' · 工作区 ' + (server.workspace || '—') +
      ' · 确认策略 ' + (server.confirmMode || '—') +
      ' · 日志级别 ' + (server.logLevel || '—') +
      (http ? ' · ' + http.dashboardUrl : '');
  }

  function setOffline(error) {
    var extra = lastSuccessAt ? '最后成功更新：' + formatClock(lastSuccessAt.toISOString()) + '。' : '';
    setStatus(false, '无法连接 MCP 服务器。' + extra + ' 错误：' + (error && error.message ? error.message : String(error)));
  }

  function fetchSnapshot() {
    if (inflight) return Promise.resolve();
    inflight = true;
    return fetch('/api/dashboard', {cache: 'no-store'})
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        render(data);
      })
      .catch(function (error) {
        setOffline(error);
      })
      .finally(function () {
        inflight = false;
        if (autoRefresh) schedule();
      });
  }

  function schedule() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!autoRefresh) return;
    timer = setTimeout(fetchSnapshot, POLL_MS);
  }

  byId('refresh').addEventListener('click', function () {
    fetchSnapshot();
  });

  byId('auto').addEventListener('change', function (event) {
    autoRefresh = !!event.target.checked;
    if (autoRefresh) fetchSnapshot();
    else schedule();
  });

  byId('clear').addEventListener('click', function () {
    if (!window.confirm('确定要清空日志和工具调用记录吗？连接记录和活动项目会保留。')) return;
    fetch('/api/dashboard/clear', {method: 'POST'})
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function () {
        return fetchSnapshot();
      })
      .catch(function (error) {
        setOffline(error);
      });
  });

  byId('level').addEventListener('change', function () {
    if (lastData) renderLogs(lastData);
  });
  byId('search').addEventListener('input', function () {
    if (lastData) renderLogs(lastData);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && autoRefresh) fetchSnapshot();
  });

  fetchSnapshot();
})();
</script>
</body>
</html>`;
