# MCP 客户端配置与调试

推荐顺序：**MCP Inspector → Claude Desktop / OpenCode → Ollama（ollmcp）**。先用 Inspector 确认服务器和工具没问题，再接入具体客户端。

所有示例中的路径都要替换成实际路径：

```text
D:\path\to\Turowarp-MCP\turbowarp-mcp-server\dist\index.js
D:\path\to\Turowarp-MCP\projects
```

Windows JSON 中反斜杠写成 `\\`；`opencode.jsonc` 同样如此。

---

## 1. 准备

```powershell
cd D:\path\to\Turowarp-MCP\turbowarp-mcp-server
npm install
npm run build
npm run smoke
```

`npm run smoke` 通过后再配置客户端。服务器入口是 `dist/index.js`，**不是** `src/index.ts`。

---

## 2. MCP Inspector

### 启动

```powershell
npm run inspector
```

或：

```powershell
npx --yes @modelcontextprotocol/inspector node dist\index.js --workspace D:\path\to\Turowarp-MCP\projects
```

Windows 辅助脚本：

```powershell
powershell -ExecutionPolicy Bypass -File examples\inspect.ps1
```

### 检查项

1. 浏览器打开 <http://localhost:6274>。
2. Transport 选 `STDIO`，Command 填 `node`，Arguments 填 `dist\index.js --workspace ...`。
3. 点击 Connect，确认状态为 connected。
4. `List Tools`：应有 11 个工具，并且每个都有 inputSchema/outputSchema。
5. 调用 `new_project`（参数带 `"confirm": true`），再调用 `list_sprites`，确认能看到 Stage。
6. 调用 `get_scripts`，确认返回 AST。
7. 如果 Inspector 都失败，先不要配 Claude/OpenCode，回到 [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)。

### CLI 模式

```powershell
npx --yes @modelcontextprotocol/inspector --cli node dist\index.js --method tools/list
```

---

## 3. Claude Desktop

### 配置位置

- Windows：`%APPDATA%\Claude\claude_desktop_config.json`
- macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`

### 配置

把 [`../examples/claude-desktop.json`](../examples/claude-desktop.json) 复制过去并改成实际路径：

```json
{
  "mcpServers": {
    "turbowarp": {
      "command": "node",
      "args": [
        "D:\\path\\to\\Turowarp-MCP\\turbowarp-mcp-server\\dist\\index.js",
        "--workspace",
        "D:\\path\\to\\Turowarp-MCP\\projects",
        "--confirm",
        "destructive",
        "--dashboard-port",
        "3000"
      ],
      "env": {
        "TW_MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

### 启动与验证

1. 完全退出 Claude Desktop（包括托盘图标）。
2. 重新启动。
3. 在对话框的工具/连接器菜单中确认 `turbowarp` 已连接。
4. 让 Claude “列出当前项目的精灵” 或 “新建一个项目”，观察是否触发工具调用。
5. 写操作第一次会被要求 `confirm: true`；确认 Claude 是否会先征求你的同意。

### 常见问题

- GUI 找不到 `node`：把 `"command"` 改成 `C:\\Program Files\\nodejs\\node.exe` 的绝对路径。
- 修改配置后没生效：完全退出再启动。
- 日志：Windows `%APPDATA%\Claude\logs`；macOS `~/Library/Logs/Claude`。
- 不要把 `cwd` 当工作区；显式传 `--workspace`。

---

## 4. OpenCode V2

### 项目级配置

在项目根目录创建/修改 `opencode.jsonc`：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "turbowarp": {
        "type": "local",
        "command": [
          "node",
          "D:\\path\\to\\Turowarp-MCP\\turbowarp-mcp-server\\dist\\index.js",
          "--workspace",
          "D:\\path\\to\\Turowarp-MCP\\projects",
          "--confirm",
          "destructive",
          "--dashboard-port",
          "3000"
        ],
        "environment": {
          "TW_MCP_LOG_LEVEL": "info",
          "TW_MCP_MAX_SB3_MB": "512"
        }
      }
    }
  }
}
```

> V2 使用 `mcp.servers`；V1 的直接 `mcp.<name>` 结构在 V2 中无效。

`--dashboard-port 3000` 是可选的：它让 OpenCode 拉起的 stdio 服务器额外提供一个监控面板。启动 OpenCode 后打开 <http://127.0.0.1:3000/dashboard>。端口冲突只会让面板启动失败，不影响 MCP 工具。

### 全局配置

把同样的 `mcp.servers` 块放进 OpenCode 的全局配置文件（具体路径以 `opencode` 文档为准），或把 `opencode.jsonc` 放在项目根目录。

### 验证

```powershell
opencode mcp list
```

看到：

```text
✓ turbowarp  connected
```

然后在 OpenCode 中让 agent 调用工具。若显示 `needs authentication`，说明它把服务器当成了远程 OAuth 服务；本地 stdio 不需要认证，检查配置的 `type` 是否为 `local`。

### 注意

- `command` 是数组，不是字符串。
- 环境变量放在 `environment`，不是 `env`。
- 如果 OpenCode 找不到 node，写 `node.exe` 的绝对路径。
- 工具调用失败时先看 OpenCode 日志，再对照 [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)。

---

## 5. Ollama（通过 ollmcp）

Ollama **没有原生 MCP 客户端**。需要一个桥接程序把 MCP 工具暴露给 Ollama 模型，例如 [`mcp-client-for-ollama` (ollmcp)](https://github.com/jonigl/mcp-client-for-ollama)。

### 安装

按项目 README 安装（通常是 `pipx install mcp-client-for-ollama` 或 `pip install mcp-client-for-ollama`）。确认：

```powershell
ollmcp --version
ollama list
```

### 配置文件

使用 [`../examples/ollmcp-servers.json`](../examples/ollmcp-servers.json)：

```json
{
  "mcpServers": {
    "turbowarp": {
      "command": "node",
      "args": [
        "D:\\path\\to\\Turowarp-MCP\\turbowarp-mcp-server\\dist\\index.js",
        "--workspace",
        "D:\\path\\to\\Turowarp-MCP\\projects",
        "--confirm",
        "destructive"
      ],
      "env": {
        "TW_MCP_LOG_LEVEL": "warn"
      }
    }
  }
}
```

### 运行

```powershell
# 本地 stdio
ollmcp -j examples\ollmcp-servers.json -m qwen2.5:7b

# 或连接已经启动的 SSE 服务器
ollmcp -u http://127.0.0.1:3000/sse -m qwen2.5:7b
```

先启动服务器：

```powershell
node dist\index.js --sse --port 3000
```

### 用 CLI 添加服务器（另一种方式）

```powershell
# 本地 stdio：-- 之后是完整命令
ollmcp mcp add turbowarp -- node "D:\path\to\Turowarp-MCP\turbowarp-mcp-server\dist\index.js" --workspace "D:\path\to\Turowarp-MCP\projects"

# 远程 SSE / Streamable HTTP
ollmcp mcp add --transport sse tw-sse http://127.0.0.1:3000/sse
ollmcp mcp add --transport http tw-http http://127.0.0.1:3000/mcp

# 查看/删除
ollmcp mcp list
ollmcp mcp remove turbowarp
```

### 模型与上下文建议

- 7B 以下模型的工具调用/JSON 生成能力较弱，容易不按 schema 传参。先用 Inspector 或 Claude/OpenCode 验证服务器，再换更大的模型。
- `get_scripts` 默认读取 2000 个块；对 Ollama 建议指定 `target` 或 `max_blocks: 500`。
- SB3 编辑是多步操作（先 hat、再 append）；小模型容易忘记 `rootId`。可以在提示中明确“先调用 add_block 并记住 rootId”。
- 写操作默认需要 `confirm: true`；如果模型总是不带，考虑在受控环境设置 `TW_MCP_CONFIRM=none`，但要先理解风险。

---

## 6. 通用 HTTP 客户端

任何支持 MCP Streamable HTTP 的客户端都可以直接连接：

```text
http://127.0.0.1:3000/mcp
```

旧客户端使用：

```text
http://127.0.0.1:3000/sse
```

启动：

```powershell
node dist\index.js --http --host 127.0.0.1 --port 3000
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

返回示例：

```json
{
  "ok": true,
  "name": "turbowarp-mcp-server",
  "version": "1.0.0",
  "transport": "http",
  "transports": ["streamable-http", "sse"],
  "confirmMode": "destructive",
  "workspace": "D:\\path\\to\\projects",
  "dashboard": "http://127.0.0.1:3000/dashboard",
  "activeProject": null
}
```

注意：

- `/mcp` 是 Streamable HTTP，不是 SSE URL；`/sse` 才是旧版 SSE。
- HTTP 没有鉴权，只应绑定 loopback。
- 多个会话共享活动项目；重启后会话和活动项目都会丢失。
- 反向代理需支持流式响应；SSE 要关闭缓冲。

### 6.1 监控面板与调试

HTTP 模式直接打开：

```text
http://127.0.0.1:3000/dashboard
```

stdio 模式（Claude Desktop、OpenCode 等）加面板端口：

```powershell
node dist\index.js --workspace D:\path\to\projects --dashboard-port 3000
```

也可以在环境变量中设置 `TW_MCP_DASHBOARD_PORT=3000`。HTTP 模式下不需要 `--dashboard-port`，面板始终与 MCP 共用 `--port`。

面板数据接口：

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/api/dashboard` | GET | 服务器、连接、活动项目、工具调用、日志的 JSON 快照 |
| `/api/dashboard/clear` | POST | 清空日志和工具调用；保留连接记录和活动项目 |
| `/health` | GET | 精简健康检查，包含 `dashboard` URL |

TurboWarp Desktop 的 `(?)` 菜单 → **MCP 面板** 会加载同一个页面。默认地址是 `http://127.0.0.1:3000/dashboard`；使用其他端口时，在启动 Desktop 前设置：

```powershell
$env:TW_MCP_DASHBOARD_URL = "http://127.0.0.1:3211/dashboard"
```

如果面板显示“离线”，依次检查：

1. 服务器是否在运行，端口是否为面板地址中的端口。
2. `--dashboard-port` 是否被其他进程占用（服务器会打印 `Failed to start MCP dashboard` 警告）。
3. 是否设置过 `TW_MCP_DASHBOARD_URL` 且指向了旧端口。
4. 防火墙/代理是否拦截了 loopback 请求。

面板只保存在内存中，重启后历史记录清空；日志和工具调用都有环形缓冲区上限。

---

## 7. 客户端能力对照

| 客户端 | stdio | Streamable HTTP | SSE | 备注 |
| --- | --- | --- | --- | --- |
| MCP Inspector | ✅ | ✅ | ✅ | 首选调试工具 |
| Claude Desktop | ✅ | 视版本 | 视版本 | 本地 stdio 最稳 |
| OpenCode V2 | ✅ | ✅ | ✅ | 配置在 `mcp.servers` |
| Ollama + ollmcp | ✅ | ✅ | ✅ | Ollama 本身无原生 MCP |
| 自定义 MCP SDK 客户端 | ✅ | ✅ | ✅ | 参考 `test/smoke.mjs` |

TurboWarp Desktop 的 MCP 面板不是 MCP 客户端：它只通过 HTTP 读取 `/dashboard`，不建立 MCP 会话。

---

## 8. 最小验证清单

- [ ] `npm run build` 成功。
- [ ] `npm run smoke` 成功（stdio 全链路）。
- [ ] `npm run smoke:http` 成功（HTTP + SSE 会话）。
- [ ] Inspector 能看到 11 个工具及其 input/output schema。
- [ ] Inspector 调用 `list_blocks` 返回 142 个积木。
- [ ] 打开 `/dashboard` 能看到 11 个工具、连接状态和日志。
- [ ] 客户端配置中的入口指向 `dist/index.js`。
- [ ] 客户端能读到 `TW_MCP_WORKSPACE` 下的文件。
- [ ] 写操作能正确处理 `CONFIRMATION_REQUIRED`。
