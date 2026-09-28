extends Node2D
## 战斗演出场景（BattleScene.ts 对齐版，M3 首批核心面：settle-then-replay）。
## 判定已在 GameScene 无头完成；本场景用同一 config 重建 Battle 内核逐事件重演：
## start/spawn → 视图；move → hopTo；attackStart → play_attack；damage/heal/shield →
## 飘字与条同步；death → 溶解；end → 结算面板（不自动关）→ 返回 Game。
## 完整 FxKind 粒子/弹道/震屏/左右阵容面板登记 M3 次批。

const DT := 1.0 / 30.0
const BATTLE_BOARD_SCALE := 1.25
const BATTLE_BOARD_LX := 560.0
const BATTLE_BOARD_LY := 108.0

var match_ref: Match
var battle: Battle
var viewer_team := 1
var views := {}  # uid -> UnitView
var board_view: BoardView
var float_layer: Node2D
var acc := 0.0
var speed := 1.0
var finished := false
var tick_label: Label


func _ready() -> void:
	match_ref = Sess.scene_data.get("match", null)
	var pair: Dictionary = Sess.scene_data.get("pair", {})
	var config: Dictionary = Sess.scene_data.get("config", {})
	if match_ref == null or config.is_empty():
		Sess.go("res://render/menu.tscn")
		return
	position = Vector2(Layout.W / 2.0, Layout.H / 2.0)
	_draw_bg()

	board_view = BoardView.new()
	board_view.battle_mode = true
	board_view.position = Vector2(BATTLE_BOARD_LX, BATTLE_BOARD_LY)
	board_view.scale = Vector2(BATTLE_BOARD_SCALE, BATTLE_BOARD_SCALE)
	add_child(board_view)

	float_layer = Node2D.new()
	float_layer.z_index = 50
	add_child(float_layer)

	tick_label = _label("", 22, Palette.PAPER[300])
	tick_label.position = Vector2(Layout.W / 2.0 - 60, 66)
	add_child(tick_label)

	viewer_team = 1 if match_ref.player_idx_of_team(pair, 1) == 0 else 0

	# 重建内核（观察者模式逐事件驱动演出；渲染永不改变结果）
	battle = Battle.new(config, Callable(_on_event), true)
	for u in battle.units:
		_spawn_view(u)
	# start 事件在构造期已发 —— 视图血条立即同步一轮
	_sync_all()


func _draw_bg() -> void:
	var bg := ColorRect.new()
	bg.color = Palette.INK[950]
	bg.position = Vector2(-Layout.W, -Layout.H) / 2.0
	bg.size = Vector2(Layout.W, Layout.H)
	bg.z_index = -10
	add_child(bg)


func _process(delta: float) -> void:
	if finished:
		return
	acc += minf(0.05, delta) * speed
	var steps := 0
	while acc >= DT and steps < 8:
		battle.step()
		acc -= DT
		steps += 1
	_sync_all()
	tick_label.text = "%.1f" % (float(battle.tick) / 30.0)
	if Input.is_action_just_pressed("ui_accept"):
		speed = 1.0 if speed > 1.0 else 4.0


func _cell_pos(u) -> Vector2:
	return board_view.position + board_view.cell_center(u.cell.x, u.cell.y) * BATTLE_BOARD_SCALE


func _spawn_view(u) -> void:
	var v := UnitView.new()
	var team := int(u.team)
	v.uid = int(u.uid)
	v.setup(u.entry["id"], team, int(u.star), u.is_minion and u.entry.get("id", "") != "" and _is_beast_uid(u))
	v.friendly = team == viewer_team
	if team == 1:
		v._hp_bar.color = Palette.TEAM_COLOR[1]
	v.place(_cell_pos(u))
	v.z_index = 30 + u.cell.y * 2
	add_child(v)
	views[int(u.uid)] = v


func _is_beast_uid(u) -> bool:
	# 墨兽标记由 config.units[].monster 承载（Unit 从 monster 建 is_minion）
	return u.is_minion


func _sync_all() -> void:
	for u in battle.units:
		var v: UnitView = views.get(int(u.uid), null)
		if v == null:
			continue
		v.position = _cell_pos(u)
		v.z_index = 30 + u.cell.y * 2
		if not u.alive and v.modulate.a > 0.5:
			v.play_death()
		elif u.alive:
			v.sync_bars(u.hp, u.max_hp, u.mp, u.max_mp, u.shield)


func _on_event(e: Dictionary) -> void:
	var t := String(e.get("t", ""))
	match t:
		"spawn":
			for u in battle.units:
				if int(u.uid) == int(e.get("uid", -1)) and not views.has(int(u.uid)):
					_spawn_view(u)
		"move":
			var v0: UnitView = views.get(int(e.get("uid", -1)), null)
			if v0 != null:
				v0.hop_to(_cell_pos(_unit(e)), float(e.get("dur", 0.3)))
		"attackStart":
			var v1: UnitView = views.get(int(e.get("uid", -1)), null)
			if v1 != null:
				var tgt = _unit_by_uid(int(e.get("targetUid", -1)))
				var dir := 1.0
				if tgt != null:
					dir = signf(float(tgt.cell.x - _unit(e).cell.x))
					if dir == 0.0:
						dir = 1.0
				v1.play_attack(dir, float(e.get("windup", 0.2)))
		"damage":
			var v2: UnitView = views.get(int(e.get("targetUid", -1)), null)
			if v2 != null:
				v2.play_hit()
			_float_text(e, e.get("amount", 0.0), _dmg_color(e))
			Sess.blip("SFX", 300.0 + randf_range(0.0, 40.0), 0.05, 0.12)
		"heal":
			_float_text(e, e.get("amount", 0.0), Palette.SPIRIT["light"], "+")
		"shield":
			_float_text(e, e.get("amount", 0.0), Palette.MOON["light"], "+")
		"death":
			var v3: UnitView = views.get(int(e.get("uid", -1)), null)
			if v3 != null:
				v3.play_death()
			Sess.blip("SFX", 150.0, 0.12, 0.14)
		"end":
			finished = true
			_on_battle_end()


func _unit(e: Dictionary):
	return _unit_by_uid(int(e.get("uid", -1)))


func _unit_by_uid(uid: int):
	for u in battle.units:
		if int(u.uid) == uid:
			return u
	return null


func _dmg_color(e: Dictionary) -> Color:
	if bool(e.get("crit", false)):
		return Palette.DAMAGE_COLOR["crit"]
	match String(e.get("type", "physical")):
		"magic":
			return Palette.DAMAGE_COLOR["magic"]
		"true":
			return Palette.DAMAGE_COLOR["true"]
	return Palette.DAMAGE_COLOR["physical"]


func _float_text(e: Dictionary, amount: float, color: Color, prefix: String = "") -> void:
	var u = _unit_by_uid(int(e.get("targetUid", e.get("uid", -1))))
	if u == null:
		return
	var l := Label.new()
	l.text = "%s%d" % [prefix, int(amount)]
	l.add_theme_font_override("font", Sess.body_font)
	l.add_theme_font_size_override("font_size", 20 if not bool(e.get("crit", false)) else 26)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Palette.INK[950])
	l.add_theme_constant_override("outline_size", 4)
	l.position = _cell_pos(u) + Vector2(-10, -90)
	l.z_index = 60
	float_layer.add_child(l)
	var tw := l.create_tween()
	tw.set_parallel(true)
	tw.tween_property(l, "position:y", l.position.y - 34.0, 0.8).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_property(l, "modulate:a", 0.0, 0.8).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.chain().tween_callback(l.queue_free)


func _on_battle_end() -> void:
	# 判定已结算（GameScene）；这里只做 endRound + 存档 + 结算面板
	match_ref.end_round()
	SaveStore.save_match(match_ref)
	await get_tree().create_timer(0.6).timeout
	var winner_raw: Variant = battle.result.get("winner", null)
	var winner: int = -1 if winner_raw == null else int(winner_raw)
	var layer := CanvasLayer.new()
	layer.layer = 95
	add_child(layer)
	var dim := ColorRect.new()
	dim.color = Color(Palette.SHADE, 0.6)
	dim.size = Vector2(Layout.W, Layout.H)
	layer.add_child(dim)
	var panel := Panel.new()
	panel.size = Vector2(560, 300)
	panel.position = Vector2((Layout.W - 560) / 2.0, (Layout.H - 300) / 2.0)
	dim.add_child(panel)
	var title_txt := "胜" if winner == viewer_team else ("败" if winner >= 0 else "平")
	var title := _label(title_txt, 64, Palette.GILT["light"] if winner == viewer_team else Palette.CINNABAR["light"], Sess.seal_font)
	title.position = Vector2(0, 30)
	title.size = Vector2(560, 90)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(title)
	var sub := _label("第 %d 回合 · %d ticks" % [match_ref.round, battle.tick], 20, Palette.PAPER[300])
	sub.position = Vector2(0, 130)
	sub.size = Vector2(560, 30)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(sub)
	var back := Button.new()
	back.text = "返 回"
	back.position = Vector2(190, 210)
	back.custom_minimum_size = Vector2(180, 46)
	back.add_theme_font_override("font", Sess.body_font)
	back.add_theme_font_size_override("font_size", 24)
	back.add_theme_color_override("font_color", Palette.PAPER[100])
	back.focus_mode = Control.FOCUS_NONE
	back.pressed.connect(func() -> void:
		var pending := match_ref.is_over() or not match_ref.human()["alive"]
		Sess.go("res://render/result.tscn" if pending else "res://render/game_scene.tscn", { "match": match_ref }))
	panel.add_child(back)


func _label(text: String, size: int, color: Color, font = null) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font if font != null else Sess.body_font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
