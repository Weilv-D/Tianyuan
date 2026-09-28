## AI 对手（src/game/ai.ts 对齐版）。
## 目标不是最优解，是「像一个有性格的人在打」：性格原型 + 局势感知 + 决策噪声。
##
## rng 消费序纪律（跨引擎对拍生命线，改动前必读）：
## - 买牌循环每个候选格一次 rng.next()（want 噪声）；
## - wantMore 的求值顺序 = TS 短路序：(shopIsDry || !bought) 为真才消费 rng.next()，
##   lockWorthy 在 rng 之后（不再消费）；
## - 手滑段先消费 rng.next() 再判 gold；
## - tidyBench/makeRoomFor 内零 rng（sell 不消费）。
class_name GameAi
extends RefCounted


## 性格原型表（arch → 除 arch/label 外的全部字段）
const ARCHETYPE := {
	"aggro": { "rollFloor": 10, "aggression": 0.7, "preferred": ["jianzong", "assassin", "warrior"], "levelPace": 1.15, "levelCap": 9, "mergeBias": 1.0, "noise": 0.22, "adventurePref": ["reinforce", "components", "item", "level", "gold", "xp"] },
	"econ": { "rollFloor": 22, "aggression": 0.3, "preferred": ["danding", "tian", "guardian"], "levelPace": 0.95, "levelCap": 9, "mergeBias": 1.0, "noise": 0.1, "adventurePref": ["gold", "xp", "level", "item", "components", "reinforce"] },
	"balanced": { "rollFloor": 12, "aggression": 0.55, "preferred": ["shanhai", "youming", "mage"], "levelPace": 1.0, "levelCap": 9, "mergeBias": 1.0, "noise": 0.16, "adventurePref": ["item", "level", "gold", "components", "reinforce", "xp"] },
	"hyperroll": { "rollFloor": 12, "aggression": 0.6, "preferred": ["yaozu", "jiguan", "warrior"], "levelPace": 1.0, "levelCap": 9, "mergeBias": 3.6, "noise": 0.3, "adventurePref": ["xp", "level", "reinforce", "gold", "components", "item"] },
	"greedy": { "rollFloor": 20, "aggression": 0.4, "preferred": ["longyuan", "tian", "mage"], "levelPace": 1.25, "levelCap": 9, "mergeBias": 1.0, "noise": 0.1, "adventurePref": ["gold", "level", "item", "xp", "components", "reinforce"] },
}

## 8 名参与者的名字。称号直接暴露性格 —— 一眼看出「这局谁危险」
const AI_ROSTER: Array = [
	{ "name": "「铁算子」神机", "arch": "balanced" },
	{ "name": "「血勇」重明", "arch": "aggro" },
	{ "name": "「守财」聚宝", "arch": "econ" },
	{ "name": "「孤注」燃犀", "arch": "hyperroll" },
	{ "name": "「老谋」玄鸢", "arch": "balanced" },
	{ "name": "「钓叟」渭滨", "arch": "greedy" },
	{ "name": "「莽夫」开山", "arch": "aggro" },
]


static func arch_label(arch: String) -> String:
	match arch:
		"aggro":
			return "血勇"
		"econ":
			return "守财"
		"balanced":
			return "老谋"
		"hyperroll":
			return "孤注"
		"greedy":
			return "钓叟"
	return "老谋"


static func make_profile(arch: String) -> Dictionary:
	var base: Dictionary = ARCHETYPE.get(arch, ARCHETYPE["balanced"])
	var prof := { "arch": arch, "label": arch_label(arch) }
	for k in base.keys():
		prof[k] = base[k]
	return prof


## 奇遇恩赐选择：按偏好序取第一个 offer 里存在的 kind；一个都不在取第一个。
## 纯函数、不消耗 rng —— 同种子同局面必同选择。
static func choose_adventure_index(prof: Dictionary, offer: Dictionary) -> int:
	for kind: String in prof["adventurePref"]:
		var options: Array = offer["options"]
		for i: int in options.size():
			if String(options[i]["kind"]) == kind:
				return i
	return 0


# ── 求值 ──────────────────────────────────────────────────

static func _clamp(v: float, lo: float, hi: float) -> float:
	return lo if v < lo else (hi if v > hi else v)


## 这张牌买进来，能让已有羁绊前进多少
static func _trait_gain(p: Dictionary, def_id: String) -> float:
	Spec.ensure()
	var def: Variant = Spec.champion_by_id.get(def_id, null)
	if def == null:
		return 0.0
	var owned: Array = []
	for u in GameState.all_units(p):
		owned.append(u["defId"])
	var before := Comp.compute_traits(owned)
	var after_input := owned.duplicate()
	after_input.append(def_id)
	var after := Comp.compute_traits(after_input)
	var s := 0.0
	for a: Dictionary in after:
		var found: Variant = null
		for b: Dictionary in before:
			if b["id"] == a["id"]:
				found = b
				break
		var bt := -1 if found == null else int(found["tier"])
		if int(a["tier"]) > bt:
			# 跨档 = 机制层面的质变，权重最高
			s += 16.0 * float(int(a["tier"]) + 1)
		elif found != null:
			# 已有一条（含未激活 tier=-1），向下一档推进 —— TS 判存在性而非 tier>=0
			s += 3.0
		else:
			# 全新羁绊：开新线也值一点分
			s += 0.4
	return s


static func _copies_of(p: Dictionary, def_id: String, star: int) -> int:
	var n := 0
	for u: Dictionary in GameState.all_units(p):
		if u["defId"] == def_id and int(u["star"]) == star:
			n += 1
	return n


## 立刻 / 逼近合成的额外价值。判序从高星级往下走（TS 注释里的坑原样保留语义）
static func merge_value(p: Dictionary, def_id: String) -> float:
	var two := _copies_of(p, def_id, 2)
	var one := _copies_of(p, def_id, 1)
	if two >= 2 and one >= 2:
		return 60.0
	if two >= 2:
		return 18.0
	if two == 1:
		return 18.0
	if one >= 2:
		return 26.0
	if one == 1:
		return 8.0
	return 0.0


## 备战席定期清理：卖掉「离合成最远」的低价值棋子，始终至少留 3 格
static func _tidy_bench(w, p: Dictionary) -> void:
	var free_slots := GameState.bench_slots() - GameState.bench_count(p)
	if free_slots >= 3:
		return
	var cands: Array = []
	for u: Variant in p["bench"]:
		if u == null:
			continue
		var one := _copies_of(p, u["defId"], 1)
		var two := _copies_of(p, u["defId"], 2)
		var v: float = GameState.power_score(u) * 0.5
		if int(u["star"]) == 1:
			v += 34.0 if one >= 3 else (24.0 if one == 2 else (2.0 if one == 1 else 0.0))
			# 场上已有 2★：这张 1★ 是通往第二个 2★ 的进度，绝不当垃圾卖
			if two >= 1:
				v += 22.0
		elif int(u["star"]) == 2:
			v += 60.0 if two >= 3 else (44.0 if two == 2 else (12.0 if two == 1 else 0.0))
		cands.append({ "iid": u["iid"], "v": v })
	cands = ParityUtil.stable_sort_by(cands, func(c) -> float: return float(c["v"]))
	var need := 3 - free_slots
	for c: Dictionary in cands:
		if need <= 0:
			break
		if GameState.all_units(p).size() <= 1:
			break
		if w.sell(p, int(c["iid"])):
			need -= 1


## 备战席满时，为更有价值的牌腾位置。核心判据「离合成有多近」而非「牌有多强」
static func _make_room_for(w, p: Dictionary, incoming: float) -> bool:
	if GameState.bench_count(p) < GameState.bench_slots():
		return true
	var worst_iid := -1
	var worst_val := INF
	for u: Variant in p["bench"]:
		if u == null:
			continue
		var v: float = GameState.power_score(u) * 0.4
		var one := _copies_of(p, u["defId"], 1)
		var two := _copies_of(p, u["defId"], 2)
		if int(u["star"]) == 1:
			v += 40.0 if one >= 3 else (22.0 if one == 2 else 4.0)
			if two >= 1:
				v += 22.0
		elif int(u["star"]) == 2:
			v += 60.0 if two >= 2 else (18.0 if two == 1 else 6.0)
		# 场上已有同名：留着等合成能直接提升战力
		var on_board := false
		for x: Variant in p["board"]:
			if x != null and x["defId"] == u["defId"]:
				on_board = true
				break
		if on_board:
			v += 12.0
		if v < worst_val:
			worst_val = v
			worst_iid = int(u["iid"])
	if worst_iid < 0:
		return false
	# 新牌必须明显更值得留才值得卖掉现有的一张
	if incoming <= worst_val * 1.15:
		return false
	return w.sell(p, worst_iid)


## 单张牌的购买欲望分。越高越想买。
static func score_card(p: Dictionary, def_id: String, round: int, prof: Dictionary) -> float:
	Spec.ensure()
	var def: Variant = Spec.champion_by_id.get(def_id, null)
	if def == null:
		return -1.0
	var fake := { "iid": -1, "defId": def_id, "star": 1, "items": [] }
	var s: float = GameState.power_score(fake) * 0.45
	s += _trait_gain(p, def_id)
	s += merge_value(p, def_id) * float(prof["mergeBias"])

	# 性格偏好
	var ts: Array = (def["origins"] as Array).duplicate()
	ts.append_array(def["classes"])
	for t: String in ts:
		if (prof["preferred"] as Array).has(t):
			s += 9.0
	# 费用与阶段的匹配度：前期高费卡买来也是废的
	var affordability := int(p["level"]) - int(def["cost"])
	if affordability < 0:
		s -= 8.0 * float(-affordability)
	# 后期低费卡价值衰减
	if round > 14 and int(def["cost"]) == 1:
		s -= 10.0
	if round > 20 and int(def["cost"]) <= 2:
		s -= 10.0

	# 开新线的隐性成本：占掉一个备战席格
	var owned := _copies_of(p, def_id, 1) + _copies_of(p, def_id, 2)
	if owned == 0:
		if GameState.all_units(p).is_empty():
			# 空手急救：任何买得起的牌都是急救
			s += 48.0
		else:
			var pressure := float(GameState.bench_count(p)) / float(GameState.bench_slots())
			# mergeBias 封顶 1.6：不允许放大到整店一张都评不过的死区
			s -= (6.0 + pressure * 22.0) * min(1.6, max(0.5, float(prof["mergeBias"])))
	return s


## 该等级下 AI 期望达到的人口
static func target_level(prof: Dictionary, round: int) -> int:
	var t := 2.0 + (round - 1) * 0.3 * float(prof["levelPace"])
	return int(_clamp(ParityUtil.js_round(t), 2.0, float(prof["levelCap"])))


# ── 决策 ──────────────────────────────────────────────────

## AI 执行一次完整的准备阶段决策。
## 顺序模仿真人：看牌 → 买 → 刷 → 升级 → 布阵 → 装配 →（手滑）→ 锁牌。
static func ai_take_turn(w, p: Dictionary) -> void:
	var prof: Variant = p["ai"]
	if prof == null:
		return
	var rng: Rng = w.rng

	var hp_ratio := float(p["hp"]) / Spec.c("PLAYER_START_HP")
	# 危机感：血越少越搏命
	var panic := _clamp(pow(1.0 - hp_ratio, 1.4), 0.0, 1.0)
	# 名次焦虑：人越少，越接近终局，越不能等
	var endgame := _clamp(float(8 - w.alive_count()) / 6.0, 0.0, 1.0)
	var urgency := _clamp(panic * 0.75 + endgame * 0.45, 0.0, 1.0)

	# 危机时把「存钱底线」整个掀掉
	var floor_n := int(max(0.0, ParityUtil.js_round(float(prof["rollFloor"]) * (1.0 - urgency * 0.85))))
	var aggression := _clamp(float(prof["aggression"]) + urgency * 0.35, 0.0, 1.0)
	var noise := float(prof["noise"])

	# ── 先整理备战席，再开始买 ──
	_tidy_bench(w, p)

	# ── 买牌 + 刷新 ──
	var rolls_left := int(ParityUtil.js_round(2.0 + aggression * 5.0))
	var guard := 0
	while guard < 24:
		guard += 1
		var bought := false
		# 阈值随危机感下降
		var threshold := 26.0 - urgency * 14.0 + (1.0 - aggression) * 8.0
		var slots := int(Spec.c("SHOP_SLOTS"))
		for s: int in slots:
			var id: Variant = p["shop"][s]
			if id == null:
				continue
			var def: Variant = Spec.champion_by_id.get(id, null)
			if def == null:
				continue
			if float(p["gold"]) < float(def["cost"]):
				continue
			# 先判定想不想要（含噪声），再谈腾位置 —— 卖是破坏性动作
			var want: float = score_card(p, id, w.round, prof) + (rng.next() - 0.5) * noise * 22.0
			if want < threshold:
				continue
			# 缺货的牌买入必败，不值得为它卖任何东西
			if w.pool.remaining(id) <= 0:
				continue
			# 备战席满了：好牌才值得腾位置；腾不动只跳过这一格
			if GameState.bench_count(p) >= GameState.bench_slots() and not _make_room_for(w, p, want):
				continue
			if w.buy(p, s)["ok"]:
				bought = true

		var can_afford_roll := float(p["gold"]) - Spec.c("REROLL_COST") >= float(floor_n)
		# 商店里已经没想要的了，才值得刷新
		var shop_is_dry := true
		for id: Variant in p["shop"]:
			if id != null and score_card(p, id, w.round, prof) >= 26.0 - urgency * 14.0:
				shop_is_dry = false
				break
		# 锁店候选在场时不刷新（掷骰在先，随机流消费顺序不变）
		var lock_worthy := false
		for id: Variant in p["shop"]:
			if id == null:
				continue
			var def: Variant = Spec.champion_by_id.get(id, null)
			if def == null or float(def["cost"]) <= float(p["gold"]) or float(def["cost"]) > float(p["gold"]) + _projected_next_income(p):
				continue
			if score_card(p, id, w.round, prof) >= 42.0:
				lock_worthy = true
				break
		# TS 短路序：(shopIsDry || !bought) 为真才消费 rng.next()，其后才看 lockWorthy
		var want_more := false
		if shop_is_dry or not bought:
			want_more = rng.next() < 0.35 + aggression * 0.6 and not lock_worthy
		if rolls_left > 0 and can_afford_roll and want_more:
			if not w.reroll(p):
				break
			rolls_left -= 1
			continue
		break

	# ── 升级 ──
	var target := target_level(prof, w.round)
	# 危机时更愿意把钱换成即时战力，但终局必须冲人口
	var level_reserve := 4.0 if urgency > 0.6 else float(max(6.0, floor_n))
	var level_guard := 0
	while int(p["level"]) < target and float(p["gold"]) >= Spec.c("XP_BUY_COST") + level_reserve and level_guard < 8:
		level_guard += 1
		if not w.buy_exp(p):
			break
	# 钱多到溢出又没到目标等级：继续砸经验；绝不突破性格等级上限
	while int(p["level"]) < int(prof["levelCap"]) and float(p["gold"]) >= 30.0 and level_guard < 12:
		level_guard += 1
		if not w.buy_exp(p):
			break

	# ── 布阵 ──
	Arrange.auto_arrange(p, w.pool)

	# ── 装配（必须在布阵后：装备只发给上场的棋子）──
	Inventory.auto_equip(p)

	# ── 手滑：偶尔做一次没道理的事（先于锁店判定，防洗掉已锁的旧牌）──
	if rng.next() < noise * 0.18 and float(p["gold"]) > 12.0:
		w.reroll(p)

	# ── 锁商店：很想要的牌这回合买不起、下回合能买得起 ──
	var lock := false
	for id: Variant in p["shop"]:
		if id == null:
			continue
		var def: Variant = Spec.champion_by_id.get(id, null)
		if def == null:
			continue
		if float(def["cost"]) <= float(p["gold"]):
			continue
		if float(def["cost"]) > float(p["gold"]) + _projected_next_income(p):
			continue
		if score_card(p, id, w.round, prof) >= 42.0:
			lock = true
			break
	p["shopLocked"] = lock


## 下一次准备阶段预计能拿到的钱（基础 + 利息粗估 + 连胜中位 2 金）
static func _projected_next_income(p: Dictionary) -> float:
	return Spec.c("INCOME_BASE") + min(Spec.c("INCOME_INTEREST_MAX"), floor(float(p["gold"]) / Spec.c("INCOME_INTEREST_TIER"))) + 2.0
