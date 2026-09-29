extends Node2D
## 武库图鉴（CodexScene 对齐版 · M3 次批紧凑面）：64 棋子滚动网格 + 点击详情（含技能描述）。
## 布局沿用：中央面板 + 网格；美术用现役立绘 PNG。

func _ready() -> void:
	# 图鉴可能是进程首个触达 Spec 的场景：不 ensure 则 champions 为空、网格全空
	Spec.ensure()
	position = Vector2(Layout.W / 2.0, Layout.H / 2.0)
	var bg := ColorRect.new()
	bg.color = Palette.INK[950]
	bg.position = Vector2(-Layout.W, -Layout.H) / 2.0
	bg.size = Vector2(Layout.W, Layout.H)
	add_child(bg)
	var title := _lbl("武 库 图 鉴", 44, Palette.PAPER[100], Sess.seal_font)
	title.position = Vector2(-400, -500)
	title.size = Vector2(800, 60)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(title)

	var scroll := ScrollContainer.new()
	scroll.position = Vector2(-560, -420)
	scroll.size = Vector2(1120, 840)
	add_child(scroll)
	var grid := GridContainer.new()
	grid.columns = 10
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	scroll.add_child(grid)
	for c: Dictionary in Spec.champions:
		var cell := _Portrait.new()
		cell.setup(c)
		cell.custom_minimum_size = Vector2(104, 140)
		cell.pressed.connect(func() -> void: _detail(c))
		grid.add_child(cell)

	var back := Button.new()
	back.text = "返 回"
	back.position = Vector2(-90, 470)
	back.custom_minimum_size = Vector2(180, 50)
	back.add_theme_font_override("font", Sess.body_font)
	back.add_theme_font_size_override("font_size", 22)
	back.add_theme_color_override("font_color", Palette.PAPER[100])
	back.focus_mode = Control.FOCUS_NONE
	back.pressed.connect(func() -> void:
		if Sess.scene_data.get("from_game", false) and Sess.scene_data.get("match", null) != null:
			Sess.go("res://render/game_scene.tscn", { "match": Sess.scene_data["match"] })
		else:
			Sess.go("res://render/menu.tscn"))
	add_child(back)


var _detail_layer: CanvasLayer = null


func _detail(c: Dictionary) -> void:
	Sess.sfx.play("ui")
	# 单实例守卫：连点多格会叠 N 层 dim（每层各自挡输入、要逐层点关）
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
	panel.size = Vector2(680, 560)
	panel.position = Vector2((Layout.W - 680) / 2.0, (Layout.H - 560) / 2.0)
	dim.add_child(panel)
	var tex := TextureRect.new()
	tex.texture = load("res://assets/pieces/%s.png" % String(c["id"]))
	tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tex.position = Vector2(28, 28)
	tex.size = Vector2(220, 260)
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
	sk_name.add_theme_color_override("font_color", Palette.GILT["light"])
	sk_name.position = Vector2(28, 310)
	panel.add_child(sk_name)
	var desc := _lbl(String(skill["desc"]), 15, Palette.PAPER[200])
	desc.position = Vector2(28, 348)
	desc.size = Vector2(624, 180)
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	panel.add_child(desc)


func _lbl(text: String, size: int, color: Color, font = null) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font if font != null else Sess.body_font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


class _Portrait extends Button:
	func setup(c: Dictionary) -> void:
		var rarity := int(c["cost"])
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
		v.add_child(tex)
		var nm := Label.new()
		nm.text = "%s %d金" % [String(c["name"]), rarity]
		nm.add_theme_font_override("font", Sess.body_font)
		nm.add_theme_font_size_override("font_size", 13)
		nm.add_theme_color_override("font_color", Palette.PAPER[300])
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(nm)
		add_child(v)


func _trait_names_cx(c: Dictionary) -> String:
	var parts: Array = []
	for tid in c["origins"]:
		var td: Variant = Spec.traits_by_id.get(String(tid), null)
		parts.append(String(td["name"]) if td != null else String(tid))
	for tid2 in c["classes"]:
		var td2: Variant = Spec.traits_by_id.get(String(tid2), null)
		parts.append(String(td2["name"]) if td2 != null else String(tid2))
	return " · ".join(parts)
