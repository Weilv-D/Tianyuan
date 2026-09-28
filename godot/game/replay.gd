## 回放契约与校验（src/game/replay.ts 对齐版）。
## 每场战斗在结算时记录 BattleSnapshot（种子 + 配置 + 结果指纹），
## verify_replay 用同一种子与配置重跑战斗并比对。
##
## digest 口径注意（M2 登记的引擎差）：TS 侧 = fnv1aHex(JSON.stringify(events))，
## JSON.stringify 键序在 JS=插入序 / Godot=字典序，字符串天然不同。
## digest 只承担「同引擎自校验」职责（录制方=校验方），跨引擎对拍比对的是
## PARITY_CODEC 事件流（另一套逐位一致口径）；本函数两侧各自自洽即契约成立。
class_name Replay
extends RefCounted


## FNV-1a 32 位、UTF-8 字节流、8 位小写 hex（空串 = 811c9dc5）。
## 与 ParityUtil.fnv1a32_hex 同一实现（全项目唯一定义点在 core；此处仅为对齐
## TS 的再导出关系保留别名）。
static func fnv1a_hex(s: String) -> String:
	return ParityUtil.fnv1a32_hex(s)


## 对快照逐条重跑战斗并比对；返回 { checked, failed, failures: [{round, field}] }。
## 规则：eventsDigest 非 '' 才记录事件流并比对摘要；'' 为无头批量模拟的快照，
## 跳过摘要位、只比 winner / ticks。config 无法构造或重跑中途抛错的快照，
## 全部比对位记为不一致，单条坏档不炸整批。
static func verify_replay(snapshots: Array) -> Dictionary:
	var failures: Array = []
	var checked := 0
	for snap: Dictionary in snapshots:
		checked += 1
		var record := String(snap.get("eventsDigest", "")) != ""
		# 哨兵语义对齐 TS undefined：构造/重跑失败时 winner/ticks/digest「未取得」，
		# 与合法产出值 null 永不相等（TS 里 undefined !== null/number 恒真）
		const MISSING := "__unset__"
		var winner = MISSING
		var ticks = MISSING
		var digest = MISSING
		if snap.get("config", null) is Dictionary:
			var battle := Battle.new(snap["config"], Callable(), record)
			var result: Dictionary = battle.run()
			winner = result.get("winner", null)
			ticks = result.get("ticks", null)
			if record:
				digest = fnv1a_hex(JSON.stringify(battle.events))
		if snap.get("winner", MISSING) != winner:
			failures.append({ "round": snap.get("round", -1), "field": "winner" })
		if snap.get("ticks", MISSING) != ticks:
			failures.append({ "round": snap.get("round", -1), "field": "ticks" })
		if record and digest != snap.get("eventsDigest", null):
			failures.append({ "round": snap.get("round", -1), "field": "eventsDigest" })
	return { "checked": checked, "failed": failures.size(), "failures": failures }
