extends Node2D
class_name MenuBackdrop
## 主菜单「夜色山海」背景（index.html #bg 烘焙语言对齐版）：
## 夜空渐变 → 月晕 → 云絮 → 远山（三层水墨远影）→ 雾带 → 星尘 → 暗角/颗粒。
##
## 静态层一次成型（GradientTexture2D/Polygon2D/FxAtlas），逐帧只有星尘粒子与
## 月晕呼吸。全程序化，零外部素材 —— 夜宴红线：夜蓝墨体系、无荧光无紫。

const W := 1920.0
const H := 1080.0


func _ready() -> void:
	_build_sky()
	_build_moon()
	_build_clouds()
	_build_mountains()
	_build_mist()
	_build_stardust()
	Atmosphere.dress(self, W, H)


## 夜空：上深渊 → 下雾青的地平线微亮
func _build_sky() -> void:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.55, 0.82, 1.0])
	g.colors = PackedColorArray([
		Palette.INK[950], Palette.INK[900],
		Palette.INK[800].lerp(Palette.INK[650], 0.4), Palette.INK[700],
	])
	var tex := GradientTexture2D.new()
	tex.gradient = g
	tex.fill_from = Vector2(0.5, 0.0)
	tex.fill_to = Vector2(0.5, 1.0)
	tex.width = 64
	tex.height = 512
	var sky := Sprite2D.new()
	sky.texture = tex
	sky.centered = false
	sky.position = Vector2(-W / 2.0, -H / 2.0)
	sky.scale = Vector2(W / 64.0, H / 512.0)
	sky.z_index = -40
	add_child(sky)


## 月：月盘 + 双层月晕（呼吸），右上偏中
func _build_moon() -> void:
	var mx := W * 0.5 - 340.0
	var my := -H * 0.5 + 240.0
	var halo := Sprite2D.new()
	halo.texture = FxAtlas.texture(FxAtlas.GLOW)
	halo.material = FxAtlas.add_material()
	halo.modulate = Color(Palette.GILT["base"], 0.30)
	halo.position = Vector2(mx, my)
	halo.scale = Vector2(1.0, 1.0) * 620.0 / 128.0
	halo.z_index = -30
	add_child(halo)
	var breathe := halo.create_tween().set_loops()
	breathe.tween_property(halo, "modulate:a", 0.22, 3.6).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	breathe.tween_property(halo, "modulate:a", 0.30, 3.6).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	var core := Sprite2D.new()
	core.texture = FxAtlas.texture(FxAtlas.GLOW)
	core.material = FxAtlas.add_material()
	core.modulate = Color(Palette.PAPER[100], 0.92)
	core.position = Vector2(mx, my)
	core.scale = Vector2(1.0, 1.0) * 120.0 / 128.0
	core.z_index = -29
	add_child(core)


## 云絮：三条横向软光带（glow 纹理扁拉伸）
func _build_clouds() -> void:
	for cfg: Array in [[-H * 0.5 + 300.0, 1500.0, 90.0, 0.07], [-H * 0.5 + 430.0, 1900.0, 70.0, 0.05], [-H * 0.5 + 210.0, 1200.0, 60.0, 0.05]]:
		var band := Sprite2D.new()
		band.texture = FxAtlas.texture(FxAtlas.GLOW)
		band.material = FxAtlas.add_material()
		band.modulate = Color(Palette.INK[500], float(cfg[3]))
		band.position = Vector2(-W * 0.1 + float(cfg[1]) * 0.1, float(cfg[0]))
		band.scale = Vector2(float(cfg[1]) / 128.0, float(cfg[2]) / 128.0)
		band.z_index = -28
		add_child(band)


## 远山：三层值噪声山脊线（越近越暗越实 —— 虚化水墨远影）
func _build_mountains() -> void:
	var layers: Array = [
		[Palette.INK[700], 0.30, 0.55, 620.0, 210.0, 13],
		[Palette.INK[800], 0.55, 0.78, 700.0, 260.0, 9],
		[Palette.INK[850], 0.85, 1.05, 790.0, 320.0, 6],
	]
	for li: int in layers.size():
		var cfg: Array = layers[li]
		var poly := MenuBackdrop.make_mountain(cfg[0], float(cfg[1]), float(cfg[3]), float(cfg[4]), float(cfg[5]), 101 + li * 37)
		poly.z_index = -20 + li
		add_child(poly)


## 单层山脊 Polygon2D（场景绝对坐标：覆盖 x 0..W，山脚线在 base_y）。
## 对局场景背景共用（game_scene 夜空远山）。
static func make_mountain(color: Color, alpha: float, base_y: float, amp: float, step: float, seed_v: int) -> Polygon2D:
	var pts := PackedVector2Array()
	pts.append(Vector2(0.0, base_y + 240.0))
	pts.append(Vector2(W, base_y + 240.0))
	var x := 0.0
	while x <= W + step:
		var n := _fbm(x * 0.004 + float(seed_v) * 0.13, seed_v)
		pts.append(Vector2(x, base_y - n * amp))
		x += step
	var poly := Polygon2D.new()
	poly.polygon = pts
	poly.color = Color(color, alpha)
	return poly


static func _fbm(x: float, seed_v: int) -> float:
	var v1 := _hash_noise(x, seed_v)
	var v2 := _hash_noise(x * 2.7 + 11.0, seed_v + 1)
	var v3 := _hash_noise(x * 6.1 + 23.0, seed_v + 2)
	return v1 * 0.6 + v2 * 0.28 + v3 * 0.12


static func _hash_noise(x: float, seed_v: int) -> float:
	var i := floori(x)
	var f := x - float(i)
	var h0 := _hash1(i, seed_v)
	var h1 := _hash1(i + 1, seed_v)
	var t := f * f * (3.0 - 2.0 * f)
	return h0 + (h1 - h0) * t


static func _hash1(i: int, seed_v: int) -> float:
	var h := (i * 374761393 + seed_v * 668265263) & 0x7FFFFFFF
	h = (h ^ (h >> 13)) * 1274126177 & 0x7FFFFFFF
	return float(h & 0xFFFF) / 65535.0


## 雾带：山脚两条低透明白雾（缓慢横移）
func _build_mist() -> void:
	for cfg: Array in [[250.0, 0.10, 62.0], [340.0, 0.07, 44.0]]:
		var fog := Sprite2D.new()
		fog.texture = FxAtlas.texture(FxAtlas.GLOW)
		fog.material = FxAtlas.add_material()
		fog.modulate = Color(Palette.MOON["base"], float(cfg[1]))
		fog.position = Vector2(0, H / 2.0 - float(cfg[0]))
		fog.scale = Vector2(1700.0 / 128.0, float(cfg[2]) / 128.0)
		fog.z_index = -16
		add_child(fog)
		var drift := fog.create_tween().set_loops()
		drift.tween_property(fog, "position:x", 90.0, 11.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		drift.tween_property(fog, "position:x", -90.0, 11.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


## 星尘：全域缓慢上浮的细光尘
func _build_stardust() -> void:
	var p := CPUParticles2D.new()
	p.material = FxAtlas.add_material()
	p.amount = 54
	p.lifetime = 12.0
	p.preprocess = 10.0
	p.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	p.emission_rect_extents = Vector2(W / 2.0, H / 2.0)
	p.position = Vector2(0, H / 2.0)
	p.direction = Vector2(0, -1)
	p.spread = 8.0
	p.gravity = Vector2.ZERO
	p.initial_velocity_min = 4.0
	p.initial_velocity_max = 12.0
	p.scale_amount_min = 0.03
	p.scale_amount_max = 0.09
	var g := Gradient.new()
	g.colors = PackedColorArray([Palette.MOON["light"], Palette.SPIRIT["light"], Palette.PAPER[200]])
	g.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
	p.color_initial_ramp = g
	var fade := Gradient.new()
	fade.set_color(0, Color(1, 1, 1, 0.0))
	fade.add_point(0.2, Color(1, 1, 1, 0.5))
	fade.set_color(1, Color(1, 1, 1, 0.0))
	p.color_ramp = fade
	p.texture = FxAtlas.texture(FxAtlas.GLOW)
	p.z_index = -10
	add_child(p)


# ── 折屏「夜宴图」（器物谱 · 屏风） ──────────────────────────────
# 六折绢屏立于山海之前：外四折画棋相墨影、中二折画山水云月。
# 屏格以乌木抹头相隔 —— 墨影各守其屏，**结构性杜绝兵器交叠扫脸**：
# 2.3.0 两轮实机遮挡事故（脸被切/兵器扫邻脸）的根治法是把遮挡物归入各自
# 画格；格间抹头隔断即无交叠可能。绢面 SILK 织理 + 折棱明暗交替 + 屏脚暗影。

const SCREEN_PANELS := 6
const SCREEN_PW := 286.0        # 屏心宽（不含抹头）
const SCREEN_STILE := 10.0      # 抹头（乌木）宽
const SCREEN_H := 640.0
const SCREEN_BASE_Y := 455.0    # 屏脚（根为中心基制：0 = 画面中心）
const SCREEN_RAIL := 16.0       # 抹头（上下横木）高
## 屏风木色：色板内派生（INK800 向 GILT.deep 偏 0.4 的深褐乌木）—— 不引外部十六进制
static func _wood() -> Color:
	return Palette.INK[800].lerp(Palette.GILT["deep"], 0.4)

## 六折绢屏（picks = 外四折棋子索引，左二右二）
static func build_screen(picks: Array) -> Node2D:
	var root := Node2D.new()
	root.name = "FoldingScreen"
	root.z_index = -14
	var total: float = SCREEN_PANELS * SCREEN_PW + (SCREEN_PANELS - 1) * SCREEN_STILE
	var x0 := -total / 2.0
	var top_y := SCREEN_BASE_Y - SCREEN_H
	# 屏脚暗影：屏浮于地的界线（径向纹理压扁成软带）
	var fsh := Sprite2D.new()
	fsh.texture = FxAtlas.texture(FxAtlas.GLOW)
	fsh.material = FxAtlas.add_material()
	fsh.modulate = Color(Palette.SHADE, 0.5)
	fsh.position = Vector2(0, SCREEN_BASE_Y + 8.0)
	fsh.scale = Vector2((total + 420.0) / 128.0, 48.0 / 128.0)
	root.add_child(fsh)
	# 六折屏心：绢面 + 折棱明暗交替 + 画心（外四折墨影 / 中二折山水云月）
	# 缩放除数取实测纹理宽（SILK/WOOD 192px 烘焙）—— 写死 256 曾令整屏缩水 25%
	#（折间空隙 81px、屏底悬空 160px；2.4.1 审查修复）：与 atlas 烘焙尺寸自同步
	var tex_w := float(FxAtlas.texture(FxAtlas.SILK).get_width())
	var heights := {0: 265.0, 1: 230.0, 4: 230.0, 5: 265.0}
	var fig_pick := {0: 0, 1: 1, 4: 2, 5: 3}
	for i: int in SCREEN_PANELS:
		var px: float = x0 + i * (SCREEN_PW + SCREEN_STILE)
		var fold: float = 0.92 if i % 2 == 0 else 0.84
		var silk := Sprite2D.new()
		silk.texture = FxAtlas.texture(FxAtlas.SILK)
		silk.centered = false
		silk.position = Vector2(px, top_y)
		silk.scale = Vector2(SCREEN_PW / tex_w, SCREEN_H / tex_w)
		silk.modulate = Color(Palette.INK[600], fold)
		silk.z_index = i
		root.add_child(silk)
		if heights.has(i):
			var idx: int = int(picks[int(fig_pick[i])] if picks.size() > int(fig_pick[i]) else 0)
			var n_champs: int = Spec.champions.size()
			if n_champs > 0:
				idx = idx % n_champs
				var tex: Texture2D = load("res://assets/pieces/%s.png" % String(Spec.champions[idx]["id"]))
				if tex != null:
					var hgt: float = float(heights[i])
					var sh := Sprite2D.new()
					sh.texture = tex
					sh.centered = false
					# 墨影压绢：INK850×0.72 覆于提亮绢面 = 清晰的画中剪影（首版
					# INK900×0.62 过暗实拍几乎不可读——画影/绢面亮度比须 <0.45
					# 才读作「画」而非「污」；2.4.0 构图判据）
					sh.modulate = Color(Palette.INK[850], 0.72)
					sh.scale = Vector2(hgt / 208.0, hgt / 208.0)
					# 画心居中、脚底坐于下抹头之上 —— 墨影画在绢上（不越抹头）
					var fw := 208.0 * hgt / 208.0
					sh.position = Vector2(px + (SCREEN_PW - fw) / 2.0, SCREEN_BASE_Y - 2.0 - hgt)
					sh.z_index = i
					root.add_child(sh)
		elif i == 2 or i == 3:
			_paint_landscape(root, px, top_y, i)
		# 折棱：抹头（乌木）+ 缝影 + 受光棱
		var stile_x := px + SCREEN_PW
		if i < SCREEN_PANELS - 1:
			var stile := Sprite2D.new()
			stile.texture = FxAtlas.texture(FxAtlas.WOOD)
			stile.centered = false
			stile.position = Vector2(stile_x, top_y)
			stile.scale = Vector2(SCREEN_STILE / tex_w, SCREEN_H / tex_w)
			stile.modulate = Color(_wood(), 0.96)
			stile.z_index = 8
			root.add_child(stile)
			var seam := _rect(stile_x, top_y, 2.0, SCREEN_H, Color(Palette.INK[950], 0.6))
			seam.z_index = 9
			root.add_child(seam)
			var lip := _rect(stile_x + SCREEN_STILE - 1.0, top_y, 1.0, SCREEN_H, Color(Palette.PAPER[100], 0.10))
			lip.z_index = 9
			root.add_child(lip)
	# 上下横木（抹头）+ 边竖杖 + 鎏金角牙
	var rail_w := total + 2.0 * 14.0
	for seg: Array in [[x0 - 14.0, top_y - SCREEN_RAIL], [x0 - 14.0, SCREEN_BASE_Y]]:
		var rail := Sprite2D.new()
		rail.texture = FxAtlas.texture(FxAtlas.WOOD)
		rail.centered = false
		rail.position = Vector2(float(seg[0]), float(seg[1]))
		rail.scale = Vector2(rail_w / tex_w, SCREEN_RAIL / tex_w)
		rail.modulate = Color(_wood(), 0.98)
		rail.z_index = 10
		root.add_child(rail)
	for seg: Array in [[x0 - 14.0], [x0 + total]]:
		var post := Sprite2D.new()
		post.texture = FxAtlas.texture(FxAtlas.WOOD)
		post.centered = false
		post.position = Vector2(float(seg[0]), top_y - SCREEN_RAIL)
		post.scale = Vector2(14.0 / tex_w, (SCREEN_H + SCREEN_RAIL * 2.0) / tex_w)
		post.modulate = Color(_wood(), 0.98)
		post.z_index = 10
		root.add_child(post)
	# 鎏金角牙（屏风的收口金件）
	for cx: Array in [[x0 - 14.0, top_y - SCREEN_RAIL], [x0 + total - 10.0, top_y - SCREEN_RAIL],
			[x0 - 14.0, SCREEN_BASE_Y], [x0 + total - 10.0, SCREEN_BASE_Y]]:
		var cap := _rect(float(cx[0]), float(cx[1]), 12.0, SCREEN_RAIL, Color(Palette.GILT["base"], 0.55))
		cap.z_index = 11
		root.add_child(cap)
	# 款识：右末折上端竖排篆名 + 朱砂印（夜宴图的落款）
	var deed_x := x0 + 5 * (SCREEN_PW + SCREEN_STILE) + 26.0
	var deed := Label.new()
	deed.text = "夜\n宴\n图"
	deed.position = Vector2(deed_x, top_y + 56.0)
	deed.size = Vector2(44, 210)
	deed.add_theme_font_override("font", Sess.seal_font)
	deed.add_theme_font_size_override("font_size", 22)
	deed.add_theme_color_override("font_color", Color(Palette.GILT["base"], 0.78))
	deed.z_index = 12
	root.add_child(deed)
	var seal := Artifacts.seal_badge("宴", 24.0)
	seal.position = Vector2(deed_x + 8.0, top_y + 280.0)
	seal.z_index = 12
	root.add_child(seal)
	return root


## 中折山水：屏心上的水墨远山 + 雾带 + 画月（绢上山水，非场景山海）
static func _paint_landscape(root: Node2D, px: float, top_y: float, panel_i: int) -> void:
	var pts := PackedVector2Array()
	var span_x0 := px + 10.0
	var span_w := SCREEN_PW - 20.0
	var base_y := SCREEN_BASE_Y - 60.0
	pts.append(Vector2(span_x0, base_y + 200.0))
	pts.append(Vector2(span_x0 + span_w, base_y + 200.0))
	var x := 0.0
	while x <= span_w + 8.0:
		var n := _fbm((span_x0 + x) * 0.004 + float(panel_i) * 13.0, 300 + panel_i)
		pts.append(Vector2(span_x0 + x, base_y - n * 120.0))
		x += 8.0
	var poly := Polygon2D.new()
	poly.polygon = pts
	poly.color = Color(Palette.INK[850], 0.9)
	poly.z_index = panel_i
	root.add_child(poly)
	# 雾带横过山脚
	var fog := Sprite2D.new()
	fog.texture = FxAtlas.texture(FxAtlas.GLOW)
	fog.material = FxAtlas.add_material()
	fog.modulate = Color(Palette.MOON["base"], 0.13)
	fog.position = Vector2(px + SCREEN_PW / 2.0, base_y + 6.0)
	fog.scale = Vector2((SCREEN_PW + 40.0) / 128.0, 26.0 / 128.0)
	fog.z_index = panel_i + 1
	root.add_child(fog)
	# 画月：右中折绢上的一轮暖月（GILT 月晕 + 纸白月心）
	if panel_i == 3:
		var mx := px + SCREEN_PW * 0.68
		var my := top_y + 130.0
		var halo := Sprite2D.new()
		halo.texture = FxAtlas.texture(FxAtlas.GLOW)
		halo.material = FxAtlas.add_material()
		halo.modulate = Color(Palette.GILT["base"], 0.30)
		halo.position = Vector2(mx, my)
		halo.scale = Vector2(150.0 / 128.0, 150.0 / 128.0)
		halo.z_index = panel_i + 1
		root.add_child(halo)
		var disc := Sprite2D.new()
		disc.texture = FxAtlas.texture(FxAtlas.GLOW)
		disc.material = FxAtlas.add_material()
		disc.modulate = Color(Palette.PAPER[50], 0.85)
		disc.position = Vector2(mx, my)
		disc.scale = Vector2(56.0 / 128.0, 56.0 / 128.0)
		disc.z_index = panel_i + 1
		root.add_child(disc)


## 直角填充矩形（Node2D 语境的小工具：无缝线/角牙/棱）
static func _rect(x: float, y: float, w: float, h: float, color: Color) -> Polygon2D:
	var p := Polygon2D.new()
	p.polygon = PackedVector2Array([
		Vector2(x, y), Vector2(x + w, y), Vector2(x + w, y + h), Vector2(x, y + h),
	])
	p.color = color
	return p
