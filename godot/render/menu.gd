extends Node2D
## 主菜单（对应 MenuScene）：标题 + 继续/新对局/每日挑战 + 图鉴（占位）+ 版本号。
## 存档入口与 has_save 同口径（坏档自愈在 SaveStore 内）。

func _ready() -> void:
	# 子元素为中心基制坐标（负偏移）：根必须居中，否则只渲染左上象限
	# （2026-09-29 排查实证；与 boot/result/codex 同律）
	position = Vector2(Layout.W / 2.0, Layout.H / 2.0)
	_draw_bg()
	var cx := 0.0

	var title := _seal_label("百 战 天 元", 96, Palette.PAPER[100])
	title.position = Vector2(cx - 400, -330)
	title.size = Vector2(800, 130)
	# 标题鎏金光晕（MenuScene.setShadow 同语言：GILT 软晕垫字后）
	title.add_theme_color_override("font_shadow_color", Color(Palette.GILT["base"], 0.5))
	title.add_theme_constant_override("shadow_offset_x", 0)
	title.add_theme_constant_override("shadow_offset_y", 0)
	title.add_theme_constant_override("shadow_outline_size", 28)
	add_child(title)
	var sub := _seal_label("夜 宴", 40, Palette.GILT["light"])
	sub.position = Vector2(cx - 400, -200)
	sub.size = Vector2(800, 60)
	add_child(sub)
	var tag := _body_label("八 人 对 弈　·　幽 冥 水 墨", 16, Palette.GILT["base"])
	tag.position = Vector2(cx - 400, -136)
	tag.size = Vector2(800, 26)
	tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(tag)

	# 底部剪影长卷：几名棋子的墨影平铺，暗合「点将」的意象（MenuScene 对齐）
	var picks := [7, 19, 31, 44, 56]
	var n_champs: int = Spec.champions.size()
	for k: int in picks.size():
		var idx := int(picks[k]) % n_champs
		var def_id := String(Spec.champions[idx]["id"])
		var tex: Texture2D = load("res://assets/pieces/%s.png" % def_id)
		if tex == null:
			continue
		var sh := Sprite2D.new()
		sh.texture = tex
		sh.centered = false
		sh.modulate = Color(Palette.INK[500], 0.34)
		sh.position = Vector2(-260.0 * 2.0 + k * 260.0 - 104.0, 390.0 - 260.0)
		sh.scale = Vector2(260.0 / 208.0, 260.0 / 208.0)
		add_child(sh)

	var has_save: bool = SaveStore.has_save("normal")
	var has_daily: bool = SaveStore.has_save("daily")
	var entries: Array = [
		{ "label": "继 续 对 局", "enabled": has_save, "cb": func() -> void: _enter("continue") },
		{ "label": "新 的 对 局", "enabled": true, "cb": func() -> void: _enter("fresh") },
		{ "label": "每 日 挑 战", "enabled": true, "cb": func() -> void: _enter("daily") },
		{ "label": "武 库 图 鉴", "enabled": true, "cb": func() -> void: Sess.go("res://render/codex.tscn") },
	]
	var y := -60.0
	for e: Dictionary in entries:
		var btn := _menu_button(e["label"], y, e["enabled"])
		if e["enabled"]:
			btn.pressed.connect(e["cb"] as Callable)
		add_child(btn)
		y += 92.0

	var settings := _menu_button("设 置", y, true)
	var sp := SettingsPanel.new()
	add_child(sp)
	settings.pressed.connect(func() -> void: sp.open())
	add_child(settings)

	var ver := _body_label("夜宴 · Godot 版 %s" % String(ProjectSettings.get_setting("application/config/version", "2.1.0")), 16, Palette.PAPER[500])
	ver.position = Vector2(cx - 400, 480)
	ver.size = Vector2(800, 30)
	ver.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(ver)


func _enter(kind: String) -> void:
	Sess.sfx.play("ui")
	match kind:
		"continue":
			var m: Variant = SaveStore.load_match("normal")
			if m == null:
				m = Match.new(int(Time.get_unix_time_from_system()) & 0x7FFFFFFF, "你", "normal")
			Sess.go("res://render/game_scene.tscn", { "match": m })
		"fresh":
			SaveStore.clear_save("normal")
			var seed_val := int(Time.get_unix_time_from_system() * 1000.0) & 0x7FFFFFFF
			Sess.go("res://render/game_scene.tscn", { "match": Match.new(seed_val, "你", "normal") })
		"daily":
			var dt: Dictionary = Time.get_datetime_dict_from_system()
			var has_daily: bool = SaveStore.has_save("daily")
			var m2: Variant = SaveStore.load_match("daily") if has_daily else null
			if m2 == null:
				m2 = Match.new(Daily.daily_seed_for(dt), "你", "daily")
			Sess.go("res://render/game_scene.tscn", { "match": m2 })


func _draw_bg() -> void:
	# 夜色山海（index.html #bg 对齐）：夜空渐变/月晕/云絮/远山/雾带/星尘/颗粒
	add_child(MenuBackdrop.new())


func _seal_label(text: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", Sess.seal_font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return l


func _body_label(text: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", Sess.body_font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


func _menu_button(text: String, y: float, enabled: bool) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(360, 70)
	b.position = Vector2(-180, y)
	b.add_theme_font_override("font", Sess.body_font)
	b.add_theme_font_size_override("font_size", 26)
	b.add_theme_color_override("font_color", Palette.PAPER[100] if enabled else Palette.INK[400])
	b.add_theme_color_override("font_hover_color", Palette.GILT["light"])
	b.add_theme_color_override("font_pressed_color", Palette.GILT["base"])
	b.add_theme_stylebox_override("normal", _panel_style(Palette.INK[800], Palette.INK[500]))
	b.add_theme_stylebox_override("hover", _panel_style(Palette.INK[700], Palette.GILT["deep"]))
	b.add_theme_stylebox_override("pressed", _panel_style(Palette.INK[900], Palette.GILT["base"]))
	b.add_theme_stylebox_override("disabled", _panel_style(Palette.INK[900], Palette.INK[600]))
	b.focus_mode = Control.FOCUS_NONE
	MicroFx.hook(b)
	return b


func _panel_style(bg: Color, border: Color) -> StyleBoxTexture:
	# 漆面按钮：宣纸纤维底纹 × 状态染色（FxAtlas.panel_box 9-slice；夜宴禁圆角 → 直角边线）
	return FxAtlas.panel_box(bg, border)
