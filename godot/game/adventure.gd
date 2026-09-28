## PVE 奇遇轮（src/game/adventure.ts 对齐版）。
## 奇遇轮 4 / 10 / 16 恰三次；全员共享同一份 2~3 选 1 恩赐。
## 确定性契约：Rng 只由 Match 按固定顺序消费（beginRound 内 roll → 按 idx 顺序 grant），
## 选择函数是纯函数零 rng —— 打乱任一顺序都会让旧档/回放的 rng 流错位。
class_name Adventure
extends RefCounted


## 阶段划分：前期 < 8（奇遇轮 4），中期 8~13（奇遇轮 10），后期 ≥ 14（奇遇轮 16）
static func adventure_stage(round: int) -> String:
	if round < 8:
		return "early"
	if round < 14:
		return "mid"
	return "late"


## 金币档：前期 10 / 中期 16 / 后期 24
static func adventure_gold(round: int) -> int:
	var t := adventure_stage(round)
	return 10 if t == "early" else (16 if t == "mid" else 24)


## 经验档：前期 8 / 中期 14 / 后期 20（= 金币档 × 0.8，4 金 = 4 经验口径）
static func adventure_xp(round: int) -> int:
	var t := adventure_stage(round)
	return 8 if t == "early" else (14 if t == "mid" else 20)


## 援军费用档：前期 1 费 / 中期 2 费 / 后期 3 费（一律 2★，占卡池 3 张）
static func adventure_reinforce_cost(round: int) -> int:
	var t := adventure_stage(round)
	return 1 if t == "early" else (2 if t == "mid" else 3)


## 组件档：前期 2 / 中期 3 / 后期 3
static func adventure_components(round: int) -> int:
	return 2 if adventure_stage(round) == "early" else 3


## 2★ 援军入不了账时的折金返还额 = 2★ 卖出价（state 单一口径）
static func reinforce_refund(round: int) -> float:
	return GameState.sell_refund_for(adventure_reinforce_cost(round), 2)


## 成品装备池（item 恩赐随机；顺序 = ITEMS 原序，与墨兽胜场成品掉落同源）
static func combined_item_ids() -> Array:
	return Spec.combined_item_ids()


## 选项展示顺序：掷出的种类集合无序，按此固定次序排列（断言可写死；
## 读档清洗复用：kind 不在清单内的恩赐选项是脏档残渣，读档即弃）
const DISPLAY_ORDER: Array = ["gold", "xp", "components", "item", "level", "reinforce"]


static func _option_for(kind: String, round: int) -> Dictionary:
	match kind:
		"gold":
			var n := adventure_gold(round)
			return { "kind": kind, "title": "金币 +%d" % n, "desc": "计入持有，参与利息结算。" }
		"xp":
			var n := adventure_xp(round)
			return { "kind": kind, "title": "经验 +%d" % n, "desc": "按升级表结算，可连升多级。" }
		"item":
			return { "kind": kind, "title": "丹青成装", "desc": "随机成品装备 ×1，放入装备栏。" }
		"components":
			var n := adventure_components(round)
			return { "kind": kind, "title": "组件 ×%d" % n, "desc": "随机组件 ×%d，放入装备栏。" % n }
		"level":
			return { "kind": kind, "title": "顿悟 · 等级 +1", "desc": "等级 +1；满级改得 %d 金。" % adventure_xp(round) }
		"reinforce":
			var cost := adventure_reinforce_cost(round)
			return {
				"kind": kind,
				"title": "援军 · 2★ %d 费" % cost,
				"desc": "入驻备战席，占卡池 3 张；席满折返 %d 金。" % int(reinforce_refund(round)),
			}
	return { "kind": kind, "title": kind, "desc": "" }


## 由对局 rng 掷出本回合的恩赐选项（2 或 3 选各半）。
## rng 消费序：shuffle(DISPLAY_ORDER 拷贝) → chance(0.5)；其后仅排序无 rng。
static func roll_adventure_offer(round: int, rng: Rng) -> Dictionary:
	var kinds: Array = rng.shuffle(DISPLAY_ORDER.duplicate())
	var count := 3 if rng.chance(0.5) else 2
	var chosen: Array = kinds.slice(0, count)
	var order := {}
	for i: int in DISPLAY_ORDER.size():
		order[DISPLAY_ORDER[i]] = i
	chosen.sort_custom(func(a, b) -> bool: return int(order[a]) < int(order[b]))
	var options: Array = []
	for kind: String in chosen:
		options.append(_option_for(kind, round))
	return { "round": round, "options": options }
