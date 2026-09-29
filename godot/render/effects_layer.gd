extends Node2D
class_name EffectsLayer
## 墨迹特效层（EffectsLayer.ts 全面对齐版）—— 16 kind + 全屏闪。
##
## 「读得懂 → 看得爽 → 不糊屏」三原则：
##  - 每个特效都有明确的几何语义（弧=斩击、环=范围、束=穿透、柱=召唤）
##  - 四段式：蓄力预兆 → 释放主体 → 命中反馈 → 余韵消散
##  - 大招主体一律 ADD 混合且瞬时，不在棋盘上留超过 400ms 的实色遮挡
##
## 材质：环/光斑/火星/月牙/六边盾全部走 FxAtlas 烘焙纹理 × ADD 混合（软边发光，
## 曾用 draw_circle 硬边几何是「草稿感」的主根源）；法阵虚线弧/界格方阵/菱形符点/
## 描边扫环等几何语义件保留 _draw。色彩经 FX_TINTS 槽位（params.hue → tint → fallback）。
##
## 震屏：shake_accum 累加，宿主每帧取走清零并换算相机脉冲（静观模式恒 0）。

var calm := false
var shake_accum := 0.0
var _gen := 0
var _strays: Array = []

## 渲染预算：存活 fx 节点超帽后跳过装饰件（墨点/火花）——主体 glow/ring 保留
const FX_BUDGET := 140
## 倍速下装饰抑制（4× 此前只关声音不关视觉）
var deco_suppressed := false


## 色彩：params.hue → FX_TINTS → fallback（对齐 tintOf）
func _tint_of(r: Dictionary, fallback: Color) -> Color:
	var params: Dictionary = r.get("params", {})
	if params.has("hue"):
		return Palette.FX_TINTS.get(int(params["hue"]), fallback)
	# get 对「存在但值为 null」的键不回落默认值（battle_scene 恒写入 tint 键）
	var t: Variant = r.get("tint", null)
	return t if t is Color else fallback


func clear() -> void:
	_gen += 1
	for s in _strays:
		if is_instance_valid(s):
			s.queue_free()
	_strays.clear()
	shake_accum = 0.0


func _register(n: Node) -> Node:
	_strays.append(n)
	n.tree_exited.connect(func() -> void: _strays.erase(n))
	return n


## 代际守卫的延时（clear 后迟到演出自杀）
func _after(ms: float, fn: Callable) -> void:
	var g := _gen
	get_tree().create_timer(ms / 1000.0).timeout.connect(func() -> void:
		# is_instance_valid 必须首评：对已释放 self 读成员 _gen / 调 is_inside_tree
		# 本身即崩（战斗结束立即返回时跨场触发的延时件曾逐条刷错——2.4.1 修复）
		if is_instance_valid(self) and is_inside_tree() and g == _gen:
			fn.call())


func take_shake() -> float:
	var v := shake_accum
	shake_accum = 0.0
	return 0.0 if calm else v


# ── 原语（纹理 × ADD） ───────────────────────────────────

## 登记一枚 ADD 软光纹理精灵（上色 = modulate 乘 tint）
func _img(tex_key: String, pos: Vector2, color: Color, rot := 0.0) -> Sprite2D:
	var sp := Sprite2D.new()
	sp.texture = FxAtlas.texture(tex_key)
	sp.material = FxAtlas.add_material()
	sp.modulate = color
	sp.position = pos
	sp.rotation = rot
	add_child(_register(sp))
	return sp


func _ring(pos: Vector2, r0: float, r1: float, dur: float, color: Color, a0: float, _width: float = 2.0, ease := Tween.EASE_OUT) -> Sprite2D:
	var sp := _img(FxAtlas.RING, pos, Color(color, a0))
	var k0 := r0 * 2.0 / 128.0
	var k1 := r1 * 2.0 / 128.0
	sp.scale = Vector2.ONE * k0
	var tw := sp.create_tween()
	tw.tween_method(func(t: float) -> void:
		sp.scale = Vector2.ONE * (k0 + (k1 - k0) * t)
		sp.modulate.a = a0 * (1.0 - t), 0.0, 1.0, dur / 1000.0).set_ease(ease).set_trans(Tween.TRANS_QUAD)
	tw.tween_callback(sp.queue_free)
	return sp


func _glow(pos: Vector2, s0: float, s1: float, dur: float, color: Color, a0: float, ease := Tween.EASE_OUT) -> Sprite2D:
	var sp := _img(FxAtlas.GLOW, pos, Color(color, a0))
	var k0 := s0 / 128.0
	var k1 := s1 / 128.0
	sp.scale = Vector2.ONE * k0
	var tw := sp.create_tween()
	tw.tween_method(func(t: float) -> void:
		sp.scale = Vector2.ONE * (k0 + (k1 - k0) * t)
		sp.modulate.a = a0 * (1.0 - t), 0.0, 1.0, dur / 1000.0).set_ease(ease).set_trans(Tween.TRANS_QUAD)
	tw.tween_callback(sp.queue_free)
	return sp


## 火星/速度线/弹道：SPARK 纹理沿 from→to（亮端朝飞出方向）
func _spark(from: Vector2, to: Vector2, width: float, dur: float, color: Color, a0: float = 0.8) -> Sprite2D:
	if deco_suppressed or _strays.size() >= FX_BUDGET:
		# 预算帽：返回 null（曾返回未挂树 Sprite2D = 每次触帽泄一个孤儿节点，
		# 退出期刷 ObjectDB 告警——2.4.1 审查修复；调用方均不消费返回值）
		return null
	var seg := to - from
	var sp := _img(FxAtlas.SPARK, (from + to) / 2.0, Color(color, a0), seg.angle())
	sp.scale = Vector2(seg.length() / 64.0, width / 16.0)
	var tw := sp.create_tween()
	tw.tween_method(func(t: float) -> void:
		sp.modulate.a = a0 * (1.0 - t), 0.0, 1.0, dur / 1000.0).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_callback(sp.queue_free)
	return sp


## 墨点迸溅（inkDot 纹理 × ADD；预算帽内生效）
func _burst_dots(pos: Vector2, count: int, color: Color, speed: float, scale_v: float = 0.2) -> void:
	if deco_suppressed or _strays.size() >= FX_BUDGET:
		return
	for i: int in count:
		var ang := randf() * TAU
		var v := Vector2(cos(ang), sin(ang)) * (0.35 + randf() * 0.65) * speed
		var s0 := 26.0 * scale_v / 0.18
		var sp := _img(FxAtlas.INK_DOT, pos, Color(color, 0.95))
		sp.scale = Vector2.ONE * s0 / 64.0
		var tw := sp.create_tween()
		tw.tween_method(func(t: float) -> void:
			sp.position = pos + v * t
			sp.modulate.a = 0.95 * (1.0 - t)
			sp.scale = Vector2.ONE * (s0 / 64.0) * (1.0 - t * 0.8), 0.0, 1.0, 0.52)
		tw.tween_callback(sp.queue_free)


## 地面墨染（椭圆展开再退去；无纹理语义件，_draw 承担）
func _ground_stain(pos: Vector2, rx: float, ry: float, color: Color, dur: float) -> void:
	var n := _Fx.new()
	n.kind = 4
	n.color = color
	n.radius = rx
	n.radius2 = ry
	n.position = pos
	# 墨染沉入漆盘：压层的是墨点节点自身（曾裸写 z_index 误压整层）
	n.z_index = -5
	add_child(_register(n))
	var tw := n.create_tween()
	tw.tween_method(func(t: float) -> void:
		var spread: float = 0.5 + 0.5 * minf(t * 2.0, 1.0)
		n.radius = rx * spread
		n.radius2 = ry * spread
		n.color.a = 0.16 * (1.0 - maxf(0.0, (t - 0.36) / 0.64))
		n.queue_redraw(), 0.0, 1.0, dur / 1000.0)
	tw.tween_callback(n.queue_free)


## 斩击月牙（SLASH 纹理：alpha 快进快出 + 尺寸外扩）
func _slash_arc(pos: Vector2, rot: float, s0: float, s1: float, dur: float, color: Color, a0: float, delay_ms := 0.0) -> void:
	var sp := _img(FxAtlas.SLASH, pos, Color(color, 0.0), rot)
	sp.scale = Vector2.ONE * s0 / 256.0
	var tw := sp.create_tween()
	if delay_ms > 0.0:
		tw.tween_interval(delay_ms / 1000.0)
	tw.tween_method(func(t: float) -> void:
		sp.modulate.a = a0 * sin(minf(t * 1.6, 1.0) * PI * 0.5), 0.0, 1.0, dur / 2000.0)
	tw.tween_method(func(t: float) -> void:
		sp.modulate.a = a0 * (1.0 - t), 0.0, 1.0, dur / 2000.0)
	tw.parallel().tween_property(sp, "scale", Vector2.ONE * s1 / 256.0, dur / 1000.0).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_callback(sp.queue_free)


# ── 16 kind 入口（play 语义对齐；形态分化与 TS 同款） ──

func play(r: Dictionary) -> void:
	var p: Dictionary = r.get("params", {})
	var tint := _tint_of(r, Palette.CINNABAR["light"])
	match String(r.get("kind", "")):
		"impact":
			_impact(r, p, tint)
		"slash":
			_slash(r, tint)
		"pierce":
			var dist: float = r.get("dist", 40.0)
			var dir := Vector2(r.get("dx", 1.0), r.get("dy", 0.0)).normalized()
			var c0: Vector2 = r["pos"] + Vector2(0, -30.0)
			_spark(c0 - dir * dist / 2.0, c0 + dir * dist / 2.0, 9.0, 180.0, tint, 0.9)
			_after(60.0, func() -> void: _spark(c0 - dir * (dist / 2.0 + 10.0), c0 + dir * (dist * 0.33 - 10.0), 4.5, 230.0, tint, 0.5))
		"nova":
			_nova(r, tint)
		"burst":
			var rad2: float = float(r.get("radius", 1.0)) * 72.0 * 0.55
			_ring(r["pos"], rad2 * 0.4, rad2 * 2.4, 400.0, tint, 0.9, 2.4)
			_glow(r["pos"], rad2 * 0.3, rad2 * 1.8, 330.0, tint, 0.85)
			_burst_dots(r["pos"], 14, tint, 320.0, 0.26)
			shake_accum += 0.7
		"beam":
			_beam(r, tint)
		"castRing":
			_cast_ring(r, tint)
		"healWave":
			_heal_wave(r)
		"shieldWall":
			_shield_wall(r)
		"dashTrail":
			var from2: Vector2 = r["pos"]
			var to2: Vector2 = r.get("to", from2)
			var mid2 := (from2 + to2) / 2.0 + Vector2(0, -26.0)
			_spark(mid2 - (to2 - from2).normalized() * (to2 - from2).length() * 0.6, mid2 + (to2 - from2).normalized() * (to2 - from2).length() * 0.6, 40.0, 300.0, tint, 0.55)
			_burst_dots(to2 + Vector2(0, -20.0), 8, tint, 200.0, 0.18)
		"summon":
			_summon(r)
		"buffAura":
			_buff_aura(r, tint)
		"debuffMark":
			_debuff_mark(r)
		"groundMark":
			_ground_mark(r, p, tint)
		"burnTick":
			var x: float = float(r["pos"].x) + randf_range(-11.0, 11.0)
			var y: float = float(r["pos"].y) - 20.0 - randf() * 34.0
			var n := _glow(Vector2(x, y), 10.0, 4.0, 560.0, Palette.EMBER["light"], 0.9)
			var tw := n.create_tween()
			tw.parallel().tween_property(n, "position:y", y - 30.0, 0.56)
		"bleedTick":
			var x2: float = float(r["pos"].x) + randf_range(-8.0, 8.0)
			var y2: float = float(r["pos"].y) - 14.0
			var n2 := _glow(Vector2(x2, y2), 8.0, 3.0, 640.0, Palette.CINNABAR["base"], 0.85)
			var tw2 := n2.create_tween()
			tw2.parallel().tween_property(n2, "position:y", y2 + 16.0 + randf() * 10.0, 0.64)
		_:
			pass


## 命中反馈：白核（瞬）→ 阵营色柔光晕（涨）→ 冲击环（散）→ 墨花（炸）。
## 形态分化：法术=等角六芒（符箓感）、处决=正十字皓白（裁定感）、其余=随机相位。
func _impact(r: Dictionary, p: Dictionary, tint: Color) -> void:
	var crit := float(p.get("crit", 0.0)) > 0.0
	var base := 1.3 if crit else 1.0
	var pos: Vector2 = r["pos"]
	var is_magic := int(p.get("hue", -1)) == 2
	var is_true := int(p.get("hue", -1)) == 6
	var spin := randf() * TAU
	# 白核闪点：小而快，「接触」的那一瞬
	_glow(pos, 14.0, 46.0 * base, 200.0 if crit else 140.0, Palette.PAPER[50], 0.95)
	# 阵营色柔光晕：垫在白核后的体感层，负责「这一下有多大」
	_glow(pos, 26.0, 88.0 * base, 300.0 if crit else 210.0, tint, 0.55)
	# 冲击环：随机旋向扩散
	_ring(pos, 24.0, (128.0 if crit else 88.0) * base, 340.0 if crit else 240.0, tint, 0.85)
	# 墨点飞溅
	_burst_dots(pos, 12 if crit else 6, tint, 260.0 if crit else 150.0, 0.24 if crit else 0.16)
	# 六向墨花（形态分化）
	var petals := 8 if crit else 6
	for i: int in petals:
		var ang: float
		if is_true:
			ang = PI / 4.0 + (i % 2) * PI / 2.0 + floorf(i / 2.0) * PI + spin * 0.1
		elif is_magic:
			ang = (float(i) / float(petals)) * TAU + 0.26
		else:
			ang = spin + (float(i) / float(petals)) * TAU + randf_range(-0.15, 0.15)
		var reach := (66.0 if crit else 46.0) * base + randf() * 14.0
		var tip := pos + Vector2(cos(ang), sin(ang)) * reach
		_spark(pos + Vector2(cos(ang), sin(ang)) * 9.0, tip, 3.2 if is_true else 2.2, 260.0 if crit else 190.0,
			tint if i % 2 == 0 else (Palette.PAPER[50] if (is_magic or is_true) else Palette.PAPER[100]))
	if crit:
		# 暴击第二重冲击环：迟一拍追上去，双层扩散
		_after(80.0, func() -> void:
			_ring(pos, 40.0, 164.0, 320.0, Palette.GILT["light"], 0.8, 2.4)
			# 界格放射线：六道鎏金短线射出 —— 「裁定落下」
			for i: int in 6:
				var a := (float(i) / 6.0) * TAU + spin
				_spark(pos + Vector2(cos(a), sin(a)) * 20.0, pos + Vector2(cos(a), sin(a)) * 78.0, 1.8, 300.0, Palette.GILT["base"], 0.9))
		shake_accum += 0.5
	else:
		shake_accum += 0.12


## 近战斩击：交叉双弧（月牙）+ 冲势速度线 + 落点界格十字闪
func _slash(r: Dictionary, tint: Color) -> void:
	var from: Vector2 = r["pos"]
	var to: Vector2 = r.get("to", from + Vector2(40, 0))
	var ang := (to - from).angle()
	var mid := (from + to) / 2.0 + Vector2(0, -26)
	_slash_arc(mid, ang, 150.0, 200.0, 200.0, tint, 0.95)
	_slash_arc(mid, ang - 0.45, 112.0, 152.0, 190.0, tint, 0.6, 40.0)
	# 冲势速度线：三道细线沿攻击方向掠过
	var perp := Vector2(-sin(ang), cos(ang))
	for i: int in 3:
		var off := perp * (float(i) - 1.0) * 14.0
		var b0 := from + Vector2(0, -30) - Vector2(cos(ang), sin(ang)) * 26.0 + off
		_spark(b0, b0 + Vector2(cos(ang), sin(ang)) * 52.0, 2.5, 180.0, Palette.PAPER[100], 0.55)
	# 界格十字闪：落点一横一竖两道界格线
	var cross := _Fx.new()
	cross.kind = 5
	cross.color = Color(tint, 0.9)
	cross.width = 1.6
	cross.radius = 12.0
	cross.position = to + Vector2(0, -40)
	add_child(_register(cross))
	var tw := cross.create_tween()
	tw.tween_interval(0.06)
	tw.tween_method(func(t: float) -> void:
		cross.color.a = 0.9 * (1.0 - t)
		cross.queue_redraw(), 0.0, 1.0, 0.2)
	tw.tween_callback(cross.queue_free)


## 环爆：地面墨染 → 双冲击环 → 核心光涨 → 八道界格放射线
func _nova(r: Dictionary, tint: Color) -> void:
	var rad: float = float(r.get("radius", 1.0)) * 72.0
	var pos: Vector2 = r["pos"]
	_ground_stain(pos, rad * 2.2, rad * 1.3, tint, 0.72)
	_ring(pos, 40.0, rad * 2.4, 420.0, tint, 0.95, 2.4)
	_after(90.0, func() -> void: _ring(pos, 40.0, rad * 2.95, 580.0, tint, 0.85, 2.0))
	_glow(pos, rad * 0.6, rad * 2.2, 380.0, tint, 0.75)
	# 界格放射线：八道沿环法线射出 —— 把「范围边界」喊出来
	if not deco_suppressed and _strays.size() < FX_BUDGET:
		for i: int in 8:
			var a := (float(i) / 8.0) * TAU + 0.39
			_spark(pos + Vector2(cos(a), sin(a)) * rad * 0.4, pos + Vector2(cos(a), sin(a)) * rad * 1.05, 2.2, 360.0, tint, 0.8)
	_burst_dots(pos, 16, tint, 380.0, 0.3)
	shake_accum += 1.1 if rad >= 2.0 * 72.0 else 0.6


## 光束：贯穿双线 + 起点聚能 + 终点光爆 + 束上脉冲节点
func _beam(r: Dictionary, tint: Color) -> void:
	var dist2: float = r.get("dist", 200.0)
	var dir2 := Vector2(r.get("dx", 1.0), r.get("dy", 0.0)).normalized()
	var a0: Vector2 = r["pos"] + Vector2(0, -30.0)
	var b0 := a0 + dir2 * dist2
	_spark(a0, a0 + dir2 * dist2 * 1.1, 44.0, 460.0, tint, 0.62)
	_spark(a0, b0, 12.0, 300.0, Palette.PAPER[50], 0.9)
	_glow(a0, 34.0, 6.0, 240.0, tint, 0.9, Tween.EASE_IN)
	_after(120.0, func() -> void: _glow(b0, 12.0, 52.0, 260.0, tint, 0.95))
	# 脉冲节点：束线上两枚亮点依次闪过 —— 能量「流动」感
	for i: int in 2:
		var t01 := 0.35 + float(i) * 0.3
		var nx := a0 + dir2 * (dist2 * t01)
		_after(float(i) * 90.0, func() -> void: _glow(nx, 16.0, 4.0, 240.0, Palette.PAPER[50], 0.95))
	_burst_dots(a0, 8, tint, 260.0, 0.2)
	shake_accum += 0.8


## 蓄力法阵：八段虚线弧随收缩反向旋转 + 起手聚焦 + 环收拢后炸开
func _cast_ring(r: Dictionary, tint: Color) -> void:
	var pos: Vector2 = r["pos"]
	var g := _Fx.new()
	g.kind = 6
	g.color = Color(tint, 0.7)
	g.width = 2.5
	g.position = pos
	g.radius = 96.0
	add_child(_register(g))
	var tw := g.create_tween()
	tw.tween_method(func(t: float) -> void:
		g.radius = 96.0 - 66.0 * t
		g.color.a = 0.6 + 0.4 * t
		g.rotation = -t * 1.8
		g.queue_redraw(), 0.0, 1.0, 0.48).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.tween_callback(g.queue_free)
	_glow(pos + Vector2(0, -14.0), 52.0, 8.0, 460.0, tint, 0.85, Tween.EASE_IN)
	_ring(pos, 150.0, 56.0, 420.0, tint, 0.35, 2.0, Tween.EASE_IN)
	_after(420.0, func() -> void: _ring(pos, 56.0, 190.0, 240.0, tint, 0.95))


## 治疗波纹：向上生长 + 灵青符点三枚菱形错拍上浮（与伤害语言彻底区分）
func _heal_wave(r: Dictionary) -> void:
	var pos: Vector2 = r["pos"] + Vector2(0, -18.0)
	_ring(pos, 30.0, 140.0, 620.0, Palette.SPIRIT["light"], 0.8)
	_burst_dots(pos, 8, Palette.SPIRIT["light"], 60.0, 0.14)
	if deco_suppressed or _strays.size() >= FX_BUDGET:
		return
	for i: int in 3:
		var px := pos.x + float(i - 1) * 14.0
		var d := _Fx.new()
		d.kind = 7
		d.color = Color(Palette.SPIRIT["light"], 0.9)
		d.radius = 4.0
		d.position = Vector2(px, pos.y - 26.0)
		add_child(_register(d))
		var tw := d.create_tween()
		tw.tween_interval(float(i) * 0.11)
		tw.tween_method(func(t: float) -> void:
			d.position.y = pos.y - 26.0 - t * 34.0
			d.color.a = 0.9 * (1.0 - t)
			d.queue_redraw(), 0.0, 1.0, 0.7).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
		tw.tween_callback(d.queue_free)


## 护盾：六边盾面点亮 → 停留 → 同熄 + 四符点按序点亮
func _shield_wall(r: Dictionary) -> void:
	var pos: Vector2 = r["pos"] + Vector2(0, -26.0)
	var hex := _img(FxAtlas.HEX, pos, Color(Palette.MOON["light"], 0.0))
	hex.scale = Vector2(76.0 / 128.0, 88.0 / 128.0)
	var tw := hex.create_tween()
	tw.tween_property(hex, "modulate:a", 0.7, 0.18).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_interval(0.6)
	tw.tween_property(hex, "modulate:a", 0.0, 0.9)
	tw.tween_callback(hex.queue_free)
	if deco_suppressed or _strays.size() >= FX_BUDGET:
		return
	for i: int in 4:
		var a := (float(i) / 4.0) * TAU + PI / 4.0
		var dp := pos + Vector2(cos(a), sin(a)) * Vector2(30.0, 34.0)
		_after(float(i) * 70.0, func() -> void:
			var dot := _glow(dp, 6.0, 10.0, 140.0, Palette.MOON["light"], 0.95)
			var tw2 := dot.create_tween()
			tw2.tween_interval(0.16)
			tw2.tween_property(dot, "modulate:a", 0.0, 0.14)
			tw2.tween_callback(dot.queue_free))


## 召唤：界格方阵闪现 → 光柱 → 法环 → 四道墨涡旋入
func _summon(r: Dictionary) -> void:
	var pos: Vector2 = r["pos"]
	var grid := _Fx.new()
	grid.kind = 8
	grid.color = Color(Palette.GILT["base"], 0.8)
	grid.radius = 16.0
	grid.position = pos
	add_child(_register(grid))
	var tw := grid.create_tween()
	tw.tween_method(func(t: float) -> void:
		grid.color.a = 0.8 * (1.0 - t)
		grid.queue_redraw(), 0.0, 1.0, 0.38).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_callback(grid.queue_free)
	var pillar := _glow(pos + Vector2(0, -40.0), 30.0, 130.0, 620.0, Palette.GILT["light"], 0.9)
	tw = pillar.create_tween()
	tw.parallel().tween_property(pillar, "scale:x", 72.0 / 128.0, 0.62).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	_ring(pos, 20.0, 150.0, 540.0, Palette.GILT["light"], 0.95, 2.4)
	# 墨涡：四道短弧从外圈向内旋入 —— 「墨被拧出来」的聚合感
	if not deco_suppressed and _strays.size() < FX_BUDGET:
		for i: int in 4:
			var a0 := (float(i) / 4.0) * TAU + 0.5
			var swirl := _Fx.new()
			swirl.kind = 9
			swirl.color = Color(Palette.GILT["light"], 0.7)
			swirl.width = 2.0
			swirl.position = pos + Vector2(0, -18.0)
			swirl.radius = 64.0
			add_child(_register(swirl))
			var tsw := swirl.create_tween()
			tsw.tween_method(func(t: float) -> void:
				swirl.radius = 64.0 * (1.0 - t) + 8.0
				swirl.rotation = a0 + t * 2.2
				swirl.color.a = 0.7 * (1.0 - t)
				swirl.queue_redraw(), 0.0, 1.0, 0.52).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
			tsw.tween_callback(swirl.queue_free)
	_burst_dots(pos, 10, Palette.GILT["light"], 120.0, 0.2)
	shake_accum += 0.5


## 增益：描边扫环沿单位轮廓扫一周 —— 「力量漫过全身」
func _buff_aura(r: Dictionary, tint: Color) -> void:
	var pos: Vector2 = r["pos"] + Vector2(0, -26.0)
	var sweep := _Fx.new()
	sweep.kind = 10
	sweep.color = Color(tint, 0.75)
	sweep.width = 2.5
	sweep.radius = 34.0
	sweep.position = pos
	add_child(_register(sweep))
	var tw := sweep.create_tween()
	tw.tween_method(func(t: float) -> void:
		sweep.radius2 = t  # radius2 复用为扫过进度 0..1
		sweep.color.a = 0.75 * (1.0 - t * 0.5)
		sweep.queue_redraw(), 0.0, 1.0, 0.46).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_callback(sweep.queue_free)
	if deco_suppressed or _strays.size() >= FX_BUDGET:
		return
	for i: int in 6:
		var a := (float(i) / 6.0) * TAU
		var dp := pos + Vector2(cos(a), sin(a)) * 6.0
		var far := pos + Vector2(cos(a), sin(a)) * 42.0
		_spark(dp, far, 10.0, 520.0, tint, 0.9)


## 减损标记：环向心收缩 + 两滴墨下坠 —— 「被侵蚀」的方向感
func _debuff_mark(r: Dictionary) -> void:
	var pos: Vector2 = r["pos"] + Vector2(0, -34.0)
	_ring(pos, 90.0, 26.0, 520.0, Palette.VOID["base"], 0.85, 2.0, Tween.EASE_IN)
	if deco_suppressed or _strays.size() >= FX_BUDGET:
		return
	for i: int in 2:
		var dp := pos + Vector2(-10.0 if i == 0 else 12.0, -14.0)
		_after(float(i) * 110.0, func() -> void:
			var drop := _glow(dp, 5.0, 9.0, 480.0, Palette.VOID["base"], 0.8, Tween.EASE_IN)
			var tw2 := drop.create_tween()
			tw2.parallel().tween_property(drop, "position:y", dp.y + 26.0, 0.48).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN))


## 地面法阵：持续型区域，缓慢呼吸后消散；telegraph 红线四向预警
func _ground_mark(r: Dictionary, p: Dictionary, tint: Color) -> void:
	var rad3: float = float(r.get("radius", 1.0)) * 72.0 * 0.62
	var dur_ms: float = float(p.get("dur", 2.6)) * 1000.0
	var telegraph := float(p.get("telegraph", 0.0)) > 0.0
	var mark_color := Palette.CINNABAR["light"] if telegraph else tint
	_ground_stain(r["pos"], rad3 * 1.15, rad3 * 0.66, mark_color, dur_ms / 1000.0)
	if telegraph and not deco_suppressed and _strays.size() < FX_BUDGET:
		for i: int in 4:
			var a := (float(i) / 4.0) * TAU
			_spark(r["pos"] + Vector2(cos(a), sin(a)) * rad3 * 0.5, r["pos"] + Vector2(cos(a), sin(a)) * rad3, 1.3, minf(300.0, dur_ms), Palette.CINNABAR["light"], 0.85)
	_ring(r["pos"], rad3, rad3 * 1.02, minf(300.0, dur_ms), mark_color, 0.85, 1.3)


## 全屏闪（calm 静观直接吞掉）
func fullscreen_flash(color: Color, strength: float = 1.0) -> void:
	if calm:
		return
	var rect := ColorRect.new()
	rect.color = Color(color, 0.32 * strength)
	rect.size = Vector2(Layout.W, Layout.H)
	# 原点铺满 + 挂当前场景根：effects_layer 位于 board_view 缩放子树内，
	# 全屏矩形挂本层会被缩到 1/4 且随板偏移
	rect.position = Vector2.ZERO
	rect.z_index = 90
	get_tree().current_scene.add_child(rect)
	_strays.append(rect)
	rect.tree_exited.connect(func() -> void: _strays.erase(rect))
	var tw := rect.create_tween()
	tw.tween_property(rect, "color:a", 0.0, 0.18 * strength)
	tw.tween_callback(rect.queue_free)
	shake_accum += 1.4 * strength


## 自绘几何语义件（texture 之外的形状语言）
## kind: 4=地面椭圆 5=界格十字 6=八段虚线弧 7=菱形符点 8=界格方阵 9=弧段(墨涡) 10=描边扫环
class _Fx extends Node2D:
	var kind := 4
	var color := Color.WHITE
	var width := 2.0
	var radius := 10.0
	var radius2 := 10.0

	func _draw() -> void:
		match kind:
			1:
				# 弹道光点（_play_projectile 设 kind=1；此前无分支 = 每帧空绘）
				draw_circle(Vector2.ZERO, maxf(radius, 0.5), color)
			4:
				var pts := PackedVector2Array()
				for i: int in 25:
					var a := TAU * float(i) / 24.0
					pts.append(Vector2(cos(a) * maxf(radius, 0.5), sin(a) * maxf(radius2, 0.5)))
				draw_colored_polygon(pts, color)
			5:
				# 界格十字：一横一竖
				draw_line(Vector2(-radius, 0), Vector2(radius, 0), color, width)
				draw_line(Vector2(0, -radius), Vector2(0, radius), color, width)
			6:
				# 八段虚线弧（法阵起手）
				for i: int in 8:
					var a0 := (float(i) / 8.0) * TAU
					draw_arc(Vector2.ZERO, maxf(radius, 0.5), a0, a0 + PI / 5.0, 12, color, width)
			7:
				# 菱形符点（星标同款）
				var r := maxf(radius, 0.5)
				draw_colored_polygon(PackedVector2Array([Vector2(0, -r), Vector2(r, 0), Vector2(0, r), Vector2(-r, 0)]), color)
			8:
				# 界格方阵：3×3 小方格（机关造物「落格」）
				for ix: int in range(-1, 2):
					for iy: int in range(-1, 2):
						draw_rect(Rect2(float(ix) * radius - 6.0, float(iy) * radius * 0.55 - 4.0, 12.0, 8.0), color, false, 1.0)
			9:
				# 弧段（墨涡旋入；rotation 由宿主 tween 驱动）
				draw_arc(Vector2.ZERO, maxf(radius, 0.5), 0.0, 0.9, 12, color, width)
			10:
				# 描边扫环：细弧沿轮廓扫过一周（radius2 = 扫过进度 0..1）
				draw_arc(Vector2.ZERO, maxf(radius, 0.5), -PI / 2.0, -PI / 2.0 + TAU * maxf(radius2, 0.001), 40, color, width)
