# `add_block` 积木编写指南

`add_block` 直接在 SB3 的 `blocks` 表里创建积木、菜单影子块和嵌套链。它不需要 TurboWarp 编辑器，也不执行扩展代码。

---

## 1. 基本参数

```jsonc
{
  "target": "Sprite1",          // 省略时用第一个精灵；没有精灵时用 Stage
  "opcode": "looks_say",        // 完整 opcode 或别名
  "mode": "new",                // new | append | start | after | substack
  "inputs": { "MESSAGE": "Hi" },
  "fields": {},
  "confirm": true
}
```

`opcode` 支持别名（不区分大小写？——当前是**大小写敏感**的精确别名）。例如：

- `say` → `looks_say`
- `when_flag_clicked` → `event_whenflagclicked`
- `repeat` → `control_repeat`
- `if_else` → `control_if_else`
- `set_variable` → `data_setvariableto`

完整别名列表可通过 `list_blocks` 的 `aliases` 字段查看。

---

## 2. 插入模式

| 模式 | 是否需要 `block_id` | 行为 |
| --- | --- | --- |
| `new` | 否 | 创建新的顶层脚本；`x`/`y` 可指定位置。 |
| `append` | 是 | 找到锚点所在链的最后一个积木，把新链接在它后面。 |
| `after` | 是 | 把新链接在 `block_id` 之后，原有后续链接到新链末尾。 |
| `start` | 是 | 把新链接在 `block_id` 之前；适合在脚本开头插入。 |
| `substack` | 是 | 把新链放进 C 型积木的 `SUBSTACK`（或 `SUBSTACK2`）中。 |

### 新建脚本

```json
{
  "target": "Sprite1",
  "opcode": "event_whenflagclicked",
  "mode": "new",
  "x": 48,
  "y": 48,
  "confirm": true
}
```

返回的 `rootId` 是后续 `append`/`after`/`start`/`substack` 的锚点。

### 追加

```json
{
  "target": "Sprite1",
  "opcode": "looks_say",
  "mode": "append",
  "block_id": "<hat rootId>",
  "inputs": { "MESSAGE": "Hello!" },
  "confirm": true
}
```

`append` 会沿 `next` 走到链尾，所以即使锚点是 hat 也可以直接追加。

### 在锚点前插入

```json
{
  "opcode": "data_setvariableto",
  "mode": "start",
  "block_id": "<script rootId>",
  "inputs": { "VALUE": 0 },
  "fields": { "VARIABLE": { "variable": "score", "scope": "global" } },
  "confirm": true
}
```

如果锚点是顶层脚本，新链继承它的 `x`/`y` 并成为新的顶层积木；原锚点变成新链的 `next`。

### 放进 C 型积木

```json
{
  "opcode": "control_repeat",
  "target": "Sprite1",
  "mode": "new",
  "inputs": { "TIMES": 10 },
  "substacks": {
    "SUBSTACK": [
      {
        "opcode": "looks_say",
        "inputs": { "MESSAGE": "tick" }
      }
    ]
  },
  "confirm": true
}
```

`control_if_else` 支持 `SUBSTACK` 和 `SUBSTACK2`。`substack` 模式可以向已有 C 型积木追加：

```json
{
  "opcode": "looks_say",
  "mode": "substack",
  "block_id": "<control_repeat rootId>",
  "substack": "SUBSTACK",
  "position": "end",
  "inputs": { "MESSAGE": "again" },
  "confirm": true
}
```

---

## 3. `inputs` 的写法

`inputs` 的键必须与积木输入名一致（`MESSAGE`、`TIMES`、`VALUE`、`CONDITION` 等）。可从 `list_blocks` 或 TurboWarp 项目中确认。

### 3.1 标量

```jsonc
"inputs": {
  "MESSAGE": "Hello",
  "SECS": 2,
  "CONDITION": true
}
```

数字会按输入类型转换为 SB3 primitive；布尔输入会变成 `[1,[10,"true"]]`。字符串会保留为文本。

### 3.2 变量

```jsonc
"inputs": {
  "VALUE": { "variable": "score" }
}
```

变量不存在时会在目标上自动创建（`auto` 作用域：精灵局部优先，否则 Stage 全局）。强制全局：

```jsonc
{ "variable": "score", "scope": "global" }
```

强制局部：

```jsonc
{ "variable": "score", "scope": "local" }
```

> `scope=local` 时变量必须创建在指定的精灵上；对 Stage 使用会报错。

### 3.3 列表

```jsonc
"inputs": {
  "LIST": { "list": "items", "scope": "global" }
}
```

列表会自动创建（空列表）。注意：`data_listcontents`/`data_addtolist` 等积木的字段通常叫 `LIST`，而输入可能叫 `ITEM`/`INDEX`。

### 3.4 广播

```jsonc
"inputs": {
  "BROADCAST_INPUT": { "broadcast": "start" }
}
```

广播会在 Stage 的 `broadcasts` 中自动创建。`event_whenbroadcastreceived` 的字段写法：

```jsonc
"fields": {
  "BROADCAST_OPTION": { "broadcast": "start" }
}
```

### 3.5 菜单

当积木输入本身是菜单时，可以直接传字符串，服务器会用注册表中的默认菜单创建影子块：

```json
{
  "opcode": "looks_switchcostumeto",
  "inputs": { "COSTUME": "costume2" },
  "confirm": true
}
```

也可以显式指定菜单 opcode（适合注册表默认菜单不符合预期，或扩展积木）：

```jsonc
"inputs": {
  "COSTUME": { "menu": "costume2", "opcode": "looks_costume" }
}
```

菜单影子块是 `shadow: true` 的积木，会自动挂到父积木的 `inputs` 中。

### 3.6 嵌套 reporter / boolean

```json
{
  "opcode": "looks_say",
  "inputs": {
    "MESSAGE": {
      "block": {
        "opcode": "operator_join",
        "inputs": {
          "STRING1": "score = ",
          "STRING2": { "block": { "opcode": "data_variable", "fields": { "VARIABLE": { "variable": "score" } } } }
        }
      }
    }
  },
  "confirm": true
}
```

嵌套积木必须用 `{ "block": { ... } }` 包裹。被嵌套的积木形状必须是 `reporter`、`boolean` 或 `menu`；`stack`/`hat`/`cap` 会被拒绝（`INVALID_INPUT_BLOCK`）。

布尔示例：

```json
{
  "opcode": "control_if",
  "inputs": {
    "CONDITION": {
      "block": {
        "opcode": "operator_gt",
        "inputs": {
          "OPERAND1": { "block": { "opcode": "data_variable", "fields": { "VARIABLE": { "variable": "score" } } } },
          "OPERAND2": 10
        }
      }
    }
  },
  "substacks": {
    "SUBSTACK": [{ "opcode": "looks_say", "inputs": { "MESSAGE": "high" } }]
  },
  "confirm": true
}
```

### 3.7 raw SB3 tuple

需要完全控制编码时：

```json
{
  "opcode": "looks_say",
  "inputs": {
    "MESSAGE": { "raw": [1, [10, "Hello"]] }
  },
  "confirm": true
}
```

常见 primitive 编号：

| 编号 | 含义 |
| --- | --- |
| 4 | number |
| 5 | positive number |
| 6 | positive integer |
| 7 | integer |
| 8 | angle |
| 9 | color |
| 10 | string |
| 11 | broadcast |
| 12 | variable |
| 13 | list |

输入编码：`[1, primitive]`（字面量/菜单 id）、`[2, blockId | null]`（积木输入/子栈）、`[3, blockId, primitive]`（被遮挡的输入）。

`fields` 也接受 raw tuple：

```jsonc
"fields": { "VARIABLE": ["score", "variableId"] }
```

### 3.8 字面量强制类型

```jsonc
"inputs": {
  "VALUE": { "value": 42, "type": "text" }
}
```

`type` 可取注册表输入类型或 `"text"`；不传时使用积木注册表的默认类型。

---

## 4. `fields`

字段用于下拉选项和变量/列表/广播引用：

```json
{
  "opcode": "looks_changeeffectby",
  "inputs": { "CHANGE": 25 },
  "fields": { "EFFECT": "color" },
  "confirm": true
}
```

`fields` 的值可以是：

- 字符串/数字：写入 `[value]`；
- `{ "variable": "score" }`：写入 `[name, id]`；
- `{ "list": "items" }`：写入 `[name, id]`；
- `{ "broadcast": "start" }`：写入 `[name, id]`；
- raw tuple，如 `["score", "id"]`。

未提供的字段会使用注册表默认值；变量/列表/广播字段会自动创建对应实体。

---

## 5. 自定义积木与扩展积木

```jsonc
"mutation": {
  "tagName": "mutation",
  "children": [],
  "proccode": "my block %s",
  "argumentids": "[\"arg1\"]",
  "warp": "false"
}
```

`mutation` 会原样写入积木。**自定义积木定义（`procedures_definition`）和调用（`procedures_call`）依赖配套的 prototype/argument id，当前没有高级封装**：请先在 TurboWarp 中创建，或使用 `load_sb3` 打开后通过 raw mutation 编辑。

未知扩展 opcode（例如某个扩展的 `myext_dosomething`）可以直接插入：

```json
{
  "opcode": "myext_dosomething",
  "inputs": { "ARG": { "raw": [1, [10, "x"]] } },
  "mutation": { "tagName": "mutation", "children": [], "myfield": "value" },
  "confirm": true
}
```

服务器会返回 `UNKNOWN_OPCODE` 警告；它不会安装扩展。导出后是否能在 TurboWarp 中正常运行，取决于扩展是否存在。

---

## 6. 形状规则

| 形状 | 规则 |
| --- | --- |
| `hat` | 必须是脚本第一个积木，只能用 `mode: "new"`。 |
| `stack` | 可以追加到 hat 或 stack 后面。 |
| `cap` | 必须是脚本最后一个积木；不能 `append`/`after`。 |
| `reporter` / `boolean` | 只能作为嵌套输入，或单独作为顶层积木（`mode: "new"`），不能跟后续积木。 |
| `menu` | 只能作为影子/嵌套输入，不能作为语句。 |

违反规则会返回 `INVALID_HAT`、`INVALID_STATEMENT`、`INVALID_CAP` 等错误。

---

## 7. 常用示例

### 计数器 + 说数字

```jsonc
// 1) 绿旗
{ "opcode": "event_whenflagclicked", "target": "Sprite1", "mode": "new", "confirm": true }

// 2) 设 score = 0
{
  "opcode": "data_setvariableto",
  "mode": "append",
  "block_id": "<hatId>",
  "inputs": { "VALUE": 0 },
  "fields": { "VARIABLE": { "variable": "score", "scope": "global" } },
  "confirm": true
}

// 3) repeat 10 次：score + 1，说 score
{
  "opcode": "control_repeat",
  "mode": "append",
  "block_id": "<setVariableId>",
  "inputs": { "TIMES": 10 },
  "substacks": {
    "SUBSTACK": [
      {
        "opcode": "data_changevariableby",
        "inputs": { "VALUE": 1 },
        "fields": { "VARIABLE": { "variable": "score", "scope": "global" } }
      },
      {
        "opcode": "looks_say",
        "inputs": {
          "MESSAGE": {
            "block": { "opcode": "data_variable", "fields": { "VARIABLE": { "variable": "score", "scope": "global" } } }
          }
        }
      }
    ]
  },
  "confirm": true
}
```

### 条件 + 广播

```jsonc
{
  "opcode": "control_if_else",
  "mode": "new",
  "inputs": {
    "CONDITION": {
      "block": {
        "opcode": "operator_equals",
        "inputs": { "OPERAND1": { "block": { "opcode": "sensing_mousedown" } }, "OPERAND2": true }
      }
    }
  },
  "substacks": {
    "SUBSTACK": [
      { "opcode": "event_broadcast", "inputs": { "BROADCAST_INPUT": { "broadcast": "start" } } }
    ],
    "SUBSTACK2": [
      { "opcode": "looks_say", "inputs": { "MESSAGE": "waiting" } }
    ]
  },
  "confirm": true
}
```

---

## 8. 稳定性说明

- 注册表覆盖 **142 个非菜单积木**，但 Scratch/TurboWarp 的扩展积木远不止这些。
- 菜单默认值依赖目标当前造型/声音/广播；没有造型或声音时可能创建空菜单值，请在 TurboWarp 中确认。
- `control_stop` 的 `mutation.hasnext` 需要与 `STOP_OPTION` 匹配；当前没有自动生成，涉及 “other scripts in sprite” 时请在 TurboWarp 中补全或使用 raw mutation。
- 自定义积木、扩展积木、云变量、TurboWarp 专属积木的运行时行为不在本服务器保证范围内。
- 导出前建议用 `get_scripts` 检查，导入 TurboWarp 后再做一次人工验证。

更完整的边界见 [`LIMITATIONS.md`](LIMITATIONS.md)。
