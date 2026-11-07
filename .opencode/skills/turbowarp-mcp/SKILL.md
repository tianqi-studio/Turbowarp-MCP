---
name: TurboWarp MCP
description: 操作 TurboWarp / Scratch SB3 项目：新建、加载、查看精灵与脚本、添加精灵/积木/变量、导出 SB3、无头运行验证。包含 11 个 MCP 工具的调用顺序、确认规则、路径沙箱、积木写法、错误处理与验证清单。当用户提到 .sb3、TurboWarp、Scratch 项目、绿旗脚本或需要编辑积木时使用。
---

# TurboWarp MCP 操作指南

本技能指导你通过 `turbowarp` MCP 服务器操作 Scratch 3 / TurboWarp 的 `.sb3` 项目。服务器入口和可用工具由 MCP 配置提供；在 OpenCode Code Mode 下通过 `tools.turbowarp.<tool>` 调用，直接工具模式下名称为 `turbowarp_<tool>`。

## 何时使用

- 新建或加载 `.sb3` 项目；
- 查看/修改精灵、脚本、积木、变量；
- 把内存中的项目导出为真正的 SB3 ZIP；
- 用无头 VM 验证脚本逻辑（说话、变量、列表）。

## 环境事实

- 一个服务器进程只持有**一个活动项目**；`load_sb3` / `new_project` 会替换它。
- 编辑只改内存；只有 `export_sb3` 写磁盘。退出前必须导出。
- 默认路径沙箱是 `TW_MCP_WORKSPACE`。当前项目通常为
  `D:\编程项目\OpenCode\Turowarp-MCP\projects`；以实际配置为准。
- 默认确认策略 `destructive`：`load_sb3`、`new_project`、`add_sprite`、
  `add_block`、`set_variable`、`export_sb3` 必须带 `"confirm": true`。
- `run_headless` 默认不拦截，只有 `TW_MCP_CONFIRM=all` 时才需要确认。
- 工具完整参数见 `references/tools.md`，常用配方见 `references/recipes.md`。

## 黄金规则

1. **先读后写**：先 `list_sprites`、`get_scripts`、`list_blocks` 了解现状。
2. **写操作先征得同意**：用户没有明确要求的具体修改，不要直接传
   `confirm: true`。先说明将改什么，得到同意后再调用。
3. **不伪造成功**：写完后用 `get_scripts` / `get_variable` 复查；导出后用
   返回值、文件存在性或 `run_headless` 验证。
4. **小步编辑**：每次 `add_block` 只做一件事，保存返回的 `rootId` 和
   `blockIds` 供下一步使用。
5. **导出前检查**：确认 `missingAssets` 为空；缺少素材时默认拒绝导出。
6. **无头运行只验证逻辑**：没有渲染、音频、摄像头、云变量和 TurboWarp
   专属扩展。

## 工具速查

| 工具 | 类型 | 用途 |
| --- | --- | --- |
| `new_project` | 写 | 新建空项目（Stage + 可选 Sprite1） |
| `load_sb3` | 写 | 加载并校验 SB3，替换活动项目 |
| `list_sprites` | 只读 | 列出 Stage/精灵的属性和数量 |
| `add_sprite` | 写 | 添加精灵（PNG/SVG 造型，内置默认造型） |
| `add_block` | 写 | 添加积木，支持嵌套 reporter、子栈、菜单、变量 |
| `get_scripts` | 只读 | 读取脚本 AST 和 block id |
| `set_variable` | 写 | 设置/创建全局或局部变量 |
| `get_variable` | 只读 | 读取变量；不存在时 `found: false` |
| `export_sb3` | 写文件 | 序列化为 SB3 ZIP |
| `run_headless` | 执行 | 无头运行并采集 say/变量/列表快照 |
| `list_blocks` | 只读 | 查询内置积木注册表（142 个） |

## 标准工作流

### 新建项目

1. `new_project`：需要自带精灵时用默认 `with_default_sprite: true`；
   要自己加精灵时设 `false`，避免重名。
2. `add_sprite`：名称唯一、不能是 `Stage`。
3. `add_block` 创建绿旗/广播等 hat（`mode: "new"`），记住 `rootId`。
4. `add_block` 用 `mode: "append"` 接后续积木，`block_id` 用上一步的
   `rootId`；或继续用新返回的 `rootId` 追加到链尾。
5. `set_variable` 初始化变量（可选）。
6. `export_sb3` 写文件。
7. `run_headless` 验证 say/think 和变量快照。

### 读取/修改已有项目

1. `load_sb3`（会丢弃当前未导出的修改）。
2. `list_sprites` + `get_scripts`（必要时指定 `target`、降低 `max_blocks`）。
3. 用 `get_scripts` 返回的 block id 作为 `append` / `after` / `start` /
   `substack` 的锚点。
4. 修改后 `export_sb3`；需要时重新 `load_sb3` 验证导出文件可解析。

## `add_block` 核心规则

- `opcode` 接受完整 opcode 或注册表别名（大小写敏感），如
  `looks_say`、`say`、`control_repeat`、`repeat`。
- `mode`：
  - `new`：新建顶层脚本（hat 必须用这个模式）；
  - `append`：接到锚点所在链的末尾；
  - `after`：紧接在锚点之后，保留原后续链；
  - `start`：插到锚点之前；
  - `substack`：放进 C 型积木的 `SUBSTACK` / `SUBSTACK2`。
- `inputs` 值：
  - 标量：`"MESSAGE": "Hello"`、`"TIMES": 10`；
  - 变量：`{"variable": "score", "scope": "global"}`；
  - 列表：`{"list": "items"}`；
  - 广播：`{"broadcast": "start"}`；
  - 菜单：字符串，或 `{"menu": "costume2", "opcode": "looks_costume"}`；
  - 嵌套积木：`{"block": {"opcode": "...", ...}}`；
  - raw：`{"raw": [1, [10, "Hello"]]}`。
- `fields` 用于下拉/变量/列表/广播；变量字段写作
  `{"VARIABLE": {"variable": "score", "scope": "global"}}`。
- `substacks` 是数组，元素是同一套 block spec；只有 C 型积木支持。
- 未知 opcode 可以插入，但会返回 `UNKNOWN_OPCODE` 警告；必须自行提供
  `inputs` / `fields` / `mutation`。
- 形状限制：hat 只能 `new`；cap 必须在末尾；reporter/boolean 只能作为
  嵌套输入或单独顶层积木；menu 不能当语句。

## 变量规则

- `scope: "auto"`：目标局部变量优先，否则 Stage 全局；
  不存在时在目标上创建（精灵默认局部，Stage 默认全局）。
- `scope: "global"`：只在 Stage 上；`scope: "local"` 必须给 `target`，
  且目标不能是 Stage。
- `set_variable` 只接受字符串、有限数字、布尔、`null`；数组/对象请用列表
  或积木表达。
- `get_variable` 找不到变量不是错误，返回 `found: false`。

## 导出规则

- `path` 省略：已加载项目覆盖源文件；新项目写
  `<workspace>/<项目名>.sb3`。
- 相对路径基于 `TW_MCP_WORKSPACE`；绝对路径也必须在工作区内，除非服务器
  启动时用了 `--allow-any-path`。
- 目标父目录会自动创建；目标以目录结尾时会写入该目录。
- 缺少素材默认报 `MISSING_ASSETS`；只有确认无害时才用
  `allow_missing_assets: true`。
- 导出成功会把项目标记为 `dirty: false` 并更新 `sourcePath`。

## 无头运行规则

- `run_headless` 省略 `path` 时运行**当前内存项目**；给 `path` 时运行该文件。
- `duration_ms` 默认 3000，最大 120000；`forever` 循环会跑满时长。
- `stop_when_idle: true` 时脚本全部结束后提前停止。
- 返回值重点看：`say[]`（`type` 为 `say`/`think`）、`variables[]`、
  `lists[]`、`timedOut`、`threadCount`、`errors[]`。
- 变量值可能是字符串（如 `"100"`），比较时按 Scratch 语义处理。
- `No rendering module present` 警告是正常现象，不代表失败。
- 使用 TurboWarp 专属扩展的项目可能 `HEADLESS_LOAD_FAILED`；编辑和导出
  仍然可用。

## 错误处理

| 错误码 | 处理 |
| --- | --- |
| `CONFIRMATION_REQUIRED` | 先向用户说明修改，得到同意后带 `confirm: true` 重试 |
| `NO_PROJECT` | 先 `new_project` 或 `load_sb3` |
| `TARGET_NOT_FOUND` / `AMBIGUOUS_TARGET` | 用 `list_sprites` 获取精确名称 |
| `DUPLICATE_NAME` / `INVALID_NAME` | 换一个唯一、非 `Stage` 的名称 |
| `PATH_OUTSIDE_WORKSPACE` | 改用工作区内路径；导出到工作区后再用文件工具复制 |
| `FILE_NOT_FOUND` / `FILE_READ_FAILED` | 检查路径、权限和文件是否存在 |
| `SB3_PARSE_ERROR` | 只支持 SB3；先用 TurboWarp 另存为 SB3 |
| `MISSING_ASSETS` | 补回素材，或明确允许缺失后再导出 |
| `INVALID_BLOCK_SPEC` / `INVALID_INPUT_BLOCK` | 检查 `inputs` 包装和积木形状；查 `references/tools.md` |
| `INVALID_HAT` / `INVALID_STATEMENT` / `INVALID_CAP` | 按积木形状调整插入模式 |
| `BLOCK_NOT_FOUND` / `MISSING_ANCHOR` | 重新 `get_scripts` 获取有效 block id |
| `NOT_A_C_BLOCK` / `UNSUPPORTED_SUBSTACK` | 确认目标确实是 C 型积木且子栈名正确 |
| `VARIABLE_NOT_FOUND` / `AMBIGUOUS_VARIABLE` / `INVALID_SCOPE` | 明确 `target` 和 `scope` |
| `HEADLESS_LOAD_FAILED` | 项目含不支持的扩展；不要声称运行成功 |
| `HEADLESS_DEPENDENCY_*` | 在服务器目录执行 `npm install` / `npm run build` |
| `UNKNOWN_OPCODE`（警告） | 可继续，但需在 TurboWarp 中人工验证 |

## 完成前检查清单

- [ ] 修改后 `get_scripts` 能看到预期脚本和积木数量。
- [ ] 变量用 `get_variable` 复查为期望值。
- [ ] `export_sb3` 返回 `exported: true`、`missingAssets: []`，文件存在。
- [ ] 需要行为验证时 `run_headless` 捕获到预期 say/think 或变量值。
- [ ] 向用户报告实际文件路径；不要只说“完成了”。

## 明确限制

- 单活动项目、无撤销、无并发保护；HTTP 多会话共享同一项目。
- 无删除/重命名/重排精灵、造型、声音的工具。
- 自定义积木和 `control_stop` 的 mutation 需手工构造。
- 扩展积木可保留/插入，但服务器不安装扩展。
- 路径沙箱是词法检查，不解析符号链接。
- 复杂项目建议先在 TurboWarp 中搭骨架，再用 MCP 做批量/文本化修改。

更完整的边界见服务器仓库的 `turbowarp-mcp-server/docs/LIMITATIONS.md`。
