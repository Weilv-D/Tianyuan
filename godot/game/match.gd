## 对局编排（src/game/match.ts 对齐版）。
## 一整局 8 人自走棋状态机：准备 → 战斗 → 结算 → 淘汰，直到只剩一人。
## 契约：1) 无头可跑（零渲染/时钟）；2) 完全确定（唯一随机源 rng）；
## 3) 内核与编排解耦（Match 只管谁打谁/打完掉多少血）。
##
## pairings P0 契约（v3.2）：本回合配对随档持久化 + 读档 sanitize 整表弃用兜底 ——
## 不入档则读档重掷会让 rng 流分叉、交手史双记，打断「同种子同一局」契约。
class_name Match
extends RefCounted

const BEAST_ROUND_SCHEDULE: Array = [1, 7, 13, 19, 25]
const ADVENTURE_ROUND_SCHEDULE: Array = [4, 10, 16]
const BATTLE_SNAPSHOT_KEEP := 60

## 单只墨兽的掉落档：全员保底（胜负同发）+ 胜场追加
const BEAST_DROP_SCHEDULE: Array = [
	{ "round": 1, "comp": 2, "gold": 8, "winComp": 0, "winGold": 0, "winCompleted": 0 },
	{ "round": 7, "comp": 3, "gold": 12, "winComp": 1, "winGold": 4, "winCompleted": 0 },
	{ "round": 13, "comp": 4, "gold": 14, "winComp": 2, "winGold": 6, "winCompleted": 0 },
	{ "round": 19, "comp": 5, "gold": 16, "winComp": 2, "winGold": 8, "winCompleted": 1 },
	{ "round": 25, "comp": 5, "gold": 20, "winComp": 3, "winGold": 10, "winCompleted": 1 },
]

var seed: int
var rng: Rng
var pool: CardPool
var players: Array = []
var round := 0
var phase: String = "prep"
var pairings: Array = []
## 淘汰玩家留下的阵容快照（idx → board），奇数人时的「墨影」对战
var _ghosts: Dictionary = {}
## 本回合的墨兽阵容（全体玩家面对同一只）
var _beast_board = null
## 商店概率表覆盖（平衡工具链 A/B 用；对局主路径恒 null，不随档持久化）
var shop_table = null
## 事件日志（结算面板与调试用）
var log: Array = []
var settings: Dictionary = { "autoDeploy": true }
## 对局模式：daily 的种子来自日期哈希
var mode: String = "normal"
## 奇遇轮恩赐（非 null 表示待人选择；开战未选即过期清空）
var adventure_offer = null
## 每场战斗的快照（回放）：种子 + 双方配置 + 结果指纹，随档持久化
var battle_snapshots: Array = []


func _init(p_seed: int, human_name: String = "你", p_mode: String = "normal") -> void:
	Spec.ensure()
	mode = p_mode
	seed = p_seed & 0xFFFFFFFF
	rng = Rng.new(seed)
	pool = CardPool.new()
	players = []

	# 玩家 0 是人类，1~7 是 AI
	players.append(GameState.blank_player(0, human_name, true))
	for i: int in GameAi.AI_ROSTER.size():
		var entry: Dictionary = GameAi.AI_ROSTER[i]
		var p := GameState.blank_player(i + 1, entry["name"], false)
		p["ai"] = GameAi.make_profile(entry["arch"])
		players.append(p)
	log.append("对局开始 · 八方入场")


# ── 查询 ──────────────────────────────────────────────────

func human() -> Dictionary:
	return players[0]


func alive_players() -> Array:
	var out: Array = []
	for p: Dictionary in players:
		if p["alive"]:
			out.append(p)
	return out


func alive_count() -> int:
	return alive_players().size()


func is_over() -> bool:
	return alive_count() <= 1


## 当前排名（计分板排序），第 1 名在最前
func standings() -> Array:
	var out := (players as Array).duplicate()
	# 比较器末位 a.idx 决胜（全序），稳定性无歧义
	out.sort_custom(func(a, b) -> bool:
		var pa: Dictionary = a
		var pb: Dictionary = b
		if pa["alive"] != pb["alive"]:
			return pa["alive"]
		if not pa["alive"]:
			# 死者名次相等（仅坏档可达）：idx 决胜对齐 JS 稳定排序的保序语义
			var ra := int(pa["rank"]) if int(pa["rank"]) != 0 else 99
			var rb := int(pb["rank"]) if int(pb["rank"]) != 0 else 99
			if ra != rb:
				return ra < rb
			return int(pa["idx"]) < int(pb["idx"])
		if float(pa["hp"]) != float(pb["hp"]):
			return float(pa["hp"]) > float(pb["hp"])
		if int(pa["level"]) != int(pb["level"]):
			return int(pa["level"]) > int(pb["level"])
		return int(pa["idx"]) < int(pb["idx"])
	)
	return out


## 读档时是否需要先推进回合（phase='result' 的存档是结算已落盘的中间态，
## 直接进备战会二次结算；必须先 begin_round）
func needs_advance_on_load() -> bool:
	return phase == "result"


func is_beast_round(at_round: int = -1) -> bool:
	var r := round if at_round < 0 else at_round
	return BEAST_ROUND_SCHEDULE.has(r)


func is_adventure_round(at_round: int = -1) -> bool:
	var r := round if at_round < 0 else at_round
	return ADVENTURE_ROUND_SCHEDULE.has(r)


## 人类玩家点选奇遇恩赐（index 对应 options 下标；每回合至多一次）
func resolve_adventure(index: int) -> void:
	var offer: Variant = adventure_offer
	if offer == null:
		return
	var options: Array = offer["options"]
	if index < 0 or index >= options.size():
		return
	_grant_adventure(human(), options[index], int(offer["round"]))
	adventure_offer = null


## 开战时人类仍未点选：按「老谋」偏好序代选（纯函数零 rng，同一入口发放）
func resolve_human_adventure() -> bool:
	var offer: Variant = adventure_offer
	if offer == null:
		return false
	var idx := GameAi.choose_adventure_index(GameAi.make_profile("balanced"), offer)
	var options: Array = offer["options"]
	if idx < 0 or idx >= options.size():
		return false
	var opt: Dictionary = options[idx]
	_grant_adventure(human(), opt, int(offer["round"]))
	adventure_offer = null
	log.append("你自动选择了恩赐「%s」" % opt["title"])
	return true


## 发放一份奇遇恩赐（人类点选与 AI 即选共用同一入口）。
## 纪律：只走既有系统入账；入不了账按卖出价折金，卡与金币守恒。
func _grant_adventure(p: Dictionary, opt: Dictionary, at_round: int) -> void:
	match String(opt["kind"]):
		"gold":
			var gold_n := Adventure.adventure_gold(at_round)
			p["gold"] = float(p["gold"]) + gold_n
			log.append("%s 奇遇 · 金币 +%d" % [p["name"], gold_n])
		"xp":
			var xp_n := Adventure.adventure_xp(at_round)
			Economy.gain_xp(p, xp_n)
			log.append("%s 奇遇 · 经验 +%d（等级 %d）" % [p["name"], xp_n, int(p["level"])])
		"item":
			var item_id: String = rng.pick(Adventure.combined_item_ids())
			Inventory.add_item(p, item_id)
			var idef: Variant = Spec.item_by_id.get(item_id, null)
			var iname: String = String(idef["name"]) if idef != null else item_id
			log.append("%s 奇遇 · 丹青成装 · %s 入装备栏" % [p["name"], iname])
		"components":
			var comp_n := Adventure.adventure_components(at_round)
			var names: Array = []
			for i: int in comp_n:
				var cid: String = rng.pick(Spec.component_ids)
				Inventory.add_item(p, cid)
				var cidef: Variant = Spec.item_by_id.get(cid, null)
				names.append(String(cidef["name"]) if cidef != null else cid)
			log.append("%s 奇遇 · 组件 ×%d（%s）入装备栏" % [p["name"], comp_n, "、".join(names)])
		"level":
			# 走既有升级表：发放恰好升 1 级的经验；满级折金（4 金 = 4 经验口径）
			var need := Economy.xp_to_next(int(p["level"]))
			if need > 0:
				Economy.gain_xp(p, need)
				log.append("%s 奇遇 · 顿悟（等级 %d）" % [p["name"], int(p["level"])])
			else:
				var lvl_gold := Adventure.adventure_xp(at_round)
				p["gold"] = float(p["gold"]) + lvl_gold
				log.append("%s 奇遇 · 顿悟满级 · 折算金币 +%d" % [p["name"], lvl_gold])
		"reinforce":
			_grant_reinforce(p, at_round)


## 援军恩赐：2★ 棋子占卡池 3 张入驻备战席；入不了账按卖出价折金返还
func _grant_reinforce(p: Dictionary, at_round: int) -> void:
	var cost := Adventure.adventure_reinforce_cost(at_round)
	var refund := Adventure.reinforce_refund(at_round)
	if GameState.bench_count(p) >= GameState.bench_slots():
		p["gold"] = float(p["gold"]) + refund
		log.append("%s 奇遇 · 援军备战席已满 · 折算金币 +%d" % [p["name"], int(refund)])
		return
	var candidates: Array = []
	for id: String in Spec.champion_ids_by_cost.get(str(cost), []):
		if pool.remaining(id) >= 3:
			candidates.append(id)
	if candidates.is_empty():
		p["gold"] = float(p["gold"]) + refund
		log.append("%s 奇遇 · 援军卡池余量不足 · 折算金币 +%d" % [p["name"], int(refund)])
		return
	var id: String = rng.pick(candidates)
	for i: int in 3:
		pool.take(id)
	var u := GameState.create_unit(id, 2)
	var slot := GameState.add_to_bench(p, u)
	if slot < 0:
		# 理论不可达（上方已检查），防御性兜底：卡回池、折金
		pool.give_unit(id, 2)
		p["gold"] = float(p["gold"]) + refund
		log.append("%s 奇遇 · 援军备战席已满 · 折算金币 +%d" % [p["name"], int(refund)])
		return
	var merges := GameState.resolve_merges(p)
	var cdef: Variant = Spec.champion_by_id.get(id, null)
	log.append("%s 奇遇 · 援军 %s 2★ 入驻备战席" % [p["name"], String(cdef["name"]) if cdef != null else id])
	for m: Dictionary in merges:
		var mdef: Variant = Spec.champion_by_id.get(m["defId"], null)
		log.append("%s 合成 %s %d★" % [p["name"], String(mdef["name"]) if mdef != null else m["defId"], int(m["star"])])


## 展示名：墨兽轮显示「墨兽」而不是玩家名
func display_name_of_team(pair: Dictionary, team: int) -> String:
	var idx := player_idx_of_team(pair, team)
	if pair["beast"]:
		return Beast.BEAST_NAME
	if idx >= 0:
		return players[idx]["name"]
	if int(pair["ghost"]) >= 0:
		return "墨影"
	return "（轮空）"


# ── 回合开始 ──────────────────────────────────────────────

## 进入下一个准备阶段：发钱、涨经验、刷商店、AI 行动。
## rng 消费序（跨引擎对拍生命线）：beastBoard 生成 → adventureOffer 掷点 →
## 每存活玩家收入/经验（零 rng）→ 未锁商店 rollShop → AI 按 idx 序行动。
func begin_round() -> void:
	if is_over():
		phase = "over"
		return
	round += 1
	phase = "prep"

	# 墨兽阵容回合开始生成一次，全体玩家面对同一只
	_beast_board = Beast.generate_beast_board(round, rng) if is_beast_round() else null

	# 奇遇轮：全员共享同一份选项（offer 生成不依赖人类存活 —— 快进回合 AI 仍要分名次）
	adventure_offer = Adventure.roll_adventure_offer(round, rng) if is_adventure_round() else null

	for p: Dictionary in alive_players():
		# 1) 结算上一回合的收入（第一回合没有上一回合）
		if round > 1:
			var won: bool = p["lastOutcome"] == "win"
			var inc := Economy.compute_income(p, won, p["lastOutcome"] == "bye")
			p["gold"] = float(p["gold"]) + int(inc["total"])
		# 2) 经验
		Economy.gain_xp(p, Spec.c("XP_PER_ROUND"))
		# 3) 商店：锁定只保一回合，用掉即清
		if p["shopLocked"]:
			p["shopLocked"] = false
		else:
			p["shop"] = CardPool.roll_shop(pool, rng, int(p["level"]), shop_table)

	# 4) AI 行动（按 index 顺序保证确定性；恩赐即选在 aiTakeTurn 之前）
	for p: Dictionary in alive_players():
		if p["isHuman"]:
			continue
		if p["ai"] != null and adventure_offer != null:
			var idx := GameAi.choose_adventure_index(p["ai"], adventure_offer)
			var options: Array = adventure_offer["options"]
			_grant_adventure(p, options[idx], int(adventure_offer["round"]))
		GameAi.ai_take_turn(self, p)

	log.append("第 %d 回合 · 准备 · 存活 %d 人" % [round, alive_count()])

	# 5) 配对在回合开始即生成（备战期全程可侦查本轮对手）
	if not is_over():
		pairings = make_pairings()


# ── 玩家动作 ──────────────────────────────────────────────

## 买入商店第 slot 张（满席且同名 ≥2 时走溢出即合；任何入不了账整体回滚）
func buy(p: Dictionary, slot: int) -> Dictionary:
	# 域外/负 slot 对齐 TS 的 undefined→拒绝（GD 负索引会回绕误买）
	if slot < 0 or slot >= (p["shop"] as Array).size():
		return { "ok": false, "reason": "none" }
	var id: Variant = p["shop"][slot]
	if id == null:
		return { "ok": false, "reason": "none" }
	var def: Variant = Spec.champion_by_id.get(id, null)
	if def == null:
		return { "ok": false, "reason": "none" }
	if float(p["gold"]) < float(def["cost"]):
		return { "ok": false, "reason": "gold" }
	var copies := 0
	for u: Dictionary in GameState.all_units(p):
		if u["defId"] == id and int(u["star"]) == 1:
			copies += 1
	var bench_full := GameState.bench_count(p) >= GameState.bench_slots()
	if bench_full:
		if copies < 2:
			return { "ok": false, "reason": "bench" }
		var has_bench_victim := false
		for u: Variant in p["bench"]:
			if u != null and u["defId"] == id and int(u["star"]) == 1:
				has_bench_victim = true
				break
		if not has_bench_victim:
			return { "ok": false, "reason": "bench" }
	# 快照先于取卡：从此任何失败都整体回滚（含随机游标 —— 前瞻守卫，当前零 rng）
	var snap := Undo.snapshot_player(p, pool, adventure_offer)
	var rng_backup := rng.state
	# 卡池不足：保留商店格（缺货卡仍显示），不吞卡
	if not pool.take(id):
		return { "ok": false, "reason": "pool" }
	p["gold"] = float(p["gold"]) - float(def["cost"])
	p["shop"][slot] = null
	var u := GameState.create_unit(id, 1)

	if bench_full:
		# 溢出落位：新子临时占第 10 格（BENCH_SLOTS 之外的 push 槽）
		(p["bench"] as Array).append(u)
		var merges := GameState.resolve_merges(p)
		# 成功判定：合成消费两张旧同名 1★ 后第 10 格必须空出
		while (p["bench"] as Array).size() > GameState.bench_slots() and (p["bench"] as Array).back() == null:
			(p["bench"] as Array).pop_back()
		if merges.is_empty() or (p["bench"] as Array).size() > GameState.bench_slots():
			_rollback_buy(p, snap, rng_backup)
			return { "ok": false, "reason": "bench" }
		for m: Dictionary in merges:
			var mdef: Variant = Spec.champion_by_id.get(m["defId"], null)
			log.append("%s 合成 %s %d★（满席即合）" % [p["name"], String(mdef["name"]) if mdef != null else m["defId"], int(m["star"])])
		# 合成出的新 2★ 仍在席上则走自动上场
		if settings["autoDeploy"]:
			var upgraded = _find_bench_upgraded(p, id)
			if upgraded != null:
				try_auto_deploy(p, int(upgraded["iid"]))
		# 尾部收敛回 9 格（只截断不拉长 —— 补洞会让 iid 寻址抛错）
		while (p["bench"] as Array).size() > GameState.bench_slots():
			(p["bench"] as Array).pop_back()
		return { "ok": true }

	# 常路径：新子直接落空格；落不下整体回滚
	if GameState.add_to_bench(p, u) < 0:
		_rollback_buy(p, snap, rng_backup)
		return { "ok": false, "reason": "bench" }
	var normal_merges := GameState.resolve_merges(p)
	for m: Dictionary in normal_merges:
		var mdef: Variant = Spec.champion_by_id.get(m["defId"], null)
		log.append("%s 合成 %s %d★" % [p["name"], String(mdef["name"]) if mdef != null else m["defId"], int(m["star"])])
	# 新手友好：人口有空位就自动上场
	if settings["autoDeploy"]:
		var upgraded = null
		if not normal_merges.is_empty():
			upgraded = _find_bench_upgraded(p, id)
		else:
			upgraded = u
		if upgraded != null:
			try_auto_deploy(p, int(upgraded["iid"]))
	if (p["bench"] as Array).size() > GameState.bench_slots():
		(p["bench"] as Array).resize(GameState.bench_slots())
	return { "ok": true }


func _find_bench_upgraded(p: Dictionary, id) -> Variant:
	for b: Variant in p["bench"]:
		if b != null and b["defId"] == id and int(b["star"]) > 1:
			return b
	return null


## buy 的失败回滚：快照 + 恩赐 + 随机游标一次还原到位（与撤销层同口径）
func _rollback_buy(p: Dictionary, snap: Dictionary, rng_backup: int) -> void:
	Undo.restore_player(p, pool, snap, self)
	rng.state = rng_backup


## 卖出棋子，按星级返还金币并把卡放回池
func sell(p: Dictionary, iid: int) -> bool:
	var from_board := GameState._index_of_iid(p["board"], iid)
	var from_bench := -1
	if from_board < 0:
		from_bench = GameState._index_of_iid(p["bench"], iid)
	var slot := from_board if from_board >= 0 else from_bench
	if slot < 0:
		return false
	var arr: Array = p["board"] if from_board >= 0 else p["bench"]
	var u: Variant = arr[slot]
	if u == null:
		return false
	arr[slot] = null
	p["gold"] = float(p["gold"]) + GameState.sell_value(u)
	pool.give_unit(u["defId"], int(u["star"]))
	Inventory.strip_items(p, u)
	return true


## 刷新商店
func reroll(p: Dictionary) -> bool:
	if float(p["gold"]) < Spec.c("REROLL_COST"):
		return false
	p["gold"] = float(p["gold"]) - Spec.c("REROLL_COST")
	p["shop"] = CardPool.roll_shop(pool, rng, int(p["level"]), shop_table)
	return true


## 花 4 金买 4 经验
func buy_exp(p: Dictionary) -> bool:
	if int(p["level"]) >= int(Spec.c("MAX_LEVEL")):
		return false
	if float(p["gold"]) < Spec.c("XP_BUY_COST"):
		return false
	p["gold"] = float(p["gold"]) - Spec.c("XP_BUY_COST")
	Economy.gain_xp(p, Spec.c("XP_BUY_AMOUNT"))
	return true


## 把备战席棋子放到场上空位（自动布阵 / 买入后上场用）。
## 同名已在场 → 不上（自动上场保持单张口径，堆场是玩家的战术决定）
func try_auto_deploy(p: Dictionary, iid: int) -> bool:
	if GameState.board_count(p) >= GameState.board_cap(p):
		return false
	var slot := GameState._index_of_iid(p["bench"], iid)
	if slot < 0:
		return false
	var u: Dictionary = p["bench"][slot]
	var on_board := false
	for x: Variant in p["board"]:
		if x != null and x["defId"] == u["defId"]:
			on_board = true
			break
	if on_board:
		return false
	var target := suggest_slot(p, u["defId"])
	if target < 0:
		return false
	p["bench"][slot] = null
	p["board"][target] = u
	return true


## 按职业纵深推荐一个空格
func suggest_slot(p: Dictionary, def_id: String) -> int:
	var def: Variant = Spec.champion_by_id.get(def_id, null)
	var depth_raw := 0.5
	if def != null:
		depth_raw = float(GameState.UNIT_DEPTH.get(String(def["cls"]), 0.5))
	var preferred_row := int(min(3, floor(depth_raw * 4.0)))
	var order := GameState.center_out_columns()
	for r: int in range(preferred_row, 4):
		for c: int in order:
			var i := GameState.board_idx(c, r)
			if p["board"][i] == null:
				return i
	for i: int in (p["board"] as Array).size():
		if p["board"][i] == null:
			return i
	return -1


# ── 配对与战斗 ────────────────────────────────────────────

## 生成本回合的配对。随机洗牌后贪心配对，优先避开最近两回合交过手的对手；
## 奇数人时落单者与「墨影」交战；无人可复用则轮空。
## record_history=false 供读档清洗后的开战兜底重掷（交手史必须恰好记一次）。
func make_pairings(record_history: bool = true) -> Array:
	# 墨兽轮：每个存活玩家各自单挑同一只墨兽，玩家固定在下半场
	if is_beast_round():
		var beast_out: Array = []
		for p: Dictionary in alive_players():
			beast_out.append({ "a": p["idx"], "b": -1, "ghost": -1, "swap": true, "beast": true })
		return beast_out
	var alive: Array = []
	for p: Dictionary in alive_players():
		alive.append(int(p["idx"]))
	rng.shuffle(alive)
	var out: Array = []
	var used := {}

	for a: int in alive:
		if used.has(a):
			continue
		var cands: Array = []
		for b: int in alive:
			if b != a and not used.has(b):
				cands.append(b)
		if cands.is_empty():
			var ghost := _pick_ghost(a)
			out.append({ "a": a, "b": -1, "ghost": ghost, "swap": a == 0, "beast": false })
			used[a] = true
			continue
		var recent_src: Array = players[a]["opponents"]
		var recent: Array = recent_src.slice(maxi(0, recent_src.size() - 2))
		var fresh: Array = []
		for b: int in cands:
			if not recent.has(b):
				fresh.append(b)
		var b: int = (fresh[0] if not fresh.is_empty() else cands[0])
		used[a] = true
		used[b] = true
		# 人类玩家固定打下半场
		out.append({ "a": a, "b": b, "ghost": -1, "swap": a == 0, "beast": false })
		if record_history:
			(players[a]["opponents"] as Array).append(b)
			(players[b]["opponents"] as Array).append(a)
	return out


## 取一个墨影对手：最近被淘汰、且有阵容可复用的玩家（rank 相等时按 players 序 —— 稳定排序）
func _pick_ghost(for_idx: int) -> int:
	var dead: Array = []
	for p: Dictionary in players:
		if not p["alive"] and int(p["idx"]) != for_idx:
			dead.append(p)
	if dead.is_empty():
		return -1
	dead = ParityUtil.stable_sort_by(dead, func(p) -> float:
		return float(int(p["rank"]) if int(p["rank"]) != 0 else 99))
	for d: Dictionary in dead:
		if _has_ghost_squad(int(d["idx"])):
			return int(d["idx"])
	return -1


## 该玩家的墨影快照可用：快照存在且至少有一名棋子（生成侧/清洗侧同一判据）
func _has_ghost_squad(idx: int) -> bool:
	var board: Variant = _ghosts.get(idx, null)
	if board == null or not (board is Array):
		return false
	for u in board:
		if u != null:
			return true
	return false


## 读档配对表清洗（from_json 专用）：逐条验型 + 全表自洽，任一违例整表弃用。
func _sanitize_pairings(raw) -> Array:
	var n := players.size()
	var beast_round := is_beast_round()
	var parsed: Array = []
	var covered := {}
	for q: Variant in raw:
		if not (q is Dictionary):
			return []
		var a: Variant = q.get("a", null)
		var b: Variant = q.get("b", null)
		var ghost: Variant = q.get("ghost", null)
		var swap: Variant = q.get("swap", null)
		var beast: Variant = q.get("beast", null)
		var idx_ok := func(v, mn: int) -> bool:
			return ParityUtil.js_is_int(v) and int(v) >= mn and int(v) < n
		if not idx_ok.call(a, 0) or not idx_ok.call(b, -1) or not idx_ok.call(ghost, -1):
			return []
		if not (swap is bool) or not (beast is bool):
			return []
		if int(a) == int(b) or covered.has(int(a)) or (int(b) >= 0 and covered.has(int(b))):
			return []
		if beast != beast_round:
			return []
		if beast and (int(b) != -1 or int(ghost) != -1):
			return []
		# 非墨兽行 b 与 ghost 互斥：双设语义不明，同一粒度整表弃用
		if not beast and int(b) >= 0 and int(ghost) != -1:
			return []
		if int(ghost) != -1:
			var gp: Variant = players[int(ghost)] if int(ghost) < players.size() else null
			if gp == null or gp["alive"] or not _has_ghost_squad(int(ghost)):
				return []
		covered[int(a)] = true
		if int(b) >= 0:
			covered[int(b)] = true
		parsed.append({ "a": int(a), "b": int(b), "ghost": int(ghost), "swap": swap, "beast": beast })
	# 覆盖不变量：每个存活玩家在 a∪b 中恰好出现一次
	var alive_n := 0
	for p: Dictionary in players:
		if p["alive"]:
			alive_n += 1
	if covered.size() != alive_n:
		return []
	for p: Dictionary in players:
		if p["alive"] and not covered.has(int(p["idx"])):
			return []
	return parsed


## 记录一个玩家的阵容快照（每回合结束调用，淘汰后即成为墨影）
func _snapshot(p: Dictionary) -> void:
	_ghosts[int(p["idx"])] = GameState.clone_board(p["board"])


## 把一个半场棋盘展开成入场单位（uid 从 1/101 起顺序分配）
static func push_board(out: Array, board: Array, team: int) -> void:
	var i := 0
	for idx: int in board.size():
		var u: Variant = board[idx]
		if u == null:
			continue
		var entry := {
			"uid": (i + 1 if team == 0 else 101 + i),
			"defId": u["defId"],
			"team": team,
			"star": int(u["star"]),
			"cell": { "c": GameState.board_col_of(idx), "r": GameState.local_to_global_row(team, GameState.board_row_of(idx)) },
		}
		if (u["items"] as Array).size() > 0:
			entry["items"] = (u["items"] as Array).duplicate()
		if u.get("isBeast", false):
			entry["monster"] = true
		if u.has("powMult"):
			entry["powMult"] = u["powMult"]
		out.append(entry)
		i += 1


## 棋盘 → uid 映射（分配规则与 push_board 完全一致，结算对号用）
static func board_uids(board: Array, team: int) -> Dictionary:
	var out := {}
	var i := 0
	for u: Variant in board:
		if u == null:
			continue
		out[(i + 1 if team == 0 else 101 + i)] = u
		i += 1
	return out


## 构造一场战斗的配置。种子 = 对局种子 ^ 回合 ^ 配对（派生可复现）。
## swap 把 pair.a 放到下半场 —— 玩家永远从下半场观战。
func build_battle_config(pair: Dictionary, swap: bool = false) -> Dictionary:
	var pa: Dictionary = players[int(pair["a"])]
	var battle_seed: int = (seed ^ (round * 0x9e3779b1) ^ (int(pair["a"]) * 0x85ebca6b) ^ ((int(pair["b"]) + 2) * 0xc2b2ae35)) & 0xFFFFFFFF
	var opponent_board := board_of_opponent(pair)

	var team_a := 1 if swap else 0
	var team_b := 0 if swap else 1

	var units: Array = []
	push_board(units, pa["board"], team_a)
	push_board(units, opponent_board, team_b)

	return {
		"seed": battle_seed,
		"units": units,
		# traits 键必须字符串化：battle 构造按 str(team) 读（JSON 载荷键天然是字符串，
		# 内存构造时 int 键会静默 miss —— 羁绊全部丢失，M2 实证）
		"traits": {
			str(team_a): _traits_of(pa["board"]),
			str(team_b): _traits_of(opponent_board),
		},
	}


## 棋盘 → 激活羁绊列表
## 公开包装（render 层跨类消费的合法入口；私有 _traits_of 保持对拍口径不变）
func traits_of_board(board: Array) -> Array:
	return _traits_of(board)


func _traits_of(board: Array) -> Array:
	var ids: Array = []
	for u: Variant in board:
		if u != null:
			ids.append(u["defId"])
	return Comp.compute_traits(ids)


## 无头跑完一场。record_events=true 时记事件流摘要（回放校验面）。
## 快照追加是纯观察者：不触碰 this.rng，战斗结果与后续 rng 流不受影响。
func run_battle_headless(pair: Dictionary, swap = null, record_events: bool = false) -> Dictionary:
	var use_swap: bool = bool(pair["swap"]) if swap == null else bool(swap)
	var config := build_battle_config(pair, use_swap)
	var battle := Battle.new(config, Callable(), record_events)
	var result: Dictionary = battle.run()
	battle_snapshots.append({
		"round": round,
		"config": config,
		"winner": result.get("winner", null),
		"ticks": result.get("ticks", 0),
		"eventsDigest": Replay.fnv1a_hex(JSON.stringify(battle.events)) if record_events else "",
	})
	if battle_snapshots.size() > BATTLE_SNAPSHOT_KEEP:
		battle_snapshots.pop_front()
	return result


# ── 结算 ──────────────────────────────────────────────────

## 败方应受的伤害 = 阶段基础伤害 + 胜方每个存活单位的追加伤害。
## 第 1 回合（引导轮）归零。
func damage_of(result: Dictionary, winner_team: int, winner_board: Array) -> float:
	if round == 1:
		return 0.0
	var curve: Array = Spec.cfg.get("ROUND_BASE_DAMAGE", [])
	# 空表守卫：TS 侧 curve[-1] 是 undefined→NaN 静默传播；GD 负索引读空数组直接崩
	# 对局循环（spec 对账门禁下不可达，属纵深防御）
	var base_curve: float = 0.0
	if curve.is_empty():
		push_error("ROUND_BASE_DAMAGE 缺失（spec 损坏）——阶段基础伤害按 0 结算")
	else:
		base_curve = float(curve[min(round, curve.size() - 1)])
	# 后期处决曲线放缓：只放缓「阶段处决」，不动「打赢余威」
	# MATCH_TUNING 兜底值与 config.ts 真源同值（spec 对账门禁保证键在位；
	# 兜底仅防 JSON 损坏，不得偏离真源——否则处决曲线静默漂移）
	var tuning: Dictionary = Spec.cfg.get("MATCH_TUNING", {})
	var late_scale := float(tuning.get("lateDamageCurveScale", 0.75)) if round >= int(tuning.get("lateDamageCurveFromRound", 16)) else 1.0
	if int(result.get("winner", -1)) < 0:
		# 非法战斗（_bad_input 哨兵）：不判胜负不扣血（TS 上抛无结果，GD 合成 result 的等价口径）
		push_error("战斗结果非法（winner=-1）：本场按无效处理")
		return 0.0
	var uids := board_uids(winner_board, winner_team)
	var extra := 0.0
	for uid in result.get("survivors", {}).get(winner_team, []):
		var u: Variant = uids.get(uid, null)
		if u == null:
			continue
		extra += float(tuning.get("damagePerSurvivor", 2.0)) + float(int(u["star"]) - 1) * float(tuning.get("damagePerStar", 1.0))
	return max(1.0, ParityUtil.js_round((base_curve * late_scale + extra) * float(tuning.get("playerDamageScale", 0.5))))


## 结算一场战斗：更新连胜连败、扣血、判定淘汰。
## 契约：同一 Pairing 只得结算一次 —— 二次结算即双倍掉血/重复掉落。
func apply_battle_result(pair: Dictionary, result: Dictionary) -> Array:
	var pa: Dictionary = players[int(pair["a"])]
	var opponent_board := board_of_opponent(pair)
	var out: Array = []

	# 轮空：不掉血不给连胜奖励（墨兽配对的 b/ghost 同为 -1，必须排除）
	if not pair["beast"] and int(pair["b"]) < 0 and int(pair["ghost"]) < 0:
		pa["lastOutcome"] = "bye"
		pa["lastDamage"] = 0.0
		out.append({ "idx": pa["idx"], "outcome": "bye", "damage": 0.0, "hpAfter": pa["hp"], "eliminated": false, "drops": [], "gold": 0.0 })
		return out

	if result.get("winner", null) == null:
		# 同归于尽：双方不掉血，连胜连败清零；墨兽平局照样走保底
		pa["lastOutcome"] = "draw"
		pa["streak"] = 0
		pa["lastDamage"] = 0.0
		var draw_drop := _roll_item_drops(pa, false) if pair["beast"] else { "items": [], "gold": 0.0 }
		out.append({ "idx": pa["idx"], "outcome": "draw", "damage": 0.0, "hpAfter": pa["hp"], "eliminated": false, "drops": draw_drop["items"], "gold": draw_drop["gold"] })
		if int(pair["b"]) >= 0:
			var pb: Dictionary = players[int(pair["b"])]
			pb["lastOutcome"] = "draw"
			pb["streak"] = 0
			pb["lastDamage"] = 0.0
			out.append({ "idx": pb["idx"], "outcome": "draw", "damage": 0.0, "hpAfter": pb["hp"], "eliminated": false, "drops": [], "gold": 0.0 })
		return out

	# 空阵直胜：一方零上场子时首 tick 即判单队胜（平局已在上游返回）
	var pa_empty := true
	for u: Variant in pa["board"]:
		if u != null:
			pa_empty = false
			break
	var opp_empty := true
	for u: Variant in opponent_board:
		if u != null:
			opp_empty = false
			break
	if pa_empty or opp_empty:
		if pa_empty and opp_empty:
			pa["lastOutcome"] = "draw"
			pa["streak"] = 0
			pa["lastDamage"] = 0.0
			out.append({ "idx": pa["idx"], "outcome": "draw", "damage": 0.0, "hpAfter": pa["hp"], "eliminated": false, "drops": [], "gold": 0.0 })
			if int(pair["b"]) >= 0:
				var pb0: Dictionary = players[int(pair["b"])]
				pb0["lastOutcome"] = "draw"
				pb0["streak"] = 0
				pb0["lastDamage"] = 0.0
				out.append({ "idx": pb0["idx"], "outcome": "draw", "damage": 0.0, "hpAfter": pb0["hp"], "eliminated": false, "drops": [], "gold": 0.0 })
			return out
		var empty_winner_team: int = (0 if pair["swap"] else 1) if pa_empty else (1 if pair["swap"] else 0)
		var empty_winner_board: Array = opponent_board if pa_empty else pa["board"]
		var fake_result := { "winner": empty_winner_team, "ticks": 1, "survivors": {}, "remainingHpRatio": {}, "timeout": false }
		var dmg_empty := damage_of(fake_result, empty_winner_team, empty_winner_board)
		if pa_empty:
			_apply_loss(pa, dmg_empty, out, players[int(pair["b"])] if int(pair["b"]) >= 0 else null, pair["beast"])
			if int(pair["b"]) >= 0:
				_apply_win(players[int(pair["b"])], out)
		else:
			_apply_win(pa, out, pair["beast"])
			if int(pair["b"]) >= 0:
				_apply_loss(players[int(pair["b"])], dmg_empty, out, pa, false)
		return out

	# pair.a 在 swap 时位于 team 1，「a 是否获胜」按交换后的队号判断
	var a_team: int = 1 if pair["swap"] else 0
	var winner_team: int = int(result["winner"])
	var a_won := winner_team == a_team
	var dmg := damage_of(result, winner_team, pa["board"] if a_won else opponent_board)

	if a_won:
		_apply_win(pa, out, pair["beast"])
	# 墨影战：赢了没人可掉血；输了照样掉血
	if int(pair["b"]) >= 0:
		var pb: Dictionary = players[int(pair["b"])]
		if a_won:
			_apply_loss(pb, dmg, out, pa, false)
		else:
			_apply_win(pb, out, false)
	if not a_won:
		_apply_loss(pa, dmg, out, players[int(pair["b"])] if int(pair["b"]) >= 0 else null, pair["beast"])
	return out


func _apply_win(p: Dictionary, out: Array, beast = false) -> void:
	p["wins"] = int(p["wins"]) + 1
	p["lastOutcome"] = "win"
	p["lastDamage"] = 0.0
	_apply_streak(p, true)
	var drop: Dictionary = _roll_item_drops(p, true) if beast else { "items": [], "gold": 0.0 }
	out.append({ "idx": p["idx"], "outcome": "win", "damage": 0.0, "hpAfter": p["hp"], "eliminated": false, "drops": drop["items"], "gold": drop["gold"] })


func _apply_loss(p: Dictionary, dmg: float, out: Array, winner, beast = false) -> void:
	p["losses"] = int(p["losses"]) + 1
	p["lastOutcome"] = "loss"
	p["lastDamage"] = dmg
	p["hp"] = max(0.0, float(p["hp"]) - dmg)
	_apply_streak(p, false)
	if winner != null:
		winner["totalDamage"] = float(winner["totalDamage"]) + dmg
	var dead: bool = float(p["hp"]) <= 0.0 and p["alive"]
	if dead:
		_eliminate(p)
	# 墨兽轮败野按真源表保底发放（下限口径）
	var drop: Dictionary = _roll_item_drops(p, false) if beast else { "items": [], "gold": 0.0 }
	out.append({ "idx": p["idx"], "outcome": "loss", "damage": dmg, "hpAfter": p["hp"], "eliminated": dead, "drops": drop["items"], "gold": drop["gold"] })


func board_of_opponent(pair: Dictionary) -> Array:
	if pair["beast"]:
		return _beast_board if _beast_board != null else GameState.empty_board()
	if int(pair["b"]) >= 0:
		return players[int(pair["b"])]["board"]
	var board: Variant = _ghosts.get(int(pair["ghost"]), null)
	return board if board is Array else GameState.empty_board()


## 人类视角的本场对手棋盘（人类可能是 a 也可能是 b，对手永远是「另一方」）
func board_faced_by_human(pair: Dictionary) -> Array:
	if pair["beast"]:
		return _beast_board if _beast_board != null else GameState.empty_board()
	if int(pair["b"]) == 0:
		return players[int(pair["a"])]["board"]
	return board_of_opponent(pair)


## 某个队伍对应的玩家序号。-1 = 墨影 / 轮空
func player_idx_of_team(pair: Dictionary, team: int) -> int:
	var team_of_a: int = 1 if pair["swap"] else 0
	if team == team_of_a:
		return int(pair["a"])
	return int(pair["b"])


## 墨兽轮掉落：按 BEAST_DROP_SCHEDULE 真源表发放（全员保底 + 胜场追加）。
## 发放不设器匣上限（与 stripItems 同一守恒口径：装备只进不出）。
func _roll_item_drops(p: Dictionary, won: bool) -> Dictionary:
	# 真源表只覆盖墨兽轮：非墨兽轮误入说明调用方守卫丢了
	if not is_beast_round():
		return { "items": [], "gold": 0.0 }
	var tier: Variant = null
	for t: Dictionary in BEAST_DROP_SCHEDULE:
		if int(t["round"]) == round:
			tier = t
			break
	if tier == null:
		push_error("墨兽轮 %d 无掉落档：BEAST_DROP_SCHEDULE 与墨兽轮调度表失同步" % round)
		return { "items": [], "gold": 0.0 }
	var comp := int(tier["comp"]) + (int(tier["winComp"]) if won else 0)
	var items: Array = []
	for i: int in comp:
		var id: String = rng.pick(Spec.component_ids)
		Inventory.add_item(p, id)
		items.append(id)
	if won:
		for i: int in int(tier["winCompleted"]):
			var id: String = rng.pick(Adventure.combined_item_ids())
			Inventory.add_item(p, id)
			items.append(id)
	var gold := int(tier["gold"]) + (int(tier["winGold"]) if won else 0)
	p["gold"] = float(p["gold"]) + gold
	return { "items": items, "gold": gold }


func _apply_streak(p: Dictionary, won: bool) -> void:
	if won:
		p["streak"] = (int(p["streak"]) + 1 if int(p["streak"]) > 0 else 1)
		if int(p["streak"]) > int(p["bestStreak"]):
			p["bestStreak"] = int(p["streak"])
	else:
		p["streak"] = (int(p["streak"]) - 1 if int(p["streak"]) < 0 else -1)


func _eliminate(p: Dictionary) -> void:
	_snapshot(p)
	p["alive"] = false
	# 淘汰名次 = 淘汰瞬间还活着的人数（含自己）
	p["rank"] = alive_count() + 1
	# 阵容回池：让别人能感觉到「某某死了，他的牌回到池子里了」
	for u: Dictionary in GameState.all_units(p):
		Inventory.strip_items(p, u)
		pool.give_unit(u["defId"], int(u["star"]))
	p["board"] = GameState.empty_board()
	p["bench"] = GameState.empty_bench()
	log.append("%s 被淘汰 · 第 %d 名" % [p["name"], int(p["rank"])])


## 结算本回合全部战斗（结算顺序确定性：按 this.pairings 产出序）。
## 前置：本回合已 make_pairings；结算后清空防重入。
func settle_round() -> Array:
	var outs: Array = []
	for pair: Dictionary in pairings:
		outs.append(apply_battle_result(pair, run_battle_headless(pair)))
	pairings = []
	return outs


## 每回合战斗全部结束后调用：快照阵容、推进阶段、判定结束
func end_round() -> void:
	for p: Dictionary in alive_players():
		_snapshot(p)
	if is_over():
		phase = "over"
		var alive := alive_players()
		if not alive.is_empty():
			var last: Dictionary = alive[0]
			last["rank"] = 1
			log.append("%s 获得胜利 · 第 1 名" % last["name"])
	else:
		phase = "result"


# ── 存档 ──────────────────────────────────────────────────

## 可序列化快照（复合字段一律深拷贝：toJSON→fromJSON 轮转不共享引用）
func to_json() -> Dictionary:
	var ghosts_out: Array = []
	for k in _ghosts.keys():
		ghosts_out.append([k, GameState.clone_board(_ghosts[k])])
	return {
		"seed": seed,
		"rngState": rng.state,
		"round": round,
		"phase": phase,
		"pool": pool.snapshot(),
		"players": (players as Array).duplicate(true),
		"ghosts": ghosts_out,
		"beastBoard": GameState.clone_board(_beast_board) if _beast_board != null else null,
		"settings": settings.duplicate(),
		"mode": mode,
		"battleSnapshots": (battle_snapshots as Array).duplicate(true),
		"adventureOffer": adventure_offer.duplicate(true) if adventure_offer != null else null,
		"pairings": pairings.map(func(q) -> Dictionary: return q.duplicate()),
	}


static func _finite_or(v, fallback: float) -> float:
	if ParityUtil.js_finite(v):
		return float(v)
	return fallback


## 奇遇恩赐验型（from_json 专用）
static func _sanitize_offer(raw) -> Variant:
	if raw == null:
		return null
	if not (raw is Dictionary):
		return null
	var offer: Dictionary = raw
	var round_v: Variant = offer.get("round", null)
	if not ParityUtil.js_finite(round_v) or not (offer.get("options", null) is Array):
		return null
	var options: Array = offer["options"]
	if options.size() < 2 or options.size() > 3:
		return null
	var kinds := {}
	for k: String in Adventure.DISPLAY_ORDER:
		kinds[k] = true
	for opt: Variant in options:
		if not (opt is Dictionary) or not kinds.has(String((opt as Dictionary).get("kind", ""))):
			return null
	return offer


## 单元条目清洗（from_json 专用，pool.restore 同一容错粒度）。
## 返回 { unit, cleaned, refund? }：refund 是「已知 defId 但条目损坏」时该回的池。
static func _sanitize_unit_entry(raw, strip_beast: bool = false) -> Dictionary:
	if raw == null:
		return { "unit": null, "cleaned": false }
	if not (raw is Dictionary):
		return { "unit": null, "cleaned": true }
	var u: Dictionary = raw
	var def_id: Variant = u.get("defId", null)
	if not (def_id is String) or not Spec.champion_by_id.has(def_id):
		return { "unit": null, "cleaned": true }
	var star_v: Variant = u.get("star", null)
	var clamp_star := func(v) -> int:
		return int(min(3, max(1, ParityUtil.js_round(float(v))))) if ParityUtil.js_finite(v) else 1
	if not ParityUtil.js_finite(u.get("iid", null)):
		return { "unit": null, "cleaned": true, "refund": { "defId": def_id, "star": clamp_star.call(star_v) } }
	if not ParityUtil.js_finite(star_v):
		return { "unit": null, "cleaned": true, "refund": { "defId": def_id, "star": clamp_star.call(star_v) } }
	var cleaned := false
	if u.has("powMult") and not ParityUtil.js_finite(u["powMult"]):
		u.erase("powMult")
		cleaned = true
	if strip_beast and u.get("isBeast", false):
		u.erase("isBeast")
		cleaned = true
	var star: Variant = u["star"]
	if not ParityUtil.js_is_int(star) or int(star) < 1 or int(star) > 3:
		u["star"] = int(min(3, max(1, ParityUtil.js_round(float(star)))))
		cleaned = true
	var items_v: Variant = u.get("items", null)
	if items_v is Array:
		var before := (items_v as Array).size()
		var kept: Array = []
		for id: Variant in items_v:
			if id is String and Spec.item_by_id.has(id):
				kept.append(id)
		if kept.size() > Inventory.MAX_ITEMS_PER_UNIT:
			kept = kept.slice(0, Inventory.MAX_ITEMS_PER_UNIT)
		u["items"] = kept
		if kept.size() != before:
			cleaned = true
	else:
		u["items"] = []
		cleaned = true
	return { "unit": u, "cleaned": cleaned }


## 读档：结构校验 + 逐层清洗（坏档守卫的完整移植；任何验型失败抛错，
## 与 TS throw 同口径 —— 调用方 save.gd 捕获后整档作废）。
static func from_json(data: Dictionary) -> Match:
	var round_v: Variant = data.get("round", null)
	var rng_v: Variant = data.get("rngState", null)
	if not ParityUtil.js_finite(round_v) or float(round_v) < 1.0:
		push_error("invalid round in save")
		return null
	if not ParityUtil.js_finite(rng_v):
		push_error("invalid rngState in save")
		return null
	# 白名单只含 Match 真正会产出的三态：'battle' 是渲染层演出态，坏档即拒收
	var phase_v: Variant = data.get("phase", "prep")
	if phase_v != null and phase_v != "" and not (phase_v is String and (phase_v == "prep" or phase_v == "result" or phase_v == "over")):
		push_error("invalid phase in save")
		return null
	var seed_v: float = float(data.get("seed", 0)) if ParityUtil.js_finite(data.get("seed", null)) else 0.0
	var mode_v: Variant = data.get("mode", "normal")
	if mode_v != null and mode_v != "normal" and mode_v != "daily":
		push_error("invalid mode in save")
		return null
	var m := Match.new(int(seed_v), "你", mode_v if mode_v != null else "normal")
	m.rng.state = int(data["rngState"])
	m.round = int(data["round"])
	m.phase = String(phase_v)
	m.pool.restore(data.get("pool", {}))
	# 玩家条目清洗（board/bench 长度收敛 + 数值缺省 + 名单过滤 + 超长回池）
	# 计数器装箱：lambda 按值捕获标量，+1 必须经字典引用回传（M1 纪律 7）
	var cleaned_counter := { "n": 0 }
	var players_raw: Variant = data.get("players", null)
	if not (players_raw is Array) or (players_raw as Array).is_empty():
		push_error("corrupted players array in save")
		return null
	var max_level := int(Spec.c("MAX_LEVEL"))
	var shop_slots := int(Spec.c("SHOP_SLOTS"))
	for pi: int in players_raw.size():
		var pl: Variant = players_raw[pi]
		if not (pl is Dictionary):
			push_error("corrupted player entry in save")
			return null
		if not ParityUtil.js_finite(pl.get("gold", null)) or not ParityUtil.js_finite(pl.get("hp", null)) or not ParityUtil.js_finite(pl.get("level", null)):
			push_error("corrupted player numeric stats in save")
			return null
		if int(pl["level"]) < 1 or int(pl["level"]) > max_level:
			push_error("invalid player level in save")
			return null
		pl["idx"] = pi  # 序号以数组位置为真源
		pl["xp"] = _finite_or(pl.get("xp", null), 0.0)
		pl["streak"] = int(_finite_or(pl.get("streak", null), 0.0))
		pl["bestStreak"] = int(_finite_or(pl.get("bestStreak", null), 0.0))
		pl["wins"] = int(_finite_or(pl.get("wins", null), 0.0))
		pl["losses"] = int(_finite_or(pl.get("losses", null), 0.0))
		pl["rank"] = int(_finite_or(pl.get("rank", null), 0.0))
		pl["lastDamage"] = _finite_or(pl.get("lastDamage", null), 0.0)
		pl["totalDamage"] = _finite_or(pl.get("totalDamage", null), 0.0)
		if not (pl.get("isHuman", null) is bool):
			pl["isHuman"] = pi == 0
		var name_v: Variant = pl.get("name", null)
		if not (name_v is String) or String(name_v).is_empty():
			pl["name"] = ("你" if pl["isHuman"] else "诸侯%d" % pi)
		if not (pl.get("alive", null) is bool):
			pl["alive"] = float(pl["hp"]) > 0.0
		var outcome: Variant = pl.get("lastOutcome", null)
		if not (outcome == null or outcome == "win" or outcome == "loss" or outcome == "draw" or outcome == "bye"):
			pl["lastOutcome"] = null
		# 器匣：非数组清空，名单外装备剥离
		var items_v: Variant = pl.get("items", null)
		if not (items_v is Array):
			items_v = []
		var kept_items: Array = []
		for id: Variant in items_v:
			if id is String and Spec.item_by_id.has(id):
				kept_items.append(id)
		pl["items"] = kept_items
		# 商店：恒 N 格；坏条目收敛为空格，不重掷（商店随档持久化是随机流契约面）
		var raw_shop: Variant = pl.get("shop", null)
		var shop_fixed: Array = []
		shop_fixed.resize(shop_slots)
		shop_fixed.fill(null)
		if raw_shop is Array:
			for i: int in int(min(shop_slots, (raw_shop as Array).size())):
				var v: Variant = raw_shop[i]
				if v is String and Spec.champion_by_id.has(v):
					shop_fixed[i] = v
		pl["shop"] = shop_fixed
		pl["shopLocked"] = pl.get("shopLocked", null) == true
		var opp_v: Variant = pl.get("opponents", null)
		if not (opp_v is Array):
			opp_v = []
		var kept_opp: Array = []
		for v: Variant in opp_v:
			if ParityUtil.js_is_int(v) and int(v) >= 0 and int(v) < players_raw.size():
				kept_opp.append(int(v))
		pl["opponents"] = kept_opp
		# AI 原型档案：损坏按 arch 重建，arch 不在名单回落「老谋」；人类必须 null
		var ai_raw: Variant = pl.get("ai", null)
		var arch := "balanced"
		if ai_raw is Dictionary:
			var arch_raw: Variant = ai_raw.get("arch", null)
			if arch_raw is String and GameAi.ARCHETYPE.has(arch_raw):
				arch = String(arch_raw)
		pl["ai"] = null if pl["isHuman"] else GameAi.make_profile(arch)
		# 槽位收敛：坏形状重建 + 超长截断回池（卡可以坏，不能凭空蒸发）
		var repair_slots := func(raw, width: int) -> Array:
			var src: Array = raw if raw is Array else []
			var nb: Array = []
			nb.resize(width)
			nb.fill(null)
			for i: int in int(min(width, src.size())):
				nb[i] = src[i]
			for i: int in range(width, src.size()):
				var u: Variant = src[i]
				if u is Dictionary and String(u.get("defId", "")) is String and Spec.champion_by_id.has(u.get("defId", null)):
					var raw_star: Variant = u.get("star", null)
					var star: int = int(min(3, max(1, ParityUtil.js_round(float(raw_star))))) if ParityUtil.js_finite(raw_star) else 1
					m.pool.give_unit(u["defId"], star)
					cleaned_counter["n"] = int(cleaned_counter["n"]) + 1
			return nb
		if not (pl.get("board", null) is Array) or (pl["board"] as Array).size() != GameState.board_cells():
			pl["board"] = repair_slots.call(pl.get("board", null), GameState.board_cells())
		if not (pl.get("bench", null) is Array) or (pl["bench"] as Array).size() != GameState.bench_slots():
			pl["bench"] = repair_slots.call(pl.get("bench", null), GameState.bench_slots())
		# 单元条目清洗（玩家条目剥墨兽标记；计数走装箱字典）
		var unit_cleaned := { "n": 0 }
		var keep_or_refund := func(cell) -> Variant:
			var r: Dictionary = _sanitize_unit_entry(cell, true)
			if r.get("refund", null) != null:
				m.pool.give_unit(r["refund"]["defId"], int(r["refund"]["star"]))
			if r["cleaned"]:
				unit_cleaned["n"] = int(unit_cleaned["n"]) + 1
			return r["unit"]
		var board_fixed: Array = []
		for cell in pl["board"]:
			board_fixed.append(keep_or_refund.call(cell))
		pl["board"] = board_fixed
		var bench_fixed: Array = []
		for cell in pl["bench"]:
			bench_fixed.append(keep_or_refund.call(cell))
		pl["bench"] = bench_fixed
		cleaned_counter["n"] = int(cleaned_counter["n"]) + int(unit_cleaned["n"])
	m.players = players_raw
	# 墨影快照与墨兽阵容同口径清洗
	var converge_board32 := func(raw) -> Array:
		var src: Array = raw if raw is Array else []
		var board: Array = []
		board.resize(GameState.board_cells())
		board.fill(null)
		for i: int in int(min(GameState.board_cells(), src.size())):
			board[i] = src[i] if src[i] != null else null
		return board
	var ghosts_fixed := {}
	var ghosts_raw: Variant = data.get("ghosts", null)
	if ghosts_raw is Array:
		for entry: Variant in ghosts_raw:
			# 每条墨影必须是 [玩家序号, 棋盘数组]；坏条目整条丢弃
			if entry is Array and (entry as Array).size() >= 2 and ParityUtil.js_is_int(entry[0]):
				ghosts_fixed[int(entry[0])] = converge_board32.call(entry[1])
	m._ghosts = ghosts_fixed
	m._beast_board = converge_board32.call(data.get("beastBoard", null)) if data.get("beastBoard", null) is Array else null
	for k in m._ghosts.keys():
		var board: Array = m._ghosts[k]
		for i: int in board.size():
			var r: Dictionary = _sanitize_unit_entry(board[i])
			if r["cleaned"]:
				cleaned_counter["n"] = int(cleaned_counter["n"]) + 1
			board[i] = r["unit"]
	if m._beast_board != null:
		for i: int in (m._beast_board as Array).size():
			var r: Dictionary = _sanitize_unit_entry(m._beast_board[i])
			if r["cleaned"]:
				cleaned_counter["n"] = int(cleaned_counter["n"]) + 1
			m._beast_board[i] = r["unit"]
	# iid 去重（分层域：对局实况一域；每条墨影、墨兽阵容各一域 —— 快照与本人实况
	# 合法同 iid，跨域共集会把好档的墨影整片误杀）
	var make_dedup := func() -> Callable:
		var seen := {}
		return func(cells: Array) -> void:
			for i: int in cells.size():
				var u: Variant = cells[i]
				if u == null:
					continue
				if seen.has(int(u["iid"])):
					cells[i] = null
					cleaned_counter["n"] = int(cleaned_counter["n"]) + 1
				else:
					seen[int(u["iid"])] = true
	var dedup_live: Callable = make_dedup.call()
	for p: Dictionary in m.players:
		dedup_live.call(p["board"])
		dedup_live.call(p["bench"])
	for k in m._ghosts.keys():
		(make_dedup.call()).call(m._ghosts[k])
	if m._beast_board != null:
		(make_dedup.call()).call(m._beast_board)
	if int(cleaned_counter["n"]) > 0:
		push_warning("[save] 存档内容与本版名单/口径不一致，已清洗 %d 处（丢弃/钳制/回池），其余保留" % int(cleaned_counter["n"]))
	var settings_raw: Variant = data.get("settings", null)
	m.settings = { "autoDeploy": not (settings_raw is Dictionary and settings_raw.get("autoDeploy", null) == false) }
	# 快照载荷验型 + 窗口收敛（坏条目丢弃，超窗裁最旧）
	var snaps_fixed: Array = []
	var snaps_raw: Variant = data.get("battleSnapshots", null)
	if snaps_raw is Array:
		for s: Variant in snaps_raw:
			if not (s is Dictionary):
				continue
			var b: Dictionary = s
			if ParityUtil.js_finite(b.get("round", null)) and ParityUtil.js_finite(b.get("ticks", null)) \
					and (b.get("winner", null) == 0 or b.get("winner", null) == 1 or b.get("winner", null) == null) \
					and b.get("config", null) is Dictionary \
					and b.get("eventsDigest", null) is String:
				snaps_fixed.append(b)
		if snaps_fixed.size() > BATTLE_SNAPSHOT_KEEP:
			snaps_fixed = snaps_fixed.slice(snaps_fixed.size() - BATTLE_SNAPSHOT_KEEP)
	m.battle_snapshots = snaps_fixed
	m.adventure_offer = _sanitize_offer(data.get("adventureOffer", null))
	# 时刻自洽：恩赐只在奇遇轮的本回合内存在，脱钩的 offer 是冒领面
	if m.adventure_offer != null and (int(m.adventure_offer["round"]) != m.round or not m.is_adventure_round()):
		m.adventure_offer = null
		if data.get("adventureOffer", null) != null:
			cleaned_counter["n"] = int(cleaned_counter["n"]) + 1
	# 本回合配对（v3.2 起）：逐条验型 + 全表自洽，违例整表弃用回落重掷
	if data.has("pairings"):
		var pairings_raw: Variant = data["pairings"]
		m.pairings = m._sanitize_pairings(pairings_raw) if pairings_raw is Array else []
	# iid 计数器必须扫到所有存活引用（含墨影快照与墨兽阵容）
	var max_iid := 0
	for p: Dictionary in m.players:
		for u: Dictionary in GameState.all_units(p):
			if int(u["iid"]) > max_iid:
				max_iid = int(u["iid"])
	for k in m._ghosts.keys():
		for u: Variant in m._ghosts[k]:
			if u != null and int(u["iid"]) > max_iid:
				max_iid = int(u["iid"])
	if m._beast_board != null:
		for u: Variant in m._beast_board:
			if u != null and int(u["iid"]) > max_iid:
				max_iid = int(u["iid"])
	GameState.bump_iid_counter(max_iid)
	return m
