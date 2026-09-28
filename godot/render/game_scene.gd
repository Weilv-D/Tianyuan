extends Node2D
## 准备阶段主场景（GameScene.ts 对齐版，M3 首批核心面）：
## 顶栏 / 大漆盘（己方半场） / 备战席 / 商店 / 羁绊轨 / 操作列 / 出售印 /
## 拖拽布阵 / 奇遇面板 / 回合结算浮层 / 开战流程（settle-then-replay 入口）。
## 战报·记事·侦查·成员卡·设置面板登记于 M3 次批（见 MILESTONES 清单）。

var match_ref: Match
var board_view: BoardView
var unit_views := {}  # iid -> UnitView
var labels := {}      # 顶栏动态文本
var shop_buttons: Array = []
var undo_stack: Array = []
const UNDO_LIMIT := 30

var drag_iid := -1
var drag_ghost: UnitView = null
var result_panel: CanvasLayer = null


func _ready() -> void:
	match_ref = Sess.scene_data.get("match", null)
	if match_ref == null:
		Sess.go("res://render/menu.tscn")
		return
	position = Vector2(Layout.W / 2.0, Layout.H / 2.0)
	_draw_bg()
	_build_top_bar()
	_build_board()
	_build_bench()
	_build_shop()
	_build_trait_rail()
	_build_action_bar()
	_build_sell_seal()
	if match_ref.round == 0:
		match_ref.begin_round()
	elif match_ref.needs_advance_on_load():
		match_ref.begin_round()
	refresh_all()


# ── 静态构建 ──────────────────────────────────────────────

func _draw_bg() -> void:
	var bg := ColorRect.new()
	bg.color = Palette.INK[950]
	bg.position = Vector2(-Layout.W, -Layout.H) / 2.0
	bg.size = Vector2(Layout.W, Layout.H)
	bg.z_index = -10
	add_child(bg)


func _label(text: String, size: int, color: Color, font = null) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font if font != null else Sess.body_font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


func _build_top_bar() -> void:
	var bar := ColorRect.new()
	bar.color = Color(Palette.INK[900], 0.92)
	bar.position = Vector2(-Layout.W / 2.0, -Layout.H / 2.0)
	bar.size = Vector2(Layout.W, Layout.HEADER_H)
	bar.z_index = -5
	add_child(bar)
	var title := _label("百 战 天 元", 34, Palette.PAPER[100], Sess.seal_font)
	title.position = Vector2(-Layout.W / 2.0 + 400, -Layout.H / 2.0 + 24)
	title.size = Vector2(800, 50)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(title)
	for pair: Array in [["round", -360], ["hp", -180], ["gold", -20], ["level", 160], ["streak", 330]]:
		var l := _label("", 26, Palette.PAPER[100])
		l.position = Vector2(pair[1], -Layout.H / 2.0 + 28)
		l.size = Vector2(200, 36)
		labels[pair[0]] = l
		add_child(l)


func _build_board() -> void:
	board_view = BoardView.new()
	board_view.position = Vector2(Layout.BOARD_X, Layout.BOARD_Y)
	add_child(board_view)


func _build_bench() -> void:
	var frame := ColorRect.new()
	frame.color = Color(Palette.INK[900], 0.85)
	frame.position = Vector2(Layout.BENCH_X - 6, Layout.BENCH_Y - 28)
	frame.size = Vector2(Layout.BENCH_W + 12, Layout.BENCH_CELL + 32)
	add_child(frame)
	var cap := _label("备 战", 18, Palette.PAPER[400], Sess.seal_font)
	cap.position = Vector2(Layout.BENCH_X, Layout.BENCH_Y - 26)
	add_child(cap)


func _build_shop() -> void:
	for i: int in 5:
		var x := Layout.SHOP_X + i * (Layout.SHOP_CW + Layout.SHOP_GAP)
		var b := Button.new()
		b.position = Vector2(x, Layout.SHOP_Y)
		b.custom_minimum_size = Vector2(Layout.SHOP_CW, Layout.SHOP_CH)
		b.focus_mode = Control.FOCUS_NONE
		var idx := i
		b.pressed.connect(func() -> void: _on_buy(idx))
		add_child(b)
		shop_buttons.append(b)


func _build_trait_rail() -> void:
	for i: int in 17:
		var y := Layout.RAIL_Y + i * Layout.RAIL_PITCH
		var badge := _TraitBadge.new()
		badge.position = Vector2(Layout.RAIL_X, y)
		add_child(badge)


func _build_action_bar() -> void:
	var defs: Array = [
		["刷 新 · 2 金", func() -> void: _on_reroll()],
		["买 经 验 · 4 金", func() -> void: _on_buy_exp()],
		["一 键 布 阵", func() -> void: _on_auto_arrange()],
		["撤 销", func() -> void: _on_undo()],
	]
	for i: int in defs.size():
		var b := Button.new()
		b.text = defs[i][0]
		b.position = Vector2(Layout.ACT_X, Layout.ACT_Y + i * (Layout.ACT_BTN_H + 8))
		b.custom_minimum_size = Vector2(Layout.ACT_BTN_W, Layout.ACT_BTN_H)
		b.add_theme_font_override("font", Sess.body_font)
		b.add_theme_font_size_override("font_size", 20)
		b.add_theme_color_override("font_color", Palette.PAPER[100])
		b.focus_mode = Control.FOCUS_NONE
		b.pressed.connect(defs[i][1] as Callable)
		add_child(b)
	var fight := Button.new()
	fight.text = "开 战"
	fight.position = Vector2(Layout.ACT_X, Layout.ACT_Y + 4 * (Layout.ACT_BTN_H + 8) + 12)
	fight.custom_minimum_size = Vector2(Layout.ACT_BTN_W, Layout.ACT_BTN_H + 10)
	fight.add_theme_font_override("font", Sess.seal_font)
	fight.add_theme_font_size_override("font_size", 26)
	fight.add_theme_color_override("font_color", Palette.CINNABAR["light"])
	fight.focus_mode = Control.FOCUS_NONE
	fight.pressed.connect(_start_battle_phase)
	add_child(fight)


func _build_sell_seal() -> void:
	var seal := Panel.new()
	seal.position = Vector2(Layout.SELL_X, Layout.SELL_Y)
	seal.size = Vector2(Layout.SELL_SIZE, Layout.SELL_SIZE)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.DANGER["base"], 0.85)
	sb.border_color = Palette.PAPER[300]
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(0)
	seal.add_theme_stylebox_override("panel", sb)
	add_child(seal)
	var t := _label("售", 30, Palette.PAPER[100], Sess.seal_font)
	t.position = Vector2(Layout.SELL_X, Layout.SELL_Y + 12)
	t.size = Vector2(Layout.SELL_SIZE, 40)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(t)


# ── 刷新（Match 状态 → 视图） ─────────────────────────────

func refresh_all() -> void:
	var p := match_ref.human()
	(labels["round"] as Label).text = "第 %d 回合" % match_ref.round
	(labels["hp"] as Label).text = "生命 %d" % int(p["hp"])
	(labels["gold"] as Label).text = "金 %d" % int(p["gold"])
	(labels["level"] as Label).text = "Lv%d · %d/%d" % [int(p["level"]), int(p["xp"]), Economy.xp_to_next(int(p["level"]))]
	var streak_txt := "—"
	if int(p["streak"]) > 0:
		streak_txt = "胜%d" % int(p["streak"])
	elif int(p["streak"]) < 0:
		streak_txt = "败%d" % -int(p["streak"])
	(labels["streak"] as Label).text = streak_txt
	_refresh_units()
	_refresh_shop()
	_refresh_trait_rail()
	_check_adventure()


func _refresh_units() -> void:
	# 棋盘（human 半场：本地行 → 全局行 4+local）
	var p := match_ref.human()
	var seen := {}
	for i: int in (p["board"] as Array).size():
		var u: Variant = p["board"][i]
		if u == null:
			continue
		seen[int(u["iid"])] = true
		_place_unit_view(u, board_view.position + board_view.cell_center(i % 8, 4 + i / 8))
	for i: int in (p["bench"] as Array).size():
		var u: Variant = p["bench"][i]
		if u == null:
			continue
		seen[int(u["iid"])] = true
		_place_unit_view(u, Vector2(Layout.BENCH_X + i * Layout.BENCH_CELL + Layout.BENCH_CELL / 2.0, Layout.BENCH_Y + Layout.BENCH_CELL / 2.0))
	for iid: int in unit_views.keys():
		if not seen.has(iid):
			(unit_views[iid] as UnitView).queue_free()
			unit_views.erase(iid)


func _place_unit_view(u: Dictionary, pos: Vector2) -> void:
	var v: UnitView = unit_views.get(int(u["iid"]), null)
	if v == null:
		v = UnitView.new()
		v.setup(u["defId"], 0, int(u["star"]), u.get("isBeast", false))
		add_child(v)
		unit_views[int(u["iid"])] = v
		v.place(pos)
	else:
		v.place(pos)
		v.set_star_scale()


func _refresh_shop() -> void:
	var p := match_ref.human()
	for i: int in 5:
		var b: Button = shop_buttons[i]
		var id: Variant = p["shop"][i]
		_clear_button_children(b)
		if id == null:
			b.disabled = true
			continue
		var def: Variant = Spec.champion_by_id.get(id, null)
		if def == null:
			b.disabled = true
			continue
		b.disabled = float(p["gold"]) < float(def["cost"])
		var thumb := UnitView.piece_texture(id)
		var sp := TextureRect.new()
		sp.texture = thumb
		sp.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		sp.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		sp.custom_minimum_size = Vector2(Layout.SHOP_CW - 16, 92)
		sp.position = Vector2(8, 6)
		b.add_child(sp)
		var name_l := _label("%s  %d金" % [def["name"], int(def["cost"])], 17, Palette.RARITY_COLOR[int(def["cost"])])
		name_l.position = Vector2(8, 104)
		name_l.size = Vector2(Layout.SHOP_CW - 16, 24)
		b.add_child(name_l)
		var trait_l := _label("%s · %s" % [String(def["origins"][0]), String(def["classes"][0])], 14, Palette.PAPER[400])
		trait_l.position = Vector2(8, 130)
		trait_l.size = Vector2(Layout.SHOP_CW - 16, 20)
		b.add_child(trait_l)


func _clear_button_children(b: Button) -> void:
	for c in b.get_children():
		c.queue_free()


func _refresh_trait_rail() -> void:
	var badges: Array = []
	for c in get_children():
		if c is _TraitBadge:
			badges.append(c)
	var p := match_ref.human()
	var ids: Array = []
	for u in p["board"]:
		if u != null:
			ids.append(u["defId"])
	var traits := Comp.compute_traits(ids)
	for i: int in badges.size():
		var badge: _TraitBadge = badges[i]
		if i < traits.size():
			badge.visible = true
			var t: Dictionary = traits[i]
			var def: Variant = Spec.traits_by_id.get(t["id"], null)
			badge.set_trait(t["id"], int(t["count"]), int(t["tier"]), def)
		else:
			badge.visible = false


func _check_adventure() -> void:
	if match_ref.adventure_offer == null:
		return
	var offer: Dictionary = match_ref.adventure_offer
	var layer := CanvasLayer.new()
	layer.layer = 90
	add_child(layer)
	var dim := ColorRect.new()
	dim.color = Color(Palette.SHADE, 0.55)
	dim.size = Vector2(Layout.W, Layout.H)
	layer.add_child(dim)
	var panel := Panel.new()
	panel.size = Vector2(760, 320)
	panel.position = Vector2((Layout.W - 760) / 2.0, (Layout.H - 320) / 2.0)
	dim.add_child(panel)
	var title := _label("奇 遇 · 择 一", 34, Palette.GILT["light"], Sess.seal_font)
	title.position = Vector2(0, 20)
	title.size = Vector2(760, 50)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(title)
	var options: Array = offer["options"]
	for i: int in options.size():
		var opt: Dictionary = options[i]
		var b := Button.new()
		b.text = "%s\n%s" % [opt["title"], opt["desc"]]
		b.position = Vector2(20 + i * 244, 90)
		b.custom_minimum_size = Vector2(224, 200)
		b.add_theme_font_override("font", Sess.body_font)
		b.add_theme_font_size_override("font_size", 18)
		b.add_theme_color_override("font_color", Palette.PAPER[100])
		b.focus_mode = Control.FOCUS_NONE
		var idx := i
		b.pressed.connect(func() -> void:
			match_ref.resolve_adventure(idx)
			layer.queue_free()
			Sess.blip("UI", 660.0)
			refresh_all())
		panel.add_child(b)


# ── 玩家动作 ──────────────────────────────────────────────

func _push_undo() -> void:
	var p := match_ref.human()
	undo_stack.append({
		"snap": Undo.snapshot_player(p, match_ref.pool, match_ref.adventure_offer),
		"rng": match_ref.rng.state,
	})
	if undo_stack.size() > UNDO_LIMIT:
		undo_stack.pop_front()


func _after_action() -> void:
	refresh_all()
	SaveStore.save_match(match_ref)


func _on_buy(slot: int) -> void:
	_push_undo()
	var r: Dictionary = match_ref.buy(match_ref.human(), slot)
	if not r["ok"]:
		undo_stack.pop_back()
		Sess.blip("UI", 180.0, 0.08)
		return
	Sess.blip("UI", 520.0)
	_after_action()


func _on_reroll() -> void:
	_push_undo()
	if not match_ref.reroll(match_ref.human()):
		undo_stack.pop_back()
		return
	Sess.blip("UI", 392.0)
	_after_action()


func _on_buy_exp() -> void:
	_push_undo()
	if not match_ref.buy_exp(match_ref.human()):
		undo_stack.pop_back()
		return
	Sess.blip("UI", 587.0)
	_after_action()


func _on_auto_arrange() -> void:
	_push_undo()
	Arrange.auto_arrange(match_ref.human(), match_ref.pool)
	_after_action()


func _on_undo() -> void:
	if undo_stack.is_empty():
		return
	var e: Dictionary = undo_stack.pop_back()
	Undo.restore_player(match_ref.human(), match_ref.pool, e["snap"], match_ref)
	match_ref.rng.state = int(e["rng"])
	_after_action()


# ── 拖拽（拾起-跟随-落子；≥8px 才算拖拽） ─────────────────

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var e: InputEventMouseButton = event
		if e.button_index == MOUSE_BUTTON_LEFT:
			if e.pressed:
				_try_pick(e.position)
			else:
				_drop(e.position)
			get_viewport().set_input_as_handled()
	elif event is InputEventMouseMotion and drag_iid >= 0:
		if drag_ghost != null:
			drag_ghost.position = get_global_mouse_position()


func _try_pick(world: Vector2) -> void:
	# 命中：备战席 → 己方半场棋盘
	var p := match_ref.human()
	var pick: Variant = null
	var bench_y0 := float(Layout.BENCH_Y)
	if world.y >= bench_y0 - 10 and world.y <= bench_y0 + Layout.BENCH_CELL + 10:
		var i := int((world.x - Layout.BENCH_X) / Layout.BENCH_CELL)
		if i >= 0 and i < 9 and p["bench"][i] != null:
			pick = p["bench"][i]
	else:
		var cell := _world_to_local_cell(world)
		if cell.y >= 4 and cell.y >= 0:
			var idx := (cell.y - 4) * 8 + cell.x
			if idx >= 0 and idx < 32 and p["board"][idx] != null:
				pick = p["board"][idx]
	if pick == null:
		return
	drag_iid = int(pick["iid"])
	drag_ghost = unit_views.get(drag_iid, null)
	if drag_ghost != null:
		drag_ghost.z_index = 100
	# 落点预显：全部可放置格
	var placeable := {}
	for slot: int in GameState.board_cells():
		if GameState.can_place(p, drag_iid, "board", slot)["ok"]:
			var c := slot % 8
			var r := 4 + slot / 8
			placeable[Vector2i(c, r)] = true
	board_view.set_placeable(placeable)


func _drop(world: Vector2) -> void:
	board_view.set_placeable({})
	if drag_iid < 0:
		return
	var p := match_ref.human()
	if drag_ghost != null:
		drag_ghost.z_index = 10
	# 出售印
	if world.x >= Layout.SELL_X and world.x <= Layout.SELL_X + Layout.SELL_SIZE and world.y >= Layout.SELL_Y and world.y <= Layout.SELL_Y + Layout.SELL_SIZE:
		if match_ref.sell(p, drag_iid):
			Sess.blip("SFX", 240.0, 0.1)
			undo_stack.clear()
			SaveStore.save_match(match_ref)
			refresh_all()
			drag_iid = -1
			drag_ghost = null
			return
	var cell := _world_to_local_cell(world)
	if cell.y >= 4:
		var slot := (cell.y - 4) * 8 + cell.x
		if GameState.can_place(p, drag_iid, "board", slot)["ok"]:
			GameState.move_to_slot(p, drag_iid, "board", slot)
	elif world.y >= Layout.BENCH_Y - 10 and world.y <= Layout.BENCH_Y + Layout.BENCH_CELL + 10:
		var bi := int((world.x - Layout.BENCH_X) / Layout.BENCH_CELL)
		if bi >= 0 and bi < 9 and GameState.can_place(p, drag_iid, "bench", bi)["ok"]:
			GameState.move_to_slot(p, drag_iid, "bench", bi)
	drag_iid = -1
	drag_ghost = null
	SaveStore.save_match(match_ref)
	refresh_all()


func _world_to_local_cell(world: Vector2) -> Vector2i:
	return board_view.xy_to_cell(world - board_view.position)


# ── 开战（settle-then-replay 入口） ───────────────────────

func _start_battle_phase() -> void:
	if match_ref.phase != "prep":
		return
	undo_stack.clear()
	SaveStore.save_match(match_ref)
	match_ref.resolve_human_adventure()
	if match_ref.pairings.is_empty():
		match_ref.pairings = match_ref.make_pairings(false)
	# 无头结算全部配对（战斗场景重演人类场）
	var me_pair: Dictionary = {}
	for q: Dictionary in match_ref.pairings:
		if int(q["a"]) == 0 or int(q["b"]) == 0:
			me_pair = q
	Sess.blip("SFX", 196.0, 0.2)
	if me_pair.is_empty():
		# 轮空（人类不参战）——直接推进
		match_ref.settle_round()
		_after_settle([])
		return
	var config := match_ref.build_battle_config(me_pair, bool(me_pair["swap"]))
	match_ref.settle_round()
	Sess.go("res://render/battle_scene.tscn", { "match": match_ref, "pair": me_pair, "config": config })


## BattleScene 返回后（resultPending）与本地的轮空结算共口
func _after_settle(_outs: Array) -> void:
	match_ref.end_round()
	SaveStore.save_match(match_ref)
	_show_round_result()


func _show_round_result() -> void:
	if result_panel != null:
		result_panel.queue_free()
	result_panel = CanvasLayer.new()
	result_panel.layer = 95
	add_child(result_panel)
	var dim := ColorRect.new()
	dim.color = Color(Palette.SHADE, 0.6)
	dim.size = Vector2(Layout.W, Layout.H)
	result_panel.add_child(dim)
	var panel := Panel.new()
	panel.size = Vector2(640, 420)
	panel.position = Vector2((Layout.W - 640) / 2.0, (Layout.H - 420) / 2.0)
	dim.add_child(panel)
	var title := _label("回 合 结 算", 36, Palette.GILT["light"], Sess.seal_font)
	title.position = Vector2(0, 22)
	title.size = Vector2(640, 54)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(title)
	var p := match_ref.human()
	var lines: Array = []
	match String(p["lastOutcome"]):
		"win":
			lines.append("胜 —— 敌阵尽墨")
		"loss":
			lines.append("败 —— 折损 %d 生命" % int(p["lastDamage"]))
		"draw":
			lines.append("同归于尽")
		"bye":
			lines.append("轮空")
		_:
			lines.append("—")
	for i: int in lines.size():
		var l := _label(lines[i], 24, Palette.PAPER[100])
		l.position = Vector2(0, 100 + i * 44)
		l.size = Vector2(640, 40)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		panel.add_child(l)
	var cont := Button.new()
	cont.text = "继 续"
	cont.position = Vector2(230, 320)
	cont.custom_minimum_size = Vector2(180, 46)
	cont.add_theme_font_override("font", Sess.body_font)
	cont.add_theme_font_size_override("font_size", 24)
	cont.add_theme_color_override("font_color", Palette.PAPER[100])
	cont.focus_mode = Control.FOCUS_NONE
	cont.pressed.connect(func() -> void:
		result_panel.queue_free()
		result_panel = null
		if match_ref.is_over() or not match_ref.human()["alive"]:
			Sess.go("res://render/result.tscn", { "match": match_ref })
			return
		match_ref.begin_round()
		refresh_all())
	panel.add_child(cont)


## 羁绊徽章（环 + 篆字 + 计数；档位亮环）
class _TraitBadge extends Node2D:
	var trait_id := ""
	var tier := -1
	var count := 0
	var def: Variant = null

	func set_trait(p_id: String, p_count: int, p_tier: int, p_def: Variant) -> void:
		trait_id = p_id
		count = p_count
		tier = p_tier
		def = p_def
		queue_redraw()

	func _draw() -> void:
		var ring_c: Color = Palette.GILT["base"] if tier >= 0 else Palette.INK[400]
		draw_arc(Vector2.ZERO, 16.0, 0, TAU, 40, Color(ring_c, 0.85 if tier >= 0 else 0.4), 1.8)
		if tier >= 2:
			draw_arc(Vector2.ZERO, 19.0, 0, TAU, 40, Color(Palette.GILT["light"], 0.5), 1.2)
		var font: Font = Sess.seal_font
		var ch := String(def["name"]).substr(0, 1) if def != null else trait_id.substr(0, 1)
		draw_string(font, Vector2(-8, 6), ch, HORIZONTAL_ALIGNMENT_CENTER, 16, 15, Palette.PAPER[100])
		var num := "%d" % count
		draw_string(Sess.body_font, Vector2(21, 5), num, HORIZONTAL_ALIGNMENT_LEFT, 24, 13, Palette.PAPER[300])
