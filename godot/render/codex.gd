extends Node2D
## 武库图鉴（CodexScene 对齐版）：三册 —— 棋子 / 羁绊 / 装备（含合成谱）。
## 棋子册：64 棋子滚动网格 + 点击详情（含技能描述）；羁绊册：全档位效果行 +
## 点击展开成员网格；装备册：组件/成品分组 + 合成谱（A ＋ B → C）+ 点击浮层。
## 布局沿用：中央面板 + 页签切换（同矩形三 ScrollContainer 显隐）；美术用现役 PNG。

const BODY_X := -560.0
const BODY_Y := -400.0
const BODY_W := 1120.0
const BODY_H := 830.0

var _tabs: Dictionary = {}      # 页签名 -> Button（激活态 alpha 1 / 非激活 0.6）
var _pages: Dictionary = {}     # 页签名 -> ScrollContainer
var _detail_layer: CanvasLayer = null
var _expanded_trait: Button = null  # 羁绊册单行展开（web toggleTraitBand 同口径）


func _ready() -> void:
	# 图鉴可能是进程首个触达 Spec 的场景：不 ensure 则 champions 为空、网格全空
	Spec.ensure()
	position = Vector2(Layout.W / 2.0, Layout.H / 2.0)
	var bg := ColorRect.new()
	bg.color = Palette.INK[950]
	bg.position = Vector2(-Layout.W, -Layout.H) / 2.0
	bg.size = Vector2(Layout.W, Layout.H)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE  # 装饰放行：网格 Button 在上层，底层不拦截
	add_child(bg)
	var title := _lbl("武 库 图 鉴", 44, Palette.PAPER[100], Sess.seal_font)
	title.position = Vector2(-400, -510)
	title.size = Vector2(800, 56)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(title)

	for i: int in 3:
		var id: String = ["champs", "traits", "items"][i]
		var label: String = ["棋 子", "羁 绊", "装 备"][i]
		var b := Button.new()
		b.text = label
		b.position = Vector2(-225 + i * 150, -448)
		b.custom_minimum_size = Vector2(130, 40)
		Artifacts.jade_button(b, {"size": 19})
		b.focus_mode = Control.FOCUS_NONE
		b.pressed.connect(func() -> void: _switch_tab(id))
		_tabs[id] = b
		add_child(b)

	_pages["champs"] = _build_champs_page()
	_pages["traits"] = _build_traits_page()
	_pages["items"] = _build_items_page()
	for k: String in _pages:
		add_child(_pages[k])
	_switch_tab("champs")

	var back := Button.new()
	back.text = "返 回"
	back.position = Vector2(-90, 470)
	back.custom_minimum_size = Vector2(180, 50)
	# 墨玉三态按钮（器物谱）：字体/字色/三态/焦点全由形制库接管
	Artifacts.jade_button(back, {"size": 22})
	back.pressed.connect(func() -> void:
		if Sess.scene_data.get("from_game", false) and Sess.scene_data.get("match", null) != null:
			Sess.go("res://render/game_scene.tscn", { "match": Sess.scene_data["match"] })
		else:
			Sess.go("res://render/menu.tscn"))
	add_child(back)


## ── 页签切换：同矩形三页显隐（web switchTab 同口径，激活钮全亮 / 余钮压暗） ──
func _switch_tab(tab: String) -> void:
	for k: String in _pages:
		(_pages[k] as Control).visible = k == tab
	for k: String in _tabs:
		(_tabs[k] as Button).modulate.a = 1.0 if k == tab else 0.6
	Sess.sfx.play("ui")


func _make_scroll() -> ScrollContainer:
	var scroll := ScrollContainer.new()
	scroll.position = Vector2(BODY_X, BODY_Y)
	scroll.size = Vector2(BODY_W, BODY_H)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	return scroll


## ── 棋子册：64 滚动网格 + 点击详情 ──
func _build_champs_page() -> ScrollContainer:
	var scroll := _make_scroll()
	var grid := GridContainer.new()
	grid.columns = 10
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(grid)
	for c: Dictionary in Spec.champions:
		var cell := _Portrait.new()
		cell.setup(c)
		cell.custom_minimum_size = Vector2(104, 140)
		cell.pressed.connect(func() -> void: _champ_detail(c))
		grid.add_child(cell)
	return scroll


## ── 羁绊册：每羁绊一行（头行 = 名称 + 档位 + 成员数；体 = 描述 + 档位格 +
## 各档效果 + 成员网格）。点击头行展开/收起，单行展开（web toggleTraitBand 同口径）。
func _build_traits_page() -> ScrollContainer:
	var scroll := _make_scroll()
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 8)
	vb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(vb)
	for t: Dictionary in Spec.traits_by_id.values():
		vb.add_child(_trait_row(t))
	return scroll


func _trait_row(t: Dictionary) -> PanelContainer:
	var row := PanelContainer.new()
	# 砚石行底（器物谱：砚）；装饰面板不放行会吞页内滚动点击
	Artifacts.night_panel(row)
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 4)
	row.add_child(vb)

	var members := _trait_members(String(t["id"]))
	# JSON 数字解析为 float，档位须 int 化再上屏（否则「2.0 / 4.0」）
	var bp_txts: Array = t["breakpoints"].map(func(b): return str(int(b)))
	var head := Button.new()
	head.text = "%s　　%s　　成员 %d" % [String(t["name"]), " / ".join(bp_txts), members.size()]
	head.custom_minimum_size = Vector2(BODY_W - 40, 40)
	head.focus_mode = Control.FOCUS_NONE
	var hsb := StyleBoxFlat.new()
	hsb.bg_color = Color(Palette.INK[800], 0.55)
	hsb.set_corner_radius_all(0)
	head.add_theme_stylebox_override("normal", hsb)
	var hsb2 := hsb.duplicate()
	hsb2.bg_color = Color(Palette.GILT["base"], 0.10)
	head.add_theme_stylebox_override("hover", hsb2)
	head.add_theme_stylebox_override("pressed", hsb)
	head.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	head.add_theme_font_override("font", Sess.body_font)
	head.add_theme_font_size_override("font_size", 19)
	head.add_theme_color_override("font_color", Palette.PAPER[100])
	head.add_theme_color_override("font_hover_color", Palette.GILT["light"])
	vb.add_child(head)

	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 4)
	body.visible = false
	vb.add_child(body)
	var desc := _lbl(String(t["description"]), 13, Palette.PAPER[400])
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	desc.custom_minimum_size = Vector2(BODY_W - 64.0, float(Artifacts.est_lines(String(t["description"]), 13, BODY_W - 64.0)) * 19.0)
	body.add_child(desc)
	# 档位格：几档亮几格（对局内羁绊行同语汇；档位色 TRAIT_TIER_COLOR 真源）
	var tiers := HBoxContainer.new()
	tiers.add_theme_constant_override("separation", 6)
	body.add_child(tiers)
	for i: int in (t["breakpoints"] as Array).size():
		var mark := ColorRect.new()
		mark.color = Palette.TRAIT_TIER_COLOR[mini(i, 3)]
		mark.custom_minimum_size = Vector2(22, 5)
		mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
		tiers.add_child(mark)
	var bps: Array = t["breakpoints"]
	var effs: Array = t.get("effectText", [])
	for i: int in bps.size():
		var eff_txt := "%d 人：%s" % [int(bps[i]), String(effs[i]) if i < effs.size() else "—"]
		var eff := _lbl(eff_txt, 13, Palette.TRAIT_TIER_COLOR[mini(i, 3)] if i == bps.size() - 1 else Palette.PAPER[300])
		eff.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		eff.custom_minimum_size = Vector2(BODY_W - 64.0, float(Artifacts.est_lines(eff_txt, 13, BODY_W - 64.0)) * 19.0)
		body.add_child(eff)
	# 成员网格：立绘 + 名（上阵与否不做状态着色——图鉴是全量静态册）
	var grid := GridContainer.new()
	grid.columns = 12
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 6)
	body.add_child(grid)
	for m: Dictionary in members:
		var cell := VBoxContainer.new()
		var tex := TextureRect.new()
		tex.texture = UnitView.piece_texture(String(m["id"]))
		tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		tex.custom_minimum_size = Vector2(66, 52)
		tex.mouse_filter = Control.MOUSE_FILTER_IGNORE
		cell.add_child(tex)
		var nm := _lbl(String(m["name"]), 12, Palette.PAPER[300])
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		cell.add_child(nm)
		grid.add_child(cell)

	head.pressed.connect(func() -> void:
		var opening := not body.visible
		if _expanded_trait != null and _expanded_trait != head:
			(_expanded_trait.get_parent().get_child(1) as Control).visible = false
		body.visible = opening
		_expanded_trait = head if opening else null
		Sess.sfx.play("ui"))
	return row


func _trait_members(trait_id: String) -> Array:
	var members: Array = []
	for c: Dictionary in Spec.champions:
		if (c["origins"] as Array).has(trait_id) or (c["classes"] as Array).has(trait_id):
			members.append(c)
	members.sort_custom(func(a, b): return int(a["cost"]) < int(b["cost"]))
	return members


## ── 装备册：组件 / 成品（神兵）分组 + 合成谱（web buildItems 同构） ──
func _build_items_page() -> ScrollContainer:
	var scroll := _make_scroll()
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 10)
	vb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(vb)

	var comps: Array = Spec.items.filter(func(it): return String(it["tier"]) == "component")
	var comb: Array = Spec.items.filter(func(it): return String(it["tier"]) == "combined")
	vb.add_child(_section_head("组 件"))
	vb.add_child(_item_grid(comps))
	vb.add_child(_section_head("成 品（神兵）"))
	vb.add_child(_item_grid(comb))
	vb.add_child(_section_head("合 成 谱"))
	for it: Dictionary in comb:
		var recipe: Variant = it.get("recipe", null)
		if recipe == null:
			continue
		vb.add_child(_recipe_row(it))
	return scroll


func _section_head(txt: String) -> Label:
	var l := _lbl(txt, 15, Palette.GILT["light"])
	return l


func _item_grid(list: Array) -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 10)
	for it: Dictionary in list:
		var chip := Button.new()
		chip.custom_minimum_size = Vector2(250, 56)
		chip.focus_mode = Control.FOCUS_NONE
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(Palette.INK[850], 0.85)
		sb.set_corner_radius_all(0)
		chip.add_theme_stylebox_override("normal", sb)
		var sb2 := sb.duplicate()
		sb2.bg_color = Color(Palette.GILT["base"], 0.10)
		chip.add_theme_stylebox_override("hover", sb2)
		chip.add_theme_stylebox_override("pressed", sb)
		chip.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var icon := TextureRect.new()
		icon.texture = load("res://assets/items/%s.png" % String(it["id"]))
		icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.position = Vector2(6, 6)
		icon.size = Vector2(44, 44)
		icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		chip.add_child(icon)
		var nm := _lbl(String(it["name"]), 14,
			Palette.GILT["light"] if String(it["tier"]) == "combined" else Palette.PAPER[200])
		nm.position = Vector2(60, 18)
		chip.add_child(nm)
		chip.pressed.connect(func() -> void: _item_detail(it))
		grid.add_child(chip)
	return grid


func _recipe_row(it: Dictionary) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var recipe: Array = it["recipe"]
	for i: int in 2:
		row.add_child(_recipe_item(recipe[i] as String))
		if i == 0:
			var plus := _lbl("＋", 14, Palette.INK[300])
			plus.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			row.add_child(plus)
	var arrow := _lbl("→", 14, Palette.INK[300])
	arrow.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(arrow)
	row.add_child(_recipe_item(String(it["id"])))
	return row


func _recipe_item(id: String) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 6)
	var def: Variant = Spec.item_by_id.get(id, null)
	var icon := TextureRect.new()
	icon.texture = load("res://assets/items/%s.png" % id)
	icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon.custom_minimum_size = Vector2(30, 30)
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	h.add_child(icon)
	var nm := _lbl(String(def["name"]) if def != null else id, 13, Palette.PAPER[200])
	nm.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	h.add_child(nm)
	return h


## ── 浮层公共骨架：dim（modal 拦截）+ 砚石面板；返回面板供内容排布 ──
func _overlay(w: float, h: float) -> Panel:
	if _detail_layer != null and is_instance_valid(_detail_layer):
		_detail_layer.queue_free()
	var layer := CanvasLayer.new()
	_detail_layer = layer
	layer.layer = 95
	add_child(layer)
	var dim := ColorRect.new()
	dim.color = Color(Palette.SHADE, 0.65)
	dim.size = Vector2(Layout.W, Layout.H)
	dim.gui_input.connect(func(ev: InputEvent) -> void:
		if ev is InputEventMouseButton and ev.pressed:
			layer.queue_free()
			_detail_layer = null)
	layer.add_child(dim)
	var panel := Panel.new()
	# 砚石嵌金面板（器物谱）：替代引擎默认灰 Panel
	Artifacts.night_panel(panel)
	panel.size = Vector2(w, h)
	panel.position = Vector2((Layout.W - w) / 2.0, (Layout.H - h) / 2.0)
	dim.add_child(panel)
	return panel


func _champ_detail(c: Dictionary) -> void:
	Sess.sfx.play("ui")
	var panel := _overlay(680, 560)
	var tex := TextureRect.new()
	tex.texture = load("res://assets/pieces/%s.png" % String(c["id"]))
	tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tex.position = Vector2(28, 28)
	tex.size = Vector2(220, 260)
	tex.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(tex)
	var rarity := int(c["cost"])
	var name_txt := String(c["name"]) if String(c["title"]) == String(c["name"]) else "%s · %s" % [c["name"], c["title"]]
	var name_l := _lbl(name_txt, 26, Palette.RARITY_COLOR[rarity])
	name_l.position = Vector2(270, 34)
	panel.add_child(name_l)
	var meta := _lbl("%s · %d 金" % [_trait_names_cx(c), rarity], 17, Palette.PAPER[300])
	meta.position = Vector2(270, 78)
	panel.add_child(meta)
	var base: Dictionary = c["base"]
	var stats := _lbl("生命 %g　攻击 %g　法强 %g\n护甲 %g　魔抗 %g　射程 %g\n攻速 %g/秒　初始法力 %g/%g" % [
		base["hp"], base["atk"], base["sp"], base["armor"], base["mr"], base["range"], base["aspd"], base["startMp"], base["maxMp"]], 16, Palette.PAPER[200])
	stats.position = Vector2(270, 116)
	stats.size = Vector2(380, 90)
	panel.add_child(stats)
	var skill: Dictionary = c["skillSpec"]
	var sk_name := _lbl("【%s】" % String(skill["name"]), 20, Palette.GILT["light"])
	sk_name.position = Vector2(28, 310)
	panel.add_child(sk_name)
	var desc := _lbl(String(skill["desc"]), 15, Palette.PAPER[200])
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART  # 折行先于 size（钳位判例）
	desc.position = Vector2(28, 348)
	desc.size = Vector2(624, 180)
	panel.add_child(desc)


## 装备浮层：图 + 名 + 类别 + 效果 + 合成来源（component 无谱行）
func _item_detail(it: Dictionary) -> void:
	Sess.sfx.play("ui")
	var panel := _overlay(520, 380)
	var icon := TextureRect.new()
	icon.texture = load("res://assets/items/%s.png" % String(it["id"]))
	icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon.position = Vector2(32, 32)
	icon.size = Vector2(96, 96)
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(icon)
	var combined := String(it["tier"]) == "combined"
	var name_l := _lbl(String(it["name"]), 24, Palette.GILT["light"] if combined else Palette.PAPER[100])
	name_l.position = Vector2(150, 40)
	panel.add_child(name_l)
	var meta := _lbl("成品 · 神兵" if combined else "组件", 15, Palette.PAPER[400])
	meta.position = Vector2(150, 80)
	panel.add_child(meta)
	var desc := _lbl(String(it["desc"]), 17, Palette.PAPER[200])
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART  # 折行先于 size（钳位判例）
	desc.position = Vector2(32, 160)
	desc.size = Vector2(456, 90)
	panel.add_child(desc)
	var recipe: Variant = it.get("recipe", null)
	if recipe != null:
		var cap := _lbl("合 成", 14, Palette.PAPER[400])
		cap.position = Vector2(32, 270)
		panel.add_child(cap)
		var row := _recipe_row(it)
		row.position = Vector2(32, 300)
		panel.add_child(row)


func _lbl(text: String, size: int, color: Color, font = null) -> Label:
	# 形制库薄包装；本地签名保持不变以不动调用面
	var l := Artifacts.label(text, size, color)
	if font != null:
		l.add_theme_font_override("font", font)
	return l


class _Portrait extends Button:
	func setup(c: Dictionary) -> void:
		var rarity := int(c["cost"])
		# 稀有度色边是信息载体（随档变色），Flat 直绘；漆面材质只给大面板
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(Palette.INK[850], 0.9)
		sb.border_color = Color(Palette.RARITY_COLOR[rarity], 0.55)
		sb.set_border_width_all(1)
		sb.set_corner_radius_all(0)
		add_theme_stylebox_override("normal", sb)
		var sb2 := sb.duplicate()
		sb2.border_color = Palette.GILT["light"]
		add_theme_stylebox_override("hover", sb2)
		add_theme_stylebox_override("pressed", sb)
		add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var v := VBoxContainer.new()
		v.alignment = BoxContainer.ALIGNMENT_CENTER
		# Button 不是容器：VBox 无显式尺寸时收缩到最小内容高，EXPAND_FILL 的立绘分到 0 高
		v.size = Vector2(104, 140)
		var tex := TextureRect.new()
		tex.texture = load("res://assets/pieces/%s.png" % String(c["id"]))
		tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		tex.size_flags_vertical = Control.SIZE_EXPAND_FILL
		tex.custom_minimum_size = Vector2(96, 100)
		tex.mouse_filter = Control.MOUSE_FILTER_IGNORE
		v.add_child(tex)
		var nm := Label.new()
		nm.text = "%s %d金" % [String(c["name"]), rarity]
		nm.add_theme_font_override("font", Sess.body_font)
		nm.add_theme_font_size_override("font_size", 13)
		nm.add_theme_color_override("font_color", Palette.PAPER[300])
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(nm)
		add_child(v)
		# 费阶宝石（器物谱·琢面）：右上角落印，不遮立绘主体；稀有度色边仍由 Flat 直绘（信息载体）
		var gem := Artifacts.cost_gem(rarity, 12.0)
		gem.position = Vector2(104.0 - 16.0, 4.0)
		add_child(gem)


func _trait_names_cx(c: Dictionary) -> String:
	var parts: Array = []
	for tid in c["origins"]:
		var td: Variant = Spec.traits_by_id.get(String(tid), null)
		parts.append(String(td["name"]) if td != null else String(tid))
	for tid2 in c["classes"]:
		var td2: Variant = Spec.traits_by_id.get(String(tid2), null)
		parts.append(String(td2["name"]) if td2 != null else String(tid2))
	return " · ".join(parts)
