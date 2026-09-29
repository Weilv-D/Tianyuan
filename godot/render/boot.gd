extends Node2D
## 启动序章：黑底「天」篆体淡入淡出（对应 Phaser 版 boot 序章 1500+1300ms 节奏），
## 之后进 Menu。字体经 Sess 预载（篆体必先于首笔）。取「天」与 TS 版同源
## （traitIcons.ts：源字体无「弈」篆形，开屏题字用「天」）。

## 启动预热（仅游戏进程——headless 探针/平衡 worker 不跑主场景）。
## 帧预算主线程分片（2.4.0 判例：worker 线程 ResourceLoader.load 贴图会在
## RenderingServer 越权建 RID，退出期二相故障 EXIT=139/124 —— 跨线程预载已除根）：
## 序章 3.4s 淡入期内吃完 108 张贴图 + 音效预池 + 器物谱纹理烘焙，hitch 被淡入掩盖
func _prewarm() -> void:
	Sess.prime_assets()


func _ready() -> void:
	_prewarm()
	# --battle-smoke：探针自带换场（session.gd 的 deferred battle_scene），
	# 序章整段让路——否则本函数的转发后注册会把战斗场景顶掉（2026-09-29 实证）
	if Sess.battle_smoke:
		return
	# 实机冒烟：--autostart 跳过序章直入对局（TS ?autostart=1 先例）。
	# 必须转发既有 scene_data —— Sess.go 的 data 参数默认空字典，不传会把
	# _setup_smoke 放进去的 match 清空，game_scene 拿不到对局弹回菜单
	# （2026-09-29 排查实证：此前所有 autostart 冒烟截的都是菜单，假阳性）
	if not Sess.scene_data.is_empty():
		Sess.go.call_deferred("res://render/game_scene.tscn", Sess.scene_data)
		return
	# 设计分辨率黑底铺满（夜宴底色 INK 950 深渊）。根节点居中偏移与 game_scene 同律：
	# 场景按中心坐标构建，无此偏移时背景只盖左上象限、上排元素出屏（2026-09-28
	# 序章实测：字形带 -690..-390 全数出屏，此前被「源字体缺字不渲染」掩盖）。
	position = Vector2(Layout.W / 2.0, Layout.H / 2.0)
	var bg := ColorRect.new()
	bg.color = Palette.INK[950]
	bg.size = Vector2(Layout.W, Layout.H)
	bg.position = Vector2(-Layout.W, -Layout.H) / 2.0
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE  # 装饰放行：STOP 会吞后续场景首帧点击
	add_child(bg)

	var glyph := Label.new()
	glyph.text = "天"
	glyph.add_theme_font_override("font", Sess.seal_font)
	glyph.add_theme_font_size_override("font_size", 220)
	glyph.add_theme_color_override("font_color", Palette.PAPER[100])
	glyph.position = Vector2(-Layout.W / 2.0, -Layout.H / 2.0 + 150)
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
