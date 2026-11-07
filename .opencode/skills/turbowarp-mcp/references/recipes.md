# 常用配方

以下示例假设用户已经明确要求对应修改，因此直接带 `confirm: true`。
如果只是你主动提议，先征得同意再调用。

---

## 1. 新建 Hello 项目并导出

```jsonc
// 1) 新项目，不要默认精灵
{ "name": "Hello", "with_default_sprite": false, "confirm": true }

// 2) 加一个精灵
{ "name": "Sprite1", "x": 0, "y": 0, "confirm": true }

// 3) 绿旗 hat，记住返回的 rootId
{
  "target": "Sprite1",
  "opcode": "event_whenflagclicked",
  "mode": "new",
  "confirm": true
}

// 4) append 说话积木
{
  "target": "Sprite1",
  "opcode": "looks_say",
  "mode": "append",
  "block_id": "<上一步 rootId>",
  "inputs": { "MESSAGE": "Hello" },
  "confirm": true
}

// 5) 导出
{ "path": "Hello.sb3", "confirm": true }

// 6) 无头验证，期望 say[0].text === "Hello"
{ "duration_ms": 3000 }
```

---

## 2. 计数器：repeat + 变量 + 说话

```jsonc
// 1) 新建（带默认 Sprite1）
{ "name": "Counter", "confirm": true }

// 2) 绿旗
{ "target": "Sprite1", "opcode": "event_whenflagclicked", "confirm": true }

// 3) score = 0
{
  "target": "Sprite1",
  "opcode": "data_setvariableto",
  "mode": "append",
  "block_id": "<hat rootId>",
  "inputs": { "VALUE": 0 },
  "fields": { "VARIABLE": { "variable": "score", "scope": "global" } },
  "confirm": true
}

// 4) repeat 10：score + 1，然后说 score
{
  "target": "Sprite1",
  "opcode": "control_repeat",
  "mode": "append",
  "block_id": "<setVariable rootId>",
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
            "block": {
              "opcode": "data_variable",
              "fields": { "VARIABLE": { "variable": "score", "scope": "global" } }
            }
          }
        }
      }
    ]
  },
  "confirm": true
}

// 5) 导出并验证
{ "path": "Counter.sb3", "confirm": true }
{ "duration_ms": 5000 }
```

预期：`say` 中出现 1–10 的文本，`score` 为 `"10"`（字符串）。

---

## 3. 加载已有项目 → 追加脚本 → 另存

```jsonc
// 1) 加载
{ "path": "demo.sb3", "confirm": true }

// 2) 查看目标
{ "include_stage": true }

// 3) 查看脚本，拿到 scripts[0].rootId
{ "target": "Sprite1" }

// 4) 在链尾追加“说 done”
{
  "target": "Sprite1",
  "opcode": "looks_say",
  "mode": "append",
  "block_id": "<scripts[0].rootId>",
  "inputs": { "MESSAGE": "done" },
  "confirm": true
}

// 5) 另存，避免覆盖原文件
{ "path": "demo-edited.sb3", "confirm": true }

// 6) 可选：重新加载导出文件，确认可解析
{ "path": "demo-edited.sb3", "confirm": true }
```

---

## 4. 导出到工作区外（例如桌面）

服务器默认只允许 `TW_MCP_WORKSPACE` 内路径，所以不要直接把
`C:/Users/.../Desktop/x.sb3` 传给 `export_sb3`，会得到
`PATH_OUTSIDE_WORKSPACE`。做法：

1. 先导出到工作区：

```jsonc
{ "path": "Hello.sb3", "confirm": true }
```

2. 再用文件/终端工具复制到桌面：

```powershell
Copy-Item -LiteralPath "D:\...\projects\Hello.sb3" `
          -Destination "$env:USERPROFILE\Desktop\Hello.sb3" -Force
```

3. 用 `Get-Item` 或文件工具确认目标存在，并向用户报告绝对路径。

如果服务器启动时带了 `--allow-any-path`，可以直接导出到任意路径；不要
假设一定启用了这个开关。

---

## 5. 在 C 型积木里插入

已有 `control_repeat` 的 `rootId` 时：

```jsonc
{
  "target": "Sprite1",
  "opcode": "looks_say",
  "mode": "substack",
  "block_id": "<repeat rootId>",
  "substack": "SUBSTACK",
  "position": "end",
  "inputs": { "MESSAGE": "again" },
  "confirm": true
}
```

新建时直接用 `substacks`：

```jsonc
{
  "target": "Sprite1",
  "opcode": "control_if_else",
  "mode": "new",
  "inputs": {
    "CONDITION": {
      "block": {
        "opcode": "operator_gt",
        "inputs": {
          "OPERAND1": {
            "block": {
              "opcode": "data_variable",
              "fields": { "VARIABLE": { "variable": "score", "scope": "global" } }
            }
          },
          "OPERAND2": 10
        }
      }
    }
  },
  "substacks": {
    "SUBSTACK": [{ "opcode": "looks_say", "inputs": { "MESSAGE": "high" } }],
    "SUBSTACK2": [{ "opcode": "looks_say", "inputs": { "MESSAGE": "low" } }]
  },
  "confirm": true
}
```

---

## 6. 广播

```jsonc
// 发送
{
  "target": "Sprite1",
  "opcode": "event_broadcast",
  "mode": "new",
  "inputs": { "BROADCAST_INPUT": { "broadcast": "start" } },
  "confirm": true
}

// 接收
{
  "target": "Sprite2",
  "opcode": "event_whenbroadcastreceived",
  "mode": "new",
  "fields": { "BROADCAST_OPTION": { "broadcast": "start" } },
  "confirm": true
}
```

广播会在 Stage 的 `broadcasts` 中自动创建。

---

## 7. 无头运行没有 say 输出

按顺序检查：

1. 项目里是否存在 `event_whenflagclicked` 脚本（`get_scripts`）。
2. `looks_say` 是否真的在 hat 的 `next` 链上，而不是孤立积木。
3. `duration_ms` 是否太短，或脚本卡在 `wait` / `ask and wait`。
4. 是否依赖渲染器、音频、摄像头、云变量或 TurboWarp 专属扩展。
5. 用 `get_variable` 确认分支条件所需的变量值。
6. 查看返回的 `timedOut`、`threadCount`、`errors`。

必要时把 `duration_ms` 提高到 5000–10000 再试；`forever` 循环会一直运行到
超时，这是正常的。

---

## 8. 查询可用 opcode 和输入名

```jsonc
// 所有事件积木
{ "category": "events" }

// 只看 TurboWarp 专属积木
{ "turbo_warp_only": true }
```

用返回的 `inputs[].name`、`fields[].name`、`substacks[]` 构造 `add_block`
参数，不要凭记忆猜输入名。
