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
var fx_layer: EffectsLayer
var acc := 0.0
var speed := 1.0
var _shake_tw: Tween
var finished := false
var tick_label: Label
var speed_buttons: Array = []


func _update_speed_buttons() -> void:
	for i: int in speed_buttons.size():
		var b: Button = speed_buttons[i]
		b.modulate = Color.WHITE if absf(speed - [1.0, 2.0, 4.0][i]) < 0.01 else Color(1, 1, 1, 0.45)


func _ready() -> void:
	match_ref = Sess.scene_data.get("match", null)
	var pair: Dictionary = Sess.scene_data.get("pair", {})
	var config: Dictionary = Sess.scene_data.get("config", {})
	if match_ref == null or config.is_empty():
		Sess.go("res://render/menu.tscn")
		return
	# 根在原点：子元素用设计绝对坐标（棋盘 BATTLE_BOARD_LX=(1920-800)/2 等），与
	# game_scene 同律（曾误设根居中致整体偏移，2026-09-29 排查实证修复）
	_draw_bg()

	board_view = BoardView.new()
	board_view.battle_mode = true
	board_view.position = Vector2(BATTLE_BOARD_LX, BATTLE_BOARD_LY)
	board_view.scale = Vector2(BATTLE_BOARD_SCALE, BATTLE_BOARD_SCALE)
	add_child(board_view)

	float_layer = Node2D.new()
	float_layer.z_index = 50
	add_child(float_layer)

	fx_layer = EffectsLayer.new()
	fx_layer.z_index = 20
	board_view.add_child(fx_layer)

	tick_label = _label("", 22, Palette.PAPER[300])
	tick_label.position = Vector2(Layout.W / 2.0 - 60, 66)
	add_child(tick_label)

	# 倍速按钮（原版 speedBtns 1×/2×/4×；空格切换保留）
	for i: int in 3:
		var sv: float = [1.0, 2.0, 4.0][i]
		var sb := Button.new()
		sb.text = "%d×" % int(sv)
		sb.position = Vector2(1560 + i * 90, 52)
		sb.custom_minimum_size = Vector2(80, 30)
		sb.add_theme_font_override("font", Sess.body_font)
		sb.add_theme_font_size_override("font_size", 14)
		sb.add_theme_color_override("font_color", Palette.PAPER[100])
		sb.focus_mode = Control.FOCUS_NONE
		sb.pressed.connect(func() -> void:
			speed = sv
			Sess.sfx.play("ui")
			_update_speed_buttons())
		speed_buttons.append(sb)
		add_child(sb)
	_update_speed_buttons()

	viewer_team = 1 if match_ref.player_idx_of_team(pair, 1) == 0 else 0

	# 重建内核（观察者模式逐事件驱动演出；渲染永不改变结果）
	battle = Battle.new(config, Callable(_on_event), true)
	for u in battle.units:
		_spawn_view(u)
	# start 事件在构造期已发 —— 视图血条立即同步一轮
	_sync_all()
	# 左右羁绊面板（TS renderMatchTraitPanel 口径：config.traits 每队激活羁绊；
	# 此前 1920 宽下战斗两侧大片空置）
	_build_trait_panels(config)
	# 开战低吟（原版 BattleScene 交战瞬间 warn；BGM battle 心境已由 Sess.go 路由）
	Sess.sfx.play("warn")


func _build_trait_panels(cfg: Dictionary) -> void:
	var traits_cfg: Dictionary = cfg.get("traits", {})
	var foe := 1 if viewer_team == 0 else 0
	_build_one_trait_panel(Vector2(40, 130), "我 方", _team_name(viewer_team), Palette.SPIRIT["base"], traits_cfg.get(str(viewer_team), []))
	_build_one_trait_panel(Vector2(1460, 130), "敌 方", _team_name(foe), Palette.CINNABAR["base"], traits_cfg.get(str(foe), []))


func _team_name(team: int) -> String:
	for q: Dictionary in match_ref.pairings:
		if int(q["a"]) == team or int(q["b"]) == team:
			var idx := match_ref.player_idx_of_team(q, team)
			if idx >= 0 and idx < (match_ref.players as Array).size():
				return String(match_ref.players[idx]["name"])
	return ""


func _build_one_trait_panel(pos: Vector2, title: String, who: String, accent: Color, traits: Array) -> void:
	var t1 := _label(title, 17, Palette.PAPER[100])
	t1.position = pos
	add_child(t1)
	var t2 := _label(who, 12, accent)
	t2.position = pos + Vector2(72, 5)
	add_child(t2)
	var y := pos.y + 34
	var active: Array = traits.filter(func(t): return int(t.get("tier", -1)) >= 0)
	active.sort_custom(func(a, b): return int(a["tier"]) > int(b["tier"]))
	if active.is_empty():
		var none := _label("（未激活任何羁绊）", 12, Palette.INK[300])
		none.position = Vector2(pos.x, y)
		add_child(none)
		return
	for t: Dictionary in active:
		var def: Variant = Spec.traits_by_id.get(String(t["id"]), null)
		if def == null:
			continue
		var tier := mini(int(t["tier"]), 3)
		var chip := _label("【%s】" % String(def["name"]), 13, Palette.TRAIT_TIER_COLOR[tier])
		chip.position = Vector2(pos.x, y)
		add_child(chip)
		var cnt := _label("%d　第%d档" % [int(t["count"]), tier + 1], 12, Palette.PAPER[100])
		cnt.position = Vector2(pos.x + 84, y + 2)
		add_child(cnt)
		y += 28
		var eff: Array = def.get("effectText", [])
		if tier < eff.size():
			var eff_l := _label(String(eff[tier]), 12, Palette.PAPER[300])
			eff_l.position = Vector2(pos.x + 10, y)
			eff_l.size = Vector2(400, 200)
			eff_l.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
			add_child(eff_l)
			y += 46


func _draw_bg() -> void:
	var bg := ColorRect.new()
	bg.color = Palette.INK[950]
	bg.position = Vector2.ZERO
	bg.size = Vector2(Layout.W, Layout.H)
	bg.z_index = -10
	add_child(bg)


func _process(delta: float) -> void:
	if finished:
		return
	# 震屏：累加器换算位移脉冲（对齐 TS shake(90+shake*90, 0.0022*shake) 的收敛节奏）
	var shake_v: float = fx_layer.take_shake()
	if shake_v > 0.0:
		# 连震先杀旧 tween：多条 tween 同写根 position 会互相争夺（终值兜底也救不回节奏）
		if _shake_tw != null and _shake_tw.is_valid():
			_shake_tw.kill()
			position = Vector2.ZERO
		var amp: float = minf(14.0, 2.0 + shake_v * 3.0)
		_shake_tw = create_tween()
		_shake_tw.tween_method(func(t: float) -> void:
			position = Vector2(randf_range(-amp, amp), randf_range(-amp, amp)) * (1.0 - t), 0.0, 1.0, minf(0.32, 0.09 + shake_v * 0.09))
		_shake_tw.tween_callback(func() -> void: position = Vector2.ZERO)
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
		Sess.sfx.play("ui")
		_update_speed_buttons()


func _cell_pos(u) -> Vector2:
	return board_view.position + board_view.cell_center(u.cell.x, u.cell.y) * BATTLE_BOARD_SCALE


func _spawn_view(u) -> void:
	var v := UnitView.new()
	var team := int(u.team)
	v.uid = int(u.uid)
	v.setup(u.entry["id"], team, int(u.star), u.is_minion and u.entry.get("id", "") != "" and _is_beast_uid(u))
	v.friendly = team == viewer_team
	# 敌我恒色（原版口径）：viewer 视角的友军夜蓝/敌军朱砂——swap 局原始 team 会反置
	v._hp_bar.color = Palette.TEAM_COLOR[0] if v.friendly else Palette.TEAM_COLOR[1]
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
		if v == null or not is_instance_valid(v):
			continue
		if u.alive:
			# 位移补间（hop/攻击突进）持有 position 期间不硬写：逐帧覆写会把演出压成瞬移
			if v.busy == 0:
				v.position = _cell_pos(u)
			v.z_index = 30 + u.cell.y * 2
			v.sync_bars(u.hp, u.max_hp, u.mp, u.max_mp, u.shield)
		else:
			# 阵亡即除名：play_death 尾声 queue_free 后字典残留引用会在下一帧崩掉整个同步
			views.erase(int(u.uid))
			if v.modulate.a > 0.5:
				v.play_death()


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
				# 弹道音贴「命中瞬间」（原版口径）：起手后 windup 秒触发；倍速排水期不响
				if bool(e.get("isRanged", false)) and speed <= 1.0:
					var windup := float(e.get("windup", 0.2))
					get_tree().create_timer(maxf(0.0, windup)).timeout.connect(func() -> void:
						# is_instance_valid 前置：场景已释放时对 freed self 调 is_inside_tree 本身即崩
						if is_instance_valid(self) and is_inside_tree() and not finished and speed <= 1.0:
							Sess.sfx.play("shoot"))
		"damage":
			var v2: UnitView = views.get(int(e.get("targetUid", -1)), null)
			if v2 != null:
				v2.play_hit()
			var crit := bool(e.get("crit", false))
			var dmg_kind := String(e.get("kind", ""))
			var tier: String = "crit" if crit else ("skill" if dmg_kind == "skill" else "normal")
			var dmg_c := _dmg_color(e)
			if dmg_kind == "true":
				tier = "true"
				dmg_c = Palette.DAMAGE_COLOR["true"]
			_float_text(e, e.get("amount", 0.0), dmg_c, "", tier)
			# 命中特效：普攻 impact（crit 参数），法伤走 hue=2
			var fx_src = _unit_by_uid(int(e.get("uid", -1)))
			if fx_src != null:
				var tgt_fx = _unit_by_uid(int(e.get("targetUid", -1)))
				var fpos: Vector2 = board_view.cell_center(tgt_fx.cell.x, tgt_fx.cell.y) if tgt_fx != null else Vector2.ZERO
				fx_layer.play({ "kind": "impact", "pos": fpos, "tint": dmg_c,
					"params": { "crit": 1.0 if crit else 0.0, "hue": 2.0 if String(e.get("type", "")) == "magic" else 0.0 } })
		"heal":
			_float_text(e, e.get("amount", 0.0), Palette.SPIRIT["light"], "+", "heal")
			if speed <= 1.0:
				Sess.sfx.play("heal")
		"shield":
			_float_text(e, e.get("amount", 0.0), Palette.MOON["light"], "+", "heal")
			if speed <= 1.0:
				Sess.sfx.play("shield")
		"castStart":
			# 施法起手音（演出本体走 fx 事件；此处对齐原版 castStart 的 cast 音）
			if speed <= 1.0:
				Sess.sfx.play("cast")
		"cast":
			# 五费大招走 skillBig，其余 cast（原版同档）
			if speed <= 1.0:
				var cu = _unit_by_uid(int(e.get("uid", -1)))
				if cu != null and int(cu.entry["cost"]) >= 5:
					Sess.sfx.play("skillBig")
				else:
					Sess.sfx.play("cast")
		"death":
			var v3: UnitView = views.get(int(e.get("uid", -1)), null)
			if v3 != null:
				v3.play_death()
			if e.has("cell"):
				fx_layer.play({ "kind": "burst", "pos": _cell_local(e["cell"]), "radius": float(e.get("radius", 1.0)), "tint": Palette.INK[300] })
			if speed <= 1.0:
				Sess.sfx.play("death")
		"fx":
			_play_fx(e)
		"projectile":
			_play_projectile(e)
		"end":
			finished = true
			_on_battle_end()


## fx 事件 → effects_layer（pos = 棋盘层局部；cell/targetUid 二选一）
func _play_fx(e: Dictionary) -> void:
	var pos: Vector2
	if e.has("cell"):
		var c: Dictionary = e["cell"]
		pos = _cell_local_xy(int(c.get("c", 0)), int(c.get("r", 0)))
	elif e.has("targetUid"):
		var tgt0 = _unit_by_uid(int(e["targetUid"]))
		if tgt0 == null:
			return
		pos = board_view.cell_center(tgt0.cell.x, tgt0.cell.y) + Vector2(0, -26)
	else:
		var src0 = _unit_by_uid(int(e.get("uid", -1)))
		if src0 == null:
			return
		pos = board_view.cell_center(src0.cell.x, src0.cell.y) + Vector2(0, -26)
	var req := { "kind": String(e.get("kind", "")), "pos": pos, "radius": float(e.get("radius", 1.0)), "tint": e.get("tint", null) }
	var params_in: Dictionary = e.get("params", {})
	if not params_in.is_empty():
		req["params"] = params_in
	fx_layer.play(req)


## 弹道（arrow/bolt/orb → 线束/光点推进）
func _play_projectile(e: Dictionary) -> void:
	var src = _unit_by_uid(int(e.get("uid", -1)))
	var tgt = _unit_by_uid(int(e.get("targetUid", -1)))
	if src == null or tgt == null:
		return
	# 局部系（board_view 子节点 fx_layer 用）/ 根空间系（float_layer 无缩放）双轨：
	# bolt 挂根空间必须乘 BATTLE_BOARD_SCALE 并加 board_view.position，与 _cell_pos 同式
	var la := board_view.cell_center(src.cell.x, src.cell.y) + Vector2(0, -30)
	var lb := board_view.cell_center(tgt.cell.x, tgt.cell.y) + Vector2(0, -26)
	var a := board_view.position + la * BATTLE_BOARD_SCALE
	var b := board_view.position + lb * BATTLE_BOARD_SCALE
	var dur: float = maxf(0.08, float(e.get("dur", 0.2)))
	var color := Palette.MOON["light"] if String(e.get("kind", "")) == "arrow" else Palette.SPIRIT["light"]
	var bolt := Node2D.new()
	bolt.z_index = 55
	bolt.position = a
	var dot := EffectsLayer._Fx.new()
	dot.kind = 1
	dot.color = Color(color, 0.95)
	dot.radius = 4.0
	bolt.add_child(dot)
	float_layer.add_child(bolt)
	var tw := bolt.create_tween()
	tw.tween_method(func(t: float) -> void:
		bolt.position = a.lerp(b, t), 0.0, 1.0, dur)
	tw.tween_callback(bolt.queue_free)
	fx_layer._spark(la, lb, 2.0, dur * 1000.0 + 60.0, color, 0.5)


func _cell_local(cell: Dictionary) -> Vector2:
	return _cell_local_xy(int(cell.get("c", 0)), int(cell.get("r", 0)))


func _cell_local_xy(c: int, r: int) -> Vector2:
	return board_view.cell_center(c, r)


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


func _float_text(e: Dictionary, amount: float, color: Color, prefix: String = "", tier := "normal") -> void:
	var u = _unit_by_uid(int(e.get("targetUid", e.get("uid", -1))))
	if u == null:
		return
	# 分级参数（DamageText.ts：size/rise/life/pop；dot 两级 16px）
	var size := 20
	var rise := 34.0
	var life := 0.72
	var pop := 1.15
	match tier:
		"crit":
			size = 32
			rise = 46.0
			life = 0.9
			pop = 1.7
		"skill":
			size = 26
			rise = 40.0
			life = 0.82
			pop = 1.35
		"true":
			size = 26
			rise = 42.0
			life = 0.86
			pop = 1.4
		"heal":
			size = 22
			rise = 40.0
			life = 0.8
		"dotBurn", "dotBleed":
			size = 16
			rise = 26.0
			life = 0.62
			pop = 1.05
	var l := Label.new()
	l.text = "%s%d" % [prefix, int(amount)]
	l.add_theme_font_override("font", Sess.body_font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Palette.INK[950])
	l.add_theme_constant_override("outline_size", 4)
	l.position = _cell_pos(u) + Vector2(-10 + randf_range(-6.0, 6.0), -90)
	l.z_index = 60
	l.pivot_offset = Vector2(8, 12)
	l.scale = Vector2(pop, pop)
	float_layer.add_child(l)
	var tw := l.create_tween()
	tw.set_parallel(true)
	tw.tween_property(l, "position:y", l.position.y - rise, life).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_property(l, "scale", Vector2.ONE, 0.09).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(l, "modulate:a", 0.0, life * 0.45).set_delay(life * 0.55).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.chain().tween_callback(l.queue_free)


func _on_battle_end() -> void:
	# 判定已结算（GameScene）；这里只做 endRound + 存档 + 战报统计带回 + 结算面板
	match_ref.end_round()
	SaveStore.save_match(match_ref)
	_dump_battle_stats()
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
	var sub := _label("第 %d 回合 · %.1f 秒" % [match_ref.round, float(battle.tick) / 30.0], 20, Palette.PAPER[300])
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
		if match_ref.is_over():
			# 终局直跳也要补 end_round（快照 + 冠军 rank1 + phase over）
			match_ref.end_round()
			Sess.go("res://render/result.tscn", { "match": match_ref })
		else:
			# 非终局（含阵亡）一律回 game_scene 走 _after_settle 战报链：
			# 阵亡由面板「继续」分流道消层，end_round 不在此跳过
			Sess.go("res://render/game_scene.tscn", { "match": match_ref, "from_battle": true }))
	panel.add_child(back)


## 战报统计带回：双方每单位的输出三色（物理/法术/真伤）与存活态
func _dump_battle_stats() -> void:
	var units_out: Array = []
	for u in battle.units:
		units_out.append({
			"uid": int(u.uid), "defId": u.entry["id"], "name": u.entry["name"],
			"team": int(u.team), "star": int(u.star), "alive": u.alive,
			"physical": float(u.dealt_by_type.get("physical", 0.0)),
			"magic": float(u.dealt_by_type.get("magic", 0.0)),
			"true": float(u.dealt_by_type.get("true", 0.0)),
		})
	Sess.scene_data["battle_stats"] = units_out


func _label(text: String, size: int, color: Color, font = null) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font if font != null else Sess.body_font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
