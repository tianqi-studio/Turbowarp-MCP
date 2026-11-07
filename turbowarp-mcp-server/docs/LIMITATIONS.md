# 限制与稳定性边界

本服务器把**可靠的 SB3 读写**放在第一位。积木级编辑和无头运行是“尽量可用”，不是 TurboWarp 编辑器的完整替代。

---

## 1. 项目模型

- **单活动项目**：一个服务器进程只持有一个项目。`load_sb3`/`new_project` 会替换它，且没有内置撤销。
- **内存态**：编辑只改内存；只有 `export_sb3` 写磁盘。服务器退出时未导出的修改会丢失。
- **HTTP 共享**：所有 Streamable HTTP / SSE 会话共享同一个活动项目。多个 AI 客户端同时编辑会互相覆盖。
- **无并发保护**：没有文件锁或版本冲突检测。多实例操作同一个文件时请自行协调。

---

## 2. SB3 格式与解析

- 只接受 **SB3（`projectVersion === 3`）**。SB1/SB2 会返回 `SB3_PARSE_ERROR`；请先在 TurboWarp Desktop 中另存为 SB3。
- 解析器是 TurboWarp 的 `scratch-parser` 分支；它比官方 LLK 版本更宽松，但仍会校验 JSON Schema。严重损坏的项目可能无法加载。
- 加载时会调用 `normalizeProject` 补齐缺省字段（`variables`、`lists`、`costumes`、`rotationCenterX` 等）。未知的项目/目标字段会保留，但缺省值可能让文件与原始字节不完全一致。
- 导出的 ZIP 会保留原始素材字节，但 `project.json` 会重新序列化（默认不缩进）。因此“加载后立即导出”不保证与原文件逐字节相同。
- `meta.semver` 如果不是 `3.x.y` 会被改为 `3.0.0`；`meta.vm/agent` 等字段保留。
- 扩展列表 `extensions` 会原样保留，但服务器不安装扩展。

---

## 3. 素材

- 加载/导出时素材按 `md5ext` 原样保存；不会重新编码图片或音频。
- `add_sprite` 只支持 **PNG** 和 **SVG** 造型；GIF/JPEG/WebP 等会返回 `UNSUPPORTED_COSTUME`。
- 没有独立的造型/声音编辑工具：不能重命名、删除、切换造型，不能导入/编辑声音，不能编辑 Stage 背景列表。
- 没有删除/重命名/重排精灵的工具。
- 手写 SB3 或 ZIP 不完整时，`missingAssets` 会列出缺失的 `md5ext`；`export_sb3` 默认拒绝导出（可用 `allow_missing_assets` 覆盖）。
- PNG 的旋转中心按图片宽高中心估算；SVG 从 `width/height/viewBox` 推断。复杂 SVG 的视觉中心可能需要人工调整。

---

## 4. 积木编辑（不稳定区域）

- 注册表覆盖 **142 个非菜单积木**（标准 Scratch 3 + 部分 TurboWarp），但不是完整的 TurboWarp/扩展目录。
- 未知 opcode 可以插入，但只会得到 `UNKNOWN_OPCODE` 警告；输入默认值、菜单影子块、mutation 都需要用户自行提供。
- **自定义积木**（`procedures_definition`/`procedures_call`/prototype/argument id）没有高级封装；请先在 TurboWarp 中创建，或用 raw mutation 手工构造。
- **`control_stop`** 的 `mutation.hasnext` 没有自动生成；“stop other scripts in sprite” 这类选项请在 TurboWarp 中检查/补全。
- 扩展积木的字段/输入名可能与注册表不同；用 `{ "raw": [..] }` 或 `{ "value": ..., "type": ... }` 保留控制。
- 菜单影子块依赖目标当前造型/声音/广播；空项目没有声音时，`sound_play` 的菜单值可能为空。
- 积木坐标只对顶层脚本有意义；嵌套积木没有独立坐标。服务器不会做自动布局优化。
- block id 是随机 20 位十六进制；除显式传入 `id` 外，不保证跨导出稳定。
- 没有撤销、重做、拖拽、注释、变量监视器布局等编辑器功能。

> 推荐流程：`get_scripts` 检查 → 小步 `add_block` → `export_sb3` → 在 TurboWarp Desktop 中打开验证。复杂项目优先“在 TurboWarp 中搭骨架，用 MCP 做批量/文本化修改”。

---

## 5. 变量与列表

- `set_variable`/`get_variable` 只处理**标量**：字符串、有限数字、布尔、`null`。数组/对象会被拒绝。
- 没有独立的列表编辑工具；可以通过 `add_block` 的 `{"list":"items"}` 创建/引用列表，并在无头运行快照中读取列表。
- 云变量（`isCloud: true`）可以读取/保留，但不会连接 Scratch 云服务；无头运行也不会同步。
- 变量名解析：精确匹配优先，唯一的大小写不敏感匹配次之；同名多处会返回 `AMBIGUOUS_*`。
- 新建变量默认在 Stage（全局）；`scope=local` + `target` 才创建精灵局部变量。

---

## 6. 无头运行（`run_headless`）

使用 **vanilla `scratch-vm@5`** 的 Node 构建，不加载 TurboWarp 的渲染器、音频引擎或扩展运行环境。

### 支持

- 绿旗启动、普通 Scratch 3 积木逻辑；
- 变量、列表、广播、克隆（逻辑层面）；
- `SAY`/`think` 事件捕获；
- 变量/列表/监视器快照；
- turbo 模式、空闲提前结束、最长 120 秒。

### 不支持/不可靠

- **渲染**：没有 WebGL/Canvas，造型不会真正绘制；`looks_*` 的视觉效果无法验证。控制台会出现 `No rendering module present` 警告。
- **音频**：没有音频引擎；声音播放、音量、音效不可验证。
- **摄像头/视频/麦克风**：`videoSensing`、`sensing_loudness` 等无法工作。
- **云变量**：不连接云服务。
- **TurboWarp 专属积木/扩展**：`scratch-vm` 不认识，`loadProject` 可能直接失败（`HEADLESS_LOAD_FAILED`）；自定义扩展也不会被加载。
- **交互**：`ask and wait`、键盘/鼠标输入不会有人响应，可能一直等待到超时；`sensing_keypressed`/`mousedown` 取决于运行时默认状态。
- **计时**：使用真实时间；不同机器上的 `wait`/`timer` 结果可能不同。
- **视觉效果**：`say` 文本能捕获，但气泡位置、图层、旋转样式、碰撞检测（依赖渲染器）可能不准确或不可用。
- **监视器**：只对运行时实际创建的监视器做快照；显示/隐藏状态不保证与编辑器一致。

### 资源与安全

- `forever` 循环会跑满 `duration_ms`（默认 3 秒，最大 120 秒）。
- 恶意项目可能消耗大量 CPU/内存（例如超大列表、深度递归/克隆）。服务器没有操作系统级沙箱。
- 不要在承载敏感数据的机器上运行不可信项目；需要强隔离时请使用容器/虚拟机。
- 运行结束会 `stopAll()` + `quit()` 清理定时器；如果 VM 模块本身有未释放的句柄，进程可能仍需要退出。

---

## 7. HTTP / SSE

- 没有身份认证、授权、速率限制或 TLS。
- 默认只绑定 `127.0.0.1`，只允许 loopback Origin；`TW_MCP_ALLOW_ORIGIN` 可追加允许的 Origin（逗号分隔，`*` 表示全部）。
- 会话保存在内存中；服务器重启后全部丢失。
- 请求体上限 8 MiB（JSON-RPC 层；SB3 文件上限由 `TW_MCP_MAX_SB3_MB` 控制）。
- 单活动项目意味着 HTTP 更适合“一个编辑器 + 一个 AI 客户端”，不适合多租户。

---

## 8. 路径与平台

- 路径沙箱是**词法检查**：`path.relative` 判断是否位于工作区。符号链接、Windows junction、8.3 短路径等可能绕过；不要依赖它隔离不可信用户。
- Windows 路径、中文路径、空格路径均可用；在 JSON 中反斜杠必须写成 `\\`。
- 不自动创建 `TW_MCP_WORKSPACE`；启动前请确保目录存在。
- 超长路径可能受 Windows 260 字符限制影响（取决于系统策略）。
- `~` 会展开为用户主目录，但仍受工作区沙箱约束。

---

## 9. 兼容性

| 组件 | 版本/说明 |
| --- | --- |
| MCP | 2025 协议；SDK `@modelcontextprotocol/sdk` 1.32.x |
| SB3 | `projectVersion` 3；`meta.semver` 3.x |
| TurboWarp Desktop | 仓库根目录的克隆；导出/导入建议使用较新版本 |
| `scratch-vm` | `^5.0.300`（Node CJS 构建） |
| `scratch-storage` | `^4.1.27` |
| `scratch-parser` | `github:TurboWarp/scratch-parser#master` |
| Node.js | >= 20（验证：25.2.1） |

TurboWarp Desktop 的版本升级可能改变 SB3 的扩展字段或默认值；如果遇到加载失败，请先用 TurboWarp 另存为 SB3，再对比 `project.json`。

---

## 10. 已知问题 / 后续可改进

- 没有列表编辑、声音/造型编辑、精灵删除/重命名工具。
- 自定义积木和 `control_stop` mutation 需要手工处理。
- 无头模式使用 vanilla `scratch-vm`，不是 TurboWarp 的完整运行时。
- HTTP 无鉴权、无持久化、无多项目隔离。
- 路径沙箱不解析符号链接。
- `get_scripts` 默认 2000 块上限；超大项目需要分批读取。
- `scratch-vm` 的 Node 构建版本与 TurboWarp Desktop 内置 VM 可能存在行为差异。
