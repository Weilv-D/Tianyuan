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
