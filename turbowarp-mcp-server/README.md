# TurboWarp MCP Server

一个面向 **TurboWarp / Scratch 3 (`.sb3`)** 的 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器。它让 AI 客户端可以读取、创建、编辑、导出并在无头环境中运行 SB3 项目。

- 传输：默认 **stdio**；同时提供 **MCP Streamable HTTP**（`/mcp`）和旧版 **SSE**（`/sse`）。
- 解析：使用 TurboWarp 维护的 [`scratch-parser`](https://github.com/TurboWarp/scratch-parser) 分支，而不是自己写 ZIP/JSON 解析器。
- 原生 SB3：直接读写真实 SB3 ZIP，保留原始素材字节。
- 无头运行：使用 `scratch-vm` 的 Node 构建，能捕获说/思考事件、变量、列表和监视器快照。
- 每个工具都同时注册 **inputSchema** 和 **outputSchema**；完整的实时 JSON Schema 见 [`docs/tools.schema.json`](docs/tools.schema.json)。
- 写操作默认需要显式 `"confirm": true`，并且工具带有 MCP `readOnlyHint` / `destructiveHint` 注解。
- 内置**监控面板**：在浏览器或 TurboWarp Desktop 中查看连接状态、活动项目、工具调用和实时日志。

> TurboWarp Desktop 的克隆位于仓库根目录；MCP 服务器位于 `turbowarp-mcp-server/`。两者互不覆盖。

---

## 1. 功能一览

| 工具 | 类型 | 作用 |
| --- | --- | --- |
| `load_sb3` | 修改状态 | 读取并校验一个 SB3 文件，设为当前活动项目。 |
| `new_project` | 修改状态 | 在内存中新建空项目（含 Stage，可选默认 Sprite1）。 |
| `list_sprites` | 只读 | 列出 Stage / 精灵的位置、尺寸、造型、脚本数量等。 |
| `add_sprite` | 修改状态 | 添加精灵，支持 PNG/SVG 造型和初始属性。 |
| `add_block` | 修改状态 | 向 Stage/精灵添加积木，支持嵌套 reporter、变量、广播和 C 型积木子栈。 |
| `get_scripts` | 只读 | 以结构化 AST + 文本形式读取脚本，返回 block id 供后续编辑。 |
| `set_variable` | 修改状态 | 设置/创建变量，支持全局与精灵局部作用域。 |
| `get_variable` | 只读 | 读取变量的值、id、作用域、云变量标记。 |
| `export_sb3` | 写文件 | 把活动项目序列化为真正的 SB3 ZIP。 |
| `run_headless` | 执行代码 | 用 `scratch-vm` 无头运行项目并收集运行快照。 |
| `list_blocks` | 只读 | 列出内置积木注册表（142 个非菜单积木）。 |

完整的参数、返回值和示例见 [`docs/TOOLS.md`](docs/TOOLS.md)。积木写法见 [`docs/BLOCKS.md`](docs/BLOCKS.md)。

---

## 2. 环境要求

- Node.js **20 或更高**（本机验证版本：25.2.1）。
- npm 10 或更高。
- Git（`scratch-parser` 通过 GitHub 依赖安装）。
- Windows、Linux、macOS 均可。Windows 路径和反斜杠已支持。

第一次安装会下载 `scratch-vm`、`scratch-storage` 和 TurboWarp 的 `scratch-parser`，大约需要几分钟。

---

## 3. 安装与构建

```powershell
cd D:\编程项目\OpenCode\Turowarp-MCP\turbowarp-mcp-server
npm install
npm run build
```

构建输出在 `dist/`。可以先用 `npm run smoke` 做一次完整的 stdio 端到端测试（新建 → 编辑 → 导出 → 重新加载 → 无头运行）。

```powershell
npm run smoke
npm run smoke:http
```

---

## 4. 启动

### 4.1 stdio（推荐）

```powershell
node dist\index.js
# 或
npm start
# 或
scripts\start-stdio.cmd
```

stdin/stdout 用于 JSON-RPC，所有日志都写到 stderr。不要在 stdio 模式下向 stdout 打印任何内容；服务器已经重定向了 `console.log/info/debug`。

### 4.2 Streamable HTTP

```powershell
node dist\index.js --http --host 127.0.0.1 --port 3000
# 或
scripts\start-http.cmd --port 3000
```

端点：

| 路径 | 说明 |
| --- | --- |
| `/mcp` | MCP Streamable HTTP（POST/GET/DELETE） |
| `/sse` | 旧版 SSE 连接入口 |
| `/messages?sessionId=<id>` | 旧版 SSE 消息 POST 入口 |
| `/health` | 健康检查、当前活动项目、确认策略 |
| `/dashboard` | 浏览器监控面板（中文 UI） |
| `/api/dashboard` | 面板 JSON 快照（连接、调用、日志） |
| `/api/dashboard/clear` | `POST` 清空日志和工具调用记录 |

HTTP 服务器默认只监听 `127.0.0.1`，并且只允许 loopback Origin。多个 HTTP/SSE 会话共享**同一个活动项目**（单项目模型），适合在编辑器/代理之间共享状态。

### 4.3 旧版 SSE

```powershell
node dist\index.js --sse --port 3000
```

启动后仍然同时提供 `/mcp` 和 `/sse`；`--sse` 只是把默认传输切换为 SSE 并打印对应地址。

### 4.4 端口和并发

- `--port 0` 会随机选择空闲端口，实际地址打印在 stderr。
- HTTP 模式没有内置鉴权。不要绑定到公网地址；如果必须跨机器使用，请放在带认证的反向代理后面。
- 单进程只有一个活动项目。需要并行处理多个项目时，启动多个服务器实例并使用不同的工作目录/端口。

### 4.5 监控面板（Dashboard）

HTTP 模式会自动在同一个端口提供监控面板：

```powershell
node dist\index.js --http --port 3000
# 浏览器打开 http://127.0.0.1:3000/dashboard
```

stdio 模式（例如 Claude Desktop、OpenCode 直接拉起服务器）可以额外开一个**只提供面板**的 HTTP 端口：

```powershell
node dist\index.js --dashboard-port 3000
# 或设置 TW_MCP_DASHBOARD_PORT=3000
```

`--dashboard-port` 只暴露 `/dashboard`、`/api/dashboard`、`/api/dashboard/clear` 和 `/health`，不会暴露 `/mcp` 或 `/sse`。端口被占用时只记录一条警告，不会阻止 stdio MCP 服务器启动。

面板每 1.5 秒轮询一次，显示：

- 活动连接数、会话/客户端名称、传输方式、最近活动；
- 当前活动项目及其未导出修改状态；
- 可用的 11 个工具（即使还没有客户端连接）；
- 最近的工具调用、耗时、成功/错误码；
- 实时日志（DEBUG/INFO/WARN/ERROR，可搜索、可过滤）。

“清空日志”按钮只清空日志和工具调用缓冲区，保留连接记录和活动项目。遥测数据保存在内存中，重启服务器后消失；日志缓冲区有上限，超长字段会被截断。

**TurboWarp Desktop 面板**：本项目根目录的 Desktop 克隆提供 `(?)` 菜单 → **MCP 面板**（macOS 菜单栏：`MCP Panel`）。它默认加载 `http://127.0.0.1:3000/dashboard`；如果服务器不可达，会显示本地离线页并提供“重新连接”按钮。服务器使用其他端口时，在启动 Desktop 前设置：

```powershell
$env:TW_MCP_DASHBOARD_URL = "http://127.0.0.1:3211/dashboard"
```

Desktop 开发构建在仓库根目录执行：

```powershell
npm install
$env:NODE_OPTIONS = "--openssl-legacy-provider"   # Node 17+ / OpenSSL 3（webpack 4）
npm run webpack:compile
npm run electron:start
```

仅验证面板不需要 `npm run fetch`；如果需要完整素材库、扩展或打包器，再执行 `npm run fetch`。

---

## 5. 配置

优先级：命令行参数 > 环境变量 > 默认值。

| 命令行 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--transport <stdio\|http\|sse>` | `TW_MCP_TRANSPORT` | `stdio` | 传输方式。 |
| `--stdio` / `--http` / `--sse` | - | - | 传输方式简写。 |
| `--host <host>` | `TW_MCP_HOST` | `127.0.0.1` | HTTP/SSE 绑定地址。 |
| `--port <port>` | `TW_MCP_PORT` | `3000` | HTTP/SSE 端口；`0` 表示随机。 |
| `--dashboard-port <port>` | `TW_MCP_DASHBOARD_PORT` | 关闭 | 额外的只读监控面板端口（stdio 模式常用）；`0` 表示随机。 |
| `--workspace <dir>` | `TW_MCP_WORKSPACE` | 当前目录 | 相对路径的解析根目录，也是路径沙箱。 |
| `--allow-any-path` | `TW_MCP_ALLOW_ANY_PATH=1` | 关闭 | 关闭路径沙箱（不推荐）。 |
| `--confirm <all\|destructive\|none>` | `TW_MCP_CONFIRM` | `destructive` | 写操作确认策略。 |
| `--max-sb3-mb <n>` | `TW_MCP_MAX_SB3_MB` | `512` | SB3/造型文件大小上限（MiB）。 |
| `--log-level <debug\|info\|warn\|error>` | `TW_MCP_LOG_LEVEL` | `info` | stderr 日志级别。 |
| `--vm-module <module>` | `TW_MCP_VM_MODULE` | `scratch-vm` | 无头 VM 的 CommonJS 模块名/路径。 |
| `-h`, `--help` | - | - | 帮助。 |
| `-v`, `--version` | - | - | 版本。 |

### 确认策略

| 模式 | 被拦截的工具 |
| --- | --- |
| `all` | 所有写操作 + `run_headless` |
| `destructive`（默认） | `load_sb3`、`new_project`、`add_sprite`、`add_block`、`set_variable`、`export_sb3` |
| `none` | 不拦截（只建议在隔离的自动化环境中使用） |

被拦截时工具返回 `isError: true`，文本包含 `CONFIRMATION_REQUIRED`，并且**不会发生任何修改**。AI 客户端应先向用户说明将要做的修改，然后携带 `"confirm": true` 重试。

> 确认是服务器端的硬性门槛，不是提示文案。但它不能替代用户审查：客户端/代理仍可能自动批准工具调用。

### 路径沙箱

默认所有相对路径基于 `TW_MCP_WORKSPACE` 解析；绝对路径也必须位于该目录内，否则返回 `PATH_OUTSIDE_WORKSPACE`。这是词法路径检查，不能防御符号链接/目录联接穿越；不要把工作区指向不可信目录。

```powershell
node dist\index.js --workspace D:\scratch-projects
```

---

## 6. MCP 客户端配置

完整的客户端说明（Claude Desktop、OpenCode V2、Ollama + `ollmcp`、MCP Inspector）见 [`docs/MCP-CLIENTS.md`](docs/MCP-CLIENTS.md)。可直接复制的示例：

- [`examples/claude-desktop.json`](examples/claude-desktop.json)
- [`examples/opencode.jsonc`](examples/opencode.jsonc)
- [`examples/ollmcp-servers.json`](examples/ollmcp-servers.json)
- [`examples/inspect.ps1`](examples/inspect.ps1)

最小 Claude Desktop 配置：

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
      ]
    }
  }
}
```

最小 OpenCode V2 配置（注意 V2 使用 `mcp.servers`，不是 `mcp` 下面直接写名字）：

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
          "D:\\path\\to\\Turowarp-MCP\\projects"
        ],
        "environment": { "TW_MCP_CONFIRM": "destructive" }
      }
    }
  }
}
```

Ollama 本身没有原生 MCP 客户端，使用 [`ollmcp`](https://github.com/jonigl/mcp-client-for-ollama) 作为桥接：

```powershell
ollmcp -j examples\ollmcp-servers.json -m qwen2.5:7b
```

---

## 7. 推荐工作流

1. `new_project` 或 `load_sb3`（需要 `confirm: true`）。
2. `list_sprites` 查看目标；`get_scripts` 查看已有脚本和 block id。
3. `add_sprite` / `add_block` / `set_variable` 编辑。
4. `export_sb3` 写出磁盘上的 SB3。
5. `run_headless` 做逻辑冒烟测试，检查 say/think 和变量快照。

示例：创建一个会说话的脚本

```jsonc
// 1. add_block: 绿旗 hat
{ "target": "Sprite1", "opcode": "event_whenflagclicked", "mode": "new", "confirm": true }

// 2. add_block: 在 hat 后追加 say
{
  "target": "Sprite1",
  "opcode": "looks_say",
  "mode": "append",
  "block_id": "<上一步返回的 rootId>",
  "inputs": { "MESSAGE": "你好，TurboWarp！" },
  "confirm": true
}
```

更多积木示例（嵌套 reporter、变量、列表、广播、`repeat`/`if_else` 子栈）见 [`docs/BLOCKS.md`](docs/BLOCKS.md)。

---

## 8. 无头运行说明

`run_headless` 使用 **vanilla `scratch-vm`** 的 Node 构建，不加载渲染器、音频、摄像头、视频或云变量。它会：

- 触发绿旗；
- 捕获 `SAY`/`think` 事件；
- 在结束时快照变量、列表和监视器；
- 默认在脚本空闲时提前结束，否则运行到 `duration_ms`；
- 运行结束后 `stopAll()` + `quit()` 清理定时器。

因此它适合验证逻辑，**不适合验证画面、声音、摄像头或 TurboWarp 专属积木**。详见 [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)。

---

## 9. 调试流程

1. **构建**：`npm run build`。
2. **监控面板**：HTTP 模式打开 `http://127.0.0.1:3000/dashboard`；stdio 模式加 `--dashboard-port 3000` 后打开同样地址，先确认服务器在线、工具列表和日志正常。
3. **MCP Inspector**：`npm run inspector`，在浏览器中连接 stdio，先跑 `tools/list`，再逐个调用只读工具。
4. **Claude Desktop**：把 `examples/claude-desktop.json` 的路径改成实际路径，重启客户端，检查 MCP 日志。
5. **OpenCode V2**：把配置写入 `opencode.jsonc`，运行 `opencode mcp list` 确认 connected。
6. **Ollama**：用 `ollmcp -j ... -m ...` 启动桥接；本地小模型的工具调用能力有限，建议先用 Inspector 验证。

排查步骤见 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)。

---

## 10. 目录结构

```text
turbowarp-mcp-server/
├─ src/
│  ├─ index.ts              # CLI 入口、stdio/HTTP 启动、信号处理
│  ├─ server.ts             # MCP Server 与 11 个工具注册
│  ├─ http.ts               # Streamable HTTP / SSE / health / dashboard 路由
│  ├─ dashboard.ts          # 自包含监控面板 HTML 与快照构建
│  ├─ telemetry.ts          # 内存环形缓冲区、连接注册、工具调用埋点
│  ├─ config.ts             # 参数、环境变量、帮助文本
│  ├─ scratch/              # SB3 解析、项目模型、积木、变量、AST
│  ├─ headless/runner.ts    # scratch-vm 无头执行
│  ├─ tools/                # 每个 MCP 工具的实现
│  └─ utils/                # 路径、ID、JSON 工具
├─ scripts/                 # 启动/导出 schema 脚本
├─ test/                    # stdio 与 HTTP 冒烟测试
├─ examples/                # 客户端配置示例
├─ docs/                    # 工具、积木、限制、排错、客户端文档
├─ package.json
└─ tsconfig.json
```

---

## 11. 文档索引

- [`docs/TOOLS.md`](docs/TOOLS.md) — 每个工具的输入、输出、错误码和调用示例。
- [`docs/BLOCKS.md`](docs/BLOCKS.md) — `add_block` 的积木写法、别名、嵌套、子栈、raw 转义。
- [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — 不稳定的积木/无头限制、兼容性边界。
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — stdio 污染、路径、Windows 换行、SB3 版本、安装失败。
- [`docs/MCP-CLIENTS.md`](docs/MCP-CLIENTS.md) — Inspector、Claude Desktop、OpenCode、Ollama、HTTP 客户端。
- [`docs/tools.schema.json`](docs/tools.schema.json) — 由运行中的服务器导出的完整工具 JSON Schema。

---

## 12. 安全与稳定性

- 所有写操作都有确认门槛，默认只允许工作区内的路径。
- HTTP 模式没有鉴权，默认只绑定 loopback；不要直接暴露到公网。
- 监控面板同样没有鉴权，会显示日志和工具参数摘要；仅在可信环境中使用，不要暴露到公网。
- 活动项目保存在内存中；服务器退出前请先 `export_sb3`。
- 未知扩展积木可以原样保留/插入，但服务器不会安装或执行扩展代码；`run_headless` 无法加载 TurboWarp 专属扩展。
- 详见 [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)。
