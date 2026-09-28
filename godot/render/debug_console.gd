extends CanvasLayer
## DebugConsole（DEV-only Ctrl+~，DebugConsole.ts 对齐版 · M3 次批只读态）：
## 对局内核态一览（种子/游标/回合/卡池/玩家快照）。命令面登记次批。
class_name DebugConsole

var _panel: Panel
var _text: Label
var _host: Node2D


func setup(host: Node2D) -> void:
	_host = host
	layer = 200
	visible = false


func toggle() -> void:
	if _panel == null:
		_build()
	visible = not visible
	if visible:
		_refresh()


func _build() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(560, 420)
	_panel.position = Vector2(24, 120)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.INK[950], 0.92)
	sb.border_color = Palette.GILT["deep"]
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(0)
	_panel.add_theme_stylebox_override("panel", sb)
	add_child(_panel)
	_text = Label.new()
	_text.position = Vector2(14, 12)
	_text.size = Vector2(532, 396)
	_text.add_theme_font_override("font", Sess.body_font)
	_text.add_theme_font_size_override("font_size", 14)
	_text.add_theme_color_override("font_color", Palette.PAPER[200])
	_panel.add_child(_text)


func _refresh() -> void:
	if _host == null or not _host.has_method("human"):
		return
	var m = _host
	var lines: Array = [
		"== 百战天元 · 夜宴 DEV ==",
		"seed=%d  rngState=%d" % [m.seed, m.rng.state],
		"round=%d  phase=%s  mode=%s" % [m.round, m.phase, m.mode],
		"pool 余量=%d / 满池" % m.pool.total_remaining(),
		"pairings=%d  snapshots=%d  log=%d" % [m.pairings.size(), m.battle_snapshots.size(), m.log.size()],
		"",
	]
	var i := 0
	for p: Dictionary in m.players:
		var ai_arch := "-" if p["ai"] == null else str(p["ai"]["arch"])
		lines.append("%d %-9s hp=%-4g gold=%-3g lv%d %s %s streak=%d %s" % [
			i, str(p["name"]).substr(0, 9), float(p["hp"]), float(p["gold"]), int(p["level"]),
			"存活" if p["alive"] else "淘汰", ai_arch, int(p["streak"]), "锁店" if p["shopLocked"] else ""])
		i += 1
	_text.text = "\n".join(lines)
