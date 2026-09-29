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

	# 投影
	var shadow := _soft_circle(26.0, Color(Palette.SHADE, 0.45))
	shadow.position = Vector2(0, 2)
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

	# 星标（3 枚菱形）
	for i: int in 3:
		var pip := ColorRect.new()
		pip.color = Palette.GILT["light"] if i < star else Color(Palette.INK[600], 0.8)
		pip.size = Vector2(7, 7)
		pip.rotation = PI / 4.0
		pip.position = Vector2((i - 1) * 10 - 3.5, bar_y - MANA_BAR_H - 12.0)
		_pips.append(pip)
		add_child(pip)

	set_star_scale()


func set_star_scale() -> void:
	var s: float = STAR_SCALE[star]
	if is_beast:
		s *= 0.98
	scale = Vector2(s, s)


func place(pos: Vector2) -> void:
	position = pos
	_base_y = pos.y


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
	var tw := create_tween()
	tw.tween_property(self, "position", position + back_v, maxf(0.06, windup * 0.7)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.tween_property(self, "position", position + Vector2(dir * 5.0, 0), 0.09).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(self, "position", position, 0.17).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.finished.connect(_end_busy)


func play_hit() -> void:
	var tw := create_tween()
	tw.tween_property(_portrait, "modulate", Color(Palette.PURE_WHITE, 1.0), 0.05)
	tw.tween_property(_portrait, "modulate", Color.WHITE, 0.09)


func play_death() -> void:
	var tw := create_tween()
	tw.tween_property(self, "modulate:a", 0.0, 0.42).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN)
	tw.parallel().tween_property(self, "position:y", position.y + 14.0, 0.42)
	tw.tween_callback(queue_free)


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


func _soft_circle(r: float, color: Color) -> Node2D:
	# _FxShape 是 Node2D：没有 Control 式 size 属性（曾误赋值即炸，setup 中途中断
	# → 立绘/血条/星标全不建，棋盘空壳——2026-09-29 战斗路径首跑实证修复）
	var n := _FxShape.new()
	n.kind = 0
	n.radius = r
	n.color = color
	n.position = Vector2(-r, -r * 1.3)
	return n


func _soft_ring(r: float, color: Color, alpha: float) -> Node2D:
	var n := _FxShape.new()
	n.kind = 1
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


## 简易程序化形状（投影椭圆 / 底座环）—— shader 化前的基础实现
class _FxShape extends Node2D:
	var kind := 0
	var radius := 10.0
	var color := Color.WHITE

	func _draw() -> void:
		if kind == 0:
			# 三层同心渐弱：单层 draw_circle 是硬边实心盘，战斗视角下格外突兀
			var c0 := Vector2(radius, radius * 1.3)
			draw_circle(c0, radius, Color(color, color.a * 0.35))
			draw_circle(c0, radius * 0.66, Color(color, color.a * 0.7))
			draw_circle(c0, radius * 0.36, color)
		else:
			draw_arc(Vector2(radius, radius), radius - 1.0, 0, TAU, 32, color, 2.0)
			draw_circle(Vector2(radius, radius), radius * 0.55, Color(color, color.a * 0.5))
