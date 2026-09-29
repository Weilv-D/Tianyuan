## 对局状态核心（src/game/state.ts 的 GDScript 对齐版）。
## 纯数据 + 纯函数：UnitInstance / PlayerState 均为 Dictionary（snake_case 与 TS 同名），
## 不引用任何渲染/场景 API。随机一律来自 Match 持有的 Rng（本文件零 rng 消费）。
##
## 设计契约（与 TS 同源）：同名棋子允许同时上场；羁绊按「是否拥有该棋子」唯一计数。
class_name GameState
extends RefCounted


## 己方半场格数（4 行 × 8 列）——行/列一律读 config 真源
static func board_cells() -> int:
	return int(Spec.c("BOARD_COLS")) * int(Spec.c("ROWS_PER_SIDE"))


static func bench_slots() -> int:
	return int(Spec.c("BENCH_SLOTS"))


## 本地行（0=前排）→ 全局 8×8 棋盘行号
static func local_to_global_row(team: int, local_row: int) -> int:
	var rows := int(Spec.c("ROWS_PER_SIDE"))
	return (rows - 1 - local_row) if team == 0 else (rows + local_row)


static func board_idx(col: int, local_row: int) -> int:
	return local_row * int(Spec.c("BOARD_COLS")) + col


## 职业纵深：0 = 最前排，1 = 最后排（autoPlace / arrange / suggestSlot 单一真源）
const UNIT_DEPTH := {
	"guardian": 0.0,
	"warrior": 0.12,
	"assassin": 0.95,
	"marksman": 0.72,
	"mage": 0.78,
	"warlock": 0.6,
	"support": 0.88,
}


## 由中心向两侧的列填充顺序（8 列 → [3,4,2,5,1,6,0,7]），保证阵型对称
static func center_out_columns() -> Array:
	var out: Array = []
	var cols := int(Spec.c("BOARD_COLS"))
	var mid := int(cols / 2.0) - 1
	for i: int in cols:
		out.append((mid - i / 2) if i % 2 == 0 else (mid + (i + 1) / 2))
	return out


static func board_col_of(i: int) -> int:
	return i % int(Spec.c("BOARD_COLS"))


static func board_row_of(i: int) -> int:
	return int(i / float(Spec.c("BOARD_COLS")))


# ── 单位/玩家构造 ─────────────────────────────────────────

## 商店恒 N 格（SHOP_SLOTS 真源；存档清洗侧同款重建）
static func _empty_shop() -> Array:
	var shop: Array = []
	shop.resize(int(Spec.c("SHOP_SLOTS")))
	shop.fill(null)
	return shop


static var _next_iid := 1

static func new_iid() -> int:
	var v := _next_iid
	_next_iid += 1
	return v


## 读档后需要把计数器推到安全位置
static func bump_iid_counter(v: int) -> void:
	if v >= _next_iid:
		_next_iid = v + 1


static func create_unit(def_id: String, star: int = 1) -> Dictionary:
	return { "iid": new_iid(), "defId": def_id, "star": star, "items": [] }


## 深拷贝一个单位（保留 isBeast / powMult 等可选自有属性 —— TS 的 { ...u } 语义）
static func clone_unit(u: Dictionary) -> Dictionary:
	var c := u.duplicate()
	c["items"] = (u["items"] as Array).duplicate()
	return c


static func empty_board() -> Array:
	var a: Array = []
	a.resize(board_cells())
	a.fill(null)
	return a


static func empty_bench() -> Array:
	var a: Array = []
	a.resize(bench_slots())
	a.fill(null)
	return a


static func clone_board(board: Array) -> Array:
	var out: Array = []
	out.resize(board.size())
	for i: int in board.size():
		out[i] = clone_unit(board[i]) if board[i] is Dictionary else null
	return out


## 供 undo/存档共用的槽位数组克隆（board/bench 同一语义）
static func clone_slots(slots: Array) -> Array:
	return clone_board(slots)


static func blank_player(idx: int, player_name: String, is_human: bool) -> Dictionary:
	return {
		"idx": idx,
		"name": player_name,
		"isHuman": is_human,
		"hp": Spec.c("PLAYER_START_HP"),
		"gold": 2.0,
		"level": 2,
		"xp": 0.0,
		"streak": 0,
		"bestStreak": 0,
		"board": empty_board(),
		"bench": empty_bench(),
		"items": [],
		"shop": _empty_shop(),
		"shopLocked": false,
		"alive": true,
		"rank": 0,
		"opponents": [],
		"wins": 0,
		"losses": 0,
		"ai": null,
		"lastOutcome": null,
		"lastDamage": 0.0,
		"totalDamage": 0.0,
	}


# ── 查询 ──────────────────────────────────────────────────

static func board_units(p: Dictionary) -> Array:
	var out: Array = []
	for u in p["board"]:
		if u != null:
			out.append(u)
	return out


static func board_count(p: Dictionary) -> int:
	var n := 0
	for u in p["board"]:
		if u != null:
			n += 1
	return n


static func bench_units(p: Dictionary) -> Array:
	var out: Array = []
	for u in p["bench"]:
		if u != null:
			out.append(u)
	return out


static func bench_count(p: Dictionary) -> int:
	var n := 0
	for u in p["bench"]:
		if u != null:
			n += 1
	return n


static func all_units(p: Dictionary) -> Array:
	var out := board_units(p)
	out.append_array(bench_units(p))
	return out


## 上场人口上限 = 等级
static func board_cap(p: Dictionary) -> int:
	return int(p["level"])


## 卖出返还。2★ = 三张 1★ 的价值 - 1，鼓励「合成即锁定价值」
static func sell_value(u: Dictionary) -> float:
	Spec.ensure()
	var def: Variant = Spec.champion_by_id.get(u["defId"], null)
	if def == null:
		return 0.0
	return sell_refund_for(int(def["cost"]), int(u["star"]))


## 按费用与星级算卖出返还 —— 卖出 / 援军折金共用同一口径
static func sell_refund_for(cost: int, star: int) -> float:
	if star == 1:
		return float(cost)
	if star == 2:
		return float(cost * 3 - 1)
	return float(cost * 9 - 1)


## 棋子「战力估值」（AI 选谁上场、卖谁）。口径边界与 TS 同源：只覆盖血/攻/法三轴
## 与天命/登峰体量层；机制包按粗估常量折 90 分，不做成结算复算。
static func power_score(u: Dictionary) -> float:
	Spec.ensure()
	var def: Variant = Spec.champion_by_id.get(u["defId"], null)
	if def == null:
		return 0.0
	var s := int(u["star"])
	var si := s - 1
	var legend := int(def["cost"]) == 5 and s == 3
	var hp_m := Spec.legend("hpMult") if legend else 1.0
	var pow_m := Spec.legend("powerMult") if legend else 1.0
	var elite := int(def["cost"]) == 4 and s == 3
	var elite_hp_m := float(Spec.cfg.get("T3_ELITE_COST4", {}).get("hpMult", 1.0)) if elite else 1.0
	var elite_pow_m := float(Spec.cfg.get("T3_ELITE_COST4", {}).get("powerMult", 1.0)) if elite else 1.0
	var base: Dictionary = def["base"]
	var hp: float = float(base["hp"]) * Spec.c("GLOBAL_HP_SCALE") * Spec.star_scale("STAR_HP_SCALE", si) * hp_m * elite_hp_m
	var atk: float = float(base["atk"]) * Spec.star_scale("STAR_POWER_SCALE", si) * pow_m * elite_pow_m
	var sp: float = float(base["sp"]) * Spec.star_scale("STAR_POWER_SCALE", si) * pow_m * elite_pow_m
	return hp * 0.012 + atk * 1.0 + sp * 0.8 + (4.0 if float(base["range"]) >= 3.0 else 0.0) + float(s) * 6.0 \
		+ (90.0 if legend else 0.0)


# ── 增删 ──────────────────────────────────────────────────

## 放入备战席第一个空位。成功返回索引，满返回 -1
static func add_to_bench(p: Dictionary, u: Dictionary) -> int:
	for i: int in bench_slots():
		if p["bench"][i] == null:
			p["bench"][i] = u
			return i
	return -1


static func find_unit(p: Dictionary, iid: int) -> Variant:
	for u in p["board"]:
		if u != null and int(u["iid"]) == iid:
			return u
	for u in p["bench"]:
		if u != null and int(u["iid"]) == iid:
			return u
	return null


# ── 三合成升星 ────────────────────────────────────────────

## 检查并执行所有可能的三合成，支持级联（3 个 2★ → 1 个 3★）。
## 移除优先级：优先吃掉备战席的同名棋子，保留场上战力。
## 合成落点：参与合成的三张里有场上的，落在场上那张的位置；否则备战席那张的位置。
static func resolve_merges(p: Dictionary) -> Array:
	var events: Array = []
	var changed := true
	var guard := 0
	while changed and guard < 32:
		guard += 1
		changed = false
		var groups := {}
		for i: int in (p["board"] as Array).size():
			var u: Variant = p["board"][i]
			if u == null or int(u["star"]) >= 3:
				continue
			var k := "%s#%d" % [u["defId"], int(u["star"])]
			if not groups.has(k):
				groups[k] = []
			(groups[k] as Array).append({ "iid": u["iid"], "star": u["star"], "where": "board", "slot": i })
		for i: int in (p["bench"] as Array).size():
			var u: Variant = p["bench"][i]
			if u == null or int(u["star"]) >= 3:
				continue
			var k := "%s#%d" % [u["defId"], int(u["star"])]
			if not groups.has(k):
				groups[k] = []
			(groups[k] as Array).append({ "iid": u["iid"], "star": u["star"], "where": "bench", "slot": i })

		for key: String in groups.keys():
			var list: Array = groups[key]
			if list.size() < 3:
				continue
			var def_id := key.substr(0, key.rfind("#"))
			var star := int(list[0]["star"])
			# 排序：场上的排前面（保住场上位置），同区按 slot（where+slot 全序，稳定性无歧义）
			list = ParityUtil.stable_sort_by(list, func(e) -> float:
				return (1.0 if String(e["where"]) == "bench" else 0.0) * 1000.0 + float(e["slot"]))
			var keep: Dictionary = list[0]
			var eat := [list[1], list[2]]
			# 被吃掉的两张：身上的装备先退回器匣 —— 装备是玩家资产，合成不是回收站
			for e: Dictionary in eat:
				var eaten: Variant = p["board"][e["slot"]] if e["where"] == "board" else p["bench"][e["slot"]]
				if eaten is Dictionary:
					for it in eaten["items"]:
						(p["items"] as Array).append(it)
				if e["where"] == "board":
					p["board"][e["slot"]] = null
				else:
					p["bench"][e["slot"]] = null
			var keep_unit: Dictionary = p["board"][keep["slot"]] if keep["where"] == "board" else p["bench"][keep["slot"]]
			var merged := clone_unit(keep_unit)
			merged["star"] = star + 1
			if keep["where"] == "board":
				p["board"][keep["slot"]] = merged
			else:
				p["bench"][keep["slot"]] = merged
			events.append({ "defId": def_id, "star": star + 1, "onBoard": keep["where"] == "board" })
			changed = true
			break  # 重新扫描，保证级联按正确顺序发生
	return events


# ── 上场 / 下场 ────────────────────────────────────────────

## 槽位数组里按 iid 找下标（TS findIndex 等价）
static func _index_of_iid(arr: Array, iid: int) -> int:
	for i: int in arr.size():
		var u: Variant = arr[i]
		if u != null and u is Dictionary and int(u["iid"]) == iid:
			return i
	return -1


## 把棋子移动到任意槽位（棋盘 ↔ 备战席，或各自内部），目标格有人则两者交换。
## 拖拽的唯一落点操作 —— 一次交换语义统一处理四种拖拽方向。
static func move_to_slot(p: Dictionary, iid: int, where: String, slot) -> bool:
	var src_board := _index_of_iid(p["board"], iid)
	var src_bench := -1
	if src_board < 0:
		src_bench = _index_of_iid(p["bench"], iid)
	if src_board < 0 and src_bench < 0:
		return false
	var src_arr: Array = p["board"] if src_board >= 0 else p["bench"]
	var src_slot := src_board if src_board >= 0 else src_bench
	var dst_arr: Array = p["board"] if where == "board" else p["bench"]
	# 槽位守卫（与 can_place 同口径）：非整数/越界以拒绝路径不触碰任何数组
	if not ParityUtil.js_is_int(slot) or int(slot) < 0 or int(slot) >= dst_arr.size():
		return false
	var u: Variant = src_arr[src_slot]
	if u == null:
		return false
	var occupant: Variant = dst_arr[int(slot)]
	src_arr[src_slot] = occupant
	dst_arr[int(slot)] = u
	return true


## 这次拖拽是否允许。UI 层在松手前就要知道，用于给落点染色。
static func can_place(p: Dictionary, iid: int, where: String, slot) -> Dictionary:
	var max_slots: int = (p["board"] if where == "board" else p["bench"]).size()
	if not ParityUtil.js_is_int(slot) or int(slot) < 0 or int(slot) >= max_slots:
		return { "ok": false, "reason": "无效的位置" }
	var src_board := _index_of_iid(p["board"], iid)
	var on_board_now := src_board >= 0
	var u: Variant = null
	if on_board_now:
		u = p["board"][src_board]
	else:
		# 备战席查无此 iid 时 -1 会回绕末格（GD 负索引），必须显式拒绝
		var bi := _index_of_iid(p["bench"], iid)
		if bi < 0:
			return { "ok": false, "reason": "找不到这个棋子" }
		u = p["bench"][bi]
	if u == null or not (u is Dictionary):
		return { "ok": false, "reason": "找不到这个棋子" }

	if where == "board":
		var occupant: Variant = p["board"][int(slot)]
		var moving_in := not on_board_now
		if moving_in and occupant == null and board_count(p) >= board_cap(p):
			return { "ok": false, "reason": "人口已满（%d/%d），先升级或撤下一个" % [board_count(p), board_cap(p)] }
	return { "ok": true }


## 一枚棋子当前全部可放置槽位（己方半场 32 格 + 备战席 9 格）
static func valid_placements(p: Dictionary, iid: int) -> Array:
	var out: Array = []
	for slot: int in board_cells():
		if can_place(p, iid, "board", slot)["ok"]:
			out.append({ "where": "board", "slot": slot })
	for slot: int in bench_slots():
		if can_place(p, iid, "bench", slot)["ok"]:
			out.append({ "where": "bench", "slot": slot })
	return out
