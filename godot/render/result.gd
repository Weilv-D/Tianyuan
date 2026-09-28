extends Node2D
## 终局结算（ResultScene 对齐版）：最终名次列表 + 每日最佳记录 + 返回主菜单。

func _ready() -> void:
	var m: Variant = Sess.scene_data.get("match", null)
	if m == null:
		Sess.go("res://render/menu.tscn")
		return
	var match_ref: Match = m
	position = Vector2(Layout.W / 2.0, Layout.H / 2.0)

	var bg := ColorRect.new()
	bg.color = Palette.INK[950]
	bg.position = Vector2(-Layout.W, -Layout.H) / 2.0
	bg.size = Vector2(Layout.W, Layout.H)
	add_child(bg)

	var standings: Array = match_ref.standings()
	var human_rank := 0
	for p: Dictionary in standings:
		if int(p["idx"]) == 0:
			human_rank = int(p["rank"])

	var title := _label("终 局", 64, Palette.GILT["light"] if human_rank <= 3 else Palette.PAPER[100], Sess.seal_font)
	title.position = Vector2(-400, -420)
	title.size = Vector2(800, 100)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(title)
	var sub := _label("你的名次 · 第 %d 名" % human_rank, 26, Palette.PAPER[200])
	sub.position = Vector2(-400, -320)
	sub.size = Vector2(800, 44)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(sub)

	var y := -240.0
	for i: int in standings.size():
		var p: Dictionary = standings[i]
		var rank := int(p["rank"]) if int(p["rank"]) != 0 else 8
		var color: Color = Palette.PAPER[100] if int(p["idx"]) == 0 else Palette.PAPER[300]
		var line := _label("%d. %s　生命 %d · %d胜%d败" % [rank, p["name"], int(p["hp"]), int(p["wins"]), int(p["losses"])], 22, color)
		line.position = Vector2(-330, y)
		line.size = Vector2(700, 36)
		add_child(line)
		y += 46.0

	# 每日模式记录最佳名次
	if match_ref.mode == "daily":
		var dt: Dictionary = Time.get_datetime_dict_from_system()
		if Daily.record_daily_result(dt, human_rank):
			var best := _label("每日最佳 · 第 %d 名（新纪录）" % human_rank, 20, Palette.GILT["light"])
			best.position = Vector2(-330, y + 16)
			add_child(best)
		SaveStore.clear_save("daily")
	else:
		SaveStore.clear_save("normal")

	var back := Button.new()
	back.text = "回 到 主 菜 单"
	back.position = Vector2(-180, 420)
	back.custom_minimum_size = Vector2(360, 64)
	back.add_theme_font_override("font", Sess.body_font)
	back.add_theme_font_size_override("font_size", 24)
	back.add_theme_color_override("font_color", Palette.PAPER[100])
	back.focus_mode = Control.FOCUS_NONE
	back.pressed.connect(func() -> void: Sess.go("res://render/menu.tscn"))
	add_child(back)


func _label(text: String, size: int, color: Color, font = null) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font if font != null else Sess.body_font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
