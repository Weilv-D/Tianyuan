extends RefCounted
class_name Artifacts
## 夜宴器物谱 · UI 形制库 —— 全界面器物化的统一入口（形制由此出，色由 Palette 出，
## 纹理由 FxAtlas 出；三处真源合一，零散点硬编码是「草稿感」的根因）。
##
## 器物对应：
##   砚石 night_panel   —— 浮层面板砚底嵌金边（替代引擎默认灰 Panel）
##   墨玉 jade_button   —— 交互按钮三态（常/悬/按下逐级提亮 + 玉纹内光）
##   砚格 cell_button   —— 商肆卡/器匣格小格位（砚石小面 + 同款金线）
##   朱砂 seal_badge    —— 方印角标（购买序位/标记；直角、白边、篆字）
##   宝石 gem_pip       —— 琢面宝石点（费阶/星级/羁绊档位；cost_gem/tier_gem 取色）
##   琉璃 glaze_back    —— 装备/器匣格背衬（厚薄缘光 + 捉光斑）
##
## 纪律：Control 器物一律显式 mouse_filter = IGNORE（装饰件吞点击 = 2.3.0 已判事故）；
## 禁圆角（set_corner_radius_all(0) 或干脆不用 Flat）。


## 浮层面板砚底（引擎默认 Panel 是中性灰 —— 违反「任何颜色必须来自 Palette」红线）。
## 形参取 Control：Panel 与 PanelContainer 通吃（覆写点就在 Control 上）
static func night_panel(p: Control) -> void:
	p.add_theme_stylebox_override("panel", FxAtlas.panel_box(Color(Palette.INK[900], 0.97)))


## 墨玉三态按钮：常 INK850 → 悬 INK700（金字）→ 按下 INK900（金哑）。
## opts: {"hero": true} 开战键（GILT 主字）；{"size": 字号}；{"min": Vector2}
static func jade_button(b: Button, opts := {}) -> void:
	var fsz: int = int(opts.get("size", 16))
	var hero: bool = bool(opts.get("hero", false))
	b.add_theme_font_override("font", Sess.body_font)
	b.add_theme_font_size_override("font_size", fsz)
	b.add_theme_color_override("font_color", Palette.GILT["light"] if hero else Palette.PAPER[100])
	b.add_theme_color_override("font_hover_color", Palette.GILT["glow"])
	b.add_theme_color_override("font_pressed_color", Palette.GILT["base"])
	b.add_theme_color_override("font_disabled_color", Palette.INK[400])
	b.add_theme_stylebox_override("normal", FxAtlas.jade_box(Color(Palette.INK[850], 0.96)))
	b.add_theme_stylebox_override("hover", FxAtlas.jade_box(Color(Palette.INK[700], 0.96)))
	b.add_theme_stylebox_override("pressed", FxAtlas.jade_box(Color(Palette.INK[900], 0.96)))
	b.add_theme_stylebox_override("disabled", FxAtlas.jade_box(Color(Palette.INK[900], 0.55)))
	if opts.has("min"):
		b.custom_minimum_size = opts["min"]
	b.focus_mode = Control.FOCUS_NONE
	MicroFx.hook(b)


## 小格位按钮（商肆卡/器匣格）：砚石小面常驻 + 悬停提亮；三态字色同墨玉律
static func cell_button(b: Button, opts := {}) -> void:
	var fsz: int = int(opts.get("size", 14))
	b.add_theme_font_override("font", Sess.body_font)
	b.add_theme_font_size_override("font_size", fsz)
	b.add_theme_color_override("font_color", Palette.PAPER[100])
	b.add_theme_stylebox_override("normal", FxAtlas.cell_box(Color(Palette.INK[850], 0.94)))
	b.add_theme_stylebox_override("hover", FxAtlas.cell_box(Color(Palette.INK[700], 0.96)))
	b.add_theme_stylebox_override("pressed", FxAtlas.cell_box(Color(Palette.INK[650], 0.96)))
	b.add_theme_stylebox_override("disabled", FxAtlas.cell_box(Color(Palette.INK[900], 0.72)))
	b.focus_mode = Control.FOCUS_NONE


## 朱砂方印（篆体单字/序位数字；装饰件 → 显式放行鼠标）
static func seal_badge(ch: String, px: float = 24.0) -> Panel:
	var p := Panel.new()
	p.size = Vector2(px, px)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.CINNABAR["base"], 0.92)
	sb.border_color = Palette.PAPER[100]
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(0)
	p.add_theme_stylebox_override("panel", sb)
	var l := Label.new()
	l.text = ch
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.set_anchors_preset(Control.PRESET_FULL_RECT)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.add_theme_font_override("font", Sess.seal_font)
	l.add_theme_font_size_override("font_size", maxi(10, int(px * 0.58)))
	l.add_theme_color_override("font_color", Palette.PAPER[100])
	p.add_child(l)
	return p


## 宝石点（琢面 × 语义色；position = 宝石中心）
static func gem_pip(color: Color, px: float) -> Sprite2D:
	return FxAtlas.gem(color, px)


## 费阶宝石（RARITY_COLOR 真源取色）
static func cost_gem(cost: int, px: float) -> Sprite2D:
	return FxAtlas.gem(Palette.RARITY_COLOR[clampi(cost, 1, 5)], px)


## 羁绊档位宝石（TRAIT_TIER_COLOR 真源取色）
static func tier_gem(tier: int, px: float) -> Sprite2D:
	var t: Array = Palette.TRAIT_TIER_COLOR
	return FxAtlas.gem(t[clampi(tier, 0, t.size() - 1)], px)


## 琉璃背衬（Sprite2D —— 非 Control，不吃输入；垫在装备图标下）
static func glaze_back(w: float, h: float) -> Sprite2D:
	var s := Sprite2D.new()
	s.texture = FxAtlas.texture(FxAtlas.GLAZE)
	s.modulate = Color(Palette.INK[850], 0.92)
	s.scale = Vector2(w / 128.0, h / 128.0)
	s.centered = false
	return s


## 文本标签形制（五处散点 _label/_lbl 构造收敛于此——2.4.1 审查修复）。
## opts: {"font": Font, "align": "center"/"right", "w": 宽, "clip": true, "wrap": true}
static func label(text: String, size: int, color: Color, opts := {}) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", opts.get("font", Sess.body_font))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if opts.has("w"):
		l.size = Vector2(float(opts["w"]), l.size.y)
	var al: String = String(opts.get("align", ""))
	if al == "center":
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	elif al == "right":
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	if opts.get("clip", false):
		l.clip_text = true
	if opts.get("wrap", false):
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


## 出售印形制（66×66 朱砂大方印：金字 + 鎏金内线 + 纸白边）—— 拖拽出售目标
static func sell_seal(px: float) -> Panel:
	var p := Panel.new()
	p.size = Vector2(px, px)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.CINNABAR["base"], 0.88)
	sb.border_color = Palette.PAPER[100]
	sb.border_width_left = 1
	sb.border_width_right = 1
	sb.border_width_top = 1
	sb.border_width_bottom = 1
	sb.set_corner_radius_all(0)
	p.add_theme_stylebox_override("panel", sb)
	var t := Label.new()
	t.text = "售"
	t.mouse_filter = Control.MOUSE_FILTER_IGNORE
	t.set_anchors_preset(Control.PRESET_FULL_RECT)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	t.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	t.add_theme_font_override("font", Sess.seal_font)
	t.add_theme_font_size_override("font_size", int(px * 0.46))
	t.add_theme_color_override("font_color", Palette.PAPER[100])
	p.add_child(t)
	# 鎏金内线（印身收口）：四边 1px 内框
	for seg: Array in [[0.0, 0.0, px, 1.0], [0.0, px - 3.0, px, 1.0]]:
		var ln := ColorRect.new()
		ln.color = Color(Palette.GILT["base"], 0.55)
		ln.position = Vector2(float(seg[0]) + 2.0, float(seg[1]) + 2.0)
		ln.size = Vector2(float(seg[2]) - 4.0, float(seg[3]))
		ln.mouse_filter = Control.MOUSE_FILTER_IGNORE
		p.add_child(ln)
	return p
