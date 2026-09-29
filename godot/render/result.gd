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
	bg.z_index = -10  # 山海垫底：远山(-6/-5)压其上，文字(z 0)压山上
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE  # 装饰放行
	add_child(bg)
	# 夜色山海纵深：两层远山（game_scene 夜空远山同语）；make_mountain 出场景绝对坐标，
	# 本景根是中心基制 → 反向偏移半屏，山脚线落在画面下缘
	var m1 := MenuBackdrop.make_mountain(Palette.INK[800], 0.6, Layout.H - 96.0, 130.0, 10.0, 51)
	m1.position = Vector2(-Layout.W / 2.0, -Layout.H / 2.0)
	m1.z_index = -6
	add_child(m1)
	var m2 := MenuBackdrop.make_mountain(Palette.INK[850], 0.85, Layout.H - 24.0, 170.0, 7.0, 97)
	m2.position = Vector2(-Layout.W / 2.0, -Layout.H / 2.0)
	m2.z_index = -5
	add_child(m2)

	var standings: Array = match_ref.standings()
	var human_rank := 0
	for p: Dictionary in standings:
		if int(p["idx"]) == 0:
			human_rank = int(p["rank"])
	if human_rank == 1:
		Sess.sfx.play("victory")  # 冠位号角（原版 ResultScene champion 口径）

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
		# 三甲嵌宝（金/银/哑金）：贴名次行文字左侧，与行文字居中对齐（行高 36 · 宝石 12 → y+12）
		if rank <= 3:
			var gem_col: Color = Palette.GILT["light"] if rank == 1 else (Palette.PAPER[200] if rank == 2 else Palette.GILT["base"])
			var gem := Artifacts.gem_pip(gem_col, 12.0)
			gem.position = Vector2(-356.0, y + 12.0)
			add_child(gem)
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
	Artifacts.jade_button(back, {"size": 24})  # 墨玉三态（字色/玉纹/微动效随器物谱）
	back.pressed.connect(func() -> void: Sess.go("res://render/menu.tscn"))
	add_child(back)


func _label(text: String, size: int, color: Color, font = null) -> Label:
	# 形制库薄包装（六处散点构造收敛——2026-09-29 审查；本地签名保持不变以不动调用面）
	var l := Artifacts.label(text, size, color)
	if font != null:
		l.add_theme_font_override("font", font)
	return l
