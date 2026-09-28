# GdUnit4 对局层契约测试（src/tests 中 game 层契约类的移植面 + 引擎侧自洽契约）。
# 覆盖：确定性（同种子同轨迹摘要）、存档轮转自洽（to_json→from_json 编码不变）、
# 三合成级联、经济口径、卡池守恒、撤销往返、每日种子口径、配对覆盖不变量。
extends GdUnitTestSuite


func _make(seed_val: int) -> Match:
	return Match.new(seed_val, "你", "normal")


## 轻量状态摘要（测试专用；跨引擎全字段编码走 headless/match_probe.gd）
func _digest(m: Match) -> String:
	var parts: Array = ["%d|%s|%d" % [m.round, m.phase, m.rng.state]]
	for p: Dictionary in m.players:
		parts.append("%d:%d:%s:%s:%d:%d:%s" % [
			int(p["idx"]), 1 if p["alive"] else 0,
			ParityUtil.f64_hex(float(p["hp"])), ParityUtil.f64_hex(float(p["gold"])),
			int(p["level"]), GameState.bench_count(p) + GameState.board_count(p),
			"-" if p["lastOutcome"] == null else str(p["lastOutcome"]),
		])
	var ghosts := 0
	for k in m._ghosts.keys():
		ghosts += 1
	parts.append("g%d" % ghosts)
	parts.append("k%d" % m.battle_snapshots.size())
	return "|".join(parts)


# ── 确定性 ────────────────────────────────────────────────

func test_match_determinism_same_seed_same_digest() -> void:
	var a := _make(20260928)
	var b := _make(20260928)
	for i: int in 6:
		a.begin_round()
		b.begin_round()
		a.settle_round()
		b.settle_round()
		a.end_round()
		b.end_round()
	assert_str(_digest(a)).is_equal(_digest(b))


func test_match_beast_adventure_schedule() -> void:
	var m := _make(7)
	for r: int in 4:
		m.begin_round()
		if m.round == 4:
			assert_bool(m.is_adventure_round()).is_true()
			assert_that(m.adventure_offer != null).is_true()
		else:
			assert_bool(m.is_adventure_round()).is_false()
		if m.round == 1:
			assert_bool(m.is_beast_round()).is_true()
		else:
			assert_bool(m.is_beast_round()).is_false()
		m.settle_round()
		m.end_round()
	assert_int(m.round).is_equal(4)


# ── 存档轮转自洽（引擎侧；跨引擎面由 match_probe 的交叉读档覆盖） ──

func test_json_roundtrip_preserves_state() -> void:
	var m := _make(991)
	for i: int in 5:
		m.begin_round()
		m.settle_round()
		m.end_round()
	var before := _digest(m)
	var text := JSON.stringify({ "v": 3, "data": m.to_json() })
	var m2: Variant = Match.from_json((JSON.parse_string(text) as Dictionary)["data"])
	assert_that(m2 != null).is_true()
	assert_str(_digest(m2)).is_equal(before)
	# 轮转后再跑两回合，仍应与直接续跑一致
	var a := _make(991)
	for i: int in 7:
		a.begin_round()
		a.settle_round()
		a.end_round()
	var b: Match = m2
	for i: int in 2:
		b.begin_round()
		b.settle_round()
		b.end_round()
	assert_str(_digest(b)).is_equal(_digest(a))


func test_from_json_rejects_bad_phase() -> void:
	var m := _make(5)
	m.begin_round()
	var data := m.to_json()
	data["phase"] = "battle"
	assert_that(Match.from_json(data) == null).is_true()


func test_from_json_sanitize_pairings_drops_bad_table() -> void:
	var m := _make(5)
	m.begin_round()
	var data := m.to_json()
	# 手改配对表：a 指向不存在的玩家 → 整表弃用回落空表
	(data["pairings"] as Array)[0] = { "a": 99, "b": -1, "ghost": -1, "swap": false, "beast": false }
	var m2: Variant = Match.from_json(data)
	assert_that(m2 != null).is_true()
	assert_int((m2.pairings as Array).size()).is_equal(0)


# ── 三合成级联 ────────────────────────────────────────────

func test_resolve_merges_cascade() -> void:
	var p := GameState.blank_player(0, "t", true)
	for i: int in 9:
		(p["bench"] as Array)[i] = GameState.create_unit("pan", 1)
	var events := GameState.resolve_merges(p)
	# 9 张 1★ → 每轮 while 只合一个组（break 重扫）：3 次 2★ + 1 次 3★ = 4 次
	assert_int(events.size()).is_equal(4)
	assert_int(int(events[0]["star"])).is_equal(2)
	assert_int(int(events[3]["star"])).is_equal(3)
	var left := GameState.bench_count(p)
	assert_int(left).is_equal(1)
	assert_int(int((GameState.bench_units(p)[0])["star"])).is_equal(3)


func test_resolve_merges_board_survivor_keeps_slot() -> void:
	var p := GameState.blank_player(0, "t", true)
	var board_unit := GameState.create_unit("pan", 1)
	(p["board"] as Array)[3] = board_unit
	(p["bench"] as Array)[0] = GameState.create_unit("pan", 1)
	(p["bench"] as Array)[1] = GameState.create_unit("pan", 1)
	var events := GameState.resolve_merges(p)
	assert_int(events.size()).is_equal(1)
	assert_bool(events[0]["onBoard"]).is_true()
	# 场上那张保留位置（board[3] 是 2★，两张被吃的在备战席清空）
	assert_that((p["board"] as Array)[3] != null).is_true()
	assert_int(int((p["board"] as Array)[3]["star"])).is_equal(2)
	assert_int(GameState.bench_count(p)).is_equal(0)


# ── 经济口径 ──────────────────────────────────────────────

func test_interest_and_streak() -> void:
	assert_int(Economy.interest_of(0.0)).is_equal(0)
	assert_int(Economy.interest_of(49.0)).is_equal(4)
	assert_int(Economy.interest_of(999.0)).is_equal(5)
	assert_int(Economy.streak_gold(3)).is_equal(int(Spec.cfg["WIN_STREAK_GOLD"][3]))
	assert_int(Economy.streak_gold(-3)).is_equal(int(Spec.cfg["LOSE_STREAK_GOLD"][3]))


func test_gain_xp_multi_level() -> void:
	var p := GameState.blank_player(0, "t", true)
	Economy.gain_xp(p, 100.0)
	assert_int(int(p["level"])).is_greater_equal(4)


# ── 卡池守恒 ──────────────────────────────────────────────

func test_pool_take_give_symmetry() -> void:
	var pool := CardPool.new()
	var total0 := pool.total_remaining()
	var id: String = Spec.champions[0]["id"]
	assert_bool(pool.take(id)).is_true()
	assert_int(pool.total_remaining()).is_equal(total0 - 1)
	pool.give(id)
	assert_int(pool.total_remaining()).is_equal(total0)
	# 名单外拒收
	pool.give("__nope__")
	assert_int(pool.total_remaining()).is_equal(total0)


func test_pool_restore_clamps_overflow() -> void:
	var pool := CardPool.new()
	var id: String = Spec.champions[0]["id"]
	var over := {}
	over[id] = 99999
	pool.restore(over)
	assert_int(pool.remaining(id)).is_equal(int(Spec.cfg["POOL_COUNTS"]["1"]) if int(Spec.champions[0]["cost"]) == 1 else int(Spec.cfg["POOL_COUNTS"][str(int(Spec.champions[0]["cost"]))]))


# ── 撤销往返 ──────────────────────────────────────────────

func test_undo_roundtrip_restores_state_and_offer() -> void:
	var m := _make(12345)
	m.begin_round()
	var p := m.human()
	var before := _digest(m)
	var snap := Undo.snapshot_player(p, m.pool, m.adventure_offer)
	var rng_backup := m.rng.state
	(p["items"] as Array).append("__x__")
	p["gold"] = float(p["gold"]) - 3.0
	Undo.restore_player(p, m.pool, snap, m)
	m.rng.state = rng_backup
	assert_str(_digest(m)).is_equal(before)


# ── 每日种子口径（与 TS dailySeedFor(new Date(2026,8,28)) 对拍过的真值） ──

func test_daily_seed_matches_ts() -> void:
	# fixture.daily.seed = 0x8ad26c12（TS 侧 dailySeedFor 产出，2026-09-28）
	var s := Daily.daily_seed_for({ "year": 2026, "month": 9, "day": 28 })
	assert_int(s).is_equal(0x8ad26c12)
	assert_str(Daily.today_key({ "year": 2026, "month": 9, "day": 28 })).is_equal("2026-09-28")


# ── 配对覆盖不变量 ────────────────────────────────────────

func test_make_pairings_covers_all_alive_once() -> void:
	var m := _make(777)
	m.begin_round()
	var pairs: Array = m.pairings
	var covered := {}
	for q: Dictionary in pairs:
		covered[int(q["a"])] = true
		if int(q["b"]) >= 0:
			covered[int(q["b"])] = true
	assert_int(covered.size()).is_equal(m.alive_count())


# ── 装备容量分层 ──────────────────────────────────────────

func test_unequip_all_rejects_when_bar_full() -> void:
	var p := GameState.blank_player(0, "t", true)
	var u := GameState.create_unit("pan", 1)
	(u["items"] as Array).append("moren")
	(p["bench"] as Array)[0] = u
	# 器匣塞满（用两个已知组件 id）
	var comp_a: String = Spec.component_ids[0]
	var comp_b: String = Spec.component_ids[1]
	for i: int in int(Spec.c("ITEM_BAR_SLOTS")):
		(p["items"] as Array).append(comp_a if i % 2 == 0 else comp_b)
	var res: Dictionary = Inventory.unequip_all(p, int(u["iid"]))
	assert_bool(res["ok"]).is_false()
	assert_int(int((u["items"] as Array).size())).is_equal(1)
