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
# 器匣（M3 次批）：10 格芯片 + 分页 + 卸载 + 装备流（选中物品→点棋子）
var item_chips: Array = []
var item_page := 0
var selected_item_idx := -1
var unload_mode := false
var item_hint: Label
var page_prev: Button
var page_next: Button
var page_text: Label
# 记分板 / 记事 / 战报 / 敌情
var score_rows: Array = []
var log_label: Label
var report_label: Label
var intel_label: Label
var board_count_label: Label
var _dbg: DebugConsole
var _settings: SettingsPanel
# 羁绊悬停笺 / 成员卡（hudLayout 几何）
var rail_popup: PanelContainer = null
var trait_members_card: PanelContainer = null
var badges_visible: Array = []  # [{id,count,tier,def,i,worldHit}] 每回合 refresh 后重建


func _ready() -> void:
	match_ref = Sess.scene_data.get("match", null)
	if match_ref == null:
		Sess.go("res://render/menu.tscn")
		return
	position = Vector2(Layout.W / 2.0, Layout.H / 2.0)
	# DebugConsole 仅 DEV：编辑器/调试构建可见，发布 exe 不实例化（TS 同源纪律）
	if OS.is_debug_build() or OS.has_feature("editor"):
		_dbg = DebugConsole.new()
		add_child(_dbg)
		_dbg.setup(self)
	_settings = SettingsPanel.new()
	add_child(_settings)
	_draw_bg()
	_build_top_bar()
	_build_board()
	_build_bench()
	_build_shop()
	_build_item_bar()
	_build_side_panels()
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
	# 2×3 操作列（对齐 HudPanels.buildActionBar；快捷键 D/F/E/Z 见 _unhandled_keyinput）
	var step := Layout.ACT_BTN_W + 10
	var row_step := Layout.ACT_BTN_H + 10
	var defs: Array = [
		["刷新 · D", 0, 0, func() -> void: _on_reroll()],
		["升级 · F", 1, 0, func() -> void: _on_buy_exp()],
		["布阵 · E", 0, 1, func() -> void: _on_auto_arrange()],
		["撤销 · Z", 1, 1, func() -> void: _on_undo()],
		["一键装备", 0, 2, func() -> void: _on_auto_equip()],
		["锁定商店", 1, 2, func() -> void: _on_toggle_lock()],
	]
	for d: Array in defs:
		var b := Button.new()
		b.text = d[0]
		b.position = Vector2(Layout.ACT_X + d[1] * step, Layout.ACT_Y + d[2] * row_step)
		b.custom_minimum_size = Vector2(Layout.ACT_BTN_W, Layout.ACT_BTN_H)
		b.add_theme_font_override("font", Sess.body_font)
		b.add_theme_font_size_override("font_size", 19)
		b.add_theme_color_override("font_color", Palette.PAPER[100])
		b.focus_mode = Control.FOCUS_NONE
		b.pressed.connect(d[3] as Callable)
		add_child(b)
	var fight := Button.new()
	fight.text = "开 战"
	fight.position = Vector2(Layout.ACT_X, Layout.ACT_Y + 3 * row_step + 14)
	fight.custom_minimum_size = Vector2(step - 10, Layout.ACT_BTN_H + 12)
	fight.add_theme_font_override("font", Sess.seal_font)
	fight.add_theme_font_size_override("font_size", 26)
	fight.add_theme_color_override("font_color", Palette.CINNABAR["light"])
	fight.focus_mode = Control.FOCUS_NONE
	fight.pressed.connect(_start_battle_phase)
	add_child(fight)


func _build_item_bar() -> void:
	var gh := Layout.ITEM_ROWS * (Layout.ITEM_SIZE + Layout.ITEM_GAP) - Layout.ITEM_GAP
	var frame := Panel.new()
	frame.position = Vector2(Layout.ITEM_BAR_X - 8, Layout.ITEM_BAR_Y - 8)
	frame.size = Vector2(Layout.ITEM_BAR_W + 16, gh + 16)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.INK[900], 0.66)
	sb.border_color = Color(Palette.INK[500], 0.6)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(0)
	frame.add_theme_stylebox_override("panel", sb)
	add_child(frame)
	var cap := _label("器 匣", 15, Palette.PAPER[300], Sess.seal_font)
	cap.position = Vector2(Layout.ITEM_BAR_X + 6, Layout.ITEM_BAR_Y - 22)
	add_child(cap)
	for i: int in int(Spec.c("ITEM_BAR_SLOTS")):
		var col := i % Layout.ITEM_COLS
		var row := i / Layout.ITEM_COLS
		var chip := Button.new()
		chip.position = Vector2(Layout.ITEM_BAR_X + col * (Layout.ITEM_SIZE + Layout.ITEM_GAP), Layout.ITEM_BAR_Y + row * (Layout.ITEM_SIZE + Layout.ITEM_GAP))
		chip.custom_minimum_size = Vector2(Layout.ITEM_SIZE, Layout.ITEM_SIZE)
		chip.focus_mode = Control.FOCUS_NONE
		var idx := i
		chip.pressed.connect(func() -> void: _on_item_chip(idx))
		add_child(chip)
		item_chips.append(chip)
	# 卸载钮（框顶上带；与界格签/分页钮同带互不相触——hudLayout 契约钉死净距）
	var unload := Button.new()
	unload.text = "卸 载"
	unload.position = Vector2(Layout.ITEM_BAR_X + Layout.ITEM_BAR_W - 84, Layout.ITEM_BAR_Y + Layout.UNLOAD_BTN_DY)
	unload.custom_minimum_size = Vector2(84, 26)
	unload.add_theme_font_override("font", Sess.body_font)
	unload.add_theme_font_size_override("font_size", 13)
	unload.focus_mode = Control.FOCUS_NONE
	unload.pressed.connect(_on_toggle_unload)
	add_child(unload)
	# 溢出分页（仅超页时可见——set_page_controls 驱动）
	page_prev = Button.new()
	page_prev.text = "◀"
	page_prev.position = Vector2(Layout.ITEM_BAR_X + 80, Layout.ITEM_BAR_Y + Layout.UNLOAD_BTN_DY)
	page_prev.custom_minimum_size = Vector2(26, 26)
	page_prev.add_theme_font_size_override("font_size", 11)
	page_prev.focus_mode = Control.FOCUS_NONE
	page_prev.pressed.connect(func() -> void: _on_item_page(-1))
	add_child(page_prev)
	page_next = Button.new()
	page_next.text = "▶"
	page_next.position = Vector2(Layout.ITEM_BAR_X + 160, Layout.ITEM_BAR_Y + Layout.UNLOAD_BTN_DY)
	page_next.custom_minimum_size = Vector2(26, 26)
	page_next.add_theme_font_size_override("font_size", 11)
	page_next.focus_mode = Control.FOCUS_NONE
	page_next.pressed.connect(func() -> void: _on_item_page(1))
	add_child(page_next)
	page_text = _label("", 13, Palette.PAPER[400])
	page_text.position = Vector2(Layout.ITEM_BAR_X + 120, Layout.ITEM_BAR_Y + Layout.UNLOAD_BTN_DY + 5)
	add_child(page_text)
	item_hint = _label("", 15, Palette.PAPER[400])
	item_hint.position = Vector2(Layout.ITEM_BAR_X - 8, Layout.ITEM_BAR_Y + gh + 22)
	item_hint.size = Vector2(Layout.ITEM_BAR_W + 16, 44)
	add_child(item_hint)


func _build_side_panels() -> void:
	# 敌情（右上）
	var intel_cap := _label("敌 情", 13, Palette.INK[300])
	intel_cap.position = Vector2(Layout.REPORT_X, 140)
	add_child(intel_cap)
	intel_label = _label("", 17, Palette.PAPER[100])
	intel_label.position = Vector2(Layout.REPORT_X, 160)
	intel_label.size = Vector2(Layout.SIDE_W, 24)
	add_child(intel_label)
	# 八方诸侯（计分板）
	var sb_cap := _label("八 方 诸 侯", 13, Palette.INK[300])
	sb_cap.position = Vector2(Layout.REPORT_X, 316)
	add_child(sb_cap)
	for i: int in 8:
		var l := _label("", 15, Palette.PAPER[300])
		l.position = Vector2(Layout.REPORT_X, 338 + i * 30)
		l.size = Vector2(Layout.SIDE_W, 24)
		score_rows.append(l)
		add_child(l)
	# 记事（左下）
	var hair := ColorRect.new()
	hair.color = Color(Palette.INK[500], 0.7)
	hair.position = Vector2(Layout.LOG_X, Layout.LOG_Y)
	hair.size = Vector2(Layout.LOG_W, 1)
	add_child(hair)
	var log_cap := _label("对 局 记 事", 13, Palette.INK[300])
	log_cap.position = Vector2(Layout.LOG_X, Layout.LOG_Y + 12)
	add_child(log_cap)
	log_label = _label("", 16, Palette.PAPER[300])
	log_label.position = Vector2(Layout.LOG_X, Layout.LOG_Y + 34)
	log_label.size = Vector2(Layout.LOG_W, Layout.LOG_H - 40)
	add_child(log_label)
	# 上回合战报（右下）
	var hair2 := ColorRect.new()
	hair2.color = Color(Palette.INK[500], 0.7)
	hair2.position = Vector2(Layout.REPORT_X, Layout.REPORT_Y)
	hair2.size = Vector2(Layout.SIDE_W, 1)
	add_child(hair2)
	var rep_cap := _label("上 回 合 战 报", 13, Palette.INK[300])
	rep_cap.position = Vector2(Layout.REPORT_X, Layout.REPORT_Y + 12)
	add_child(rep_cap)
	report_label = _label("", 16, Palette.PAPER[300])
	report_label.position = Vector2(Layout.REPORT_X, Layout.REPORT_Y + 34)
	report_label.size = Vector2(Layout.SIDE_W, 200)
	add_child(report_label)
	# 场上计数（备战席签条同带右端）
	board_count_label = _label("", 15, Palette.PAPER[400])
	board_count_label.position = Vector2(Layout.BENCH_X + Layout.BENCH_W - 90, Layout.BENCH_Y - 26)
	add_child(board_count_label)


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
	_refresh_item_bar()
	_refresh_side_panels()
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
	# 重建可见徽章索引（悬停/点选命中共用 hudLayout 世界命中矩形）
	badges_visible.clear()
	var vi := 0
	for c in get_children():
		if c is _TraitBadge and c.visible:
			var t2: Dictionary = traits[vi]
			var def2: Variant = Spec.traits_by_id.get(t2["id"], null)
			badges_visible.append({
				"id": t2["id"], "count": int(t2["count"]), "tier": int(t2["tier"]), "def": def2,
				"hit": HudLayout.rail_badge_world_hit(vi),
			})
			vi += 1


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


func _refresh_item_bar() -> void:
	var p := match_ref.human()
	var items: Array = p["items"]
	var slots := int(Spec.c("ITEM_BAR_SLOTS"))
	var pages := int(ceil(float(items.size()) / float(slots)))
	if pages <= 1:
		item_page = 0
	var show_page := pages > 1
	page_prev.visible = show_page
	page_next.visible = show_page
	page_text.visible = show_page
	if show_page:
		page_text.text = "%d/%d" % [item_page + 1, pages]
		page_prev.disabled = item_page <= 0
		page_next.disabled = item_page >= pages - 1
	for i: int in slots:
		var chip: Button = item_chips[i]
		var gi := item_page * slots + i
		for c in chip.get_children():
			c.queue_free()
		if gi >= items.size():
			chip.disabled = true
			continue
		var id: String = items[gi]
		var def: Variant = Spec.item_by_id.get(id, null)
		if def == null:
			chip.disabled = true
			continue
		chip.disabled = false
		var icon := TextureRect.new()
		icon.texture = load("res://assets/items/%s.png" % id)
		icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.size = Vector2(Layout.ITEM_SIZE - 8, Layout.ITEM_SIZE - 8)
		icon.position = Vector2(4, 4)
		chip.add_child(icon)
		if gi == selected_item_idx:
			var sel := ColorRect.new()
			sel.color = Color(Palette.SPIRIT["base"], 0.25)
			sel.size = Vector2(Layout.ITEM_SIZE - 4, Layout.ITEM_SIZE - 4)
			sel.position = Vector2(2, 2)
			sel.mouse_filter = Control.MOUSE_FILTER_IGNORE
			chip.add_child(sel)
	if selected_item_idx >= 0 and selected_item_idx < items.size():
		var sdef: Variant = Spec.item_by_id.get(items[selected_item_idx], null)
		item_hint.text = "已选 %s —— 点击棋子装备" % String(sdef["name"]) if sdef != null else ""
	elif unload_mode:
		item_hint.text = "卸载中…… 点击棋子，全身装备回器匣"
	else:
		item_hint.text = ""


func _refresh_side_panels() -> void:
	# 敌情：本回合对手名（pairings 已在 begin_round 生成）
	var opp_name := "（轮空）"
	for q: Dictionary in match_ref.pairings:
		var other: int = -2
		if int(q["a"]) == 0:
			other = int(q["b"])
		elif int(q["b"]) == 0:
			other = int(q["a"])
		if other >= 0:
			opp_name = String(match_ref.players[other]["name"])
		elif int(q["ghost"]) >= 0:
			opp_name = "墨影 · %s" % String(match_ref.players[int(q["ghost"])]["name"])
		elif q["beast"]:
			opp_name = "墨兽"
		break
	intel_label.text = "第 %d 回合对垒 · %s" % [match_ref.round, opp_name]
	# 计分板（standings 序；名次/血/等级/连胜按 REPORT_ROW 列位文本化）
	var standings: Array = match_ref.standings()
	for i: int in mini(8, standings.size()):
		var pl: Dictionary = standings[i]
		var row: Label = score_rows[i]
		var c := Palette.PAPER[100] if int(pl["idx"]) == 0 else (Color(Palette.INK[400], 0.9) if not pl["alive"] else Palette.PAPER[300])
		row.add_theme_color_override("font_color", c)
		var streak_txt := ""
		if int(pl["streak"]) >= 2:
			streak_txt = " 胜%d" % int(pl["streak"])
		elif int(pl["streak"]) <= -2:
			streak_txt = " 败%d" % -int(pl["streak"])
		var rank_txt := str(int(pl["rank"])) if int(pl["rank"]) != 0 else "—"
		row.text = "%s %-7s %3d%s" % [rank_txt, String(pl["name"]).substr(0, 7), int(pl["hp"]), streak_txt]
	# 记事：尾部 9 条
	var lines: Array = match_ref.log.slice(maxi(0, match_ref.log.size() - 9))
	log_label.text = "\n".join(lines)
	# 战报：上回合人类结果 + 计分板最近变动（简版；双列图表登记 UX_DELTAS P1 次批强化）
	var h := match_ref.human()
	var rep_lines: Array = []
	match String(h["lastOutcome"]):
		"win":
			rep_lines.append("你击败了 %s" % opp_name)
		"loss":
			rep_lines.append("你不敌 %s，折损 %d 生命" % [opp_name, int(h["lastDamage"])])
		"draw":
			rep_lines.append("与 %s 同归于尽" % opp_name)
		"bye":
			rep_lines.append("轮空休整")
	if int(h["totalDamage"]) > 0:
		rep_lines.append("胜局累计输出 %d" % int(h["totalDamage"]))
	report_label.text = "\n".join(rep_lines)
	# 场上计数
	board_count_label.text = "上阵 %d/%d" % [GameState.board_count(h), GameState.board_cap(h)]


# ── 器匣交互 ──

func _on_item_chip(slot: int) -> void:
	var gi := item_page * int(Spec.c("ITEM_BAR_SLOTS")) + slot
	if unload_mode:
		return
	selected_item_idx = gi if selected_item_idx != gi else -1
	_refresh_item_bar()


func _on_item_page(dir: int) -> void:
	item_page = clampi(item_page + dir, 0, 99)
	selected_item_idx = -1
	_refresh_item_bar()


func _on_toggle_unload() -> void:
	unload_mode = not unload_mode
	selected_item_idx = -1
	_refresh_item_bar()


func _on_auto_equip() -> void:
	_push_undo()
	Inventory.auto_equip(match_ref.human())
	_after_action()


func _on_toggle_lock() -> void:
	var p := match_ref.human()
	p["shopLocked"] = not p["shopLocked"]
	Sess.blip("UI", 440.0, 0.05)
	refresh_all()


## 装备流 / 卸载流落点：拖拽之外点棋子的统一入口
func _try_unit_action(world: Vector2) -> bool:
	var p := match_ref.human()
	var target_iid := -1
	# 命中备战席 / 己方半场
	if world.y >= Layout.BENCH_Y - 10 and world.y <= Layout.BENCH_Y + Layout.BENCH_CELL + 10:
		var bi := int((world.x - Layout.BENCH_X) / Layout.BENCH_CELL)
		if bi >= 0 and bi < 9 and p["bench"][bi] != null:
			target_iid = int(p["bench"][bi]["iid"])
	else:
		var cell := _world_to_local_cell(world)
		if cell.y >= 4:
			var idx := (cell.y - 4) * 8 + cell.x
			if idx >= 0 and idx < 32 and p["board"][idx] != null:
				target_iid = int(p["board"][idx]["iid"])
	if target_iid < 0:
		return false
	if unload_mode:
		var r: Dictionary = Inventory.unequip_all(p, target_iid)
		if r["ok"]:
			Sess.blip("UI", 350.0)
			unload_mode = false
			_after_action()
		return true
	if selected_item_idx >= 0 and selected_item_idx < (p["items"] as Array).size():
		var item_id: String = p["items"][selected_item_idx]
		_push_undo()
		var er: Dictionary = Inventory.equip_item(p, target_iid, item_id)
		if er["ok"]:
			selected_item_idx = -1
			Sess.blip("UI", 587.0)
			_after_action()
		else:
			undo_stack.pop_back()
		return true
	return false


func _unhandled_keyinput(event: InputEvent) -> void:
	if match_ref == null or result_panel != null:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		var key := (event as InputEventKey).keycode
		match key:
			KEY_QUOTELEFT:
				if event.ctrl_pressed and _dbg != null:
					_dbg.toggle()
			KEY_ESCAPE:
				if result_panel == null:
					_settings.open(func(prefs: Dictionary) -> void:
						match_ref.settings["autoDeploy"] = bool(prefs.get("autoDeploy", true)))
			KEY_D:
				_on_reroll()
			KEY_F:
				_on_buy_exp()
			KEY_E:
				_on_auto_arrange()
			KEY_Z:
				_on_undo()


# ── 拖拽（拾起-跟随-落子；≥8px 才算拖拽） ─────────────────

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var e: InputEventMouseButton = event
		if e.button_index == MOUSE_BUTTON_LEFT:
			if e.pressed:
				var badge_i := _trait_badge_at(e.position)
				if badge_i >= 0:
					_open_trait_members(badge_i)
					get_viewport().set_input_as_handled()
					return
				_try_pick(e.position)
			else:
				_drop(e.position)
			get_viewport().set_input_as_handled()
	elif event is InputEventMouseMotion:
		if drag_iid >= 0:
			if drag_ghost != null:
				drag_ghost.position = get_global_mouse_position()
		else:
			var hi := _trait_badge_at(event.position)
			_update_rail_popup(hi)


## 鼠标世界位命中哪枚可见徽章（-1 无）
func _trait_badge_at(world: Vector2) -> int:
	for i: int in badges_visible.size():
		var h: Dictionary = badges_visible[i]["hit"]
		if world.x >= h["x"] and world.x <= h["x"] + h["w"] and world.y >= h["y"] and world.y <= h["y"] + h["h"]:
			if HudLayout.rail_row_visible(h["y"], h["h"]):
				return i
	return -1


## 悬停笺：效果文案（spec effectText 按 tier 取档）+ 名称与计数
func _update_rail_popup(badge_i: int) -> void:
	if badge_i < 0:
		if rail_popup != null and trait_members_card == null:
			rail_popup.queue_free()
			rail_popup = null
		return
	var b: Dictionary = badges_visible[badge_i]
	var def: Variant = b["def"]
	if def == null:
		return
	var lines: Array = []
	var tier := int(b["tier"])
	if tier >= 0:
		var eff: Array = def.get("effectText", [])
		if tier < eff.size():
			lines.append(String(eff[tier]))
	else:
		lines.append("未激活（%d）" % int(b["count"]))
	var desc_lines: Array = [String(def.get("description", ""))]
	var layout := HudLayout.rail_popup_layout(lines.size(), desc_lines.size())
	var pos := HudLayout.rail_popup_pos(HudLayout.rail_badge_world_y(badge_i), layout["h"])
	if rail_popup != null:
		rail_popup.queue_free()
	rail_popup = PanelContainer.new()
	rail_popup.position = Vector2(pos["x"], pos["y"])
	rail_popup.custom_minimum_size = Vector2(layout["w"], layout["h"])
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.INK[900], 0.96)
	sb.border_color = Palette.GILT["deep"] if tier >= 0 else Palette.INK[500]
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(0)
	sb.content_margin_left = 12
	sb.content_margin_right = 12
	sb.content_margin_top = 8
	rail_popup.add_theme_stylebox_override("panel", sb)
	add_child(rail_popup)
	var head := "%s　%d" % [String(def["name"]), int(b["count"])]
	var hl := _label(head, 18, Palette.GILT["light"] if tier >= 0 else Palette.PAPER[300])
	rail_popup.add_child(hl)
	for ln: String in lines:
		var l2 := _label(ln, 15, Palette.PAPER[200])
		l2.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		rail_popup.add_child(l2)
	for d: String in desc_lines:
		var l3 := _label(d, 14, Palette.PAPER[400])
		l3.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		rail_popup.add_child(l3)


## 成员卡（点击徽章钉住；hudLayout 5 列网格，全量成员含未上阵）
func _open_trait_members(badge_i: int) -> void:
	if trait_members_card != null:
		trait_members_card.queue_free()
		trait_members_card = null
	var b: Dictionary = badges_visible[badge_i]
	var trait_id: String = b["id"]
	# 该羁绊全部成员（origins 或 classes 含之）
	var members: Array = []
	for c: Dictionary in Spec.champions:
		if (c["origins"] as Array).has(trait_id) or (c["classes"] as Array).has(trait_id):
			members.append(c)
	var card_h := HudLayout.trait_member_card_h(members.size())
	var card_w := HudLayout.trait_member_card_w()
	var py := HudLayout.trait_member_clamp_y(HudLayout.rail_badge_world_y(badge_i), card_h)
	trait_members_card = PanelContainer.new()
	trait_members_card.position = Vector2(HudLayout.TRAIT_MEMBER_X, py)
	trait_members_card.custom_minimum_size = Vector2(card_w, card_h)
	var sb2 := StyleBoxFlat.new()
	sb2.bg_color = Color(Palette.INK[900], 0.97)
	sb2.border_color = Palette.GILT["base"] if int(b["tier"]) >= 0 else Palette.INK[500]
	sb2.set_border_width_all(1)
	sb2.set_corner_radius_all(0)
	trait_members_card.add_theme_stylebox_override("panel", sb2)
	add_child(trait_members_card)
	var def: Variant = b["def"]
	var head := _label("%s · %d 人 · 已上阵 %d" % [String(def["name"]), members.size(), int(b["count"])], 19, Palette.PAPER[100])
	trait_members_card.add_child(head)
	var grid := GridContainer.new()
	grid.columns = HudLayout.TRAIT_MEMBER_COLS
	trait_members_card.add_child(grid)
	var p := match_ref.human()
	var on_board := {}
	for u in p["board"]:
		if u != null:
			on_board[u["defId"]] = true
	for m: Dictionary in members:
		var cell := VBoxContainer.new()
		var tex := TextureRect.new()
		tex.texture = UnitView.piece_texture(m["id"])
		tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		tex.custom_minimum_size = Vector2(HudLayout.TRAIT_MEMBER_SIZE, HudLayout.TRAIT_MEMBER_SIZE - 22)
		cell.add_child(tex)
		var nm := _label(String(m["name"]), 15, Palette.PAPER[100] if on_board.has(m["id"]) else Palette.PAPER[500])
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		cell.add_child(nm)
		grid.add_child(cell)


func _try_pick(world: Vector2) -> void:
	# 装备流/卸载流：选中物品或卸载态时，点棋子直接生效、不进入拖拽
	if unload_mode or selected_item_idx >= 0:
		if _try_unit_action(world):
			return
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
	panel.size = Vector2(720, 560)
	panel.position = Vector2((Layout.W - 720) / 2.0, (Layout.H - 560) / 2.0)
	dim.add_child(panel)
	var title := _label("回 合 结 算", 36, Palette.GILT["light"], Sess.seal_font)
	title.position = Vector2(0, 22)
	title.size = Vector2(640, 54)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(title)
	var p := match_ref.human()
	var outcome_txt := "—"
	var outcome_c: Color = Palette.PAPER[100]
	match String(p["lastOutcome"]):
		"win":
			outcome_txt = "胜 —— 敌阵尽墨"
			outcome_c = Palette.SPIRIT["light"]
		"loss":
			outcome_txt = "败 —— 折损 %d 生命" % int(p["lastDamage"])
			outcome_c = Palette.CINNABAR["light"]
		"draw":
			outcome_txt = "同归于尽"
		"bye":
			outcome_txt = "轮空"
	var ol := _label(outcome_txt, 24, outcome_c)
	ol.position = Vector2(0, 84)
	ol.size = Vector2(640, 36)
	ol.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(ol)
	# 敌我两列输出三色条（battle_scene 带回统计；轮空无数据则跳过）
	var stats: Array = Sess.scene_data.get("battle_stats", [])
	if not stats.is_empty():
		_render_report_columns(panel, stats)
	var cont := Button.new()
	cont.text = "继 续"
	cont.position = Vector2(270, 490)
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


## 战报双列（v1.12.0 图表口径）：我方（viewer=0 视角按 stats team 记录）左、敌方右；
## 每行 = 名字 + 输出条三色堆叠（物理米金 / 法术夜蓝 / 真伤旧金）+ 阵亡压暗
func _render_report_columns(panel: Panel, stats: Array) -> void:
	var col_w := 310
	var top := 130
	var row_h := 34
	var bar_x := 118
	var bar_w := 128
	var max_dealt := 1.0
	for st: Dictionary in stats:
		max_dealt = maxf(max_dealt, float(st["physical"]) + float(st["magic"]) + float(st["true"]))
	for side: int in 2:
		var bx := 40 if side == 0 else 380
		var cap := _label("我 方" if side == 0 else "敌 方", 15, Palette.PAPER[400])
		cap.position = Vector2(bx, top - 26)
		panel.add_child(cap)
		var rows: Array = []
		for st: Dictionary in stats:
			if int(st["team"]) == side:
				rows.append(st)
		rows.sort_custom(func(a, b) -> bool:
			return float(a["physical"]) + float(a["magic"]) + float(a["true"]) > float(b["physical"]) + float(b["magic"]) + float(b["true"]))
		var y := top
		for ri: int in mini(9, rows.size()):
			var st2: Dictionary = rows[ri]
			var dim_c := 0.45 if not st2["alive"] else 1.0
			var nm := _label("%s%s" % [String(st2["name"]).substr(0, 5), "★".repeat(clampi(int(st2["star"]), 0, 3))], 15, Color(Palette.PAPER[200], dim_c))
			nm.position = Vector2(bx, y)
			panel.add_child(nm)
			# 三色堆叠条
			var total := float(st2["physical"]) + float(st2["magic"]) + float(st2["true"])
			var w_phys := bar_w * (float(st2["physical"]) / max_dealt)
			var w_magic := bar_w * (float(st2["magic"]) / max_dealt)
			var w_true := bar_w * (float(st2["true"]) / max_dealt)
			_stacked_bar(panel, Vector2(bx + bar_x, y + 6), w_phys, w_magic, w_true, dim_c)
			var val := _label("%d" % int(total), 13, Color(Palette.PAPER[400], dim_c))
			val.position = Vector2(bx + bar_x + bar_w + 6, y)
			panel.add_child(val)
			y += row_h
	# 分隔线 + 图例
	var sep := ColorRect.new()
	sep.color = Color(Palette.INK[500], 0.7)
	sep.position = Vector2(365, top - 26)
	sep.size = Vector2(1, 9 * row_h + 26)
	panel.add_child(sep)
	var legend_x := 40
	for leg: Array in [["物理", Palette.PAPER[100]], ["法术", Palette.VOID["light"]], ["真伤", Palette.GILT["light"]]]:
		var block := ColorRect.new()
		block.color = leg[1]
		block.position = Vector2(legend_x, 448)
		block.size = Vector2(9, 9)
		panel.add_child(block)
		var lt := _label(String(leg[0]), 13, Palette.PAPER[400])
		lt.position = Vector2(legend_x + 13, 444)
		panel.add_child(lt)
		legend_x += 64


func _stacked_bar(panel: Panel, pos: Vector2, w_phys: float, w_magic: float, w_true: float, dim_c: float) -> void:
	if w_phys > 0.0:
		var b1 := ColorRect.new()
		b1.color = Color(Palette.PAPER[100], 0.85 * dim_c)
		b1.position = pos
		b1.size = Vector2(w_phys, 8)
		panel.add_child(b1)
	if w_magic > 0.0:
		var b2 := ColorRect.new()
		b2.color = Color(Palette.VOID["light"], 0.85 * dim_c)
		b2.position = pos + Vector2(w_phys, 0)
		b2.size = Vector2(w_magic, 8)
		panel.add_child(b2)
	if w_true > 0.0:
		var b3 := ColorRect.new()
		b3.color = Color(Palette.GILT["light"], 0.85 * dim_c)
		b3.position = pos + Vector2(w_phys + w_magic, 0)
		b3.size = Vector2(w_true, 8)
		panel.add_child(b3)


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
