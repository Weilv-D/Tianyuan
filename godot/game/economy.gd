## 经济系统（src/game/economy.ts 对齐版）。
## 利息（每 10 金 +1，上限 5）是策略张力的支点；连败给得晚但同样有上限。
class_name Economy
extends RefCounted


static func interest_of(gold: float) -> int:
	var tier := int(Spec.c("INCOME_INTEREST_TIER"))
	var cap := int(Spec.c("INCOME_INTEREST_MAX"))
	return int(max(0, min(cap, floor(gold / float(tier)))))


## 连胜 / 连败奖励。连败给得更晚但同样有上限 —— 连败翻盘路径的经济基础。
static func streak_gold(streak: int) -> int:
	var n := absi(streak)
	var table: Array = Spec.cfg.get("WIN_STREAK_GOLD", []) if streak > 0 else Spec.cfg.get("LOSE_STREAK_GOLD", [])
	# 空表守卫：负索引读空数组直接崩（TS 是 undefined→NaN 静默传播）；spec 对账门禁下不可达
	if table.is_empty():
		push_error("连胜/连败奖励表缺失（spec 损坏）——按 0 结算")
		return 0
	return int(table[min(n, table.size() - 1)])


static func compute_income(p: Dictionary, won: bool, skip_streak: bool = false) -> Dictionary:
	var base := int(Spec.c("INCOME_BASE"))
	# 利息按「结算前手上的钱」算：先发利息再动余额
	var interest := interest_of(float(p["gold"]))
	# 轮空回合不结算连胜/连败档位金 —— 轮空不是胜利，也不能变成领钱回合
	var streak := 0 if skip_streak else streak_gold(int(p["streak"]))
	var win := 1 if won else 0
	return { "base": base, "interest": interest, "streak": streak, "win": win, "total": base + interest + streak + win }


## 升到下一级还差多少经验。已满级返回 0。
static func xp_to_next(level: int) -> int:
	var max_level := int(Spec.c("MAX_LEVEL"))
	if level >= max_level:
		return 0
	var table: Array = Spec.cfg.get("XP_TO_NEXT", [])
	# 空表守卫：负索引读空数组直接崩（TS 是 undefined→NaN 静默传播）；门禁下不可达
	if table.is_empty():
		push_error("XP_TO_NEXT 缺失（spec 损坏）——按 0 结算")
		return 0
	return int(table[max(0, min(table.size() - 1, level - 1))])


## 加经验并处理升级。可能一次连升多级。返回实际升到的等级。
static func gain_xp(p: Dictionary, amount: float) -> int:
	# 非有限值即数据污染（NaN 会把玩家一路顶满级）——与 core 侧数值入口同口径
	if not ParityUtil.js_finite(amount):
		push_error("非法经验值: %s" % str(amount))
		return int(p["level"])
	var max_level := int(Spec.c("MAX_LEVEL"))
	p["xp"] = float(p["xp"]) + amount
	while int(p["level"]) < max_level:
		var need := xp_to_next(int(p["level"]))
		if need <= 0 or float(p["xp"]) < float(need):
			break
		p["xp"] = float(p["xp"]) - float(need)
		p["level"] = int(p["level"]) + 1
	if int(p["level"]) >= max_level:
		p["xp"] = 0.0
	return int(p["level"])
