extends Node2D
class_name LegendaryFx
## 三星五费专属全屏演出 —— 「天命之印」（LegendaryFx.ts 样稿制式对齐版）。
##
## 夜色压暗 → 巨型剪影浮现 → 196px 朱砂方印携名将之名盖落（竖排篆字、双环印框）
## → 落款浮现 → 鎏金尘埃迸散 + 印身微 squash。
## 发光只此一处 —— 全场最稀有的瞬间独享全场唯一的 ADD 光。
##
## 触发：game_scene._detect_merge_sound 里五费升至三星时调用 play()。
## 静观模式（calm）：整段缩至约 1 秒、无尘埃无 squash（v2 圣经 §五口径）。

static var _active := false

var _def_id := ""
var _calm := false
var _bits: Array = []  # 演出件（收场统一淡出）


## 入口：root 为场景根（设计绝对坐标系 0..1920/0..1080）
static func play(root: Node, def_id: String, calm := false) -> void:
	if _active:
		return
	_active = true
	var fx := LegendaryFx.new()
	fx._def_id = def_id
	fx._calm = calm
	root.add_child(fx)


func _ready() -> void:
	var w := float(Layout.W)
	var h := float(Layout.H)
	var cx := w / 2.0
	var cy := h * 0.44

	# ── 1) 夜色压暗：把这一刻从连续的时间流里抠出来 ──
	var dim := ColorRect.new()
	dim.color = Color(Palette.SHADE, 0.0)
	dim.size = Vector2(w, h)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dim)
	_bits.append(dim)
	var t0 := dim.create_tween()
	t0.tween_property(dim, "color:a", 0.62, 0.22)

	# ── 2) 巨型剪影：名将的墨影在印后升起 ──
	var tex: Texture2D = load("res://assets/pieces/%s.png" % _def_id)
	if tex != null:
		var shadow := Sprite2D.new()
		shadow.texture = tex
		shadow.centered = false
		shadow.position = Vector2(cx - 540.0, cy + 90.0)
		shadow.scale = Vector2.ONE * (1080.0 * 5.2 / 208.0 / 10.0)
		shadow.modulate = Color(Palette.INK[500], 0.0)
		add_child(shadow)
		_bits.append(shadow)
		shadow.create_tween().tween_property(shadow, "modulate:a", 0.12, 0.9).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		shadow.create_tween().tween_property(shadow, "position:y", cy + 40.0 - shadow.texture.get_height() * shadow.scale.y / 2.0, 0.9).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)

	# ── 3) 印后鎏金光晕（全场唯一 ADD 光，只给这一刻） ──
	var halo := Sprite2D.new()
	halo.texture = FxAtlas.texture(FxAtlas.GLOW)
	halo.material = FxAtlas.add_material()
	halo.modulate = Color(Palette.GILT["base"], 0.0)
	halo.position = Vector2(cx, cy)
	halo.scale = Vector2.ONE * (560.0 / 128.0)
	add_child(halo)
	_bits.append(halo)
	halo.create_tween().tween_property(halo, "modulate:a", 0.35, 0.52).set_delay(0.16).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)

	# ── 4) 朱砂方印：竖排篆名，双环印框 ──
	var name := _def_name(_def_id)
	var seal := Node2D.new()
	seal.position = Vector2(cx, cy)
	seal.scale = Vector2.ONE * 2.1
	seal.modulate.a = 0.0
	add_child(seal)
	_bits.append(seal)
	var plate := _SealPlate.new()
	seal.add_child(plate)
	var name_size := 56 if name.length() <= 2 else 42
	var name_txt := Label.new()
	name_txt.text = " ".join(name.split("")) if name.length() <= 1 else "\n".join(name.split(""))
	name_txt.add_theme_font_override("font", Sess.seal_font)
	name_txt.add_theme_font_size_override("font_size", name_size)
	name_txt.add_theme_color_override("font_color", Palette.PAPER[50])
	name_txt.add_theme_constant_override("line_spacing", 6 if name.length() <= 2 else 2)
	name_txt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_txt.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	name_txt.size = Vector2(196, 196)
	name_txt.position = Vector2(-98, -98)
	seal.add_child(name_txt)

	# ── 5) 落款：「神 品 三 星 · 天 命 所 归」（全角空格承担字距） ──
	var banner := Label.new()
	banner.text = "神　品　三　星　·　天　命　所　归"
	banner.add_theme_font_override("font", Sess.seal_font)
	banner.add_theme_font_size_override("font_size", 18)
	banner.add_theme_color_override("font_color", Palette.GILT["light"])
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.size = Vector2(w, 30)
	banner.position = Vector2(0, h * 0.79)
	banner.modulate.a = 0.0
	add_child(banner)
	_bits.append(banner)

	# ── 落印：2.1 倍压下 → 定格 → 印身微 squash + 尘埃迸散 ──
	var land := seal.create_tween()
	land.tween_property(seal, "modulate:a", 1.0, 0.12).set_delay(0.2)
	land.tween_property(seal, "scale", Vector2.ONE, 0.3).set_delay(0.21).set_trans(Tween.TRANS_QUINT).set_ease(Tween.EASE_IN)
	land.tween_callback(func() -> void:
		if not _calm:
			_burst(Vector2(cx, cy), Palette.GILT["light"], 26)
			_burst(Vector2(cx, cy), Palette.CINNABAR["light"], 14)
			var sq := seal.create_tween()
			sq.tween_property(seal, "scale:y", 0.9, 0.09).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
			sq.tween_property(seal, "scale:y", 1.0, 0.09).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT))
	banner.create_tween().tween_property(banner, "modulate:a", 1.0, 0.8).set_delay(0.62)

	# ── 收场：夜色散去，一切如初 ──
	var linger := 0.7 if _calm else 1.85
	var out := create_tween()
	out.tween_interval(linger)
	out.tween_callback(func() -> void: Sess.sfx.play("star3"))
	out.tween_property(self, "modulate:a", 0.0, 0.46).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	out.tween_callback(func() -> void:
		_active = false
		queue_free())


func _burst(pos: Vector2, color: Color, count: int) -> void:
	for i: int in count:
		var ang := randf() * TAU
		var v := Vector2(cos(ang), sin(ang)) * randf_range(120.0, 340.0)
		var sp := Sprite2D.new()
		sp.texture = FxAtlas.texture(FxAtlas.INK_DOT)
		sp.material = FxAtlas.add_material()
		sp.modulate = Color(color, 0.9)
		sp.position = pos
		sp.scale = Vector2.ONE * randf_range(0.4, 0.9)
		add_child(sp)
		var tw := sp.create_tween()
		tw.tween_method(func(t: float) -> void:
			sp.position = pos + v * t
			sp.modulate.a = 0.9 * (1.0 - t), 0.0, 1.0, randf_range(0.38, 0.76)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tw.tween_callback(sp.queue_free)


func _def_name(def_id: String) -> String:
	var def: Variant = Spec.champion_by_id.get(def_id, null)
	return String(def["name"]) if def != null else "神"


## 印身：朱砂方 + 外缘米金亮线 + 内环发丝（样稿 inset 双环）
class _SealPlate extends Node2D:
	func _draw() -> void:
		draw_rect(Rect2(-98, -98, 196, 196), Color(Palette.CINNABAR["deep"], 0.97))
		draw_rect(Rect2(-98, -98, 196, 196), Color(Palette.GILT["light"], 0.85), false, 1.5)
		draw_rect(Rect2(-90, -90, 180, 180), Color(Palette.PAPER[100], 0.4), false, 1.0)
