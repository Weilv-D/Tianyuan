## 自动布阵（src/game/arrange.ts 对齐版）。
## AI 每回合收拾阵容 + 玩家「一键布阵」。原则：羁绊覆盖 → 保 2 前排 →
## 同纵深中心铺开 → 溢出才卖（卖是最后手段）。
##
## 排序纪律：三处比较器都可能并列（powerScore/copies 相等常见），JS sort 稳定
## 而 Godot 不稳定 —— 全部走 stable_sort_by（多键用「次键先稳排、主键再稳排」radix）。
class_name Arrange
extends RefCounted


static func _depth_of(def_id: String) -> float:
	Spec.ensure()
	var e: Variant = Spec.champion_by_id.get(def_id, null)
	var cls := "warrior" if e == null else String(e["cls"])
	return float(GameState.UNIT_DEPTH.get(cls, 0.5))


## 重新布阵。就地修改 board/bench，溢出的棋子自动卖出并返还金币。
## 返回本次卖出返还的金币。
static func auto_arrange(p: Dictionary, pool: CardPool) -> float:
	var owned := GameState.all_units(p)
	if owned.is_empty():
		return 0.0

	var cap := int(min(GameState.board_cap(p), owned.size()))
	# byScore = 战力降序（稳定）
	var by_score := ParityUtil.stable_sort_by(owned, func(u) -> float: return -GameState.power_score(u))
	var chosen: Array = []
	var chosen_keys := {}
	var take := func(u) -> void:
		if chosen.size() < cap and not chosen_keys.has(u["iid"]):
			chosen_keys[u["iid"]] = true
			chosen.append(u)

	# 1) 先锁 2 个前排（全局战力序里最强的两个坦克）
	var tanks: Array = []
	for u in by_score:
		if _depth_of(u["defId"]) < 0.5:
			tanks.append(u)
	for i: int in int(min(2, tanks.size())):
		take.call(tanks[i])
	# 2) distinct 覆盖：每个名字上最强的一张（byScore 已按战力降序，首个即最强）
	var best_by_name := {}
	for u in by_score:
		if not best_by_name.has(u["defId"]):
			best_by_name[u["defId"]] = u
	for u in best_by_name.values():
		if chosen.size() >= cap:
			break
		take.call(u)
	# 3) 人口仍有空位：按战力补同名重复张（尊重同名堆场策略）
	for u in by_score:
		if chosen.size() >= cap:
			break
		take.call(u)

	# 站位：纵深小的先放（占前排），同纵深内战力高的靠中心
	# radix 两次稳定排：先次键（战力降序）再主键（纵深升序）
	chosen = ParityUtil.stable_sort_by(chosen, func(u) -> float: return -GameState.power_score(u))
	chosen = ParityUtil.stable_sort_by(chosen, func(u) -> float: return _depth_of(u["defId"]))

	var cols := int(Spec.c("BOARD_COLS"))
	var rows := int(Spec.c("ROWS_PER_SIDE"))
	var col_order := GameState.center_out_columns()

	var new_board := GameState.empty_board()
	var row_used: Array = []
	for r: int in rows:
		var row: Array = []
		row.resize(cols)
		row.fill(false)
		row_used.append(row)
	for u: Dictionary in chosen:
		var preferred := int(min(rows - 1, floor(_depth_of(u["defId"]) * float(rows))))
		var row := -1
		for r: int in range(preferred, rows):
			if not (row_used[r] as Array).has(false):
				continue
			row = r
			break
		if row < 0:
			for r: int in preferred:
				if not (row_used[r] as Array).has(false):
					continue
				row = r
				break
		var placed := false
		if row >= 0:
			for c: int in col_order:
				if not row_used[row][c]:
					row_used[row][c] = true
					new_board[row * cols + c] = u
					placed = true
					break
		if not placed:
			# 兜底：扫第一个空格并同步占用标记，防后续单位覆写
			for i: int in new_board.size():
				if new_board[i] == null:
					new_board[i] = u
					row_used[int(i / float(cols))][i % cols] = true
					break

	# 未上场的回备战席：优先保留「离合成最近」的（同名张数多的）
	var chosen_iids := {}
	for u: Dictionary in chosen:
		chosen_iids[u["iid"]] = true
	var rest: Array = []
	for u: Dictionary in owned:
		if not chosen_iids.has(u["iid"]):
			rest.append(u)
	var copies := {}
	for u: Dictionary in rest:
		copies[u["defId"]] = int(copies.get(u["defId"], 0)) + 1
	rest = ParityUtil.stable_sort_by(rest, func(u) -> float: return -GameState.power_score(u))
	rest = ParityUtil.stable_sort_by(rest, func(u) -> float: return -float(copies.get(u["defId"], 0)))

	var bench_slots := GameState.bench_slots()
	var new_bench: Array = []
	new_bench.resize(bench_slots)
	new_bench.fill(null)
	var refund := 0.0
	for i: int in rest.size():
		if i < bench_slots:
			new_bench[i] = rest[i]
		else:
			refund += GameState.sell_value(rest[i])
			# 溢出的棋子被卖掉：装备回器匣、卡回共享池 —— 两样都不能凭空消失
			Inventory.strip_items(p, rest[i])
			pool.give_unit(rest[i]["defId"], int(rest[i]["star"]))

	p["board"] = new_board
	p["bench"] = new_bench
	# 紧急保底：若棋盘仍为空而备战席有子，强行上最强的一张，避免零对抗局
	var board_empty := true
	for u in p["board"]:
		if u != null:
			board_empty = false
			break
	var bench_has := false
	for u in p["bench"]:
		if u != null:
			bench_has = true
			break
	if board_empty and bench_has:
		var bench_units := GameState.bench_units(p)
		bench_units = ParityUtil.stable_sort_by(bench_units, func(u) -> float: return -GameState.power_score(u))
		if not bench_units.is_empty():
			var best: Dictionary = bench_units[0]
			var bi := -1
			for i: int in (p["bench"] as Array).size():
				var u: Variant = p["bench"][i]
				if u != null and int(u["iid"]) == int(best["iid"]):
					bi = i
					break
			var dest := -1
			for i: int in (p["board"] as Array).size():
				if p["board"][i] == null:
					dest = i
					break
			if bi >= 0 and dest >= 0:
				p["bench"][bi] = null
				p["board"][dest] = best
	p["gold"] = float(p["gold"]) + refund
	return refund
