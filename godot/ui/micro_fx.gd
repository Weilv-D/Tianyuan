extends RefCounted
class_name MicroFx
## UI 微动效工具（web Button hover/press 与面板出入场的 Godot 对齐）。
##
## 全部走 modulate/scale 补间（pivot 居中），零样式侵入 —— 夜宴面板的三态
## 色板仍由 StyleBox 承担，动效只叠加「有回应」的手感。

## 按钮/控件挂接：悬停微涨、按下微缩（控件销毁随树，无需手动清理）
static func hook(c: Control) -> void:
	if c.has_meta("micro_fx"):
		return
	c.set_meta("micro_fx", true)
	c.resized.connect(func() -> void: c.pivot_offset = c.size / 2.0)
	c.pivot_offset = c.size / 2.0
	c.mouse_entered.connect(func() -> void: _scale_to(c, 1.04))
	c.mouse_exited.connect(func() -> void: _scale_to(c, 1.0))
	c.button_down.connect(func() -> void: _scale_to(c, 0.96))
	c.button_up.connect(func() -> void: _scale_to(c, 1.03))


## 面板入场：淡入 + 轻微上浮（结算/侦查/奇遇/全览浮层统一手感）
static func enter(c: Control, dy := 22.0) -> void:
	var y0 := c.position.y
	c.modulate.a = 0.0
	var tw := c.create_tween()
	tw.set_parallel(true)
	tw.tween_property(c, "modulate:a", 1.0, 0.22).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(c, "position:y", y0 - dy, 0.26).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)


## 数值滚动：label 文本从 from 滚到 to（金币变化「跳字」手感）
static func roll_number(l: Label, from_v: int, to_v: int, fmt := "%d") -> void:
	if from_v == to_v:
		l.text = fmt % to_v
		return
	var carrier := { "v": float(from_v) }
	var tw := l.create_tween()
	tw.tween_method(func(t: float) -> void:
		l.text = fmt % int(roundf(carrier["v"])), from_v, float(to_v), 0.3)
	tw.tween_callback(func() -> void: l.text = fmt % to_v)


static func _scale_to(c: Control, v: float) -> void:
	var tw := c.create_tween()
	tw.tween_property(c, "scale", Vector2.ONE * v, 0.12).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
