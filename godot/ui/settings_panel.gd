extends CanvasLayer
## 设置面板（SettingsPanel.ts 对齐版 · M3 次批紧凑面）：三总线音量 / 静观 / 自动上场
## + 音乐出处脚注（原版 musicCreditLine 同行）。prefs 走 SaveStore（user://prefs.json）。
class_name SettingsPanel

var _on_changed: Callable


func open(on_changed: Callable = Callable()) -> void:
	layer = 96
	_on_changed = on_changed
	for c in get_children():
		c.queue_free()
	var dim := ColorRect.new()
	dim.color = Color(Palette.SHADE, 0.6)
	dim.size = Vector2(Layout.W, Layout.H)
	dim.gui_input.connect(func(ev: InputEvent) -> void:
		if ev is InputEventMouseButton and ev.pressed:
			close())
	add_child(dim)
	var panel := Panel.new()
	panel.size = Vector2(520, 460)
	panel.position = Vector2((Layout.W - 520) / 2.0, (Layout.H - 460) / 2.0)
	# 夜宴底覆写：默认 Panel 中性灰 + CheckBox/HSlider 深底不可见（色板红线）
	# 漆面材质化（FxAtlas.panel_box）：宣纸纤维 × 深蓝 × 金线，与三大浮层同源
	panel.add_theme_stylebox_override("panel", FxAtlas.panel_box(Color(Palette.INK[900], 0.97), Color(Palette.GILT["base"], 0.5)))
	dim.add_child(panel)
	var prefs: Dictionary = SaveStore.load_prefs()
	var title := _lbl("设 置", 30, Palette.GILT["light"], Sess.seal_font)
	title.position = Vector2(0, 26)
	title.size = Vector2(520, 44)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(title)
	var y := 96.0
	for row: Array in [["音乐音量", "volBgm", "BGM"], ["音效音量", "volSfx", "SFX"], ["界面音量", "volUi", "UI"]]:
		var l := _lbl(String(row[0]), 18, Palette.PAPER[200])
		l.position = Vector2(40, y + 4)
		panel.add_child(l)
		var sl := HSlider.new()
		sl.min_value = 0.0
		sl.max_value = 1.0
		sl.step = 0.05
		sl.value = float(prefs[row[1]])
		sl.position = Vector2(150, y)
		sl.size = Vector2(280, 24)
		# 滑杆色板化：默认灰轨在夜蓝底上不可辨
		var grab := StyleBoxFlat.new()
		grab.bg_color = Palette.GILT["light"]
		grab.set_corner_radius_all(0)
		grab.content_margin_left = 10
		grab.content_margin_right = 10
		grab.content_margin_top = 4
		grab.content_margin_bottom = 4
		sl.add_theme_stylebox_override("grabber_area", grab)
		var grab_h := grab.duplicate()
		grab_h.bg_color = Palette.GILT["base"]
		sl.add_theme_stylebox_override("grabber_area_highlight", grab_h)
		var rail := StyleBoxFlat.new()
		rail.bg_color = Color(Palette.INK[700], 0.9)
		rail.content_margin_left = 1
		rail.content_margin_right = 1
		rail.content_margin_top = 4
		rail.content_margin_bottom = 4
		sl.add_theme_stylebox_override("slider", rail)
		var bus_name := String(row[2])
		sl.value_changed.connect(func(v: float) -> void:
			prefs[row[1]] = v
			AudioServer.set_bus_volume_db(AudioServer.get_bus_index(bus_name), linear_to_db(v)))
		panel.add_child(sl)
		y += 52.0
	for row2: Array in [["静观模式（去震屏与冲击）", "calm"], ["买入后自动上场", "autoDeploy"]]:
		var cb := CheckBox.new()
		cb.text = String(row2[0])
		cb.button_pressed = bool(prefs[row2[1]])
		cb.position = Vector2(40, y)
		cb.add_theme_font_override("font", Sess.body_font)
		cb.add_theme_font_size_override("font_size", 16)
		cb.add_theme_color_override("font_color", Palette.PAPER[200])
		# 复选框色板化：默认勾选态白底在深底上刺眼、未选态边框不可见
		var cbx := StyleBoxFlat.new()
		cbx.bg_color = Color(Palette.INK[850], 0.95)
		cbx.border_color = Color(Palette.INK[300], 0.8)
		cbx.set_border_width_all(1)
		cbx.set_corner_radius_all(0)
		cbx.content_margin_left = 2
		cbx.content_margin_right = 2
		cbx.content_margin_top = 2
		cbx.content_margin_bottom = 2
		cb.add_theme_stylebox_override("normal", cbx)
		var cbh := cbx.duplicate()
		cbh.border_color = Palette.GILT["light"]
		cb.add_theme_stylebox_override("hover", cbh)
		var cbp := cbx.duplicate()
		cbp.bg_color = Palette.GILT["light"]
		cbp.border_color = Palette.GILT["light"]
		cb.add_theme_stylebox_override("pressed", cbp)
		var cbk := cbx.duplicate()
		cbk.bg_color = Palette.GILT["base"]
		cbk.border_color = Palette.GILT["base"]
		cb.add_theme_stylebox_override("checked", cbk)
		var cbkh := cbk.duplicate()
		cbkh.border_color = Palette.GILT["light"]
		cb.add_theme_stylebox_override("checked_hover", cbkh)
		var cbkp := cbk.duplicate()
		cbkp.bg_color = Palette.GILT["light"]
		cb.add_theme_stylebox_override("checked_pressed", cbkp)
		cb.toggled.connect(func(on: bool) -> void: prefs[row2[1]] = on)
		panel.add_child(cb)
		y += 44.0
	var note := _lbl("改动即时生效并随面板关闭落盘", 14, Palette.PAPER[500])
	note.position = Vector2(40, y + 8)
	panel.add_child(note)
	var credit := _lbl(MusicTracks.credit_line(), 13, Palette.PAPER[500])
	credit.position = Vector2(40, y + 30)
	panel.add_child(credit)
	var done := Button.new()
	done.text = "完 成"
	done.position = Vector2(180, 396)
	done.custom_minimum_size = Vector2(160, 44)
	done.add_theme_font_override("font", Sess.body_font)
	done.add_theme_font_size_override("font_size", 20)
	done.add_theme_color_override("font_color", Palette.PAPER[100])
	done.pressed.connect(close)
	panel.add_child(done)
	_prefs = prefs


var _prefs: Dictionary = {}


func close() -> void:
	if not _prefs.is_empty():
		SaveStore.save_prefs(_prefs)
		if _on_changed.is_valid():
			_on_changed.call(_prefs)
	for c in get_children():
		c.queue_free()


func _lbl(text: String, size: int, color: Color, font = null) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font if font != null else Sess.body_font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
