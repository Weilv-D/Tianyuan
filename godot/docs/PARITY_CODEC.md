# 对拍编解码协议（PARITY_CODEC）v1

跨引擎（TS 冻结内核 ↔ GDScript 新内核）事件流逐条一致的**唯一**序列化口径。
禁止直接比较 `JSON.stringify`：JS 对象键序、`undefined` 省略与 Godot 字典序不可对齐；
浮点十进制文本两语言最短表示也不同。本协议用**位型**绕开这两类差异。

## 原语

| 原语 | 编码 | 说明 |
|---|---|---|
| 数值 | 16 位小写 hex | float64 大端位型（`DataView.setFloat64(0,v,false)` / `StreamPeerBuffer.put_double`）。**一切数值**（tick/uid/坐标/星/队伍/伤害量）统一走此编码 |
| 布尔 | `1` / `0` | |
| 可选字段 | `-`（缺） 或 `1` + 值（在） | 判据是「字段是否为 undefined/null」，不是假值——`targetUid:0` 是在 |
| 字符串 | JSON 转义（带引号） | 事件内字符串限定 `[A-Za-z0-9_.|-]`（defId/skillId/kind/source），编码时双端断言 |

## 事件行

一个事件 = 一行 = `[` + token 逐个逗号连接 + `]`。首 token 为类型名（带引号字符串）。
`params` 类 map：键排序后按 `键, 值` 交替展开。

| t | 字段序（opt=可选带标志位） |
|---|---|
| start | tick, n, ×n{uid, defId, team, star, cx, cy, maxHp, hp} |
| spawn | 同 start |
| castStart | tick, uid, skillId, windup |
| cast | tick, uid, skillId, opt targetUid, opt cell(cx,cy), opt params |
| attackStart | tick, uid, targetUid, windup, isRanged |
| projectile | tick, uid, targetUid, from(cx,cy), to(cx,cy), dur, kind |
| damage | tick, srcUid, dstUid, amount, type, crit, kill, source |
| heal | tick, srcUid, dstUid, amount |
| mana | tick, uid, mp, maxMp |
| shield | tick, uid, amount, total |
| move | tick, uid, from(cx,cy), to(cx,cy), dur |
| blink | 同 move |
| status | tick, uid, kind, dur, value, added, opt src |
| death | tick, uid, killerUid |
| fx | tick, kind, opt uid, opt cell, opt targetUid, opt radius, opt team, opt params |
| end | tick, opt winner, timeout（winner 为 null 时标志位 `-`） |

## 流摘要

`digest = fnv1a32(lines.join("\n"))`（UTF-8 字节，FNV-1a 32 位，基准 2166136261，素数 16777619）。
对拍报告另附 sha256 作为强校验。fnv1a32 与冻结仓 `src/core/replay.ts` 的 `fnv1aHex`
同算法，但**输入文本**换成本协议行（两仓摘要值不可互比，跨引擎对拍只在本协议内闭环）。

## 实现位置

- TS 侧：`godot/tools/codec.mjs`（纯 JS，无冻结仓依赖）+ `parity_codec.mjs`（生成合成夹具）
- GDScript 侧：`godot/core/codec.gd`
- 往返验收：`headless/codec_probe.gd` 读 TS 夹具重编码，逐行逐摘要必须全等

## 修订纪律

字段序/编码规则的任何改动 = 协议版本 +1，双端同步改，夹具重新生成。
