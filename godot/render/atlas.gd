extends RefCounted
class_name FxAtlas
## 程序化材质工厂（textures.ts 对齐版）。
##
## 全部纹理首次取用时在主线程逐像素烘焙并缓存（static 生命周期 = 进程），
## boot 后台预热线程提前调 prewarm() 让首战零卡顿。纹理一律白色系，
## 运行期乘 modulate 上色 —— 与 TS TEX 的 setTint 同一用法。
##
## 材质语言（ART_BIBLE）：宣纸纤维、墨点晕染、鎏金描边、灵光渐隐。

const GLOW := "fx_glow"          # 灵光：径向渐变（粒子/光斑/月晕通用）
const INK_DOT := "fx_inkdot"     # 墨点：中心浓边缘晕开（波状不规则缘）
const RING := "fx_ring"          # 法环：中空圆环（蓄力阵/环爆）
const SPARK := "fx_spark"        # 火星：横向渐变椭圆（弹道拖尾/速度线）
const SLASH := "fx_slash"        # 斩击弧：月牙（尖朝左、弧在右）
const HEX := "fx_hex"            # 六边形底座（护盾「身份牌」）
const PAPER := "fx_paper"        # 宣纸纤维（棋盘底纹，暖色）
const GRAIN := "fx_grain"        # 全屏纸面颗粒（白噪声，alpha 低）
const VIGNETTE := "fx_vignette"  # 暗角（把视线压回战场中心）
const NOISE := "fx_noise"        # 平滑值噪声灰度（溶解阈值/墨晕边缘用）
const PANEL := "fx_panel"        # 漆面面板底：深蓝纸纤维 + 四边发丝线（9-slice）

static var _cache: Dictionary = {}
static var _prewarmed := false
## ADD 混合材质（static 共享：粒子/特效全用同一份 —— 发光叠加的质感核心）
static var _add_mat: CanvasItemMaterial


static func add_material() -> CanvasItemMaterial:
	if _add_mat == null:
		_add_mat = CanvasItemMaterial.new()
		_add_mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	return _add_mat


## boot 预热线程入口：九张一次成型（约几十毫秒，主线程首用零卡顿）
static func prewarm() -> void:
	if _prewarmed:
		return
	_prewarmed = true
	for key: String in [GLOW, INK_DOT, RING, SPARK, SLASH, HEX, PAPER, GRAIN, VIGNETTE, NOISE, PANEL]:
		texture(key)


static func texture(key: String) -> Texture2D:
	if _cache.has(key):
		return _cache[key]
	var img := _bake(key)
	var tex := ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex


## 漆面面板 StyleBox（9-slice；bg 染色、边线随纹理）—— UI 面板材质化的统一入口
static func panel_box(bg: Color, border: Color) -> StyleBoxTexture:
	var sb := StyleBoxTexture.new()
	sb.texture = texture(PANEL)
	sb.texture_margin_left = 2
	sb.texture_margin_right = 2
	sb.texture_margin_top = 2
	sb.texture_margin_bottom = 2
	sb.modulate_color = bg
	# 边线由纹理四边承担（StyleBoxTexture 无 border 绘制；border 参数仅供
	# 调用方语义占位 —— Flat 才有 border_*，混用会运行期炸）
	sb.content_margin_left = 12
	sb.content_margin_right = 12
	sb.content_margin_top = 6
	sb.content_margin_bottom = 6
	return sb


## 全屏纸面颗粒叠加：极低透明度叠在一切之上 —— 数码感的天敌（textures.ts grainOverlay）
static func grain_overlay(w: float, h: float) -> TextureRect:
	var tr := TextureRect.new()
	tr.texture = texture(GRAIN)
	tr.stretch_mode = TextureRect.STRETCH_TILE
	tr.size = Vector2(w + 8.0, h + 8.0)
	tr.position = Vector2(-4.0, -4.0)
	tr.modulate = Color(1.0, 1.0, 1.0, 0.02)
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return tr


## 暗角叠加：把视线压回中心（挂场景根，铺满设计分辨率）
static func vignette_overlay(w: float, h: float) -> TextureRect:
	var tr := TextureRect.new()
	tr.texture = texture(VIGNETTE)
	tr.stretch_mode = TextureRect.STRETCH_SCALE
	tr.size = Vector2(w, h)
	tr.position = Vector2.ZERO
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return tr


## 进程退出前清 static 缓存：GDScript static var 持 GPU 资源（ImageTexture/材质）
## 的析构顺序晚于 RenderingServer 拆除 —— 引擎退出期段错误（2.1.0 实证，
## Sess._exit_tree 收口调用）
static func release_all() -> void:
	_cache.clear()
	_add_mat = null


static func _bake(key: String) -> Image:
	match key:
		GLOW:
			return _bake_radial(128, [0.0, 0.25, 0.6, 1.0], [1.0, 0.55, 0.14, 0.0])
		INK_DOT:
			return _bake_ink_dot()
		RING:
			return _bake_ring()
		SPARK:
			return _bake_spark()
		SLASH:
			return _bake_slash()
		HEX:
			return _bake_hex()
		PAPER:
			return _bake_paper()
		GRAIN:
			return _bake_grain()
		VIGNETTE:
			return _bake_vignette()
		NOISE:
			return _bake_noise()
		PANEL:
			return _bake_panel()
	return Image.create_empty(4, 4, false, Image.FORMAT_RGBA8)


## 通用径向渐变（stops: 半径比例 → alpha，白色）
static func _bake_radial(size: int, stops: Array, alphas: Array) -> Image:
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var c := float(size) / 2.0
	for y: int in size:
		for x: int in size:
			var t := Vector2(x - c + 0.5, y - c + 0.5).length() / c
			img.set_pixel(x, y, Color(1, 1, 1, _piecewise(t, stops, alphas)))
	return img


static func _piecewise(t: float, stops: Array, vals: Array) -> float:
	if t <= float(stops[0]):
		return float(vals[0])
	for i: int in stops.size() - 1:
		var s0 := float(stops[i])
		var s1 := float(stops[i + 1])
		if t <= s1:
			var k := (t - s0) / maxf(0.0001, s1 - s0)
			return float(vals[i]) + (float(vals[i + 1]) - float(vals[i])) * k
	return float(vals[vals.size() - 1])


## 墨点：中心浓、边缘晕开 + 波状不规则缘（模拟墨迹晕散）
static func _bake_ink_dot() -> Image:
	var size := 64
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var c := size / 2.0
	var stops := [0.0, 0.45, 0.72, 1.0]
	var alphas := [1.0, 0.9, 0.35, 0.0]
	for y: int in size:
		for x: int in size:
			var d := Vector2(x - c + 0.5, y - c + 0.5)
			var ang := d.angle()
			var rr := c * (0.78 + 0.11 * sin(ang * 5.0) + 0.1 * sin(ang * 11.0))
			if d.length() > rr:
				continue
			img.set_pixel(x, y, Color(1, 1, 1, _piecewise(d.length() / rr, stops, alphas)))
	return img


## 法环：0.32~0.5 半径的中空环带
static func _bake_ring() -> Image:
	var size := 128
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var c := size / 2.0
	var stops := [0.0, 0.55, 0.8, 1.0]
	var alphas := [0.0, 0.9, 0.5, 0.0]
	for y: int in size:
		for x: int in size:
			var r := Vector2(x - c + 0.5, y - c + 0.5).length()
			var t := (r - c * 0.32) / (c * 0.18)
			if t < 0.0 or t > 1.0:
				continue
			img.set_pixel(x, y, Color(1, 1, 1, _piecewise(t, stops, alphas)))
	return img


## 火星：横向渐变椭圆（拖尾尾端亮）
static func _bake_spark() -> Image:
	var w := 64
	var h := 16
	var img := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	for y: int in h:
		for x: int in w:
			var nx := (x - w / 2.0 + 0.5) / (w / 2.0)
			var ny := (y - h / 2.0 + 0.5) / (h / 2.0)
			if nx * nx + ny * ny > 1.0:
				continue
			var t := (x + 0.5) / float(w)
			var a := 0.8 * (t / 0.7) if t < 0.7 else 0.8 + 0.2 * ((t - 0.7) / 0.3)
			img.set_pixel(x, y, Color(1, 1, 1, clampf(a, 0.0, 1.0)))
	return img


## 斩击弧：月牙（开口朝左、弧体在右），径向渐变由内向外淡出
static func _bake_slash() -> Image:
	var size := 256
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var c := size / 2.0
	var half_arc := PI * 0.42
	for y: int in size:
		for x: int in size:
			var d := Vector2(x - c + 0.5, y - c + 0.5)
			var ang := d.angle()
			if absf(ang) > half_arc:
				continue
			var r := d.length()
			if r < c * 0.20 or r > c * 0.46:
				continue
			var t := (r - c * 0.1) / (c * 0.38)
			img.set_pixel(x, y, Color(1, 1, 1, _piecewise(t, [0.0, 0.6, 1.0], [1.0, 0.75, 0.0])))
	return img


## 六边形底座：尖顶 + 顶亮底暗渐变 + 白描边
static func _bake_hex() -> Image:
	var size := 128
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var c := size / 2.0
	var rr := c * 0.44
	var edge_r := rr * 0.866  # 内切半径（cos30°）
	for y: int in size:
		for x: int in size:
			var d := Vector2(x - c + 0.5, y - c + 0.5)
			# 尖顶六边形：三组半平面（法线角 0/60/120°）
			var m := 0.0
			for i: int in 3:
				var a := PI * float(i) / 3.0
				m = maxf(m, absf(d.x * cos(a) + d.y * sin(a)))
			if m > edge_r:
				continue
			var grad := 0.95 - 0.4 * ((y + 0.5) / float(size))
			var alpha := 1.0 if edge_r - m < 2.5 else grad
			img.set_pixel(x, y, Color(1, 1, 1, alpha))
	return img


## 宣纸纤维：暖色明暗颗粒 + 长纤维丝（固定种子 LCG —— 材质不引入 Math.random 开口）
static func _bake_paper() -> Image:
	var size := 256
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var n1 := _value_noise(size, 2.2, 7)
	var n2 := _value_noise(size, 13.0, 31)
	for y: int in size:
		for x: int in size:
			var v := n1[y * size + x] * 0.55 + n2[y * size + x] * 0.45
			var cc := 18.0 + v * 34.0
			img.set_pixel(x, y, Color8(int(cc * 1.06), int(cc), int(cc * 0.92)))
	# 长纤维丝（贝塞尔近似为正弦微扰横线）
	var fs := 0x1a2b3c4d
	for i: int in 160:
		fs = (int(fs) * 1664525 + 1013904223) & 0xFFFFFFFF
		var y0 := float(fs & 0xFFFF) / 65536.0 * size
		fs = (fs * 1664525 + 1013904223) & 0xFFFFFFFF
		var amp := float(fs & 0xFF) / 255.0 * 3.0
		fs = (fs * 1664525 + 1013904223) & 0xFFFFFFFF
		var lw := 0.2 + float(fs & 0xFF) / 255.0 * 0.8
		for x: int in size:
			var yy := y0 + sin(x * 0.05 + float(i)) * amp
			img.set_pixel(x, int(yy), Color(1, 1, 1, 0.06 * lw * 4.0))
	return img


## 全屏纸面颗粒：细密单像素噪声
static func _bake_grain() -> Image:
	var size := 160
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var n := _value_noise(size, 1.1, 99)
	for y: int in size:
		for x: int in size:
			img.set_pixel(x, y, Color(1.0, 0.988, 0.957, n[y * size + x]))
	return img


## 暗角：圆形径向（0.3 内透明 → 0.72 处 0.1 → 1.0 处 0.34）
static func _bake_vignette() -> Image:
	var size := 256
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var c := size / 2.0
	for y: int in size:
		for x: int in size:
			var t := Vector2(x - c + 0.5, y - c + 0.5).length() / c
			if t < 0.3:
				continue
			var a := 0.0
			if t < 0.72:
				a = 0.1 * (t - 0.3) / 0.42
			else:
				a = 0.1 + 0.24 * (t - 0.72) / 0.28
			img.set_pixel(x, y, Color(0, 0, 0, clampf(a, 0.0, 0.34)))
	return img


## 平滑值噪声灰度（R 通道；溶解 shader 的逐像素阈值源）
static func _bake_noise() -> Image:
	var size := 256
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var n1 := _value_noise(size, 9.0, 401)
	var n2 := _value_noise(size, 27.0, 809)
	for y: int in size:
		for x: int in size:
			var v := clampf(n1[y * size + x] * 0.7 + n2[y * size + x] * 0.3, 0.0, 1.0)
			img.set_pixel(x, y, Color(v, v, v))
	return img


## 漆面面板底：**中性亮度**画底（modulate 染色承担最终色 —— 底已暗再乘深色会黑死）。
## 底 ~0.62 亮灰蓝 + 亮纤维丝 + 白边线 + 金次边线；StyleBoxTexture.modulate_color
## 乘 INK 系深色后 = 深蓝漆面且纤维隐约可辨，金线乘后成暗金（9-slice margin 2 保锐利）
static func _bake_panel() -> Image:
	var size := 256
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var n := _value_noise(size, 7.0, 911)
	for y: int in size:
		for x: int in size:
			var v := 0.60 + (n[y * size + x] - 0.5) * 0.16
			img.set_pixel(x, y, Color(v, v + 0.03, v + 0.07))
	var line := Color(1.0, 1.0, 1.0)
	for i: int in size:
		img.set_pixel(i, 0, line)
		img.set_pixel(i, size - 1, line)
		img.set_pixel(0, i, line)
		img.set_pixel(size - 1, i, line)
	var gilt := Color(0.92, 0.84, 0.62)
	for i: int in size:
		img.set_pixel(i, 1, gilt)
		img.set_pixel(i, size - 2, gilt)
	return img


## 值噪声（双线性平滑；LCG 种子 —— 与 TS makeNoise 同构）
static func _value_noise(size: int, scale: float, seed_v: int) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(size * size)
	var s := seed_v
	var rnd := func() -> float:
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		return float(s) / 4294967296.0
	var gw := int(ceil(size / scale)) + 2
	var grid := PackedFloat32Array()
	grid.resize(gw * gw)
	for i: int in grid.size():
		grid[i] = rnd.call()
	var smooth := func(t: float) -> float:
		return t * t * (3.0 - 2.0 * t)
	for y: int in size:
		for x: int in size:
			var gx := x / scale
			var gy := y / scale
			var x0 := int(floor(gx))
			var y0 := int(floor(gy))
			var tx: float = smooth.call(gx - x0)
			var ty: float = smooth.call(gy - y0)
			var a := grid[y0 * gw + x0]
			var b := grid[y0 * gw + x0 + 1]
			var cc := grid[(y0 + 1) * gw + x0]
			var d := grid[(y0 + 1) * gw + x0 + 1]
			out[y * size + x] = (a + (b - a) * tx) * (1.0 - ty) + (cc + (d - cc) * tx) * ty
	return out
