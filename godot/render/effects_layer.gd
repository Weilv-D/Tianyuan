extends Node2D
class_name EffectsLayer
## 墨迹特效层（EffectsLayer.ts 对齐版，M3 次批）—— 16 kind + 全屏闪。
## 原语：环扩张 / 软光斑 / 线束 / 墨点迸溅 / 地面墨染；全部程序化 _draw + Tween，
## 色彩经 FX_TINTS 槽位（params.hue → tint → kind fallback）。夜宴红线：无荧光无紫。
##
## 震屏：shake_accum 累加，宿主每帧取走清零并换算相机脉冲（静观模式恒 0）。

var calm := false
var shake_accum := 0.0
var _gen := 0
var _strays: Array = []


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


func _register(n: Node2D) -> Node2D:
	_strays.append(n)
	n.tree_exited.connect(func() -> void: _strays.erase(n))
	return n


## 代际守卫的延时（clear 后迟到演出自杀）
func _after(ms: float, fn: Callable) -> void:
	var g := _gen
	get_tree().create_timer(ms / 1000.0).timeout.connect(func() -> void:
		# is_instance_valid 前置：节点已释放时对 freed self 调 is_inside_tree 本身即崩
		if g == _gen and is_instance_valid(self) and is_inside_tree():
			fn.call())


func take_shake() -> float:
	var v := shake_accum
	shake_accum = 0.0
	return 0.0 if calm else v


# ── 原语 ──────────────────────────────────────────────────

func _ring(pos: Vector2, r0: float, r1: float, dur: float, color: Color, a0: float, width: float = 2.0, ease := Tween.EASE_OUT) -> Node2D:
	var n := _Fx.new()
	n.kind = 0
	n.color = Color(color, a0)
	n.width = width
	n.radius = r0
	n.position = pos
	add_child(_register(n))
	var tw := n.create_tween()
	tw.tween_method(func(t: float) -> void:
		n.radius = r0 + (r1 - r0) * t
		n.color.a = a0 * (1.0 - t)
		n.queue_redraw(), 0.0, 1.0, dur / 1000.0).set_ease(ease)
	tw.tween_callback(n.queue_free)
	return n


func _glow(pos: Vector2, s0: float, s1: float, dur: float, color: Color, a0: float, ease := Tween.EASE_OUT) -> Node2D:
	var n := _Fx.new()
	n.kind = 1
	n.color = Color(color, a0)
	n.radius = s0 / 2.0
	n.position = pos
	add_child(_register(n))
	var tw := n.create_tween()
	tw.tween_method(func(t: float) -> void:
		n.radius = (s0 + (s1 - s0) * t) / 2.0
		n.color.a = a0 * (1.0 - t)
		n.queue_redraw(), 0.0, 1.0, dur / 1000.0).set_ease(ease)
	tw.tween_callback(n.queue_free)
	return n


func _spark(from: Vector2, to: Vector2, width: float, dur: float, color: Color, a0: float = 0.8) -> Node2D:
	var n := _Fx.new()
	n.kind = 2
	n.color = Color(color, a0)
	n.width = width
	n.line_from = from
	n.line_to = to
	n.position = Vector2.ZERO
	add_child(_register(n))
	var tw := n.create_tween()
	tw.tween_method(func(t: float) -> void:
		n.color.a = a0 * (1.0 - t)
		n.queue_redraw(), 0.0, 1.0, dur / 1000.0)
	tw.tween_callback(n.queue_free)
	return n


## 墨点迸溅（inkDot 粒子语义；手动节点池替代 Phaser 粒子发射器）
func _burst_dots(pos: Vector2, count: int, color: Color, speed: float, scale_v: float = 0.2) -> void:
	for i: int in count:
		var n := _Fx.new()
		n.kind = 3
		n.color = Color(color, 0.95)
		n.radius = 7.0 * scale_v / 0.18
		n.position = pos
		add_child(_register(n))
		var ang := randf() * TAU
		var v := Vector2(cos(ang), sin(ang)) * (0.35 + randf() * 0.65) * speed
		var life := 0.52
		var tw := n.create_tween()
		tw.tween_method(func(t: float) -> void:
			n.position = pos + v * t
			n.color.a = 0.95 * (1.0 - t)
			n.radius = 7.0 * scale_v / 0.18 * (1.0 - t)
			n.queue_redraw(), 0.0, 1.0, life)
		tw.tween_callback(n.queue_free)


## 地面墨染（椭圆展开再退去）
func _ground_stain(pos: Vector2, rx: float, ry: float, color: Color, dur: float) -> void:
	var n := _Fx.new()
	n.kind = 4
	n.color = color
	n.radius = rx
	n.radius2 = ry
	n.position = pos
	z_index = -5
	add_child(_register(n))
	var tw := n.create_tween()
	tw.tween_method(func(t: float) -> void:
		var spread: float = 0.5 + 0.5 * minf(t * 2.0, 1.0)
		n.radius = rx * spread
		n.radius2 = ry * spread
		n.color.a = 0.16 * (1.0 - maxf(0.0, (t - 0.36) / 0.64))
		n.queue_redraw(), 0.0, 1.0, dur / 1000.0)
	tw.tween_callback(n.queue_free)


# ── 16 kind 入口（play 语义对齐；时长/半径按 TS 规格缩配） ──

func play(r: Dictionary) -> void:
	var p: Dictionary = r.get("params", {})
	var tint := _tint_of(r, Palette.CINNABAR["light"])
	match String(r.get("kind", "")):
		"impact":
			var crit := float(p.get("crit", 0.0)) > 0.0
			var base := 1.3 if crit else 1.0
			_glow(r["pos"], 14.0, 46.0 * base, 200.0 if crit else 140.0, Palette.PAPER[50], 0.95)
			_glow(r["pos"], 26.0, 88.0 * base, 300.0 if crit else 210.0, tint, 0.55)
			_ring(r["pos"], 24.0, (128.0 if crit else 88.0) * base, 340.0 if crit else 240.0, tint, 0.85)
			_burst_dots(r["pos"], 12 if crit else 6, tint, 260.0 if crit else 150.0, 0.24 if crit else 0.16)
			# 六向墨花
			var start := randf() * TAU
			for i: int in 6:
				var ang: float = start + i * TAU / 6.0
				var reach := (66.0 if crit else 46.0) * base + randf() * 14.0
				_spark(r["pos"] + Vector2(cos(ang), sin(ang)) * 9.0, r["pos"] + Vector2(cos(ang), sin(ang)) * reach, 2.4 if crit else 1.8, 260.0 if crit else 190.0, tint if i % 2 == 0 else Palette.PAPER[50])
			if crit:
				_after(80.0, func() -> void:
					_ring(r["pos"], 40.0, 164.0, 320.0, Palette.GILT["light"], 0.8, 2.4))
				shake_accum += 0.5
			else:
				shake_accum += 0.12
		"slash":
			var from: Vector2 = r["pos"]
			var to: Vector2 = r.get("to", from + Vector2(40, 0))
			var mid := (from + to) / 2.0 + Vector2(0, -26)
			_glow(mid, 150.0, 200.0, 100.0, tint, 0.95)
			_after(40.0, func() -> void: _glow(mid, 112.0, 152.0, 100.0, tint, 0.6))
			for i: int in 3:
				var dir := (to - from).normalized()
				var off := Vector2(-dir.y, dir.x) * (i - 1) * 14.0
				_spark(mid + off + dir * 26.0, mid + off + dir * 78.0, 2.5, 180.0, Palette.PAPER[100], 0.55)
		"pierce":
			var dist: float = r.get("dist", 40.0)
			var dir := Vector2(r.get("dx", 1.0), r.get("dy", 0.0)).normalized()
			var c0: Vector2 = r["pos"] + Vector2(0, -30.0)
			_spark(c0 - dir * dist / 2.0, c0 + dir * dist / 2.0, 9.0, 180.0, tint, 0.9)
			_after(60.0, func() -> void: _spark(c0 - dir * (dist / 2.0 + 10.0), c0 + dir * (dist * 0.33 - 10.0), 4.5, 230.0, tint, 0.5))
		"nova":
			var rad: float = float(r.get("radius", 1.0)) * 72.0
			_ground_stain(r["pos"], rad * 2.2, rad * 1.3, tint, 0.72)
			_ring(r["pos"], 40.0, rad * 2.4, 420.0, tint, 0.95, 2.4)
			_after(90.0, func() -> void: _ring(r["pos"], 40.0, rad * 2.95, 580.0, tint, 0.85, 2.0))
			_glow(r["pos"], rad * 0.6, rad * 2.2, 380.0, tint, 0.75)
			_burst_dots(r["pos"], 16, tint, 380.0, 0.3)
			shake_accum += 1.1 if rad >= 2.0 * 72.0 else 0.6
		"burst":
			var rad2: float = float(r.get("radius", 1.0)) * 72.0 * 0.55
			_ring(r["pos"], rad2 * 0.4, rad2 * 2.4, 400.0, tint, 0.9, 2.4)
			_glow(r["pos"], rad2 * 0.3, rad2 * 1.8, 330.0, tint, 0.85)
			_burst_dots(r["pos"], 14, tint, 320.0, 0.26)
			shake_accum += 0.7
		"beam":
			var dist2: float = r.get("dist", 200.0)
			var dir2 := Vector2(r.get("dx", 1.0), r.get("dy", 0.0)).normalized()
			var a0: Vector2 = r["pos"] + Vector2(0, -30.0)
			var b0 := a0 + dir2 * dist2
			_spark(a0, a0 + dir2 * dist2 * 1.1, 44.0, 460.0, tint, 0.62)
			_spark(a0, b0, 12.0, 300.0, Palette.PAPER[50], 0.9)
			_glow(a0, 34.0, 6.0, 240.0, tint, 0.9, Tween.EASE_IN)
			_after(120.0, func() -> void: _glow(b0, 12.0, 52.0, 260.0, tint, 0.95))
			_burst_dots(a0, 8, tint, 260.0, 0.2)
			shake_accum += 0.8
		"castRing":
			var pos2: Vector2 = r["pos"]
			_ring(pos2, 96.0, 56.0, 420.0, tint, 0.65, 2.5, Tween.EASE_IN)
			_glow(pos2 + Vector2(0, -14.0), 52.0, 8.0, 460.0, tint, 0.85, Tween.EASE_IN)
			_after(420.0, func() -> void: _ring(pos2, 56.0, 190.0, 240.0, tint, 0.95))
		"healWave":
			var pos3: Vector2 = r["pos"] + Vector2(0, -18.0)
			_ring(pos3, 30.0, 140.0, 620.0, Palette.SPIRIT["light"], 0.8)
			_burst_dots(pos3, 8, Palette.SPIRIT["light"], 60.0, 0.14)
		"shieldWall":
			var pos4: Vector2 = r["pos"] + Vector2(0, -26.0)
			_glow(pos4, 76.0, 82.0, 180.0, Palette.MOON["light"], 0.7)
			_after(780.0, func() -> void: _glow(pos4, 76.0, 30.0, 900.0, Palette.MOON["light"], 0.5))
			_ring(pos4, 30.0, 36.0, 140.0, Palette.MOON["light"], 0.6, 1.6)
		"dashTrail":
			var from2: Vector2 = r["pos"]
			var to2: Vector2 = r.get("to", from2)
			var mid2 := (from2 + to2) / 2.0 + Vector2(0, -26.0)
			_spark(mid2 - (to2 - from2).normalized() * (to2 - from2).length() * 0.6, mid2 + (to2 - from2).normalized() * (to2 - from2).length() * 0.6, 40.0, 300.0, tint, 0.55)
			_burst_dots(to2 + Vector2(0, -20.0), 8, tint, 200.0, 0.18)
		"summon":
			var pos5: Vector2 = r["pos"]
			_ring(pos5, 20.0, 150.0, 540.0, Palette.GILT["light"], 0.95, 2.4)
			_glow(pos5 + Vector2(0, -40.0), 30.0, 130.0, 620.0, Palette.GILT["light"], 0.9)
			_burst_dots(pos5, 10, Palette.GILT["light"], 120.0, 0.2)
			shake_accum += 0.5
		"buffAura":
			var pos6: Vector2 = r["pos"] + Vector2(0, -26.0)
			_ring(pos6, 30.0, 42.0, 460.0, tint, 0.75, 2.5)
			_glow(pos6, 10.0, 42.0, 520.0, tint, 0.9)
		"debuffMark":
			var pos7: Vector2 = r["pos"] + Vector2(0, -34.0)
			_ring(pos7, 90.0, 26.0, 520.0, Palette.VOID["base"], 0.85, 2.0, Tween.EASE_IN)
		"groundMark":
			var rad3: float = float(r.get("radius", 1.0)) * 72.0 * 0.62
			var dur_ms: float = float(p.get("dur", 2.6)) * 1000.0
			_ground_stain(r["pos"], rad3 * 1.15, rad3 * 0.66, tint, dur_ms / 1000.0)
			_ring(r["pos"], rad3, rad3 * 1.02, minf(300.0, dur_ms), tint, 0.85, 1.3)
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


## 自绘形状节点（kind: 0=环 1=软光 2=线束 3=墨点 4=地面椭圆）
class _Fx extends Node2D:
	var kind := 0
	var color := Color.WHITE
	var width := 2.0
	var radius := 10.0
	var radius2 := 10.0
	var line_from := Vector2.ZERO
	var line_to := Vector2.ZERO

	func _draw() -> void:
		match kind:
			0:
				draw_arc(Vector2.ZERO, maxf(radius, 0.5), 0, TAU, 48, color, width)
			1:
				draw_circle(Vector2.ZERO, maxf(radius, 0.5), color)
				draw_circle(Vector2.ZERO, maxf(radius * 0.55, 0.5), Color(color, minf(color.a * 1.4, 1.0)))
			2:
				draw_line(line_from, line_to, color, width)
				draw_line(line_from, line_to, Color(color, color.a * 0.4), width * 2.5)
			3:
				draw_circle(Vector2.ZERO, maxf(radius, 0.5), color)
			4:
				draw_ellipse_fill(radius, radius2, color)

	func draw_ellipse_fill(rx: float, ry: float, c: Color) -> void:
		var pts := PackedVector2Array()
		for i: int in 25:
			var a := TAU * float(i) / 24.0
			pts.append(Vector2(cos(a) * rx, sin(a) * ry))
		draw_colored_polygon(pts, c)
