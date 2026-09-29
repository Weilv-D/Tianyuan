extends RefCounted
class_name FxAtlas
## 程序化材质工厂（textures.ts 对齐版 + 夜宴器物谱）。
##
## 全部纹理首次取用时在主线程逐像素烘焙并缓存（static 生命周期 = 进程），
## 启动预载链尾（boot → Sess.prime_assets）统一调 prewarm() 一次成型
## （ImageTexture 必须主线程提交；跨线程贴图加载已除根，见 session.prime_assets）。
## 纹理一律白色/中性亮度系，运行期乘 modulate 上色 —— 与 TS TEX 的 setTint 同一用法。
##
## 器物语言（ART_BIBLE「夜宴器物谱」——桌面夜宴上席的每一件器物；2.4.1 摘除
## PAPER/VIGNETTE/GILT 三张零消费者死纹理——预载链逐像素烘焙不是免费的）：
##   砚石 STONE  —— 面板砚底：金星石眼 + 水磨痕 + 鎏金双边线（HUD 面板统一种子）
##   绢面 SILK   —— 屏风/浮层衬：平纹织造 + 陈绢绢斑（折屏画心）
##   墨玉 JADE   —— 交互器物：絮状玉纹 + 内光（按钮三态手感的材质底）
##   琉璃 GLAZE  —— 器匣/装备背衬：厚薄缘光 + 两道捉光斑（夜光琉璃，非荧光）
##   乌木 WOOD   —— 屏风大框：竖纹 + 脂孔 + 木节（折屏抹头与边框）
##   宝石 GEM    —— 琢面刻面：台面 + 冠部扇区明暗 + 腰线（费阶/星位/档位点）
##   灵光/墨点/法环/火星/斩击/六边/宣纸/颗粒/暗角/噪声 —— 特效层原语
##
## 红线：所有底纹画成中性亮度，最终颜色一律由 modulate 承担（底已暗再乘深色
## 会黑死 —— 2.2.0 面板黑死事故判例）；禁荧光禁紫；禁圆角（全部直角）。

const GLOW := "fx_glow"          # 灵光：径向渐变（粒子/光斑/月晕通用）
const INK_DOT := "fx_inkdot"     # 墨点：中心浓边缘晕开（波状不规则缘）
const RING := "fx_ring"          # 法环：中空圆环（蓄力阵/环爆）
const SPARK := "fx_spark"        # 火星：横向渐变椭圆（弹道拖尾/速度线）
const SLASH := "fx_slash"        # 斩击弧：月牙（尖朝左、弧在右）
const HEX := "fx_hex"            # 六边形底座（护盾「身份牌」）
const GRAIN := "fx_grain"        # 全屏纸面颗粒（白噪声，alpha 低；经 grain_overlay 上屏）
const NOISE := "fx_noise"        # 平滑值噪声灰度（溶解阈值/墨晕边缘用）
const STONE := "fx_stone"        # 砚石面板底（HUD 面板/格位/浮层统一）
const SILK := "fx_silk"          # 绢面（折屏画心/浮层衬底）
const JADE := "fx_jade"          # 墨玉（按钮交互面）
const GLAZE := "fx_glaze"        # 琉璃（器匣/装备背衬）
const WOOD := "fx_wood"          # 乌木（屏风大框）
const GEM := "fx_gem"            # 琢面宝石（费阶/星位/档位宝石点）

static var _cache: Dictionary = {}
static var _prewarmed := false
## ADD 混合材质（static 共享：粒子/特效全用同一份 —— 发光叠加的质感核心）
static var _add_mat: CanvasItemMaterial


static func add_material() -> CanvasItemMaterial:
	if _add_mat == null:
		_add_mat = CanvasItemMaterial.new()
		_add_mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	return _add_mat


## boot 预热线程入口：器物谱全部一次成型（后台线程，主线程首用零卡顿）
static func prewarm() -> void:
	if _prewarmed:
		return
	_prewarmed = true
	for key: String in [GLOW, INK_DOT, RING, SPARK, SLASH, HEX, GRAIN, NOISE,
			STONE, SILK, JADE, GLAZE, WOOD, GEM]:
		texture(key)


static func texture(key: String) -> Texture2D:
	if _cache.has(key):
		return _cache[key]
	var img := _bake(key)
	var tex := ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex


## 面板砚 StyleBox（9-slice；bg 染色，鎏金双边随纹理）—— HUD 面板/浮层材质化统一入口。
## 无边线参数：StyleBoxTexture 无 border 绘制属性（Flat 才有，混用运行期炸），边线由
## 纹理四边承担（外白发丝 + 内鎏金线 = 「砚台嵌金」器口）——2.4.1 删 border 死参
static func panel_box(bg: Color) -> StyleBoxTexture:
	var sb := StyleBoxTexture.new()
	sb.texture = texture(STONE)
	sb.texture_margin_left = 2
	sb.texture_margin_right = 2
	sb.texture_margin_top = 2
	sb.texture_margin_bottom = 2
	sb.modulate_color = bg
	sb.content_margin_left = 12
	sb.content_margin_right = 12
	sb.content_margin_top = 6
	sb.content_margin_bottom = 6
	return sb


## 小格位 StyleBox（商肆卡/器匣格/装备格）：砚石小面 + 同款金线，content 收紧
static func cell_box(bg: Color) -> StyleBoxTexture:
	var sb := StyleBoxTexture.new()
	sb.texture = texture(STONE)
	sb.texture_margin_left = 2
	sb.texture_margin_right = 2
	sb.texture_margin_top = 2
	sb.texture_margin_bottom = 2
	sb.modulate_color = bg
	sb.content_margin_left = 5
	sb.content_margin_right = 5
	sb.content_margin_top = 4
	sb.content_margin_bottom = 4
	return sb


## 墨玉按钮 StyleBox（三态由调用方给 bg：常/悬/按下逐级提亮）
static func jade_box(bg: Color) -> StyleBoxTexture:
	var sb := StyleBoxTexture.new()
	sb.texture = texture(JADE)
	sb.texture_margin_left = 2
	sb.texture_margin_right = 2
	sb.texture_margin_top = 2
	sb.texture_margin_bottom = 2
	sb.modulate_color = bg
	sb.content_margin_left = 10
	sb.content_margin_right = 10
	sb.content_margin_top = 3
	sb.content_margin_bottom = 3
	return sb




## 宝石 Sprite2D（琢面刻面 × 语义色；费阶/星位/羁绊档位点共用）。
## centered 默认真 —— position 即宝石中心
static func gem(color: Color, size_px: float) -> Sprite2D:
	var s := Sprite2D.new()
	s.texture = texture(GEM)
	s.modulate = color
	s.scale = Vector2(size_px / 64.0, size_px / 64.0)
	return s


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




## static 缓存主动释放入口 —— **当前不在退出链调用**（2.4.0 实证判例，见
## session.gd _exit_tree 注释：主动释放落在拆树途中撞 dying RenderingServer，
## 段错误；放任泄漏由引擎 ObjectDB 宽容路径处理，EXIT=0）。保留本函数仅供
## 将来若引擎修顺序回退使用
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
		GRAIN:
			return _bake_grain()
		NOISE:
			return _bake_noise()
		STONE:
			return _bake_stone()
		SILK:
			return _bake_silk()
		JADE:
			return _bake_jade()
		GLAZE:
			return _bake_glaze()
		WOOD:
			return _bake_wood()
		GEM:
			return _bake_gem()
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




## 全屏纸面颗粒：细密单像素噪声
static func _bake_grain() -> Image:
	var size := 160
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var n := _value_noise(size, 1.1, 99)
	for y: int in size:
		for x: int in size:
			img.set_pixel(x, y, Color(1.0, 0.988, 0.957, n[y * size + x]))
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


## 砚石面板底：**中性亮度**画底（modulate 染色承担最终色 —— 底已暗再乘深色会黑死）。
## 底 ~0.60 灰青 + 石理斑 + 金星石眼 + 水磨横痕 + 鎏金双边线（外白内金）；
## StyleBoxTexture.modulate_color 乘 INK 系深色后 = 深青砚面且金星隐约可辨
static func _bake_stone() -> Image:
	var size := 256
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var n_m := _value_noise(size, 5.0, 577)
	var n_f := _value_noise(size, 17.0, 131)
	for y: int in size:
		for x: int in size:
			var v := 0.60 + (n_m[y * size + x] - 0.5) * 0.20 + (n_f[y * size + x] - 0.5) * 0.10
			var cc := clampf(v, 0.20, 0.95)
			img.set_pixel(x, y, Color(cc, cc + 0.02, cc + 0.05))
	# 金星石眼：稀疏亮簇（金星砚名品 —— 端石里的 Caledon）
	var s := 0x2f6e2b1
	for i: int in 26:
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		var px := int(float(s & 0xFFFF) / 65536.0 * float(size))
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		var py := int(float(s & 0xFFFF) / 65536.0 * float(size))
		if px < 3 or py < 3 or px >= size - 3 or py >= size - 3:
			continue
		img.set_pixel(px, py, Color(1.0, 0.97, 0.85, 0.9))
		img.set_pixel(px + 1, py, Color(1.0, 0.95, 0.8, 0.4))
		img.set_pixel(px, py + 1, Color(1.0, 0.95, 0.8, 0.4))
	# 水磨痕：匠人理砚的极淡横弧
	for i: int in 7:
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		var wy := float(s & 0xFFFF) / 65536.0 * float(size)
		for x: int in size:
			var yy := int(wy + sin(x * 0.02 + float(i) * 2.0) * 3.0)
			if yy >= 0 and yy < size:
				img.set_pixel(x, yy, Color(1, 1, 1, 0.03))
	# 器口：外白发丝 + 内鎏金线（9-slice margin 2 保锐利直角 —— 夜宴禁圆角）
	var line := Color(1.0, 1.0, 1.0)
	for i: int in size:
		img.set_pixel(i, 0, line)
		img.set_pixel(i, size - 1, line)
		img.set_pixel(0, i, line)
		img.set_pixel(size - 1, i, line)
	# 器口内鎏金线四边齐全（原仅上下横边，左右缺失与注释不符——2.4.1 补齐）；
	# 取 Palette.GILT["light"]（旧为板外手调近似金 0.92/0.84/0.62——色板纪律）
	var gilt := Palette.GILT["light"]
	for i: int in size:
		img.set_pixel(i, 1, gilt)
		img.set_pixel(i, size - 2, gilt)
		img.set_pixel(1, i, gilt)
		img.set_pixel(size - 2, i, gilt)
	return img


## 绢面：平纹织造（4px 经纬交叠）+ 陈绢绢斑（折屏画心/浮层衬底）
static func _bake_silk() -> Image:
	var size := 192
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var n_d := _value_noise(size, 6.0, 331)
	var n_d2 := _value_noise(size, 21.0, 733)
	var n_b := _value_noise(size, 2.6, 877)
	for y: int in size:
		for x: int in size:
			# 平纹：同半区压上（亮），异半区压下（暗）—— 织缕交叠感
			var over := (x % 4 < 2) == (y % 4 < 2)
			var weave := 0.055 if over else -0.055
			var v := 0.66 + weave + (n_d[y * size + x] - 0.5) * 0.10 + (n_d2[y * size + x] - 0.5) * 0.05
			var b := n_b[y * size + x]
			if b > 0.80:
				v += 0.05
			elif b < 0.18:
				v -= 0.05
			img.set_pixel(x, y, Color(v, v, v + 0.015))
	return img


## 墨玉：深青底 + 絮状玉纹（双噪声高阈值丝）+ 左上内光（玉之有灵）。
## 交互器物底：乘 INK 系深色得墨玉，乘 GILT/SPIRIT 得对应玉色
static func _bake_jade() -> Image:
	var size := 192
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var n1 := _value_noise(size, 4.5, 613)
	var n2 := _value_noise(size, 14.0, 277)
	for y: int in size:
		for x: int in size:
			var w := n1[y * size + x] * 0.6 + n2[y * size + x] * 0.4
			var vein := smoothstep(0.74, 0.87, w)
			var g := 1.0 - clampf(Vector2(x - size * 0.30, y - size * 0.28).length() / (size * 0.95), 0.0, 1.0)
			var v := 0.40 + vein * 0.34 + g * 0.16
			img.set_pixel(x, y, Color(v, v + 0.015, v + 0.03))
	var line := Color(1.0, 1.0, 1.0)
	for i: int in size:
		img.set_pixel(i, 0, line)
		img.set_pixel(i, size - 1, line)
		img.set_pixel(0, i, line)
		img.set_pixel(size - 1, i, line)
	return img


## 琉璃：厚薄缘光（边缘厚而亮）+ 两道斜向捉光斑 + 底反光（夜光琉璃，收敛不荧光）
static func _bake_glaze() -> Image:
	var size := 128
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var c := size / 2.0
	var n := _value_noise(size, 9.0, 443)
	for y: int in size:
		for x: int in size:
			var nx := (x + 0.5) / float(size)
			var ny := (y + 0.5) / float(size)
			var d := maxf(absf(nx - 0.5), absf(ny - 0.5)) * 2.0
			var rim := 1.0 - smoothstep(0.0, 0.14, d)
			# 两道捉光斑：过厚玻璃转折处的亮斑（左上主、右下辅）
			var s1 := exp(-((nx - 0.30) * (nx - 0.30) * 22.0 + (ny - 0.24) * (ny - 0.24) * 30.0))
			var s2 := exp(-((nx - 0.68) * (nx - 0.68) * 34.0 + (ny - 0.66) * (ny - 0.66) * 26.0)) * 0.6
			var refl := smoothstep(0.86, 1.0, ny) * 0.10
			var v := 0.42 + rim * 0.24 + (s1 + s2) * 0.40 + refl + (n[y * size + x] - 0.5) * 0.05
			img.set_pixel(x, y, Color(v, v + 0.01, v + 0.02))
	return img




## 乌木：竖纹 + 脂孔 + 木节（屏风大框/器几）
static func _bake_wood() -> Image:
	var size := 192
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var n_g := _value_noise(size, 11.0, 151)
	var n_v := _value_noise(size, 3.0, 983)
	for y: int in size:
		for x: int in size:
			# 竖纹：横向高频 + 纵向漂移（木丝顺直而下）
			var drift := sin(y * 0.012 + n_v[y * size + x] * 6.0) * 5.0
			var gx := int(clampf(x + drift, 0.0, float(size - 1)))
			var v := 0.30 + (n_g[y * size + gx] - 0.5) * 0.18 + (n_v[y * size + x] - 0.5) * 0.05
			img.set_pixel(x, y, Color(v, v * 0.98, v * 0.94))
	# 脂孔：稀疏细点
	var s := 0x7c1f33a
	for i: int in 90:
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		var px := int(float(s & 0xFFFF) / 65536.0 * float(size))
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		var py := int(float(s & 0xFFFF) / 65536.0 * float(size))
		img.set_pixel(px, py, Color(0, 0, 0, 0.30))
	# 木节两处：椭圆暗斑 + 同心环纹
	for knot: Array in [[0.30, 0.62, 26.0, 401], [0.72, 0.28, 18.0, 907]]:
		var kx := float(knot[0]) * size
		var ky := float(knot[1]) * size
		var kr := float(knot[2])
		for y: int in size:
			for x: int in size:
				var dx := x - kx
				var dy := (y - ky) * 1.6
				var d := sqrt(dx * dx + dy * dy)
				if d < kr:
					img.set_pixel(x, y, Color(0, 0, 0, 0.18 * (1.0 - d / kr)))
				elif d < kr * 1.35 and int(d) % 5 == 0:
					img.set_pixel(x, y, Color(1, 1, 1, 0.05))
	return img


## 琢面宝石：八边形切割（台面 + 冠部扇区明暗 + 腰线），左上光源 —— 费阶/星位/档位共用
static func _bake_gem() -> Image:
	var size := 64
	var img := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var c := size / 2.0
	var R := size * 0.46
	var inr := R * 0.9239  # 正八边形内切半径（cos π/8）
	var tr := R * 0.52
	var tinr := tr * 0.9239
	for y: int in size:
		for x: int in size:
			var dx := x - c + 0.5
			var dy := y - c + 0.5
			# 正八边形 = 四组半平面 |x|≤inr, |y|≤inr, |x±y|≤R
			if absf(dx) > inr or absf(dy) > inr or absf(dx + dy) > R or absf(dx - dy) > R:
				continue
			var r := sqrt(dx * dx + dy * dy)
			var ang := atan2(dy, dx)
			var sector := int(floor((ang + PI / 8.0) / (PI / 4.0)))
			var v := 0.0
			if absf(dx) <= tinr and absf(dy) <= tinr and absf(dx + dy) <= tr and absf(dx - dy) <= tr:
				v = 0.90 + 0.06 * (1.0 - r / maxf(0.001, tr))  # 台面
			else:
				# 冠部：扇区交替明暗 + 由腰向台渐亮 + 左上捉光楔
				v = 0.60 + (0.20 if sector % 2 == 0 else 0.0)
				v += 0.12 * (1.0 - (r - tr) / maxf(0.001, R - tr))
				v += 0.16 * smoothstep(0.35, 0.0, absf(dx + dy + R * 0.30))
			if r > R * 0.90:
				v = 1.0  # 腰线：一圈亮棱
			img.set_pixel(x, y, Color(clampf(v, 0.0, 1.0), clampf(v, 0.0, 1.0), clampf(v, 0.0, 1.0)))
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
