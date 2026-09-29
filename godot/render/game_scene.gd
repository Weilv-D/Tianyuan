extends Node2D
## 准备阶段主场景（GameScene.ts 对齐版，M3 首批核心面）：
## 顶栏 / 大漆盘（己方半场） / 备战席 / 商店 / 羁绊轨 / 操作列 / 出售印 /
## 拖拽布阵 / 奇遇面板 / 回合结算浮层 / 开战流程（settle-then-replay 入口）。
## 战报·记事·侦查·成员卡·设置面板登记于 M3 次批（见 MILESTONES 清单）。

var match_ref: Match
var board_view: BoardView
var unit_views := {}  # iid -> UnitView
var labels := {}      # 顶栏动态文本
var streak_cap: Label = null
var hp_bar_fg: ColorRect = null
var xp_bar_fg: ColorRect = null
var xp_text: Label = null


## 浮层面板夜宴底：引擎默认 Panel 是中性灰，违反「任何颜色必须来自 Palette」红线
func _style_night_panel(p: Panel) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.INK[900], 0.97)
	sb.border_color = Color(Palette.GILT["base"], 0.5)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(0)
	p.add_theme_stylebox_override("panel", sb)


## 顶栏 56×3 微条（ink 底随建随盖，前景条由 refresh 定宽）
func _mini_bar(pos: Vector2, color: Color) -> ColorRect:
	var bg := ColorRect.new()
	bg.color = Color(Palette.INK[700], 0.9)
	bg.position = pos
	bg.size = Vector2(56, 3)
	add_child(bg)
	var b := ColorRect.new()
	b.color = color
	b.position = pos
	b.size = Vector2(56, 3)
	add_child(b)
	return b
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
var scout_layer: CanvasLayer = null  # 侦查覆盖层（只读快照；原版 ScoutOverlay）
var trait_modal: CanvasLayer = null  # 羁绊全览浮层（nav「羁绊」）
var detail_card: PanelContainer = null  # 棋子详情卡（悬停只读/点选钉住）
var detail_pinned_iid := -1
## 悬停态当前展示的 iid（同 iid 短路——MouseMotion 逐帧触发不重建卡体）
var detail_hover_iid := -1
var press_pos := Vector2.ZERO  # 点击→钉卡判定（<8px 视为点选而非拖拽）
var toast_label: Label = null


func _ready() -> void:
	match_ref = Sess.scene_data.get("match", null)
	if match_ref == null:
		Sess.go("res://render/menu.tscn")
		return
	# 根在原点：全部子元素用设计绝对坐标（0..1920/0..1080），鼠标命中测试
	# （出售印/拖放/徽章）与 e.position 同基制。曾误设 position=(W/2,H/2)（M3 首批
	# 从中心基制模板抄来）——内容整体偏移出屏且输入全错位，2026-09-29 排查实证修复。
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
	_build_phase_strip()
	_build_bench()
	_build_shop()
	_build_item_bar()
	_build_side_panels()
	_build_trait_rail()
	_build_action_bar()
	_build_sell_seal()
	# 静态装饰一律放行鼠标：ColorRect/Panel 默认 mouse_filter=STOP，会吞掉走
	# _unhandled_input 命中测试的全部鼠标事件（拖拽/点选/徽章/计分板/敌情/器匣）。
	# 交互 Control（Button/TextureRect）与此后创建的浮层（dim/panel 需吃点击）不在遍历范围
	for c in get_children():
		if c is ColorRect or c is Panel:
			c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if Sess.scene_data.get("from_battle", false):
		# 战斗返回结算链（原版 resultPending 恢复流）：end_round + 存档 + 双列战报面板
		_after_settle([])
	elif match_ref.round == 0 or match_ref.needs_advance_on_load():
		match_ref.begin_round()
	refresh_all()


# ── 静态构建 ──────────────────────────────────────────────

func _draw_bg() -> void:
	var bg := ColorRect.new()
	bg.color = Palette.INK[950]
	bg.position = Vector2.ZERO
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
	bar.position = Vector2.ZERO
	bar.size = Vector2(Layout.W, Layout.HEADER_H)
	bar.z_index = -5
	add_child(bar)
	# 中央品牌（HudPanels.buildTopBar 口径）：居中题字 + 英文微注 + 两侧金线；
	# 五数值右对齐分列 1340..1780，与题字带 856..1064 结构性错开
	var title := _label("百 战 天 元", 24, Palette.PAPER[100], Sess.seal_font)
	title.position = Vector2(760, 14)
	title.size = Vector2(400, 36)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(title)
	var sub := _label("NIGHT FEAST", 10, Palette.INK[300])
	sub.position = Vector2(760, 50)
	sub.size = Vector2(400, 16)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(sub)
	for seg: Array in [[856, 890], [1030, 1064]]:
		var gl := ColorRect.new()
		gl.color = Color(Palette.GILT["base"], 0.3)
		gl.position = Vector2(float(seg[0]), 38)
		gl.size = Vector2(float(seg[1] - seg[0]), 1)
		add_child(gl)
	# 右侧五数值（HudPanels stat 口径）：值右对齐 17px + 小注 10px，标签进小注不进值
	var stats: Array = [
		["round", "回 合", 1340, Palette.PAPER[100]],
		["gold", "金", 1450, Palette.GILT["light"]],
		["streak", "来 金", 1560, Palette.GILT["base"]],
		["hp", "生 命", 1670, Palette.SPIRIT["base"]],
		["level", "等 级", 1780, Palette.PAPER[100]],
	]
	for s: Array in stats:
		var l := _label("", 17, s[3])
		l.position = Vector2(int(s[2]) - 200, 16)
		l.size = Vector2(200, 24)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		labels[s[0]] = l
		add_child(l)
		var cap := _label(String(s[1]), 10, Palette.INK[300])
		cap.position = Vector2(int(s[2]) - 58, 48)
		cap.size = Vector2(68, 16)
		cap.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		add_child(cap)
		if s[0] == "streak":
			streak_cap = cap
	# hp/xp 微条（口径：hp 56×3 @ (1670-106,80) SPIRIT；xp 56×3 @ (1780-106,80) VOID）
	hp_bar_fg = _mini_bar(Vector2(1564, 80), Palette.SPIRIT["base"])
	xp_bar_fg = _mini_bar(Vector2(1674, 80), Palette.VOID["base"])
	xp_text = _label("", 10, Palette.INK[300])
	xp_text.position = Vector2(1700, 74)
	xp_text.size = Vector2(72, 14)
	xp_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	add_child(xp_text)
	# 左导航（原版 nav：图鉴/羁绊/阵容；样稿 .nl 双行）
	var nav_labels: Array = [["图 鉴", "Codex"], ["羁 绊", "Bonds"], ["阵 容", "Legion"]]
	var nav_cbs: Array = [
		func() -> void: Sess.go("res://render/codex.tscn", { "match": match_ref, "from_game": true }),
		func() -> void: _toggle_trait_modal(),
		func() -> void: _scout_next_opponent(),
	]
	for i: int in 3:
		var nb := Button.new()
		nb.text = String(nav_labels[i][0])
		nb.position = Vector2(Layout.NAV_X + i * Layout.NAV_GAP - 6, 18)
		nb.custom_minimum_size = Vector2(92, 34)
		nb.add_theme_font_override("font", Sess.body_font)
		nb.add_theme_font_size_override("font_size", 14)
		nb.add_theme_color_override("font_color", Palette.PAPER[100])
		nb.add_theme_color_override("font_hover_color", Palette.GILT["light"])
		nb.focus_mode = Control.FOCUS_NONE
		nb.flat = true
		nb.pressed.connect(nav_cbs[i])
		add_child(nb)
		var en := _label(String(nav_labels[i][1]), 10, Palette.INK[300])
		en.position = Vector2(Layout.NAV_X + i * Layout.NAV_GAP, 52)
		add_child(en)


func _build_board() -> void:
	board_view = BoardView.new()
	board_view.position = Vector2(Layout.BOARD_X, Layout.BOARD_Y)
	add_child(board_view)


func _build_bench() -> void:
	var frame := ColorRect.new()
	frame.color = Color(Palette.INK[900], 0.85)
	# 上沿加高到 -56：星级/血条塔（≈-53）此前压出框沿叠到「备 战」签条
	frame.position = Vector2(Layout.BENCH_X - 6, Layout.BENCH_Y - 56)
	frame.size = Vector2(Layout.BENCH_W + 12, Layout.BENCH_CELL + 60)
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
		# 悬停上浮（原版 hover ±8）：常驻按钮只连一次——refresh 循环内重复 connect 会无界累积
		var bi := i
		b.mouse_entered.connect(func() -> void: _hover_shop(bi, true))
		b.mouse_exited.connect(func() -> void: _hover_shop(bi, false))
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
	# 2×3 操作列（对齐 HudPanels.buildActionBar；快捷键 D/F/E/Z/空格 见 _unhandled_key_input）
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


## 阶段条（原版 buildPhaseStrip）：盘下金线对 + 「备 战」+ 开战按钮（唯一开战入口；
## 旧版挤在操作列下方，与 web 版口径不一）
func _build_phase_strip() -> void:
	var cx := Layout.W / 2.0
	var py := float(Layout.PHASE_Y)
	for seg: Array in [[cx - 380.0, cx - 310.0], [cx + 290.0, cx + 420.0]]:
		var line := ColorRect.new()
		line.color = Color(Palette.GILT["base"], 0.25)
		line.position = Vector2(seg[0], py)
		line.size = Vector2(seg[1] - seg[0], 1)
		add_child(line)
	var ph := _label("备 战", 15, Palette.PAPER[100], Sess.seal_font)
	ph.position = Vector2(cx - 230, py - 12)
	ph.size = Vector2(160, 24)
	ph.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(ph)
	var fight := Button.new()
	fight.text = "开 战 · 空格"
	fight.position = Vector2(cx + 20, py - 16)
	fight.custom_minimum_size = Vector2(140, 32)
	fight.add_theme_font_override("font", Sess.body_font)
	fight.add_theme_font_size_override("font_size", 13)
	fight.add_theme_color_override("font_color", Palette.PAPER[100])
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
		l.position = Vector2(Layout.REPORT_X, Layout.SCORE_ROW_Y + i * Layout.SCORE_ROW_STEP)
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
	# 奇遇回合长行横穿器匣：CJK 按字断行
	log_label.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
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
	# TS SceneRefresh 口径：值纯数字（标签在小注）、来金 = 5+利息+连胜、hp/xp 微条
	(labels["round"] as Label).text = str(match_ref.round)
	(labels["hp"] as Label).text = str(int(p["hp"]))
	(labels["gold"] as Label).text = str(int(p["gold"]))
	(labels["level"] as Label).text = str(int(p["level"]))
	var inc := 5 + Economy.interest_of(p["gold"]) + Economy.streak_gold(int(p["streak"]))
	(labels["streak"] as Label).text = "+%d" % inc
	if streak_cap != null:
		var st := int(p["streak"])
		streak_cap.text = ("来 金 · 连胜 %d" % st) if st >= 2 else (("来 金 · 连败 %d" % -st) if st <= -2 else "来 金")
	if hp_bar_fg != null:
		hp_bar_fg.size.x = 56.0 * clampf(float(p["hp"]) / Spec.c("PLAYER_START_HP", 110.0), 0.0, 1.0)
	if xp_bar_fg != null:
		var need := Economy.xp_to_next(int(p["level"]))
		if need > 0:
			xp_bar_fg.size.x = 56.0 * clampf(float(p["xp"]) / float(need), 0.0, 1.0)
			xp_text.text = "%d/%d" % [int(p["xp"]), need]
		else:
			xp_bar_fg.size.x = 56.0
			xp_text.text = "满级"
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
	var owned_ids := {}
	for u in p["board"]:
		if u != null:
			owned_ids[u["defId"]] = true
	for u in p["bench"]:
		if u != null:
			owned_ids[u["defId"]] = true
	for t in shop_pulse_tweens:
		t.kill()
	shop_pulse_tweens.clear()
	for i: int in 5:
		var b: Button = shop_buttons[i]
		var id: Variant = p["shop"][i]
		_clear_button_children(b)
		b.modulate = Color.WHITE
		b.position.y = Layout.SHOP_Y
		if id == null:
			b.disabled = true
			# 售罄留痕（TS 口径 dim + —）：纯暗块读作坏格
			var sold := _label("—", 17, Color(Palette.PAPER[400], 0.5))
			sold.position = Vector2(Layout.SHOP_CW / 2.0 - 40.0, 86)
			sold.size = Vector2(80, 26)
			sold.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			b.add_child(sold)
			continue
		var def: Variant = Spec.champion_by_id.get(id, null)
		if def == null:
			b.disabled = true
			continue
		b.disabled = float(p["gold"]) < float(def["cost"])
		# 直购角标（商肆 1-5；仅可买时显示——原版同口径）
		var badge := _label(str(i + 1), 12, Palette.PAPER[400])
		badge.position = Vector2(5, 3)
		badge.visible = not b.disabled
		b.add_child(badge)
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
		var trait_l := _label(_trait_names(def), 14, Palette.PAPER[400])
		trait_l.position = Vector2(8, 130)
		trait_l.size = Vector2(Layout.SHOP_CW - 16, 20)
		trait_l.clip_text = true
		b.add_child(trait_l)
		# 场上/备战已有同名：呼吸脉冲（「买它=向合成推进」提示——原版同口径）
		if owned_ids.has(id) and not b.disabled:
			var pt := create_tween().set_loops()
			pt.tween_property(b, "modulate:a", 0.66, 0.46)
			pt.tween_property(b, "modulate:a", 1.0, 0.46)
			shop_pulse_tweens.append(pt)


var shop_pulse_tweens: Array = []
var _shop_hover_tweens: Array = [null, null, null, null, null]


## 商店卡悬停上浮/回落：换向先 kill 旧 tween（对齐 web hoverTween 语义——两条 tween 同写 y 会互相拉扯）
func _hover_shop(bi: int, enter: bool) -> void:
	var tw: Tween = _shop_hover_tweens[bi]
	if tw != null and tw.is_valid():
		tw.kill()
	var target := float(Layout.SHOP_Y) - (8.0 if enter else 0.0)
	tw = create_tween()
	tw.tween_property(shop_buttons[bi], "position:y", target, 0.32)
	_shop_hover_tweens[bi] = tw


func _clear_button_children(b: Button) -> void:
	for c in b.get_children():
		c.queue_free()


func _refresh_trait_rail() -> void:
	# 悬停笺随刷新关闭：徽章序与档位可能已变（买卖后），留旧笺会展示过期计数
	if rail_popup != null and trait_members_card == null:
		rail_popup.queue_free()
		rail_popup = null
	rail_popup_badge = -1
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
			# 可见门与输入侧同源：越出羁绊视窗底的行不渲染（第 15+ 行会压进备战席框）
			var row_y := float(Layout.RAIL_Y + i * Layout.RAIL_PITCH)
			badge.visible = HudLayout.rail_row_visible(row_y, float(Layout.RAIL_PITCH))
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


var adventure_layer: CanvasLayer = null


func _check_adventure() -> void:
	if match_ref.adventure_offer == null:
		return
	# 已开守卫：offer 未决期间任何 refresh_all 都会重入——叠层且旧按钮仍连着 resolve
	if adventure_layer != null and is_instance_valid(adventure_layer):
		return
	var offer: Dictionary = match_ref.adventure_offer
	var layer := CanvasLayer.new()
	adventure_layer = layer
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
	var title := _label("奇 遇 · 择 一", 28, Palette.GILT["light"], Sess.seal_font)
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
		b.add_theme_font_size_override("font_size", 17)
		b.add_theme_color_override("font_color", Palette.PAPER[100])
		# 夜宴样式覆写：默认按钮无边框无底色，与暗幕融为一体
		var osb := StyleBoxFlat.new()
		osb.bg_color = Color(Palette.INK[850], 0.95)
		osb.border_color = Color(Palette.GILT["base"], 0.55)
		osb.set_border_width_all(1)
		osb.set_corner_radius_all(0)
		osb.content_margin_left = 12
		osb.content_margin_right = 12
		osb.content_margin_top = 10
		osb.content_margin_bottom = 10
		b.add_theme_stylebox_override("normal", osb)
		var hsb := osb.duplicate()
		hsb.border_color = Palette.GILT["light"]
		b.add_theme_stylebox_override("hover", hsb)
		var psb := osb.duplicate()
		psb.bg_color = Color(Palette.INK[800], 0.95)
		b.add_theme_stylebox_override("pressed", psb)
		# desc 超宽不换行会横向溢出三卡互叠
		b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		b.focus_mode = Control.FOCUS_NONE
		var idx := i
		b.pressed.connect(func() -> void:
				match_ref.resolve_adventure(idx)
				layer.queue_free()
				adventure_layer = null
				Sess.sfx.play("uiBig")
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
	var stars_before := _stars_snapshot()
	var r: Dictionary = match_ref.buy(match_ref.human(), slot)
	if not r["ok"]:
		undo_stack.pop_back()
		Sess.sfx.play("warn")
		return
	Sess.sfx.play("coin")
	_detect_merge_sound(stars_before)
	_after_action()


func _on_reroll() -> void:
	_push_undo()
	if not match_ref.reroll(match_ref.human()):
		undo_stack.pop_back()
		Sess.sfx.play("warn")
		return
	Sess.sfx.play("ui")
	_after_action()


func _on_buy_exp() -> void:
	_push_undo()
	var lv_before := int(match_ref.human()["level"])
	if not match_ref.buy_exp(match_ref.human()):
		undo_stack.pop_back()
		Sess.sfx.play("warn")
		return
	if int(match_ref.human()["level"]) > lv_before:
		Sess.sfx.play("levelup")
	else:
		Sess.sfx.play("coin")
	_after_action()


func _on_auto_arrange() -> void:
	_push_undo()
	Arrange.auto_arrange(match_ref.human(), match_ref.pool)
	Sess.sfx.play("uiBig")
	_after_action()


func _on_undo() -> void:
	if undo_stack.is_empty():
		return
	var e: Dictionary = undo_stack.pop_back()
	Undo.restore_player(match_ref.human(), match_ref.pool, e["snap"], match_ref)
	match_ref.rng.state = int(e["rng"])
	Sess.sfx.play("ui")
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
		row.text = "%s %s %s%s" % [rank_txt, _pad_disp(String(pl["name"]), 15), _pad_disp(str(int(pl["hp"])), 4, true), streak_txt]
	# 记事：尾部 9 条
	var lines: Array = match_ref.log.slice(maxi(0, match_ref.log.size() - 9))
	log_label.text = "\n".join(lines)
	# 战报：上回合人类结果 + 计分板最近变动（简版；双列图表登记 UX_DELTAS P1 次批强化）
	var h := match_ref.human()
	var rep_lines: Array = []
	# lastOutcome 首回合为 null（TS 同口径）——String() 构造不接受 null，必须空串化
	var outcome_v: Variant = h.get("lastOutcome", null)
	var outcome_s := "" if outcome_v == null else String(outcome_v)
	match outcome_s:
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
	if selected_item_idx != gi:
		Sess.sfx.play("ui")  # 选中才鸣，取消不鸣（原版同口径）
	selected_item_idx = gi if selected_item_idx != gi else -1
	_refresh_item_bar()


func _on_item_page(dir: int) -> void:
	item_page = clampi(item_page + dir, 0, 99)
	selected_item_idx = -1
	Sess.sfx.play("ui")
	_refresh_item_bar()


func _on_toggle_unload() -> void:
	unload_mode = not unload_mode
	selected_item_idx = -1
	Sess.sfx.play("ui")
	_refresh_item_bar()


func _on_auto_equip() -> void:
	_push_undo()
	Inventory.auto_equip(match_ref.human())
	Sess.sfx.play("ui")
	_after_action()


func _on_toggle_lock() -> void:
	# 对齐 web onToggleLock：不入撤销栈，但走 afterAction（落盘）——此前只刷新不落盘，
	# 锁店状态要等下一次动作才持久化
	var p := match_ref.human()
	p["shopLocked"] = not p["shopLocked"]
	Sess.sfx.play("ui")
	_after_action()


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
			Sess.sfx.play("ui")
			unload_mode = false
			_after_action()
		return true
	if selected_item_idx >= 0 and selected_item_idx < (p["items"] as Array).size():
		var item_id: String = p["items"][selected_item_idx]
		_push_undo()
		var er: Dictionary = Inventory.equip_item(p, target_iid, item_id)
		if er["ok"]:
			selected_item_idx = -1
			Sess.sfx.play("ui")
			_after_action()
		else:
			undo_stack.pop_back()
			Sess.sfx.play("warn")
		return true
	return false


func _unhandled_key_input(event: InputEvent) -> void:
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
			KEY_SPACE:
				_start_battle_phase()
			KEY_D:
				_on_reroll()
			KEY_F:
				_on_buy_exp()
			KEY_E:
				_on_auto_arrange()
			KEY_Z:
				_on_undo()
			KEY_1, KEY_2, KEY_3, KEY_4, KEY_5:
				_on_buy(int(key) - KEY_1)


# ── 拖拽（拾起-跟随-落子；≥8px 才算拖拽） ─────────────────

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var e: InputEventMouseButton = event
		if e.button_index == MOUSE_BUTTON_LEFT:
			if e.pressed:
				press_pos = e.position
				var badge_i := _trait_badge_at(e.position)
				if badge_i >= 0:
					_open_trait_members(badge_i)
					get_viewport().set_input_as_handled()
					return
				# 侦查入口：计分板行 / 敌情（与徽章同走 _unhandled_input 命中测试——
				# 本场景输入统一架构，Control gui_input 挂 Node2D 子树不可靠）
				var row_i := _score_row_at(e.position)
				if row_i >= 0:
					_open_scout_for_row(row_i)
					get_viewport().set_input_as_handled()
					return
				if _intel_hit(e.position):
					_open_scout_for_intel()
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
			if hi < 0:
				# 悬停详情卡（只读态；钉住态不受悬停影响）
				var hu = _unit_at(event.position)
				if hu != null:
					if detail_pinned_iid < 0:
						_show_detail(hu, false)
				elif detail_card != null and detail_pinned_iid < 0:
					_close_detail()


## 鼠标世界位命中哪枚可见徽章（-1 无）
func _trait_badge_at(world: Vector2) -> int:
	for i: int in badges_visible.size():
		var h: Dictionary = badges_visible[i]["hit"]
		if world.x >= h["x"] and world.x <= h["x"] + h["w"] and world.y >= h["y"] and world.y <= h["y"] + h["h"]:
			if HudLayout.rail_row_visible(h["y"], h["h"]):
				return i
	return -1


## 悬停笺：效果文案（spec effectText 按 tier 取档）+ 名称与计数
var rail_popup_badge := -1


func _update_rail_popup(badge_i: int) -> void:
	if badge_i < 0:
		if rail_popup != null and trait_members_card == null:
			rail_popup.queue_free()
			rail_popup = null
		rail_popup_badge = -1
		return
	# 同徽章短路：MouseMotion 逐帧触发不重建笺体（计数变化时由 refresh 侧关闭重开）
	if rail_popup != null and rail_popup_badge == badge_i:
		return
	rail_popup_badge = badge_i
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
	# PanelContainer 把每个子都拉伸到同一矩形（标题与网格互相叠压）——经
	# MarginContainer + VBox 纵排（TS 口径：标题行在上、成员网格在下）
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 12)
	margin.add_theme_constant_override("margin_top", 10)
	margin.add_theme_constant_override("margin_right", 12)
	margin.add_theme_constant_override("margin_bottom", 10)
	trait_members_card.add_child(margin)
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 8)
	margin.add_child(vb)
	vb.add_child(head)
	var grid := GridContainer.new()
	grid.columns = HudLayout.TRAIT_MEMBER_COLS
	vb.add_child(grid)
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
	# 点选（<8px 位移）：钉住/取消棋子详情卡（原版点选钉卡同口径）
	if press_pos.distance_to(world) < 8.0:
		_toggle_pin(drag_iid)
		drag_iid = -1
		drag_ghost = null
		return
	# 出售印
	if world.x >= Layout.SELL_X and world.x <= Layout.SELL_X + Layout.SELL_SIZE and world.y >= Layout.SELL_Y and world.y <= Layout.SELL_Y + Layout.SELL_SIZE:
		if match_ref.sell(p, drag_iid):
			Sess.sfx.play("coin")
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
			Sess.sfx.play("ui")
		else:
			Sess.sfx.play("warn")
	elif world.y >= Layout.BENCH_Y - 10 and world.y <= Layout.BENCH_Y + Layout.BENCH_CELL + 10:
		var bi := int((world.x - Layout.BENCH_X) / Layout.BENCH_CELL)
		if bi >= 0 and bi < 9 and GameState.can_place(p, drag_iid, "bench", bi)["ok"]:
			GameState.move_to_slot(p, drag_iid, "bench", bi)
			Sess.sfx.play("ui")
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
	Sess.sfx.play_pluck(196.0)  # 徵音起手：开战的弦响（原版 GameScene:803 同款）
	if me_pair.is_empty():
		# 轮空：清上一场战报残留，结算面板不渲染过期战斗的双列
		Sess.scene_data.erase("battle_stats")
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
	_style_night_panel(panel)
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
			Sess.sfx.play("uiBig")  # 回合胜负是常态：高光留给三星/终局（原版口径）
		"loss":
			outcome_txt = "败 —— 折损 %d 生命" % int(p["lastDamage"])
			outcome_c = Palette.CINNABAR["light"]
			Sess.sfx.play("warn")
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
		if match_ref.is_over():
			Sess.go("res://render/result.tscn", { "match": match_ref })
			return
		if not match_ref.human()["alive"]:
			_show_eliminated()
			return
		match_ref.begin_round()
		refresh_all())
	panel.add_child(cont)


## 显示宽度（CJK 记 2、ASCII 记 1）与定宽填充：计分板列对齐用
static func _disp_w(s: String) -> int:
	var w := 0
	for ch in s:
		w += 2 if ch.unicode_at(0) > 0x2E7F else 1
	return w


static func _pad_disp(s: String, width: int, left_pad: bool = false) -> String:
	var diff := width - _disp_w(s)
	if diff <= 0:
		return s
	return s + " ".repeat(diff) if not left_pad else " ".repeat(diff) + s


# ── 侦查覆盖层（原版 ScoutOverlay 对齐）：点击计分板行/敌情查看对手阵地快照 ──

## 计分板行命中（SCORE_ROW_Y + i×STEP 起点，含 6px 容差；与侧栏构建几何同源）
func _score_row_at(world: Vector2) -> int:
	if world.x < Layout.REPORT_X - 6.0 or world.x > Layout.REPORT_X + Layout.SIDE_W + 6.0:
		return -1
	for i: int in score_rows.size():
		var y0 := float(Layout.SCORE_ROW_Y + i * Layout.SCORE_ROW_STEP) - 6.0
		if world.y >= y0 and world.y <= y0 + 36.0:
			return i
	return -1


## 敌情行命中（y 160..184 带）
func _intel_hit(world: Vector2) -> bool:
	return world.x >= Layout.REPORT_X - 6.0 and world.x <= Layout.REPORT_X + Layout.SIDE_W + 6.0 \
		and world.y >= 154.0 and world.y <= 190.0


func _open_scout_for_row(row_i: int) -> void:
	var standings: Array = match_ref.standings()
	if row_i >= standings.size() or result_panel != null:
		return
	var pl: Dictionary = standings[row_i]
	var idx := int(pl["idx"])
	var pl2: Dictionary = match_ref.players[idx]
	_open_scout(String(pl2["name"]), "生命 %d　等级 %d" % [int(pl2["hp"]), int(pl2["level"])], pl2["board"] as Array)


func _open_scout_for_intel() -> void:
	if result_panel != null:
		return
	for q: Dictionary in match_ref.pairings:
		var other := -2
		if int(q["a"]) == 0:
			other = int(q["b"])
		elif int(q["b"]) == 0:
			other = int(q["a"])
		if other >= 0:
			var pl: Dictionary = match_ref.players[other]
			_open_scout(String(pl["name"]), "生命 %d　等级 %d" % [int(pl["hp"]), int(pl["level"])], pl["board"] as Array)
		elif int(q["ghost"]) >= 0:
			_open_scout("墨 影", "沿用〔%s〕出局阵容" % String(match_ref.players[int(q["ghost"])]["name"]), match_ref.board_of_opponent(q))
		elif q.get("beast", false):
			# 墨兽轮无可侦：与 nav「阵容」入口同口径浮讯（静默无反应两入口不一致）
			_toast("墨兽轮 · 无可侦查")
		return


func _open_scout(title: String, sub: String, board: Array) -> void:
	_close_scout()
	scout_layer = CanvasLayer.new()
	scout_layer.layer = 94
	add_child(scout_layer)
	var dim := ColorRect.new()
	dim.color = Color(Palette.SHADE, 0.66)
	dim.size = Vector2(Layout.W, Layout.H)
	dim.gui_input.connect(func(ev: InputEvent) -> void:
		if ev is InputEventMouseButton and ev.pressed:
			_close_scout())
	scout_layer.add_child(dim)
	var bw := 780
	var bh := 600
	var panel := Panel.new()
	panel.size = Vector2(bw, bh)
	panel.position = Vector2((Layout.W - bw) / 2.0, (Layout.H - bh) / 2.0)
	_style_night_panel(panel)
	dim.add_child(panel)
	var ttl := _label("%s 的阵地" % title, 22, Palette.PAPER[100])
	ttl.position = Vector2(28, 18)
	panel.add_child(ttl)
	var subl := _label(sub, 13, Palette.PAPER[400])
	subl.position = Vector2(bw - 300, 28)
	subl.size = Vector2(272, 20)
	subl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	panel.add_child(subl)
	# 棋盘快照（8×4 上半场，原版口径）
	var cell := 80.0
	var gx := (bw - cell * 8.0) / 2.0
	var gy := 66.0
	for i: int in mini(32, board.size()):
		var u = board[i]
		if u == null:
			continue
		var col := i % 8
		var row := i / 8
		var tex := TextureRect.new()
		tex.texture = UnitView.piece_texture(String(u["defId"]))
		tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		tex.custom_minimum_size = Vector2(cell - 8, cell - 24)
		tex.position = Vector2(gx + col * cell, gy + row * cell)
		panel.add_child(tex)
		var st := _label("★".repeat(clampi(int(u["star"]), 1, 3)), 13, Palette.GILT["light"])
		st.position = Vector2(gx + col * cell, gy + row * cell + cell - 24)
		st.size = Vector2(cell, 16)
		st.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		panel.add_child(st)
		for ii: int in mini(3, (u.get("items", []) as Array).size()):
			var icon := TextureRect.new()
			icon.texture = load("res://assets/items/%s.png" % String(u["items"][ii]))
			icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
			icon.custom_minimum_size = Vector2(16, 16)
			icon.position = Vector2(gx + col * cell + 2 + ii * 18, gy + row * cell + 2)
			panel.add_child(icon)
	# 羁绊行（激活档按 tier 降序）
	var ty := gy + cell * 4.0 + 16.0
	var cap := _label("羁 绊", 15, Palette.PAPER[300], Sess.seal_font)
	cap.position = Vector2(28, ty)
	panel.add_child(cap)
	var active: Array = []
	for t: Dictionary in match_ref._traits_of(board):
		if int(t["tier"]) >= 0:
			active.append(t)
	active.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return int(a["tier"]) > int(b["tier"]))
	var parts: Array = []
	for t: Dictionary in active:
		parts.append("%s %d" % [String(Spec.traits_by_id[String(t["id"])].get("name", t["id"])), int(t["count"])])
	var tr := _label(" · ".join(parts) if parts.size() > 0 else "（未激活任何羁绊）", 13, Palette.PAPER[200])
	tr.position = Vector2(90, ty + 2)
	tr.size = Vector2(bw - 130, 60)
	tr.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	panel.add_child(tr)
	var close := Button.new()
	close.text = "关 闭"
	close.position = Vector2(bw - 150, bh - 58)
	close.custom_minimum_size = Vector2(110, 42)
	close.add_theme_font_override("font", Sess.body_font)
	close.add_theme_font_size_override("font_size", 18)
	close.add_theme_color_override("font_color", Palette.PAPER[100])
	close.focus_mode = Control.FOCUS_NONE
	close.pressed.connect(_close_scout)
	panel.add_child(close)
	Sess.sfx.play("ui")


func _close_scout() -> void:
	if scout_layer != null:
		scout_layer.queue_free()
		scout_layer = null


# ── 玩家淘汰（原版 EliminatedOverlay「道 消」对齐）：名次/战绩 + 两出口 ──

func _show_eliminated() -> void:
	var p := match_ref.human()
	result_panel = CanvasLayer.new()
	result_panel.layer = 95
	add_child(result_panel)
	var dim := ColorRect.new()
	dim.color = Color(Palette.SHADE, 0.78)
	dim.size = Vector2(Layout.W, Layout.H)
	result_panel.add_child(dim)
	var panel := Panel.new()
	panel.size = Vector2(560, 420)
	panel.position = Vector2((Layout.W - 560) / 2.0, (Layout.H - 420) / 2.0)
	dim.add_child(panel)
	var title := _label("道 消", 52, Palette.CINNABAR["light"], Sess.seal_font)
	title.position = Vector2(0, 40)
	title.size = Vector2(560, 76)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(title)
	var rank := int(p["rank"]) if int(p["rank"]) != 0 else 8
	var sub := _label("第 %d 名出局 · 第 %d 回合 · 战绩 %d胜%d败" % [rank, match_ref.round, int(p["wins"]), int(p["losses"])], 20, Palette.PAPER[200])
	sub.position = Vector2(0, 130)
	sub.size = Vector2(560, 32)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(sub)
	var ff := Button.new()
	ff.text = "快 进 到 终 局"
	ff.position = Vector2(50, 240)
	ff.custom_minimum_size = Vector2(210, 52)
	_style_action_button(ff)
	ff.pressed.connect(func() -> void: _fast_forward_after_death())
	panel.add_child(ff)
	var re := Button.new()
	re.text = "再 来 一 局"
	re.position = Vector2(300, 240)
	re.custom_minimum_size = Vector2(210, 52)
	_style_action_button(re)
	re.pressed.connect(func() -> void: _restart_after_death())
	panel.add_child(re)
	Sess.sfx.play("defeat")


func _style_action_button(b: Button) -> void:
	b.add_theme_font_override("font", Sess.body_font)
	b.add_theme_font_size_override("font_size", 20)
	b.add_theme_color_override("font_color", Palette.PAPER[100])
	b.focus_mode = Control.FOCUS_NONE


## 玩家淘汰后把剩下的回合快进完，给出最终名次（原版 fastForward 同回路）
func _fast_forward_after_death() -> void:
	# 每回合让渲染一帧：内核结算 ~239ms/回合，同步跑完 ≈5-6s 整窗无响应
	_toast("推演中…")
	var guard := 0
	while not match_ref.is_over() and guard < 60:
		match_ref.begin_round()
		if match_ref.is_over():
			break
		match_ref.settle_round()
		match_ref.end_round()
		guard += 1
		await get_tree().process_frame
	Sess.go("res://render/result.tscn", { "match": match_ref })


func _restart_after_death() -> void:
	SaveStore.clear_save(String(match_ref.mode))
	var seed_val := int(Time.get_unix_time_from_system()) & 0x7FFFFFFF
	Sess.go("res://render/game_scene.tscn", { "match": Match.new(seed_val, "你", String(match_ref.mode)) })


# ── 买入合并高光音（原版 celebrate/detectThreeStar 口径） ──

func _stars_snapshot() -> Dictionary:
	var m := {}
	var p := match_ref.human()
	for u in p["board"]:
		if u != null:
			m[int(u["iid"])] = int(u["star"])
	for u in p["bench"]:
		if u != null:
			m[int(u["iid"])] = int(u["star"])
	return m


## 二星→levelup、三星→star3；五费三星追加 skillBig（全屏演出登记后续增强）
func _detect_merge_sound(before: Dictionary) -> void:
	var after := _stars_snapshot()
	for iid_v in after:
		var iid := int(iid_v)
		var star := int(after[iid_v])
		# 只有「此前已有同 iid 棋子」的升星才算合成 —— 首次买入（before 无此 iid）
		# 不鸣（曾误判每次首买都 levelup，与 coin 叠声）
		if before.has(iid) and star > int(before[iid]):
			if star >= 3:
				var u = GameState.find_unit(match_ref.human(), iid)
				var cost := 0
				if u != null:
					var def: Variant = Spec.champion_by_id.get(String(u["defId"]), null)
					if def != null:
						cost = int(def["cost"])
				if cost >= 5:
					Sess.sfx.play("star3")
					Sess.sfx.play("skillBig")
				else:
					Sess.sfx.play("star3")
			else:
				Sess.sfx.play("levelup")
			return  # 一次买入至多一串合并，只鸣一次（原版 celebrate 单次口径）


# ── 名称工具：羁绊/职业 id → 中文名（UI 一律禁直显拼音 id） ──────

func _trait_names(def: Dictionary) -> String:
	var parts: Array = []
	for tid in def["origins"]:
		var td: Variant = Spec.traits_by_id.get(String(tid), null)
		parts.append(String(td["name"]) if td != null else String(tid))
	for tid2 in def["classes"]:
		var td2: Variant = Spec.traits_by_id.get(String(tid2), null)
		parts.append(String(td2["name"]) if td2 != null else String(tid2))
	return " · ".join(parts)


func _unit_at(world: Vector2) -> Variant:
	var p := match_ref.human()
	if world.y >= Layout.BENCH_Y - 10 and world.y <= Layout.BENCH_Y + Layout.BENCH_CELL + 10:
		var i := int((world.x - Layout.BENCH_X) / Layout.BENCH_CELL)
		if i >= 0 and i < 9 and p["bench"][i] != null:
			return p["bench"][i]
	else:
		var cell := _world_to_local_cell(world)
		if cell.y >= 4:
			var idx := (cell.y - 4) * 8 + cell.x
			if idx >= 0 and idx < 32 and p["board"][idx] != null:
				return p["board"][idx]
	return null


# ── 棋子详情卡（原版 UnitDetailCard 对齐）：悬停只读 / 点选钉住带出售 ──

func _toggle_pin(iid: int) -> void:
	if detail_pinned_iid == iid:
		detail_pinned_iid = -1
		_close_detail()
		return
	detail_pinned_iid = iid
	var u = GameState.find_unit(match_ref.human(), iid)
	if u != null:
		_show_detail(u, true)
		Sess.sfx.play("ui")


func _close_detail() -> void:
	if detail_card != null:
		detail_card.queue_free()
		detail_card = null
	detail_hover_iid = -1


## 技能描述模板回填（champions.ts DESC_KEYS 对等移植）：占位键 → 语义化格式器——
## 百分比键 ×100 加 %、嵌套键从 status/summon/extraStatus 子字典取值、
## volleySpan/vulnDur 与实现同式推导；模板未列的键原样保留。
## 此前朴素「全键 float()」对 dict/bool 型 params（42+8 处）直接炸卡，且百分比裸小数。
func _fmt_skill_desc(desc: String, p: Dictionary) -> String:
	var out := desc
	for key: String in [
		"atk", "sp", "value", "healOnHit", "shieldOnHit", "damageReduction", "reflect",
		"threshold", "dpsSp", "resetOnKill", "hpPct", "atkPct", "statusValue",
		"extraStatusValue", "vulnerability", "falloff", "stackAtkOnHit", "thresholdMult",
		"finalMult", "healPerExecute", "statusFlat", "statusDur", "shieldDur", "radius",
		"dur", "delay", "length", "shots", "volleySpan", "jumps", "knockback", "count",
		"vulnDur", "maxStacks", "maxRepeats",
	]:
		var ph := "{%s}" % key
		if out.contains(ph):
			out = out.replace(ph, _desc_fmt(key, p))
	return out


static func _num(v: Variant) -> float:
	return float(v) if v is float or v is int else 0.0


## TS String(number) 口径：整数不带小数尾（GD str(8.0)="8.0"，TS String(8)="8"）
static func _snum(v: Variant) -> String:
	var f := _num(v)
	return str(int(f)) if absf(f - roundf(f)) < 0.0001 else str(f)


static func _pctv(v: Variant) -> String:
	return "%.0f%%" % (_num(v) * 100.0)


static func _sub(p: Dictionary, path: String) -> Dictionary:
	var d: Variant = p.get(path, null)
	return d if d is Dictionary else {}


func _desc_fmt(key: String, p: Dictionary) -> String:
	match key:
		# 纯百分比键（值即比例 0.45 → 45%）
		"atk", "sp", "value", "healOnHit", "shieldOnHit", "damageReduction", "reflect", \
		"threshold", "dpsSp", "resetOnKill", "falloff", "stackAtkOnHit", "healPerExecute", "vulnerability":
			return _pctv(p.get(key, null))
		# 嵌套取值键（summon / status / extraStatus 子字典）
		"hpPct":
			return _pctv(_sub(p, "summon").get("hpPct", null))
		"atkPct":
			return _pctv(_sub(p, "summon").get("atkPct", null))
		"statusValue":
			return _pctv(_num(_sub(p, "status").get("value", null)) / 100.0)
		"extraStatusValue":
			return _pctv(_num(_sub(p, "extraStatus").get("value", null)) / 100.0)
		# 平值/时长/计数键（String 口径，缺值按 0/1）
		"statusFlat":
			return str(int(_num(_sub(p, "status").get("value", null))))
		"statusDur":
			return _snum(_sub(p, "status").get("dur", p.get("dur", null)))
		"shieldDur":
			return _snum(p.get("shieldDur", null))
		"radius":
			return str(int(_num(p.get("radius", null))) if p.get("radius", null) != null else 1)
		"dur":
			return _snum(p.get("dur", null) if p.get("dur", null) != null else _sub(p, "status").get("dur", null))
		"delay", "knockback":
			return str(int(_num(p.get(key, null))))
		"length":
			return str(int(_num(p.get("length", null))))
		"shots", "jumps":
			return str(int(_num(p.get(key, null))) if p.get(key, null) != null else 1)
		"count":
			return str(int(_num(_sub(p, "summon").get("count", null))))
		"maxStacks", "maxRepeats":
			return str(int(_num(p.get(key, null))))
		# 推导式键（与实现同式）
		"volleySpan":
			return _snum(float(ParityUtil.js_round(((_num(p.get("shots", null)) if p.get("shots", null) != null else 1.0) - 1.0) * _num(p.get("interval", null)) * 100.0)) / 100.0)
		"vulnDur":
			return _snum(p.get("vulnDur", null) if p.get("vulnDur", null) != null else _num(p.get("dur", null)) + 2.0)
		# 阈值倍率（1.0 = 100%），实现侧缺省 2
		"thresholdMult", "finalMult":
			return _pctv(p.get(key, null) if p.get(key, null) != null else 2.0)
	return "{%s}" % key


func _show_detail(u: Dictionary, pinned: bool) -> void:
	var def: Variant = Spec.champion_by_id.get(String(u["defId"]), null)
	if def == null:
		return
	if detail_card != null and (detail_pinned_iid == int(u["iid"]) or detail_hover_iid == int(u["iid"])):
		return
	_close_detail()
	detail_hover_iid = int(u["iid"])
	var w: int = Layout.DETAIL_W
	var h: int = (Layout.DETAIL_H + Layout.DETAIL_SELL_BAND) if pinned else Layout.DETAIL_H
	var rarity := int(def["cost"])
	# 卡位：贴悬停/点选棋子的右侧，钳在可视域（hud_layout 卡位带）
	var anchor := Vector2(960, 500)
	var v: UnitView = unit_views.get(int(u["iid"]), null)
	if v != null:
		anchor = v.position
	var px: float = clampf(anchor.x + 40.0, 66.0, 1920.0 - 48.0 - w)
	var py: float = clampf(anchor.y - h / 2.0, float(HudLayout.CAH_Y_MIN), maxf(float(HudLayout.CAH_Y_MIN), float(HudLayout.CAH_Y_MAX) - h))
	detail_card = PanelContainer.new()
	detail_card.position = Vector2(px, py)
	detail_card.custom_minimum_size = Vector2(w, h)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.INK[900], 0.97)
	sb.border_color = Palette.RARITY_COLOR[rarity]
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(0)
	detail_card.add_theme_stylebox_override("panel", sb)
	add_child(detail_card)
	var card: Panel = Panel.new()
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	detail_card.add_child(card)
	var strip := ColorRect.new()
	strip.color = Color(Palette.RARITY_COLOR[rarity], 0.85)
	strip.position = Vector2(0, 0)
	strip.size = Vector2(w, 3)
	card.add_child(strip)
	var star := clampi(int(u["star"]), 1, 3)
	var name_l := _label(String(def["name"]), 20, Palette.PAPER[100])
	name_l.position = Vector2(14, 12)
	card.add_child(name_l)
	var title_txt := "" if String(def["title"]) == String(def["name"]) else String(def["title"]) + "　"
	var sub_l := _label("%s%s" % [title_txt, "★".repeat(star)], 13, Palette.GILT["light"])
	sub_l.position = Vector2(14, 40)
	card.add_child(sub_l)
	var cost_l := _label("%d 费" % rarity, 13, Palette.PAPER[300])
	cost_l.position = Vector2(w - 80, 14)
	cost_l.size = Vector2(66, 18)
	cost_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	card.add_child(cost_l)
	# 四行战斗数值：星级缩放走 config 真源。口径与 web 备战悬停卡一致（基础星级面板值，
	# 不含天命/登峰/精英乘区与装备加成——结算口径见 core/unit.gd，战斗内实时值另走 sync_bars）
	var s: Dictionary = def["base"]
	var si := star - 1
	var hp_s := Spec.star_scale("STAR_HP_SCALE", si)
	var pw_s := Spec.star_scale("STAR_POWER_SCALE", si)
	var rows: Array = [
		"生命 %d" % int(roundf(float(s["hp"]) * hp_s)),
		"攻击 %d　法强 %d" % [int(roundf(float(s["atk"]) * pw_s)), int(roundf(float(s["sp"]) * pw_s))],
		"护甲 %d　魔抗 %d" % [int(s["armor"]), int(s["mr"])],
		"攻速 %.2f　射程 %d　法力 %d" % [float(s["aspd"]), int(s["range"]), int(s["maxMp"])],
	]
	for i: int in rows.size():
		var rl := _label(String(rows[i]), 13, Palette.PAPER[300])
		rl.position = Vector2(14, 66 + i * 19)
		card.add_child(rl)
	# 装备三格（图标 + 格下短名）
	var items: Array = u.get("items", [])
	for i2: int in 3:
		var fx := 14 + i2 * 96
		var frame := ColorRect.new()
		frame.color = Color(Palette.INK[800], 0.4)
		frame.position = Vector2(fx, 148)
		frame.size = Vector2(88, 30)
		card.add_child(frame)
		if i2 < items.size():
			var iid: String = items[i2]
			var idef: Variant = Spec.item_by_id.get(iid, null)
			var icon := TextureRect.new()
			icon.texture = load("res://assets/items/%s.png" % iid)
			icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
			icon.position = Vector2(fx + 2, 150)
			icon.size = Vector2(26, 26)
			card.add_child(icon)
			var iname := _label(String(idef["name"]) if idef != null else iid, 10, Palette.PAPER[300])
			iname.position = Vector2(fx + 30, 154)
			iname.size = Vector2(56, 18)
			iname.clip_text = true
			card.add_child(iname)
	var trait_l := _label(_trait_names(def), 13, Palette.SPIRIT["light"])
	trait_l.position = Vector2(14, 192)
	trait_l.size = Vector2(w - 28, 18)
	trait_l.clip_text = true
	card.add_child(trait_l)
	var sk: Dictionary = def["skillSpec"]
	var skill_l := _label(String(sk["name"]), 14, Palette.VOID["light"])
	skill_l.position = Vector2(14, 214)
	card.add_child(skill_l)
	var desc_l := _label(_fmt_skill_desc(String(sk["desc"]), sk.get("params", {})), 12, Palette.PAPER[400])
	desc_l.position = Vector2(14, 236)
	desc_l.size = Vector2(w - 28, h - 236 - (44 if pinned else 0) - 10)
	desc_l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	desc_l.clip_text = true
	card.add_child(desc_l)
	# 出售带（仅钉住态；2★/3★ 两步确认——原版同口径）
	if pinned:
		var sell_iid := int(u["iid"])
		var sell_star := star
		var sell_btn := Button.new()
		sell_btn.text = "出 售 · %d 金" % GameState.sell_value(u)
		sell_btn.position = Vector2(14, h - 42)
		sell_btn.custom_minimum_size = Vector2(w - 28, 32)
		sell_btn.add_theme_font_override("font", Sess.body_font)
		sell_btn.add_theme_font_size_override("font_size", 13)
		sell_btn.add_theme_color_override("font_color", Palette.PAPER[100])
		sell_btn.focus_mode = Control.FOCUS_NONE
		var armed := {"v": false}
		sell_btn.pressed.connect(func() -> void:
			if sell_star >= 2 and not armed["v"]:
				armed["v"] = true
				sell_btn.text = "确认出售 %d★？" % sell_star
				return
			if match_ref.sell(match_ref.human(), sell_iid):
				Sess.sfx.play("coin")
				undo_stack.clear()
				SaveStore.save_match(match_ref)
				refresh_all()
			detail_pinned_iid = -1
			_close_detail())
		card.add_child(sell_btn)


# ── 羁绊全览浮层（nav「羁绊」，原版 openTraitModal 对齐） ──

func _toggle_trait_modal() -> void:
	if trait_modal != null:
		trait_modal.queue_free()
		trait_modal = null
		Sess.sfx.play("ui")
		return
	if trait_members_card != null:
		trait_members_card.queue_free()
		trait_members_card = null
	var counts := {}
	for t: Dictionary in Comp.compute_traits(_board_def_ids()):
		counts[String(t["id"])] = t
	trait_modal = CanvasLayer.new()
	trait_modal.layer = 93
	add_child(trait_modal)
	var dim := ColorRect.new()
	dim.color = Color(Palette.SHADE, 0.55)
	dim.size = Vector2(Layout.W, Layout.H)
	dim.gui_input.connect(func(ev: InputEvent) -> void:
		if ev is InputEventMouseButton and ev.pressed:
			_toggle_trait_modal())
	trait_modal.add_child(dim)
	var bw := 640
	var bh := 720
	var panel := Panel.new()
	panel.size = Vector2(bw, bh)
	panel.position = Vector2((Layout.W - bw) / 2.0, (Layout.H - bh) / 2.0)
	_style_night_panel(panel)
	dim.add_child(panel)
	var title := _label("羁 绊 全 览", 30, Palette.SPIRIT["light"], Sess.seal_font)
	title.position = Vector2(0, 20)
	title.size = Vector2(bw, 44)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(title)
	var note := _label("计数只算场上棋子（备战席不计）；同名棋子只计一次。", 11, Palette.PAPER[400])
	note.position = Vector2(20, 66)
	note.size = Vector2(bw - 40, 18)
	panel.add_child(note)
	var y := 92.0
	for tid in Spec.traits_by_id:
		var def: Dictionary = Spec.traits_by_id[tid]
		var t: Variant = counts.get(String(tid), null)
		var count := int(t["count"]) if t != null else 0
		var bps: Array = def["breakpoints"]
		var tier := -1
		for i: int in bps.size():
			if count >= int(bps[i]):
				tier = i
		var next_bp := -1
		for i2: int in bps.size():
			if int(bps[i2]) > count:
				next_bp = int(bps[i2])
				break
		var ch := _label(_badge_char(String(tid)), 20, Palette.GILT["light"] if tier >= 0 else Palette.INK[400], Sess.seal_font)
		ch.position = Vector2(20, y + 4)
		ch.size = Vector2(30, 28)
		ch.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		panel.add_child(ch)
		var nm := _label(String(def["name"]), 15, Palette.PAPER[100] if tier >= 0 else Palette.PAPER[500])
		nm.position = Vector2(58, y + 2)
		nm.size = Vector2(110, 20)
		panel.add_child(nm)
		var cnt := _label("%d/%s" % [count, str(next_bp) if next_bp > 0 else "满"], 12, Palette.PAPER[300])
		cnt.position = Vector2(170, y + 4)
		cnt.size = Vector2(50, 18)
		panel.add_child(cnt)
		var eff: Array = def.get("effectText", [])
		var eff_l := _label(String(eff[tier]) if tier >= 0 and tier < eff.size() else (String(eff[0]) if next_bp > 0 and eff.size() > 0 else String(def.get("description", ""))), 12, Palette.PAPER[200] if tier >= 0 else Palette.PAPER[500])
		eff_l.position = Vector2(230, y + 2)
		eff_l.size = Vector2(bw - 250, 32)
		eff_l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		eff_l.clip_text = true
		panel.add_child(eff_l)
		y += 36.0
	Sess.sfx.play("ui")


func _board_def_ids() -> Array:
	var ids: Array = []
	for u in match_ref.human()["board"]:
		if u != null:
			ids.append(u["defId"])
	return ids


func _badge_char(trait_id: String) -> String:
	# 徽章单字与羁绊轨同源（名称首字；轨渲染在 _TraitBadge 内）
	var def: Variant = Spec.traits_by_id.get(trait_id, null)
	if def == null:
		return "？"
	return String(def["name"]).substr(0, 1)


# ── nav「阵容」：侦查本轮对手（原版 scoutNextOpponent 对齐） ──

func _scout_next_opponent() -> void:
	var pr: Dictionary = {}
	for q: Dictionary in match_ref.pairings:
		if int(q["a"]) == 0 or int(q["b"]) == 0:
			pr = q
			break
	if pr.is_empty():
		_toast("开战后方可侦查")
		return
	if pr.get("beast", false):
		_toast("墨兽轮 · 无阵可侦")
		return
	var other := -1
	if int(pr["a"]) == 0:
		other = int(pr["b"])
	elif int(pr["b"]) == 0:
		other = int(pr["a"])
	if other >= 0:
		var pl: Dictionary = match_ref.players[other]
		_open_scout(String(pl["name"]), "生命 %d　等级 %d" % [int(pl["hp"]), int(pl["level"])], pl["board"] as Array)
	elif int(pr.get("ghost", -1)) >= 0:
		_open_scout("墨 影", "沿用〔%s〕出局阵容" % String(match_ref.players[int(pr["ghost"])]["name"]), match_ref.board_of_opponent(pr))
	else:
		_toast("本轮轮空 · 无对手")


# ── 浮讯（原版 showToast 对齐的最小落位） ──

func _toast(msg: String) -> void:
	if toast_label != null:
		toast_label.queue_free()
	toast_label = _label(msg, 17, Palette.PAPER[100])
	toast_label.position = Vector2(660, 780)
	toast_label.size = Vector2(600, 26)
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(toast_label)
	# 闭包捕获本次实例：2.1s 后读成员变量会误删其间弹出的新 toast
	var lbl := toast_label
	var tw := create_tween()
	tw.tween_interval(1.6)
	tw.tween_property(lbl, "modulate:a", 0.0, 0.5)
	tw.tween_callback(func() -> void:
		if is_instance_valid(lbl):
			lbl.queue_free())


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
