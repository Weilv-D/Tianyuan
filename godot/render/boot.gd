extends Node2D
## 启动序章：黑底「弈」篆体淡入淡出（对应 Phaser 版 boot 序章 1500+1300ms 节奏），
## 之后进 Menu。字体经 Sess 预载（篆体必先于首笔）。

func _ready() -> void:
	# 实机冒烟：--autostart 跳过序章直入对局（TS ?autostart=1 先例）
	if not Sess.scene_data.is_empty():
		Sess.go("res://render/game_scene.tscn")
		return
	# 设计分辨率黑底铺满（夜宴底色 INK 950 深渊）
	var bg := ColorRect.new()
	bg.color = Palette.INK[950]
	bg.size = Vector2(Layout.W, Layout.H)
	bg.position = Vector2(-Layout.W, -Layout.H) / 2.0
	add_child(bg)

	var glyph := Label.new()
	glyph.text = "弈"
	glyph.add_theme_font_override("font", Sess.seal_font)
	glyph.add_theme_font_size_override("font_size", 220)
	glyph.add_theme_color_override("font_color", Palette.PAPER[100])
	glyph.position = Vector2(-Layout.W / 2.0, -Layout.H / 2.0 - 150)
	glyph.size = Vector2(Layout.W, 300)
	glyph.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(glyph)

	var title := Label.new()
	title.text = "百 战 天 元"
	title.add_theme_font_override("font", Sess.seal_font)
	title.add_theme_font_size_override("font_size", 34)
	title.add_theme_color_override("font_color", Palette.PAPER[400])
	title.position = Vector2(-Layout.W / 2.0, 160)
	title.size = Vector2(Layout.W, 60)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(title)

	# 淡入 1500ms → 停 600ms → 淡出 1300ms 进 Menu
	glyph.modulate.a = 0.0
	title.modulate.a = 0.0
	var tw := create_tween()
	tw.tween_property(glyph, "modulate:a", 1.0, 1.5)
	tw.parallel().tween_property(title, "modulate:a", 1.0, 1.5)
	tw.tween_interval(0.6)
	tw.tween_property(glyph, "modulate:a", 0.0, 1.3)
	tw.parallel().tween_property(title, "modulate:a", 0.0, 1.3)
	tw.tween_callback(func() -> void: Sess.go("res://render/menu.tscn"))
