# 故障排查

先做三件事：

1. `npm run build`，确认没有 TypeScript 错误。
2. `npm run smoke`，确认服务器本身在 stdio 下能完整跑通。
3. 用 `npm run inspector` 连接，排除客户端配置问题。

服务器日志全部写到 **stderr**。需要更多信息时加 `--log-level debug`；需要堆栈时设置 `TW_MCP_DEBUG=1`。

---

## 1. stdio 协议被污染

### 症状

- 客户端报 `Unexpected token ... in JSON`、`Unexpected end of JSON input`；
- Inspector 一直 connecting；
- Claude Desktop/OpenCode 显示 server disconnected；
- 日志里混入了非 JSON-RPC 文本。

### 原因

stdio 模式下 **stdout 是 JSON-RPC 专用通道**。任何库/脚本向 stdout 打印内容都会破坏协议。

### 排查

```powershell
# 只启动服务器，手动发一条 initialize，观察 stdout 是否只有 JSON
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' | node dist\index.js --log-level debug 1> out.txt 2> err.txt
Get-Content out.txt
Get-Content err.txt
```

`out.txt` 里应该只有一行 JSON 响应；日志应全部在 `err.txt`。

### 处理

- 不要用 `echo`、`Write-Host` 或批处理 `@echo` 包装 stdio 服务器；启动脚本不要把提示信息写到 stdout（本项目脚本在必要时写 stderr）。
- 自定义插件/扩展不要调用 `console.log`；服务器已在 stdio 模式重定向 `console.log/info/debug` 到 stderr，但第三方库可能绕过。
- 不要把 `npm install`、`npm run build` 的输出接到服务器的 stdout。
- 如果使用 `npx`，确认没有 `npm` 的 “Need to install...” 提示混入 stdout；先全局/本地安装再启动。

---

## 2. 路径问题（Windows / 中文 / 空格）

### `PATH_OUTSIDE_WORKSPACE`

默认沙箱是 `TW_MCP_WORKSPACE`（未设置时是启动目录）。相对路径基于它解析，绝对路径也必须位于它内部。

```powershell
node dist\index.js --workspace D:\scratch-projects
```

或在 MCP 配置中设置：

```json
"env": { "TW_MCP_WORKSPACE": "D:\\scratch-projects" }
```

确实需要任意路径时（仅限可信本机）：

```powershell
node dist\index.js --allow-any-path
```

### JSON 中的反斜杠

Windows 路径必须转义：

```json
{ "path": "D:\\编程项目\\OpenCode\\Turowarp-MCP\\projects\\demo.sb3" }
```

也可以使用正斜杠：

```json
{ "path": "D:/编程项目/OpenCode/Turowarp-MCP/projects/demo.sb3" }
```

### 中文/空格路径

Node 和 `scratch-parser` 都支持 UTF-8 路径。确保：

- JSON 文件保存为 UTF-8（不带 BOM）；
- 客户端本身没有对路径做 URL 编码或 shell 拆分；
- PowerShell 中给含空格的路径加引号。

### `ENOENT` / `EISDIR`

- 加载时文件必须存在；
- `export_sb3` 的父目录会自动创建，但如果目标是一个已存在的目录，服务器会尝试把文件写进该目录；请确认路径以 `\` 或 `/` 结尾，或直接传给目录。
- 工作区目录本身不会自动创建；先 `New-Item -ItemType Directory`。

### 长路径

Windows 默认 260 字符限制可能导致 `ENAMETOOLONG`/`ENOENT`。缩短工作区路径，或启用系统长路径策略。

---

## 3. Windows 换行 / 编码

- JSON 中的换行写成 `\n` 即可；`JSON.stringify` 输出的是 LF，Scratch/TurboWarp 两种换行都能读取。
- 导出的 `project.json` 是 UTF-8、无 BOM。不要用记事本另存为 UTF-16。
- 文本输入里的 `\r\n` 会原样保留在字符串中；如果显示异常，改用 `\n`。
- `.cmd` 启动脚本本身使用 CRLF 没问题；`.sh` 脚本在 Git for Windows 下建议保持 LF。
- 如果手动编辑导出的 `project.json`，编辑后必须重新 ZIP；不要把解压目录直接当 SB3。

---

## 4. SB3 版本 / 解析错误

### `SB3_PARSE_ERROR`

常见原因：

- 文件不是 ZIP，或 ZIP 内没有 `project.json`；
- `project.json` 不是合法 JSON；
- `projectVersion` 不是 3（SB1/SB2）；
- 项目 JSON 不符合 Scratch 3 Schema（例如手工删除字段、字段类型错误）；
- TurboWarp 扩展字段与解析器版本不匹配。

处理：

1. 用 TurboWarp Desktop 打开并“另存为 SB3”；
2. 用 `unzip` 检查 `project.json` 是否存在、是否是 UTF-8；
3. 看错误里的 `instancePath`/`message`，定位字段；
4. 如果是 TurboWarp 新版本的项目，试试更新本服务器的 `scratch-parser` 依赖。

### `MISSING_ASSETS`

`project.json` 引用了 `md5ext`，但 ZIP 里没有对应文件。导出默认拒绝，避免生成打不开的项目。补回素材，或明确：

```json
{ "path": "out.sb3", "allow_missing_assets": true, "confirm": true }
```

### 扩展

服务器不安装扩展。带扩展的项目可以加载/导出/读取脚本；`run_headless` 是否成功取决于 `scratch-vm` 是否认识这些 opcode。TurboWarp 专属积木通常需要 TurboWarp 运行时。

---

## 5. npm 安装失败

### `git` / GitHub 依赖失败

`scratch-parser` 来自 `github:TurboWarp/scratch-parser#master`。如果公司网络/代理阻止 GitHub：

```powershell
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
npm config set proxy http://127.0.0.1:7890
npm config set https-proxy http://127.0.0.1:7890
npm install
```

或者：

- 用 `HTTPS_PROXY`/`HTTP_PROXY` 环境变量；
- 在可联网机器上 `npm pack`/克隆后，把 `package.json` 的依赖改成 `file:` 本地路径；
- 确认 `git --version` 可用、证书没有过期。

### Node 版本

要求 Node >= 20。`node --version` 检查；Windows 上用 nvm-windows 或官方安装包切换。

### `EACCES` / 文件占用

- 不要同时运行多个 `npm install`；
- 关闭占用 `node_modules` 的编辑器/杀毒扫描；
- 删除 `node_modules` 和 `package-lock.json` 后重试。

### 安装很慢

`scratch-vm` 依赖较多，首次安装 2–5 分钟正常。可以使用国内镜像加速普通 npm 包，但 GitHub 依赖仍需能访问 GitHub。

---

## 6. 构建错误

```powershell
npm run clean
npm install
npm run build
```

- `TS6133`：未使用的 import/变量；删除或使用它。
- `TS2322`/`TS2352`：类型不匹配；不要用 `as any` 掩盖，先确认 SB3 字段结构。
- `Cannot find module '...'`：确认 `npm install` 完整，且 import 带 `.js` 后缀（NodeNext ESM）。
- 修改 `src` 后必须重新 `npm run build`；MCP 客户端运行的是 `dist/index.js`，不是 `src`。

---

## 7. MCP Inspector

```powershell
npm run inspector
# 等价于
npx @modelcontextprotocol/inspector node dist\index.js --workspace D:\scratch-projects
```

- 默认 UI：<http://localhost:6274>。
- 在 Inspector 中先 `Connect`，再 `List Tools`。
- 如果 `npx` 询问是否安装，输入 `y`；或先 `npm install -g @modelcontextprotocol/inspector`。
- 连接失败时，先在终端直接运行 `node dist\index.js`，确认没有启动错误。
- Inspector 的 “Command” 要填 `node`，“Arguments” 填 `dist\index.js --workspace ...`；路径有空格时用引号。
- 无浏览器/远程机器可以用 CLI 模式：

```powershell
npx @modelcontextprotocol/inspector --cli node dist\index.js --method tools/list
```

---

## 8. Claude Desktop

配置位置：

- Windows：`%APPDATA%\Claude\claude_desktop_config.json`
- macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`

常见问题：

- **找不到 `node`**：GUI 应用的 PATH 可能不含 nvm/volta。把 `"command"` 改成 `node.exe` 的绝对路径，例如 `C:\\Program Files\\nodejs\\node.exe`。
- **路径没转义**：JSON 中 `\` 要写成 `\\`。
- **修改后没重启**：完全退出 Claude Desktop（托盘也要退出）再启动。
- **日志**：Windows 在 `%APPDATA%\Claude\logs`；macOS 在 `~/Library/Logs/Claude`。
- **工作目录**：Claude Desktop 启动服务器时的 cwd 不一定是项目目录；务必在 `args` 里显式传 `--workspace`。
- **确认错误**：默认策略下写工具需要 `"confirm": true`；这是预期行为，不是连接失败。

最小配置见 [`../examples/claude-desktop.json`](../examples/claude-desktop.json)。

---

## 9. OpenCode V2

- V2 的配置结构是 `mcp.servers`，不是 V1 的 `mcp.<name>`。
- local server 的 `command` 是**数组**（命令 + 参数），环境变量放在 `environment`。
- 写项目级 `opencode.jsonc` 或全局配置；改完运行：

```powershell
opencode mcp list
```

看到 `connected` 即成功。

- 如果 OpenCode 找不到 `node`，在 `command` 里写 `node.exe` 的绝对路径。
- 工具调用被拒绝时看 OpenCode 日志；确认不是 `CONFIRMATION_REQUIRED`。
- 详细示例：[`../examples/opencode.jsonc`](../examples/opencode.jsonc)。

---

## 10. Ollama / ollmcp

Ollama 没有原生 MCP 客户端，必须通过桥接工具（如 [`ollmcp`](https://github.com/jonigl/mcp-client-for-ollama)）。

```powershell
# stdio
ollmcp -j examples\ollmcp-servers.json -m qwen2.5:7b

# 或者连接已经启动的 SSE 服务器
ollmcp -u http://127.0.0.1:3000/sse -m qwen2.5:7b
```

常见问题：

- `ollmcp` 不在 PATH：`pipx install mcp-client-for-ollama` 或按其 README 安装。
- `command`/`args` 分离错误：`mcpServers` 格式里 `command` 是字符串，`args` 是数组；不要整条命令塞进 `command`。
- 模型太小：7B 以下模型经常不会正确调用工具/生成 JSON；先用 Inspector 验证服务器，再换更大的模型。
- 上下文不足：SB3 的 `get_scripts` 输出可能很大；先指定 `target` 或降低 `max_blocks`。
- 连接 HTTP：`-u` 要指向 `/sse`（旧版 SSE）或使用支持 Streamable HTTP 的客户端；`/mcp` 不是 SSE URL。

---

## 11. HTTP / SSE

### `EADDRINUSE`

端口被占用。换端口：

```powershell
node dist\index.js --http --port 3001
```

或 `--port 0` 随机端口（实际地址看 stderr）。

### `Unknown MCP session` / 404

服务器重启后旧 `Mcp-Session-Id` 失效。重新 initialize，不要复用旧会话。

### 400 `Mcp-Session-Id is required for GET/DELETE`

Streamable HTTP 的 GET（SSE 流）和 DELETE（关闭会话）必须带 `Mcp-Session-Id`。先 POST initialize 获取响应头。

### 403 `Origin not allowed`

默认只允许 `localhost`/`127.0.0.1`/`[::1]`。确实需要其他来源时：

```powershell
$env:TW_MCP_ALLOW_ORIGIN="https://my-ui.example"
```

### SSE 连接被代理缓冲

反向代理需要关闭响应缓冲（例如 nginx `proxy_buffering off;`），否则 SSE 事件不会实时到达。

### 请求体过大

JSON-RPC 请求体上限 8 MiB；SB3 文件本身受 `TW_MCP_MAX_SB3_MB` 控制。不要把整个 SB3 塞进工具参数（工具只接受路径）。

### 监控面板打不开 / 显示离线

HTTP 模式的面板地址是 `http://<host>:<port>/dashboard`，与 MCP 共用 `--port`：

```powershell
node dist\index.js --http --port 3000
Invoke-WebRequest http://127.0.0.1:3000/api/dashboard
```

stdio 模式需要显式开启面板端口：

```powershell
node dist\index.js --dashboard-port 3000
```

排查：

- `EADDRINUSE`：面板端口被占用。stdio 服务器只会打印 `Failed to start MCP dashboard` 警告并继续运行；换一个 `--dashboard-port`。
- `--dashboard-port` 在 HTTP/SSE 模式下不会额外生效，面板始终使用 `--port`。
- TurboWarp Desktop 面板固定读取 `TW_MCP_DASHBOARD_URL`；默认是 `http://127.0.0.1:3000/dashboard`。服务器换端口后，启动 Desktop 前设置该变量。
- 面板显示 `离线` 但 `/api/dashboard` 可访问：检查反向代理是否改写了路径或阻止了轮询请求。
- Desktop 里看不到 `(?)` → **MCP 面板**：主进程代码不需要编译，但渲染层需要先在仓库根目录执行 `npm run webpack:compile`；改完 `src-renderer-webpack` 后也要重新编译。
- `npm run webpack:compile` 在 Node 17+ 报 `ERR_OSSL_EVP_UNSUPPORTED`：webpack 4 需要旧版 OpenSSL 提供程序，先设置 `$env:NODE_OPTIONS = "--openssl-legacy-provider"` 再执行。
- 面板只保存内存数据；重启服务器后日志和调用记录会清空，这是预期行为。

---

## 12. 确认错误

```text
CONFIRMATION_REQUIRED: set_variable needs explicit confirmation ...
```

这是设计行为。处理：

1. 先向用户说明修改内容；
2. 重试时带 `"confirm": true`；
3. 或者在可信的自动化环境设置 `TW_MCP_CONFIRM=none`（不推荐对交互式客户端使用）。

注意：`TW_MCP_CONFIRM=all` 还会拦截 `run_headless`；默认 `destructive` 不拦截它。

---

## 13. 无头运行错误

### `HEADLESS_DEPENDENCY_MISSING`

`scratch-vm` 或 `scratch-storage` 未安装。在服务器目录运行：

```powershell
npm install
```

### `HEADLESS_DEPENDENCY_INVALID`

模块导出的不是构造函数。确认 `TW_MCP_VM_MODULE` 指向 CommonJS 构建（例如 `scratch-vm` 的 `dist/node/scratch-vm.js`），不要指向 ESM 源码。

### `HEADLESS_LOAD_FAILED`

`scratch-vm` 无法加载项目。常见原因：

- 项目使用 TurboWarp 专属/自定义扩展；
- 项目 JSON 含 `scratch-vm` 不认识的 opcode；
- 素材缺失或损坏；
- 项目版本与 VM 不匹配。

编辑、`get_scripts`、`export_sb3` 仍然可用；只有无头运行受限。

### 没有 SAY 事件

- 脚本没有绿旗 hat，或 hat 不是 `event_whenflagclicked`；
- 说话积木没有执行到（条件为假、等待中、被 stop）；
- `duration_ms` 太短；
- 项目依赖渲染器/音频/扩展；
- 变量/列表为空导致分支未进入。

先用 `get_scripts` 确认脚本，再增加 `duration_ms`。

### `timedOut: true`

到时仍有线程在运行，通常是 `forever` 循环。可以降低 `duration_ms`，或把循环改成有限次数来测试。

### 控制台出现 `No rendering module present`

无头模式没有渲染器，加载造型时会出现该警告。它不影响逻辑运行；不要把它当失败。

---

## 14. JSON Schema / 输出校验错误

如果客户端报 `Output validation error` 或 `MCP error -32602`：

- 确认客户端使用的是 `dist/index.js` 的最新构建；
- 运行 `npm run smoke`，排除服务器自身问题；
- 运行 `npm run schemas`，用 `docs/tools.schema.json` 对照实际 schema；
- 如果修改了工具输出结构，务必同步修改对应的 `outputSchema`；
- 错误结果（`isError: true`）不参与 outputSchema 校验，这是 MCP SDK 的行为。

---

## 15. 仍然无法解决

收集以下信息：

1. `node --version`、`npm --version`、操作系统；
2. `npm run build` 和 `npm run smoke` 的完整输出；
3. 服务器 stderr（`--log-level debug`，必要时 `TW_MCP_DEBUG=1`）；
4. 客户端配置（隐藏敏感路径）；
5. 触发问题的工具名、参数（SB3 可脱敏）；
6. 最小复现项目（能在 TurboWarp 打开的最小 SB3）。
