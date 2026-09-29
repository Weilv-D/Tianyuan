extends CanvasLayer
## DebugConsole（DEV-only Ctrl+~，DebugConsole.ts 对齐版）：只读态 + 实验命令面。
## 纪律（TS 同源）：作弊注入一律用 randi()/randf()（非确定源），绝不碰对局 Rng ——
## 消费对局随机流会改写后续商店/掉落，破坏实机调试的可复现性。
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
	_panel.size = Vector2(720, 500)
	_panel.position = Vector2((Layout.W - 720) / 2.0, (Layout.H - 500) / 2.0)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.INK[900], 0.96)
	sb.border_color = Palette.GILT["base"]
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(0)
	_panel.add_theme_stylebox_override("panel", sb)
	add_child(_panel)
	var title := _lbl("实验控制台（仅调试版本）", 16, Palette.GILT["light"], Sess.seal_font)
	title.position = Vector2(0, 6)
	title.size = Vector2(720, 26)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_panel.add_child(title)
	# 命令按钮 4×3（TS 九命令 + 关闭）
	var cmds: Array = [
		["gold", "+50 金"], ["level", "+1 级"], ["hpPlus", "+20 生命"], ["comp", "随机 2★"],
		["all2", "备战席全 2★"], ["items", "满袋装备"], ["legend", "天命 3★"], ["skip", "快进到底"],
		["reset", "清场"],
	]
	for i: int in cmds.size():
		var cid := String(cmds[i][0])
		var b := Button.new()
		b.text = String(cmds[i][1])
		b.position = Vector2(20 + (i % 4) * 174, 44 + (i / 4) * 50)
		b.custom_minimum_size = Vector2(160, 42)
		b.add_theme_font_override("font", Sess.body_font)
		b.add_theme_font_size_override("font_size", 16)
		b.add_theme_color_override("font_color", Palette.PAPER[100])
		b.focus_mode = Control.FOCUS_NONE
		b.pressed.connect(func() -> void: _handle(cid))
		_panel.add_child(b)
	_text = Label.new()
	_text.position = Vector2(20, 210)
	_text.size = Vector2(680, 220)
	_text.add_theme_font_override("font", Sess.body_font)
	_text.add_theme_font_size_override("font_size", 14)
	_text.add_theme_color_override("font_color", Palette.PAPER[200])
	_panel.add_child(_text)
	var hint := _lbl("快捷键：Ctrl+~ 唤起/关闭", 13, Palette.PAPER[400])
	hint.position = Vector2(20, 458)
	_panel.add_child(hint)
	var close := Button.new()
	close.text = "关闭"
	close.position = Vector2(590, 448)
	close.custom_minimum_size = Vector2(100, 36)
	close.add_theme_font_override("font", Sess.body_font)
	close.add_theme_font_size_override("font_size", 15)
	close.add_theme_color_override("font_color", Palette.PAPER[100])
	close.pressed.connect(toggle)
	_panel.add_child(close)


func _handle(id: String) -> void:
	if _host == null:
		return
	var m: Match = _host.get("match_ref")
	if m == null:
		return
	var p := m.human()
	match id:
		"gold":
			p["gold"] = float(p["gold"]) + 50.0
		"level":
			# 等级上限读 Spec 真源（曾硬编码 9，spec 调 MAX_LEVEL 时 DEV 命令会写出越界等级）
			p["level"] = mini(int(Spec.c("MAX_LEVEL", 9)), int(p["level"]) + 1)
		"hpPlus":
			p["hp"] = minf(Spec.c("PLAYER_START_HP"), float(p["hp"]) + 20.0)
		"comp":
			# 非对局随机（randi 白名单仅 DEV 面）：不碰对局 Rng
			var pool: Array = Spec.champions
			var c0: Dictionary = pool[randi() % pool.size()]
			var slot := -1
			for i: int in (p["bench"] as Array).size():
				if p["bench"][i] == null:
					slot = i
					break
			if slot >= 0:
				p["bench"][slot] = GameState.create_unit(c0["id"], 2)
		"all2":
			for i: int in (p["bench"] as Array).size():
				var c1: Dictionary = Spec.champions[(i * 7) % Spec.champions.size()]
				p["bench"][i] = GameState.create_unit(c1["id"], 2)
		"legend":
			var five: Variant = null
			for c2: Dictionary in Spec.champions:
				if int(c2["cost"]) == 5:
					five = c2
					break
			if five == null:
				five = Spec.champions[0]
			for i: int in (p["board"] as Array).size():
				p["board"][i] = null
			for i2: int in (p["bench"] as Array).size():
				p["bench"][i2] = null
			for i3: int in 3:
				p["bench"][i3] = GameState.create_unit(five["id"], 2)
			GameState.resolve_merges(p)
			var merged: Variant = null
			for b in p["bench"]:
				if b != null and int(b["star"]) == 3:
					merged = b
					break
			if merged != null:
				var dst := -1
				for i4: int in (p["board"] as Array).size():
					if p["board"][i4] == null:
						dst = i4
						break
				var bi2 := (p["bench"] as Array).find(merged)
				p["bench"][bi2] = null
				p["board"][dst] = merged
			else:
				# 兜底：未合成出 3★（兜底不可达，但防负索引写备战末格——GD 负索引不报错）
				push_warning("legend: 未合成出 3★（bench<3 或同名池不足）")
		"items":
			# 满袋：按 MAX_ITEMS_PER_UNIT 分发（TS 同源纪律——超发会在 stripItems 时撑爆器匣）
			var bag: Array = ["xuanjia", "moren", "lingzhu", "yunlv", "xueyu", "fafu"]
			var given := 0
			for slot2: Variant in p["bench"]:
				if slot2 == null:
					continue
				var n := mini(Inventory.MAX_ITEMS_PER_UNIT, bag.size() - given)
				if n <= 0:
					break
				for j: int in n:
					(slot2["items"] as Array).append(bag[given + j])
				given += n
			for j2: int in range(given, bag.size()):
				(p["items"] as Array).append(bag[j2])
		"skip":
			# 快进到底：beginRound→settleRound→endRound 循环（不进战斗演出）
			var guard := 0
			while not m.is_over() and guard < 60:
				m.begin_round()
				m.settle_round()
				m.end_round()
				guard += 1
		"reset":
			for i5: int in (p["board"] as Array).size():
				p["board"][i5] = null
			for i6: int in (p["bench"] as Array).size():
				p["bench"][i6] = null
			(p["items"] as Array).clear()
	if _host.has_method("refresh_all"):
		_host.call("refresh_all")
	SaveStore.save_match(m)
	_refresh()


func _refresh() -> void:
	if _host == null:
		return
	var m: Match = _host.get("match_ref")
	if m == null:
		return
	var lines: Array = [
		"== 百战天元 · 夜宴 DEV ==",
		"seed=%d  rngState=%d" % [m.seed, m.rng.state],
		"round=%d  phase=%s  mode=%s" % [m.round, m.phase, m.mode],
		"pool 余量=%d" % m.pool.total_remaining(),
		"pairings=%d  snapshots=%d  log=%d" % [m.pairings.size(), m.battle_snapshots.size(), m.log.size()],
		"",
	]
	var i := 0
	for pl: Dictionary in m.players:
		var ai_arch := "-" if pl["ai"] == null else str(pl["ai"]["arch"])
		lines.append("%d %-9s hp=%-4g gold=%-3g lv%d %s %s streak=%d %s" % [
			i, str(pl["name"]).substr(0, 9), float(pl["hp"]), float(pl["gold"]), int(pl["level"]),
			"存活" if pl["alive"] else "淘汰", ai_arch, int(pl["streak"]), "锁店" if pl["shopLocked"] else ""])
		i += 1
	_text.text = "\n".join(lines)


func _lbl(text: String, size: int, color: Color, font = null) -> Label:
	# 形制库薄包装（六处散点构造收敛——2026-09-29 审查；本地签名保持不变以不动调用面）
	var l := Artifacts.label(text, size, color)
	if font != null:
		l.add_theme_font_override("font", font)
	return l
