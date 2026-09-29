extends Node2D
class_name UnitView
## 棋子可视容器（UnitView.ts 对齐版，M3 首批核心面）：
## 投影 → 底座（稀有度色六角）→ 立绘（星级 shader 描边 / 墨兽罩染）→ 血条/蓝条 → 星标。
## 星级描边与墨兽罩染走 shader（现役 64 张 PNG 原样复用，不烘焙 576 张派生纹理）。
##
## 头顶栈（unitLayout 口径，简化为固定塔）：血条在立绘顶上方，蓝条其下。

const CONTENT_H := 68.0
# 纯视觉体型缩放（非结算数值）：与 web src/render/view/unitLayout.ts 的 UNIT_STAR_SCALE 手工同值
const STAR_SCALE := [0.0, 0.9, 1.02, 1.16]
const BAR_W := 44.0
const HP_BAR_H := 4.5
const MANA_BAR_H := 3.5

# 投影：52×20 软椭圆、染黑、alpha 0.5，锚定脚位（0,+2）。
# 与 web src/render/board/UnitView.ts 的 shadow（glow 纹理压扁 setDisplaySize(52,20) /
# setTint(SHADE) / setAlpha(0.5)，坐标 (0,0)）同值——视觉参数手工同步，非结算数值。
# 历史事故：旧实现 _soft_circle 的校正偏移（-r,-r·1.3）被 setup 用 (0,2) 覆写，
# 绘制圆心落到脚位 (+26,+35.8)·scale ≈ 右下方 23~37px——黑圆整体漂浮错位并随
# hop/突进在格间滑移（用户实机报「脚底黑圆乱飘」），形状还是 52×52 硬边正圆
# 而非 web 的压扁软椭圆。现改为程序化径向渐变纹理 Sprite2D，一次生成静态复用。
const SHADOW_W := 52.0
const SHADOW_H := 20.0
const SHADOW_ALPHA := 0.5
static var _shadow_tex: Texture2D

var def_id: String
var team := 0
var star := 1
var is_beast := false
var friendly := false
var uid := -1

var _portrait: Sprite2D
var _hp_bar: ColorRect
var _mana_bar: ColorRect
var _pips: Array = []
var _bob_t := 0.0
var _base_y := 0.0
## 位移补间持有计数（hop/攻击突进）：>0 期间上层硬同步让路，防逐帧覆写压死演出
var busy := 0


static func piece_texture(def_id: String) -> Texture2D:
	return load("res://assets/pieces/%s.png" % def_id)


func setup(p_def_id: String, p_team: int, p_star: int, p_is_beast: bool) -> void:
	def_id = p_def_id
	team = p_team
	star = p_star
	is_beast = p_is_beast
	z_index = 10

	# 投影（软椭圆，锚脚位；纹理一次生成静态复用）
	var shadow := Sprite2D.new()
	shadow.texture = _shadow_texture()
	shadow.scale = Vector2(SHADOW_W / 64.0, SHADOW_H / 64.0)
	shadow.position = Vector2(0, 2)
	shadow.modulate = Color(Palette.SHADE, SHADOW_ALPHA)
	add_child(shadow)

	# 底座（稀有度色圆环）
	var def: Variant = Spec.champion_by_id.get(def_id, null)
	var rarity := int(def["cost"]) if def != null else 1
	var base := _soft_ring(24.0, Palette.RARITY_COLOR[rarity], 0.92)
	base.scale = Vector2(1.0, 0.5)
	add_child(base)

	# 立绘：shader 描边（银/金）与墨兽罩染。
	# 缩放按实际纹理高归一（素材约定 = 紧裁画布：主体占满高、脚底贴底——
	# 旧 154px 与 M5 重制 512px 两种素材同一公式；曾硬编码 /150 只对旧画布成立）
	# 内容高归一：显示主体高恒为 CONTENT_H（脚底对齐 y≈0）
	_portrait = Sprite2D.new()
	_portrait.texture = piece_texture(def_id)
	var tex_h := float(_portrait.texture.get_height()) if _portrait.texture != null else 150.0
	var k := CONTENT_H / maxf(1.0, tex_h)
	_portrait.scale = Vector2(k, k)
	_portrait.position = Vector2(0, -tex_h * k / 2.0 + 6.0)
	var mat := ShaderMaterial.new()
	mat.shader = preload("res://render/piece_outline.gdshader")
	mat.set_shader_parameter("outline_color",
		Palette.INK[600] if star == 1 else (Palette.PAPER[200] if star == 2 else Palette.GILT["light"]))
	mat.set_shader_parameter("outline_width", 2.2 if star == 3 else 1.6)
	mat.set_shader_parameter("monster_wash", Color(Palette.MONSTER_WASH, Palette.MONSTER_WASH_ALPHA) if is_beast else Color(0, 0, 0, 0))
	_portrait.material = mat
	add_child(_portrait)

	# 血条 / 蓝条（头顶）
	var bar_y := -tex_h * k - 8.0
	_hp_bar = _bar(Vector2(-BAR_W / 2.0, bar_y), Vector2(BAR_W, HP_BAR_H), Palette.TEAM_COLOR[team])
	add_child(_hp_bar)
	_mana_bar = _bar(Vector2(-BAR_W / 2.0, bar_y - MANA_BAR_H - 1.5), Vector2(0, MANA_BAR_H), Palette.VOID["base"])
	add_child(_mana_bar)

	# 星标（3 粒琢面宝石：器物谱·宝石 —— 点亮 GILT，未点墨玉空胎）
	for i: int in 3:
		var pip := Artifacts.gem_pip(Palette.GILT["light"] if i < star else Color(Palette.INK[600], 0.85), 7.5)
		pip.position = Vector2((i - 1) * 10.0, bar_y - MANA_BAR_H - 8.5)
		add_child(pip)
		_pips.append(pip)

	set_star_scale()


func set_star_scale() -> void:
	var s: float = STAR_SCALE[star]
	if is_beast:
		s *= 0.98
	scale = Vector2(s, s)


## 合成升星：立绘白闪 + 底座金环迸散（升星瞬间的句号；game_scene 检出合并时调用）
func flash_star() -> void:
	if _portrait == null:
		return
	var tw := create_tween()
	tw.tween_property(_portrait, "modulate", Color(1.7, 1.7, 1.55), 0.08).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(_portrait, "modulate", Color.WHITE, 0.32).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	var ring := Sprite2D.new()
	ring.texture = FxAtlas.texture(FxAtlas.RING)
	ring.material = FxAtlas.add_material()
	ring.modulate = Color(Palette.GILT["light"], 0.9)
	ring.position = Vector2(0, -6)
	ring.scale = Vector2.ONE * (24.0 / 128.0)
	add_child(ring)
	var rt := ring.create_tween()
	rt.tween_method(func(t: float) -> void:
		ring.scale = Vector2.ONE * (24.0 + 96.0 * t) / 128.0
		ring.modulate.a = 0.9 * (1.0 - t), 0.0, 1.0, 0.4).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	rt.tween_callback(ring.queue_free)


func place(pos: Vector2) -> void:
	position = pos
	_base_y = pos.y


## 落子弹性：从上方 22px 弹落（BACK ease）+ 触地两粒尘点 —— 布阵手感（首次落位用）
func place_pop(pos: Vector2) -> void:
	place(pos)
	var y1 := pos.y
	position.y = y1 - 22.0
	var tw := create_tween()
	tw.tween_property(self, "position:y", y1, 0.26).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_callback(func() -> void:
		for i: int in 5:
			var ang := randf() * PI
			var v := Vector2(cos(ang) * randf_range(30.0, 70.0), -randf_range(10.0, 40.0))
			var p0 := Vector2(0, 2)
			var sp := Sprite2D.new()
			sp.texture = FxAtlas.texture(FxAtlas.INK_DOT)
			sp.material = FxAtlas.add_material()
			sp.modulate = Color(Palette.INK[400], 0.55)
			sp.position = p0
			sp.scale = Vector2.ONE * randf_range(0.05, 0.1)
			add_child(sp)
			var tw2 := sp.create_tween()
			tw2.tween_method(func(t: float) -> void:
				sp.position = p0 + Vector2(v.x, v.y) * t + Vector2(0, 220.0 * t * t)
				sp.modulate.a = 0.55 * (1.0 - t), 0.0, 1.0, 0.34).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
			tw2.tween_callback(sp.queue_free))


func sync_bars(hp: float, max_hp: float, mp: float, max_mp: float, shield: float = 0.0) -> void:
	var hp_ratio: float = clampf(hp / maxf(max_hp, 1.0), 0.0, 1.0)
	_hp_bar.size.x = BAR_W * hp_ratio
	# 低血提亮每帧按比例重算（含回升恢复）；敌我按 viewer 视角 friendly 而非原始 team
	if not friendly:
		_hp_bar.color = Palette.CINNABAR["light"] if hp_ratio < 0.3 else Palette.TEAM_COLOR[1]
	else:
		_hp_bar.color = Palette.TEAM_COLOR[0]
	_mana_bar.size.x = BAR_W * clampf(mp / maxf(max_mp, 1.0), 0.0, 1.0)


func play_attack(dir: float, windup: float) -> void:
	busy += 1
	var back_v := Vector2(-dir * 3.0, 0)
	var base_s := scale
	var tw := create_tween()
	# 蓄力：后拉同时纵向微压（squash）—— 突进时弹回（stretch 回弹），打击感的起笔
	tw.set_parallel(true)
	tw.tween_property(self, "position", position + back_v, maxf(0.06, windup * 0.7)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.tween_property(self, "scale:y", base_s.y * 0.9, maxf(0.06, windup * 0.7)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.chain().tween_property(self, "position", position + Vector2(dir * 5.0, 0), 0.09).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(self, "scale:y", base_s.y, 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.chain().tween_property(self, "position", position, 0.17).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.finished.connect(_end_busy)


func play_hit() -> void:
	var tw := create_tween()
	tw.tween_property(_portrait, "modulate", Color(Palette.PURE_WHITE, 1.0), 0.05)
	tw.tween_property(_portrait, "modulate", Color.WHITE, 0.09)


## 死亡「墨晕溶解」：噪声阈值 shader 吞没立绘 + 裁切缘染墨下沉 + 墨珠四散
## （web 版只有整体淡出——此处为 Godot 独有表现；静观模式由上层保持淡出口径）
func play_death() -> void:
	var mat := ShaderMaterial.new()
	mat.shader = preload("res://render/dissolve.gdshader")
	mat.set_shader_parameter("noise_tex", FxAtlas.texture(FxAtlas.NOISE))
	mat.set_shader_parameter("edge_color", Color(Palette.INK[950]))
	_portrait.material = mat
	# 血条/蓝条/星标随队直落：整层轻沉
	var tw := create_tween()
	tw.tween_method(func(t: float) -> void:
		mat.set_shader_parameter("progress", t), 0.0, 1.0, 0.55).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.parallel().tween_property(self, "position:y", position.y + 18.0, 0.55).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.parallel().tween_property(self, "modulate:a", 0.35, 0.55)
	tw.tween_callback(queue_free)
	_ink_burst()


## 墨珠四散（溶解同时）：朱黑小墨点自躯干弹散下沉 —— 「人化墨而去」
func _ink_burst() -> void:
	for i: int in 9:
		var ang := randf() * TAU
		var v := Vector2(cos(ang) * randf_range(20.0, 90.0), randf_range(-60.0, -10.0))
		var p0 := Vector2(randf_range(-10.0, 10.0), -randf_range(8.0, 30.0))
		var sp := Sprite2D.new()
		sp.texture = FxAtlas.texture(FxAtlas.INK_DOT)
		sp.material = FxAtlas.add_material()
		sp.modulate = Color(Palette.CINNABAR["base"] if randf() < 0.4 else Palette.INK[500], 0.8)
		sp.position = p0
		sp.scale = Vector2.ONE * randf_range(0.06, 0.14)
		add_child(sp)
		var tw := sp.create_tween()
		tw.tween_method(func(t: float) -> void:
			sp.position = p0 + Vector2(v.x, v.y) * t + Vector2(0, 130.0 * t * t)
			sp.modulate.a = 0.8 * (1.0 - t), 0.0, 1.0, randf_range(0.4, 0.7)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tw.tween_callback(sp.queue_free)


func hop_to(target: Vector2, dur: float) -> void:
	busy += 1
	var tw := create_tween()
	tw.tween_property(self, "position", target, maxf(0.016, dur)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN_OUT)
	tw.finished.connect(_end_busy)
	_base_y = target.y


func _end_busy() -> void:
	busy = maxi(0, busy - 1)


## 待机呼吸（静观模式由上层停用 _process）
func _process(delta: float) -> void:
	if _portrait.texture == null:
		return
	_bob_t += delta
	_portrait.position.y = -float(_portrait.texture.get_height()) * _portrait.scale.y / 2.0 + 6.0 + sin(_bob_t * 2.1 + position.x * 0.02) * 1.1


## 投影纹理：64×64 径向渐变（smoothstep 衰减），白底黑染由 Sprite2D modulate 完成
static func _shadow_texture() -> Texture2D:
	if _shadow_tex == null:
		var im := Image.create(64, 64, false, Image.FORMAT_RGBA8)
		var mid := 31.5
		for y: int in 64:
			for x: int in 64:
				var d: float = Vector2(x + 0.5, y + 0.5).distance_to(Vector2(mid, mid)) / mid
				var a: float = clampf(1.0 - d, 0.0, 1.0)
				im.set_pixel(x, y, Color(1, 1, 1, a * a * (3.0 - 2.0 * a)))
		_shadow_tex = ImageTexture.create_from_image(im)
	return _shadow_tex


func _soft_ring(r: float, color: Color, alpha: float) -> Node2D:
	var n := _FxShape.new()
	n.radius = r
	n.color = Color(color, alpha)
	n.position = Vector2(-r, -r)
	return n


func _bar(pos: Vector2, sz: Vector2, color: Color) -> ColorRect:
	var b := ColorRect.new()
	b.position = pos
	b.size = sz
	b.color = color
	return b


## 简易程序化形状（底座稀有度环）—— shader 化前的基础实现
class _FxShape extends Node2D:
	var radius := 10.0
	var color := Color.WHITE

	func _draw() -> void:
		draw_arc(Vector2(radius, radius), radius - 1.0, 0, TAU, 32, color, 2.0)
		draw_circle(Vector2(radius, radius), radius * 0.55, Color(color, color.a * 0.5))
