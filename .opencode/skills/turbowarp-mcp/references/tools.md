# 工具参数参考

所有写操作在默认 `destructive` 策略下需要 `"confirm": true`。只读工具永远不需要确认。

通用参数：

- `target`：`Stage` 或精灵名；精确匹配优先，唯一的大小写不敏感匹配也接受。
- `path`：相对路径基于 `TW_MCP_WORKSPACE`；绝对路径也必须在工作区内（除非 `--allow-any-path`）。
- 错误返回 `isError: true`，文本以错误码开头，不会返回 `structuredContent`。

---

## new_project

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `name` | string | `Untitled` | 显示名，也用于默认导出文件名 |
| `with_default_sprite` | boolean | `true` | 是否创建内置 `Sprite1` |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true` |

输出：`loaded`、`displayName`、`sourcePath`（新项目为 `null`）、`dirty`、
`targetCount`、`spriteCount`、`blockCount`、`scriptCount`、`variableCount`、
`listCount`、`broadcastCount`、`extensions`、`missingAssets`、`targets`。

---

## load_sb3

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | SB3 路径 |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true` |

输出同 `new_project`。只支持 `projectVersion === 3`；SB1/SB2 返回
`SB3_PARSE_ERROR`。会替换当前项目。

---

## list_sprites

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `include_stage` | boolean | `true` | 是否返回 Stage 详情 |

输出：`displayName`、`dirty`、`targetCount`、`spriteCount`、`stage`、`sprites[]`。

每个 target 包含：`name`、`isStage`、`visible`、`x`、`y`、`size`、
`direction`、`draggable`、`rotationStyle`、`currentCostume`、
`currentCostumeName`、`costumeCount`、`soundCount`、`blockCount`、
`scriptCount`、`variableCount`、`listCount`、`costumes[]`、`sounds[]`。

---

## add_sprite

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 必填 | 唯一，不能是 `Stage` / `_stage_` |
| `costume_path` | string | - | PNG 或 SVG；省略时用内置造型 |
| `costume_name` | string | 文件名 / `costume1` | 造型名 |
| `x` / `y` | number | `0` | 初始位置 |
| `size` | number | `100` | 正数 |
| `direction` | number | `90` | 角度 |
| `visible` | boolean | `true` | 初始可见 |
| `draggable` | boolean | `false` | 编辑器可拖动 |
| `rotation_style` | enum | `all around` | `all around` / `left-right` / `don't rotate` |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true` |

输出：`created`、`dirty`、`targetCount`、`spriteCount`、`sprite`（target 详情）。

---

## add_block

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `opcode` | string | 必填 | 完整 opcode 或别名 |
| `target` | string | 首个精灵/Stage | 接收目标 |
| `inputs` | object | - | 输入映射 |
| `fields` | object | - | 字段映射 |
| `substacks` | object | - | 子栈名到 block spec 数组 |
| `mutation` | object | - | 原样写入的 mutation |
| `mode` | enum | `new` | `new` / `append` / `after` / `start` / `substack` |
| `block_id` | string | - | 锚点 id；非 `new` 模式必填 |
| `substack` | string | `SUBSTACK` | `substack` 模式的输入名 |
| `position` | enum | `end` | 子栈内插入位置：`start` / `end` |
| `x` / `y` | number | 自动 | 新顶层脚本坐标 |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true` |

输出：`target`、`mode`、`rootId`、`blockIds[]`、`warnings[]`、`blockCount`、
`scriptCount`、`dirty`。

### block spec（用于嵌套和子栈）

```jsonc
{
  "opcode": "looks_say",
  "inputs": { "MESSAGE": "Hi" },
  "fields": {},
  "substacks": {},
  "mutation": {}
}
```

### inputs 值形式

| 形式 | 示例 |
| --- | --- |
| 标量 | `"Hello"`、`10`、`true` |
| 变量 | `{"variable": "score", "scope": "global"}` |
| 列表 | `{"list": "items", "scope": "global"}` |
| 广播 | `{"broadcast": "start"}` |
| 菜单 | `"costume2"` 或 `{"menu": "costume2", "opcode": "looks_costume"}` |
| 嵌套积木 | `{"block": {"opcode": "data_variable", "fields": {"VARIABLE": {"variable": "score"}}}}` |
| 强制字面量类型 | `{"value": 42, "type": "text"}` |
| raw | `{"raw": [1, [10, "Hello"]]}` |

### fields 值形式

| 形式 | 示例 |
| --- | --- |
| 普通值 | `"color"`、`25` |
| 变量 | `{"variable": "score", "scope": "global"}` |
| 列表 | `{"list": "items"}` |
| 广播 | `{"broadcast": "start"}` |
| raw | `["score", "variableId"]` |

### 常用 SB3 编码

- 输入：`[1, primitive]`、`[2, blockId | null]`、`[3, blockId, primitive]`
- primitive：4 number、5 positive number、6 positive integer、7 integer、
  8 angle、9 color、10 string、11 broadcast、12 variable、13 list

---

## get_scripts

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `target` | string | 全部 | 只读某个目标 |
| `include_stage` | boolean | `true` | 未指定 target 时是否含 Stage |
| `max_blocks` | integer | `2000` | 1–50000；超出时 `truncated: true` |

输出：`displayName`、`dirty`、`targetCount`、`totalScripts`、`totalBlocks`、
`truncated`、`targets[]`（每个含 `name`、`isStage`、`scriptCount`、
`blockCount`、`truncated`、`warnings[]`、`scripts[]`）。

`scripts[]` 元素：

```jsonc
{
  "index": 0,
  "kind": "script",       // 或 "reporter"
  "rootId": "block id",
  "x": 48,
  "y": 48,
  "stack": [ /* BlockAst */ ]
}
```

`BlockAst` 的 `inputs` 类型：`literal`、`menu`、`block`、`stack`、`empty`、
`shadowBlock`。`rootId` 可直接作为 `add_block` 的锚点。

---

## set_variable

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 必填 | 变量名 |
| `value` | string \| number \| boolean \| null | 必填 | 有限数字；数组/对象不支持 |
| `target` | string | - | 作用域解析目标 |
| `scope` | enum | `auto` | `auto` / `global` / `local` |
| `create` | boolean | `true` | 不存在时是否创建 |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true` |

输出：`set`、`name`、`id`、`scope`、`owner`、`previousValue`、`value`、
`created`、`dirty`。

`scope: "local"` 需要 `target` 且目标不能是 Stage。

---

## get_variable

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 必填 | 变量名 |
| `target` | string | - | 作用域解析目标 |
| `scope` | enum | `auto` | `auto` / `global` / `local` |

输出：`found`、`variable`（`{id, name, value, scope, owner, isCloud}` 或 `null`）。
变量不存在不是工具错误。

---

## export_sb3

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 源文件 / `<workspace>/<name>.sb3` | 目标路径或目录 |
| `pretty` | boolean | `false` | 缩进 `project.json` |
| `allow_missing_assets` | boolean | `false` | 缺少素材时仍导出 |
| `confirm` | boolean | 视策略 | 默认策略下必须为 `true` |

输出：`exported`、`path`、`displayName`、`bytes`、`assetCount`、`blockCount`、
`missingAssets[]`、`dirty: false`。

---

## run_headless

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 活动项目 | 运行指定 SB3 |
| `duration_ms` | integer | `3000` | 100–120000 |
| `turbo` | boolean | `true` | VM turbo 模式 |
| `stop_when_idle` | boolean | `true` | 线程结束后提前停止 |
| `confirm` | boolean | 视策略 | 默认策略下不拦截；`TW_MCP_CONFIRM=all` 时必须为 `true` |

输出：`ran`、`projectSource`、`durationMs`、`timedOut`、`targetCount`、
`threadCount`、`say[]`、`variables[]`、`lists[]`、`monitors[]`、`errors[]`。

`say[]` 元素：`{target, type, text, atMs}`，`type` 为 `say` 或 `think`。

---

## list_blocks

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `category` | enum | 全部 | `motion` / `looks` / `sound` / `events` / `control` / `sensing` / `operators` / `data` / `procedures` |
| `turbo_warp_only` | boolean | `false` | 只返回 TurboWarp 专属积木 |

输出：`count`、`category`、`blocks[]`。每个 block 含 `opcode`、`shape`、
`category`、`description`、`inputs[]`、`fields[]`、`substacks[]`、
`turboWarpOnly`、`aliases[]`。

注册表共 142 个非菜单积木；菜单影子块由 `add_block` 按需创建。

---

## 常用别名

| 别名 | opcode |
| --- | --- |
| `say` | `looks_say` |
| `say_for_secs` | `looks_sayforsecs` |
| `think` | `looks_think` |
| `when_flag_clicked` | `event_whenflagclicked` |
| `when_broadcast_received` | `event_whenbroadcastreceived` |
| `broadcast` | `event_broadcast` |
| `repeat` | `control_repeat` |
| `forever` | `control_forever` |
| `if` | `control_if` |
| `if_else` | `control_if_else` |
| `wait` | `control_wait` |
| `set_variable` | `data_setvariableto` |
| `change_variable` | `data_changevariableby` |
| `move_steps` | `motion_movesteps` |
| `turn_right` | `motion_turnright` |
| `go_to_xy` | `motion_gotoxy` |

完整列表用 `list_blocks` 的 `aliases` 字段查询。
