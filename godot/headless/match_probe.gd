extends SceneTree
## 整局对拍探针：读 data/match_fixture.json（TS 侧 match_parity.mjs 生成），
## 按同一剧本重放整局（人类动作/恩赐/撤销/存档轮转交叉读档/每日模式），
## 每回合产出状态编码行与 TS 侧逐行比对。全等才退出码 0。
##
## 编码口径与 tools/match_parity.mjs 的 encodeMatch 逐字符对齐（见其文件头注释）。

const MAX_ROUNDS := 45


func _initialize() -> void:
	var f := FileAccess.open("res://data/match_fixture.json", FileAccess.READ)
	if f == null:
		print('MATCH_JSON {"ok":false,"error":"fixture missing（先跑 node --import tsx tools/match_parity.mjs）"}')
		quit(1)
		return
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	f.close()
	if parsed == null or not (parsed is Dictionary):
		print('MATCH_JSON {"ok":false,"error":"fixture parse failed"}')
		quit(1)
		return
	var fx: Dictionary = parsed

	var daily: Dictionary = fx.get("daily", {})
	var daily_seed_ts: int = int(daily.get("seed", 0))
	# 每日种子口径对拍：本地日期字段（无 UTC 换算）→ FNV-1a
	var daily_seed_gd: int = Daily.daily_seed_for({ "year": daily.get("y", 0), "month": daily.get("m", 0), "day": daily.get("d", 0) })

	var cases: Array = fx["cases"]
	var total := 0
	var passed := 0
	var failures: Array = []
	var t0 := Time.get_ticks_usec()
	for case_d: Dictionary in cases:
		var r := _run_case(case_d)
		total += 1
		if r["ok"]:
			passed += 1
		else:
			failures.append(r)
	var ms := (Time.get_ticks_usec() - t0) / 1000.0
	var report := {
		"ok": failures.is_empty() and daily_seed_gd == daily_seed_ts,
		"passed": passed,
		"failed": total - passed,
		"dailySeed": { "ts": daily_seed_ts, "gd": daily_seed_gd },
		"failures": failures.slice(0, 3),
		"ms": ms,
	}
	print("MATCH_JSON " + JSON.stringify(report))
	quit(0 if report["ok"] else 1)


func _run_case(case_d: Dictionary) -> Dictionary:
	var case_name := "seed=%s mode=%s" % [str(case_d.get("seed")), str(case_d.get("mode"))]
	var m: Match = Match.new(int(case_d["seed"]), "你", str(case_d.get("mode")))
	var script: Dictionary = case_d.get("script", {})
	var snapshot_texts: Dictionary = case_d.get("snapshotTexts", {})
	var want_lines: Array = case_d["lines"]
	var want_final: String = case_d["finalLine"]
	var li := 0
	while not m.is_over() and m.round < MAX_ROUNDS:
		m.begin_round()
		var acts: Array = script.get(str(m.round), [])
		for act: Dictionary in acts:
			_apply_action(m, act)
		m.settle_round()
		m.end_round()
		var got := encode_match(m)
		if li >= want_lines.size():
			return _fail(case_name, li, want_lines, got, "overflow")
		if got != str(want_lines[li]):
			return _fail(case_name, li, want_lines, got, "round %d" % m.round)
		li += 1
		# 存档轮转：交叉读档 —— 直接消费 TS 侧产出的存档 JSON 文本（schema 兼容面）
		if m.round == 5 or m.round == 13 or m.round == 21:
			var text: String = snapshot_texts.get(str(m.round), "")
			if text.is_empty():
				return _fail(case_name, li, want_lines, "missing snapshotText", "round %d" % m.round)
			var wrap: Variant = JSON.parse_string(text)
			if wrap == null or not (wrap is Dictionary):
				return _fail(case_name, li, want_lines, "snapshot parse failed", "round %d" % m.round)
			var m2: Variant = Match.from_json(wrap["data"])
			if m2 == null:
				return _fail(case_name, li, want_lines, "from_json null", "round %d" % m.round)
			m = m2
			var reload_line := "RELOAD|" + encode_match(m)
			if li >= want_lines.size() or reload_line != str(want_lines[li]):
				return _fail(case_name, li, want_lines, reload_line, "reload round %d" % m.round)
			li += 1
	var final_got := "FINAL|" + encode_match(m)
	if final_got != want_final:
		return _fail(case_name, li, want_lines, final_got, "final")
	return { "ok": true, "case": case_name }


func _fail(case_name: String, li: int, want_lines: Array, got: String, where: String) -> Dictionary:
	var want := "<end>" if li >= want_lines.size() else str(want_lines[li])
	# 差异点 ± 窗口（截断到固定前缀会掩盖真实分叉位）
	var i := 0
	while i < min(want.length(), str(got).length()) and want[i] == str(got)[i]:
		i += 1
	var lo: int = maxi(0, i - 80)
	return {
		"ok": false,
		"case": case_name,
		"line": li,
		"where": where,
		"diffAt": i,
		"want": want.substr(lo, 200),
		"got": str(got).substr(lo, 200),
	}


# ── 动作重放（相对寻址，与 TS applyAction 同款求值） ─────────

func _kth_shop_slot(m: Match, k: int) -> int:
	var seen := -1
	var shop: Array = m.human()["shop"]
	for i: int in shop.size():
		if shop[i] != null:
			seen += 1
			if seen == k:
				return i
	return -1


func _kth_of(units: Array, k: int) -> Variant:
	var seen := 0
	for u: Variant in units:
		if u == null:
			continue
		if seen == k:
			return u
		seen += 1
	return null


func _apply_action(m: Match, act: Dictionary) -> void:
	var p := m.human()
	match str(act["t"]):
		"buy":
			var slot := _kth_shop_slot(m, int(act.get("k", 0)))
			if slot >= 0:
				m.buy(p, slot)
		"reroll":
			m.reroll(p)
		"buyexp":
			m.buy_exp(p)
		"sellbench":
			var u = _kth_of(p["bench"], int(act.get("k", 0)))
			if u != null:
				m.sell(p, int(u["iid"]))
		"sellboard":
			var u = _kth_of(p["board"], int(act.get("k", 0)))
			if u != null:
				m.sell(p, int(u["iid"]))
		"move":
			var src: Array = p["bench"] if str(act.get("fw")) == "bench" else p["board"]
			var u = _kth_of(src, int(act.get("fk", 0)))
			if u == null:
				return
			var slot := int(act.get("tr", 0)) * 8 + int(act.get("tc", 0)) if str(act.get("tw")) == "board" else int(act.get("tk", 0))
			GameState.move_to_slot(p, int(u["iid"]), str(act["tw"]), slot)
		"equip":
			var items: Array = p["items"]
			var ik := int(act.get("ik", 0))
			var item: Variant = items[ik] if ik < items.size() else null
			var domain: Array = []
			for u in p["board"]:
				if u != null:
					domain.append(u)
			for u in p["bench"]:
				if u != null:
					domain.append(u)
			var u = _kth_of(domain, int(act.get("uk", 0)))
			if item != null and u != null:
				Inventory.equip_item(p, int(u["iid"]), item)
		"unequipall":
			var domain: Array = []
			for u in p["board"]:
				if u != null:
					domain.append(u)
			for u in p["bench"]:
				if u != null:
					domain.append(u)
			var u = _kth_of(domain, int(act.get("uk", 0)))
			if u != null:
				Inventory.unequip_all(p, int(u["iid"]))
		"autobuild":
			Arrange.auto_arrange(p, m.pool)
		"autoequip":
			Inventory.auto_equip(p)
		"adv":
			m.resolve_adventure(int(act.get("i", 0)))
		"autoadv":
			m.resolve_human_adventure()
		"undo":
			var snap := Undo.snapshot_player(p, m.pool, m.adventure_offer)
			var rng_backup := m.rng.state
			m.reroll(p)
			var slot := _kth_shop_slot(m, 0)
			if slot >= 0:
				m.buy(p, slot)
			Undo.restore_player(p, m.pool, snap, m)
			m.rng.state = rng_backup


# ── 状态编码器（与 tools/match_parity.mjs encodeMatch 逐字符对齐） ─────────

func _enc_cells(board: Array) -> String:
	var parts: Array = []
	for i: int in board.size():
		var u: Variant = board[i]
		if u == null:
			continue
		var items_txt := ".".join(u["items"])
		var beast := "1" if u.get("isBeast", false) else "0"
		var pow_txt := ":" + ParityUtil.f64_hex(float(u["powMult"])) if u.has("powMult") else ""
		parts.append("%d:%d:%s:%d:%s:%s%s" % [i, int(u["iid"]), u["defId"], int(u["star"]), items_txt, beast, pow_txt])
	if parts.is_empty():
		return "-"
	return ";".join(parts)


func _enc_player(p: Dictionary) -> String:
	var shop_parts: Array = []
	for s in p["shop"]:
		shop_parts.append("-" if s == null else str(s))
	var opp_parts: Array = []
	for o in p["opponents"]:
		opp_parts.append(str(o))
	var ai_arch := "-" if p["ai"] == null else str(p["ai"]["arch"])
	var outcome: Variant = p["lastOutcome"]
	var outcome_txt := "-" if outcome == null else str(outcome)
	return "%d:%d:%s:%s:%d:%s:%d:%d:%d:%d:%d:%s:%s:%s|%s|%d|%s|%s|%s|%s|%s" % [
		int(p["idx"]), 1 if p["alive"] else 0,
		ParityUtil.f64_hex(float(p["hp"])), ParityUtil.f64_hex(float(p["gold"])),
		int(p["level"]), ParityUtil.f64_hex(float(p["xp"])),
		int(p["streak"]), int(p["bestStreak"]), int(p["rank"]), int(p["wins"]), int(p["losses"]),
		outcome_txt, ParityUtil.f64_hex(float(p["lastDamage"])), ParityUtil.f64_hex(float(p["totalDamage"])),
		",".join(shop_parts), 1 if p["shopLocked"] else 0, ",".join(opp_parts),
		_enc_cells(p["board"]), _enc_cells(p["bench"]),
		".".join(p["items"]), ai_arch,
	]


func encode_match(m: Match) -> String:
	var pl_parts: Array = []
	for p: Dictionary in m.players:
		pl_parts.append(_enc_player(p))
	var ghost_parts: Array = []
	for k in m._ghosts.keys():
		ghost_parts.append("%d>%s" % [int(k), _enc_cells(m._ghosts[k])])
	var beast := "-" if m._beast_board == null else _enc_cells(m._beast_board)
	var offer := "-"
	if m.adventure_offer != null:
		var kinds: Array = []
		for o: Dictionary in m.adventure_offer["options"]:
			kinds.append(o["kind"])
		offer = "%d:%s" % [int(m.adventure_offer["round"]), ".".join(kinds)]
	var snap_parts: Array = []
	for s: Dictionary in m.battle_snapshots:
		var w: Variant = s.get("winner", null)
		# JSON 读回的 winner 是 float（1.0），str 直转带 ".0" —— 必须先 int 化
		snap_parts.append("%d.%s.%d" % [int(s["round"]), ("N" if w == null else str(int(w))), int(s["ticks"])])
	var pair_parts: Array = []
	for q: Dictionary in m.pairings:
		pair_parts.append("%d.%d.%d.%d.%d" % [int(q["a"]), int(q["b"]), int(q["ghost"]), 1 if q["swap"] else 0, 1 if q["beast"] else 0])
	# log 摘要：每条 fnv（十六进制、无补零 —— 与 TS toString(16) 同口径）串接再 fnv
	var log_hex: Array = []
	for l: String in m.log:
		log_hex.append("%x" % ParityUtil.fnv1a32(l))
	var log_dig := ParityUtil.fnv1a32(",".join(log_hex))
	return "S|%d|%d|%s|%d|PL|%s|G|%s|B|%s|A|%s|K|%s|Q|%s|L|%d" % [
		int(m.seed), int(m.round), m.phase, int(m.rng.state),
		"|".join(pl_parts),
		"-" if ghost_parts.is_empty() else "|".join(ghost_parts),
		beast, offer, ",".join(snap_parts), ",".join(pair_parts), log_dig,
	]
