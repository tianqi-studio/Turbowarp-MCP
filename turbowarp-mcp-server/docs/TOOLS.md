# 工具参考

所有工具都通过 MCP `tools/list` 暴露 **inputSchema** 和 **outputSchema**。完整、实时的 JSON Schema 见 [`tools.schema.json`](tools.schema.json)（可用 `npm run schemas` 重新生成）。

每个工具的结果同时包含：

- `content`: 人类可读的文本摘要（`content[0].type === "text"`）；
- `structuredContent`: 与 outputSchema 对应的机器可读对象；
- 出错时 `isError: true`，文本以错误码开头（例如 `CONFIRMATION_REQUIRED: ...`），此时不会返回 structuredContent。

---

## 通用约定

### 活动项目

服务器在内存中只保存**一个**活动项目。`load_sb3` 和 `new_project` 会替换它；其余编辑工具都作用于它。需要同时处理多个项目时，启动多个服务器实例。

### 确认

默认 `TW_MCP_CONFIRM=destructive`。被拦截的工具必须带 `"confirm": true`：

```json
{ "name": "add_block", "arguments": { "opcode": "looks_say", "confirm": true } }
```

不带确认时返回：

```text
CONFIRMATION_REQUIRED: add_block needs explicit confirmation (TW_MCP_CONFIRM=destructive).
No changes were made. Review the request first, then repeat it with `"confirm": true`.
```

### 路径

相对路径基于 `TW_MCP_WORKSPACE` 解析；绝对路径也必须位于工作区内，除非使用 `--allow-any-path`。支持 `~`、正斜杠和 Windows 反斜杠。JSON 中反斜杠要转义：`D:\\projects\\demo.sb3`。

### 目标名称

`target` 参数接受 `Stage` 或精灵名。精确匹配优先；只有唯一的大小写不敏感匹配时才会接受。重名会返回 `AMBIGUOUS_TARGET`。

---

## 1. `load_sb3`

读取并校验 SB3，设为活动项目。使用 TurboWarp 的 `scratch-parser` 分支；只支持 `projectVersion === 3`，SB1/SB2 会返回 `SB3_PARSE_ERROR`。素材字节从 ZIP 中读出并保留，导出时原样写回。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | SB3 路径。 |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true`。 |

输出：项目概览（见下）。若 ZIP 中缺少被引用的素材，`missingAssets` 会列出 `md5ext`。

```json
{ "path": "demos/hello.sb3", "confirm": true }
```

> `load_sb3` 会替换当前项目。加载后原项目的未导出修改会丢失。

---

## 2. `new_project`

在内存中创建空项目：一个 Stage（白色 SVG 背景）和可选的 `Sprite1`（内置 SVG 造型）。不会写磁盘。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `name` | string | `Untitled` | 显示名，用于默认导出文件名。 |
| `with_default_sprite` | boolean | `true` | 是否创建 Sprite1。 |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true`。 |

```json
{ "name": "My Game", "with_default_sprite": false, "confirm": true }
```

---

## 3. `list_sprites`

只读。列出 Stage 和/或所有精灵。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `include_stage` | boolean | `true` | 是否返回 Stage 的详细信息。Stage 永远不计入 `spriteCount`。 |

输出：

```jsonc
{
  "displayName": "My Game",
  "dirty": true,
  "targetCount": 2,
  "spriteCount": 1,
  "stage": { /* targetDetail | null */ },
  "sprites": [ /* targetDetail[] */ ]
}
```

`targetDetail` 包含：`name`、`isStage`、`visible`、`x`、`y`、`size`、`direction`、`draggable`、`rotationStyle`、`currentCostume`、`currentCostumeName`、`costumeCount`、`soundCount`、`blockCount`、`scriptCount`、`variableCount`、`listCount`、`costumes[]`、`sounds[]`。

---

## 4. `add_sprite`

添加精灵。名称必须唯一（大小写不敏感），不能是 `Stage` 或 `_stage_`。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 必填 | 精灵名。 |
| `costume_path` | string | - | PNG/SVG 造型路径；省略时使用内置 SVG。 |
| `costume_name` | string | 文件名 / `costume1` | 造型名。 |
| `x` / `y` | number | `0` | 初始位置。 |
| `size` | number | `100` | 初始大小（正数）。 |
| `direction` | number | `90` | 初始方向（度）。 |
| `visible` | boolean | `true` | 初始可见性。 |
| `draggable` | boolean | `false` | 编辑器可拖动。 |
| `rotation_style` | enum | `all around` | `all around` / `left-right` / `don't rotate`。 |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true`。 |

输出：`created`、`dirty`、`targetCount`、`spriteCount`、`sprite`（targetDetail）。

PNG/SVG 会被计算 MD5，写入素材表；PNG 自动读取宽高作为旋转中心，SVG 从 `width/height/viewBox` 推断。

---

## 5. `add_block`

向 Stage/精灵插入一个积木（可以带嵌套 reporter 和子栈）。详细积木写法见 [`BLOCKS.md`](BLOCKS.md)。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `opcode` | string | 必填 | 完整 opcode 或别名，如 `looks_say`、`say`、`control_repeat`。 |
| `target` | string | 首个精灵/Stage | 接收积木的目标。 |
| `inputs` | object | - | 输入映射；值可以是标量、变量、列表、广播、菜单、嵌套积木或 raw tuple。 |
| `fields` | object | - | 字段映射；支持变量/列表/广播引用和 raw tuple。 |
| `substacks` | object | - | 子栈映射，如 `{ "SUBSTACK": [...] }`。 |
| `mutation` | object | - | 原样写入 SB3 的 mutation（自定义积木/扩展积木）。 |
| `mode` | enum | `new` | `new` / `append` / `start` / `after` / `substack`。 |
| `block_id` | string | - | 锚点 block id；`append`/`start`/`after`/`substack` 必填。 |
| `substack` | string | `SUBSTACK` | `mode=substack` 时使用的输入名。 |
| `position` | enum | `end` | `substack` 内的插入位置：`start` / `end`。 |
| `x` / `y` | number | 自动 | 新顶层脚本坐标。 |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true`。 |

模式：

- `new`：新建顶层脚本（hat 或任意 stack；reporter 只能单独作为顶层积木）。
- `append`：接在锚点所在脚本的最后一个积木后面。
- `after`：紧接在 `block_id` 之后，保留原有后续链。
- `start`：紧接在 `block_id` 之前；如果锚点是顶层积木，新链继承其坐标和顶层属性。
- `substack`：放进 C 型积木的子栈，默认追加到末尾。

输出：

```jsonc
{
  "target": "Sprite1",
  "mode": "append",
  "rootId": "新链的第一个 block id",
  "blockIds": ["新链的所有 id，包括自动创建的菜单/嵌套积木"],
  "warnings": [{ "code": "UNKNOWN_OPCODE", "message": "..." }],
  "blockCount": 5,
  "scriptCount": 1,
  "dirty": true
}
```

未知 opcode 会被允许插入，但返回 `UNKNOWN_OPCODE` 警告；请自行提供 `inputs`/`fields`/`mutation` 并在 TurboWarp 中验证。

示例：给绿旗脚本追加“说 100”

```json
{
  "target": "Sprite1",
  "opcode": "looks_say",
  "mode": "append",
  "block_id": "hatBlockId",
  "inputs": { "MESSAGE": 100 },
  "confirm": true
}
```

---

## 6. `get_scripts`

只读。返回结构化脚本 AST 和紧凑文本。用于查看 block id、检查脚本、准备插入操作。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `target` | string | 全部目标 | 只读取某个 Stage/精灵。 |
| `include_stage` | boolean | `true` | 未指定 `target` 时是否包含 Stage。 |
| `max_blocks` | integer | `2000` | 解析上限（1–50000）；超过时 `truncated: true`。 |

输出：

```jsonc
{
  "displayName": "My Game",
  "dirty": false,
  "targetCount": 1,
  "totalScripts": 1,
  "totalBlocks": 4,
  "truncated": false,
  "targets": [{
    "name": "Sprite1",
    "isStage": false,
    "scriptCount": 1,
    "blockCount": 4,
    "truncated": false,
    "warnings": [],
    "scripts": [{
      "index": 0,
      "kind": "script",       // 或 "reporter"
      "rootId": "...",
      "x": 48,
      "y": 48,
      "stack": [ /* BlockAst */ ]
    }]
  }]
}
```

`BlockAst`：

```jsonc
{
  "id": "block id",
  "opcode": "looks_say",
  "shadow": false,
  "fields": { "VARIABLE": ["score", "variableId"] },
  "inputs": {
    "MESSAGE": {
      "type": "literal",       // literal | menu | block | stack | empty | shadowBlock
      "value": "Hello!",
      "primitiveType": "10"
    },
    "SUBSTACK": {
      "type": "stack",
      "stack": [ /* BlockAst[] */ ]
    }
  },
  "mutation": { "tagName": "mutation", "...": "..." },
  "error": "仅在解析异常时出现"
}
```

`inputs` 的联合类型：

- `literal`：`value` + `primitiveType`（SB3 primitive 编号）。
- `menu`：`value`、`opcode`、`fields`（菜单影子块）。
- `block`：嵌套 reporter/boolean + 可选 `shadow`。
- `stack`：C 型积木的子栈。
- `empty`：空输入（`[2, null]` 或被删除的输入）。
- `shadowBlock`：影子积木（兼容旧格式）。

块 id 可用于 `add_block` 的 `append`/`start`/`after`/`substack`。

---

## 7. `set_variable`

设置或创建变量。遵循 Scratch 作用域规则：精灵局部变量遮蔽同名全局变量；全局变量属于 Stage。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 必填 | 变量名；精确匹配优先，唯一的大小写不敏感匹配也接受。 |
| `value` | string \| number \| boolean \| null | 必填 | 新值；必须是有限数字。数组/对象请用列表工具（当前版本未暴露）。 |
| `target` | string | - | 作用域解析目标。 |
| `scope` | enum | `auto` | `auto` / `global` / `local`。`local` 需要 `target`。 |
| `create` | boolean | `true` | 变量不存在时是否创建。 |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true`。 |

输出：`set`、`name`、`id`、`scope`、`owner`、`previousValue`、`value`、`created`、`dirty`。

```json
{ "name": "score", "value": 0, "target": "Sprite1", "scope": "global", "confirm": true }
```

Stage 不能拥有 `local` 变量；会返回 `INVALID_SCOPE`。

---

## 8. `get_variable`

只读。读取变量。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 必填 | 变量名。 |
| `target` | string | - | 作用域解析目标。 |
| `scope` | enum | `auto` | `auto` / `global` / `local`。 |

变量不存在时返回 `found: false`、`variable: null`，而不是工具错误。

输出：`found`、`variable`（`{ id, name, value, scope, owner, isCloud }` 或 `null`）。

---

## 9. `export_sb3`

把活动项目序列化为 SB3 ZIP 并写磁盘；成功后把项目标记为未修改，并更新 `sourcePath`。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 源文件或 `<workspace>/<name>.sb3` | 目标路径或目录。 |
| `pretty` | boolean | `false` | 是否缩进 `project.json`（文件更大）。 |
| `allow_missing_assets` | boolean | `false` | 缺少素材时是否仍然导出。 |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true`。 |

默认行为：

- 已加载项目：覆盖原文件；
- 新项目：写入 `<workspace>/<sanitized displayName>.sb3`；
- 父目录自动创建；
- 缺少被引用的素材时默认拒绝（`MISSING_ASSETS`），避免生成 TurboWarp 打不开的 SB3。

输出：`exported`、`path`、`displayName`、`bytes`、`assetCount`、`blockCount`、`missingAssets`、`dirty: false`。

---

## 10. `run_headless`

用 `scratch-vm` 在 Node 中运行项目。没有渲染器/音频/摄像头/云变量。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 活动项目 | 运行指定 SB3；省略时序列化活动项目并运行。 |
| `duration_ms` | integer | `3000` | 最大运行时间（100–120000 ms）。 |
| `turbo` | boolean | `true` | 开启 scratch-vm turbo 模式，循环不再等待重绘。 |
| `stop_when_idle` | boolean | `true` | 所有线程结束后提前停止；`forever` 循环仍会跑满时长。 |
| `confirm` | boolean | 视策略 | 默认策略下不拦截；`TW_MCP_CONFIRM=all` 时必须为 `true`。 |

输出：

```jsonc
{
  "ran": true,
  "projectSource": "active project \"My Game\"",
  "durationMs": 321,
  "timedOut": false,
  "targetCount": 2,
  "threadCount": 0,
  "say": [{ "target": "Sprite1", "type": "say", "text": "100", "atMs": 120 }],
  "variables": [{ "name": "score", "owner": "Stage", "value": "100", "isCloud": false }],
  "lists": [{ "name": "items", "owner": "Sprite1", "value": [1, 2] }],
  "monitors": [{ "id": "...", "opcode": "data_variable", "owner": "Stage", "value": "100", "visible": true }],
  "errors": []
}
```

注意：

- 变量值可能以字符串形式出现（Scratch 运行时语义），例如 `"100"`；比较时请按 Scratch 规则处理。
- `timedOut: true` 表示到时仍有线程在运行（通常是 `forever` 循环）。
- `say` 事件来自 `runtime.on("SAY", ...)`；`type` 为 `say` 或 `think`（取决于积木实现）。
- 无头运行产生的 VM 警告（如 “No rendering module present”）会写到服务器 stderr，不进入 `errors`。
- 项目使用了 TurboWarp 专属扩展/积木时，`loadProject` 可能失败并返回 `HEADLESS_LOAD_FAILED`；编辑和导出不受影响。

---

## 11. `list_blocks`

只读。列出内置积木注册表。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `category` | enum | 全部 | `motion` / `looks` / `sound` / `events` / `control` / `sensing` / `operators` / `data` / `procedures`。 |
| `turbo_warp_only` | boolean | `false` | 只返回 TurboWarp 专属积木。 |

输出：`count`、`category`、`blocks[]`。每个 block 包含 `opcode`、`shape`、`category`、`description`、`inputs[]`、`fields[]`、`substacks[]`、`turboWarpOnly`、`aliases[]`。

当前注册表包含 **142 个非菜单积木**，覆盖标准 Scratch 3 类别和部分 TurboWarp 积木；菜单影子积木在内部按需创建，不单独列出。

---

## 项目概览输出（`load_sb3` / `new_project`）

```jsonc
{
  "loaded": true,
  "displayName": "My Game",
  "sourcePath": "D:\\projects\\my-game.sb3", // 新项目为 null
  "dirty": false,
  "targetCount": 3,
  "spriteCount": 2,
  "blockCount": 42,
  "scriptCount": 6,
  "variableCount": 5,
  "listCount": 1,
  "broadcastCount": 2,
  "extensions": [],
  "missingAssets": [],
  "targets": [{
    "name": "Stage",
    "isStage": true,
    "blockCount": 0,
    "scriptCount": 0,
    "variableCount": 4,
    "listCount": 1,
    "costumeCount": 1,
    "soundCount": 0
  }]
}
```

---

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `CONFIRMATION_REQUIRED` | 需要 `"confirm": true`；未做任何修改。 |
| `NO_PROJECT` | 尚未加载/创建项目。 |
| `TARGET_NOT_FOUND` / `AMBIGUOUS_TARGET` | 目标不存在或大小写不敏感匹配不唯一。 |
| `DUPLICATE_NAME` / `INVALID_NAME` | 精灵名重复或非法。 |
| `PATH_OUTSIDE_WORKSPACE` | 路径超出沙箱。 |
| `FILE_NOT_FOUND` / `FILE_READ_FAILED` | 文件不存在或无法读取。 |
| `FILE_TOO_LARGE` | 超过 `TW_MCP_MAX_SB3_MB`。 |
| `SB3_PARSE_ERROR` | ZIP/JSON/版本校验失败（包括 SB1/SB2）。 |
| `MISSING_ASSETS` | 导出时发现没有素材字节的引用。 |
| `INVALID_BLOCK_SPEC` | `add_block` 的 block spec 结构错误。 |
| `DUPLICATE_BLOCK_ID` / `BLOCK_NOT_FOUND` | block id 冲突或找不到。 |
| `MISSING_ANCHOR` | 插入模式缺少 `block_id`。 |
| `INVALID_HAT` / `INVALID_STATEMENT` / `INVALID_CAP` | 积木形状与插入位置不合法。 |
| `NOT_A_C_BLOCK` / `UNSUPPORTED_SUBSTACK` | 目标没有该子栈或子栈格式无法安全扩展。 |
| `VARIABLE_NOT_FOUND` / `AMBIGUOUS_VARIABLE` / `INVALID_SCOPE` | 变量解析失败。 |
| `HEADLESS_DEPENDENCY_MISSING` / `HEADLESS_DEPENDENCY_INVALID` | 无头依赖未安装或导出形式不对。 |
| `HEADLESS_LOAD_FAILED` | `scratch-vm` 无法加载项目（常见于 TurboWarp 专属扩展）。 |
| `INTERNAL_ERROR` / `INTERNAL_HTTP_ERROR` | 未预期错误；请查看 stderr 日志。 |

---

## 如何查看实时 JSON Schema

stdio + MCP Inspector：

```powershell
npm run inspector
```

HTTP：

```powershell
node dist\index.js --http --port 3000
# 然后用任意 MCP 客户端连接 http://127.0.0.1:3000/mcp
```

或直接查看导出的 [`tools.schema.json`](tools.schema.json)：

```powershell
npm run schemas
```
