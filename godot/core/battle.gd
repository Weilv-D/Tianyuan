## 战斗内核（src/core/battle.ts 的 GDScript 逐句对齐版）。
## 设计契约：1) 完全无头（零渲染/时钟 API）；2) 完全确定（同 seed+同输入 ⇒ 逐帧一致事件流）；
## 3) 固定步长 30Hz。跨引擎一致性由 tools/parity_check 的战斗对拍门禁守护。
##
## 数值语义纪律（改动前必读）：
## - 取整一律 ParityUtil.js_round（JS floor(x+0.5)），禁用 round()
## - 除法显式 float 化（GDScript int/int 是整除，TS 是浮点除）
## - 排序：单键排序用 stable_sort_by（JS 稳定序等价）；含 uid 决胜的比较器可直接 sort_custom
## - 钩子注册顺序 = 羁绊 id 字典序 → 装备（items_core 固定序），SHIELD_CAP 谁先吃满依赖此序
class_name Battle
extends RefCounted

const TICK_RATE := 30
const DT := 1.0 / 30.0
const OVERTIME_START_TICK := 30 * TICK_RATE
# DoT/领域结算间隔：从 Spec 推导（与 TS max(1, round(TICK_RATE / DOT_TICKS_PER_SEC)) 同式），
# 不落字面量——DOT_TICKS_PER_SEC 调档时间隔与 dt 双真源脱节
static var EFFECT_INTERVAL := maxi(1, int(round(float(TICK_RATE) / Spec.c("DOT_TICKS_PER_SEC", 2.0))))

const CONTROL_KINDS: Array = ["stun", "silence", "disarm", "slow", "taunt"]
const STACKABLE_KINDS: Array = ["aspdUp", "atkUp", "armorUp", "mrUp", "dr"]

var rng: Rng
var tick := 0
var units: Array = []
var events: Array = []

var _hooks := {}
var _sorted_teams: Array = []
var _occ := PackedInt32Array()
var _zones: Array = []
var _scheduled: Array = []
## 待复活占位（uid → 归属队）：checkEnd 见"一方清零但仍有未兑现复活"时不判胜负
var _pending_revives := {}
var _seq := 0
var _next_uid := 1
var _zone_id := 1
var _sink: Callable = Callable()
var _record_events := true
var _max_ticks := 0

var finished := false
var result: Dictionary = {}
## 输入校验失败标记：非法输入整场拒步进（对齐 TS throw 上抛后「无可玩战斗」）
var _invalid := false


func _bad_input(msg: String) -> void:
	_invalid = true
	units.clear()
	# 步进循环以 finished 为出口：非法输入立刻终局，防驱动方死循环
	finished = true
	result = { "winner": -1, "ticks": 0, "timeout": false, "survivors": [], "remainingHpRatio": 0.0 }
	push_error(msg)

# 热路径常量缓存（Spec 一次性读取）
var _mana_per_attack := 10.0
var _mana_from_damage_ratio := 32.0
var _mana_from_damage_cap := 15.0
var _mana_regen_per_sec := 2.0
var _mana_lock_after_cast := 0.5
var _cast_windup := 0.35
var _attack_windup_ratio := 0.38
var _retarget_interval := 0.4
var _shield_cap_ratio := 0.45
var _resist_base := 100.0
var _timeout_win_ratio := 0.02


func _init(cfg: Dictionary, sink: Callable = Callable(), record_events: bool = true) -> void:
	Spec.ensure()
	_cache_cfg()
	rng = Rng.new(int(cfg["seed"]))
	_sink = sink
	_record_events = record_events
	_max_ticks = int(cfg.get("maxTicks", 0))
	if _max_ticks <= 0:
		_max_ticks = int(Spec.mech("battleTimeoutTicks"))
	_occ.resize(Grid.COLS * Grid.ROWS)
	_occ.fill(-1)

	# 1) 建单位（uid 升序）。输入校验同 TS：非法输入整场拒建（TS 为 throw 上抛；
	# GDScript 无异常系统，push_error 置 _invalid 并中止建场——双端对非法输入都不产出可玩战斗）
	var inputs: Array = (cfg.get("units", []) as Array).duplicate()
	# 排序比较器对缺 uid 键容错（0 哨兵保序），逐条拒绝在校验循环内做
	inputs.sort_custom(func(a, b):
		return int(a.get("uid", 0)) < int(b.get("uid", 0)))
	var seen_uid := {}
	for input: Dictionary in inputs:
		if not ParityUtil.js_is_int(input.get("uid", null)):
			_bad_input("战斗输入非整数 uid: %s（%s）" % [str(input.get("uid")), str(input.get("defId"))])
			return
		var cell_d: Dictionary = input.get("cell", {})
		if not ParityUtil.js_is_int(cell_d.get("c", null)) or not ParityUtil.js_is_int(cell_d.get("r", null)):
			_bad_input("战斗输入非整数格: (%s,%s) %s" % [str(cell_d.get("c")), str(cell_d.get("r")), str(input.get("defId"))])
			return
		var uid := int(input["uid"])
		if seen_uid.has(uid):
			_bad_input("战斗输入重复 uid: %d（%s）" % [uid, str(input.get("defId"))])
			return
		seen_uid[uid] = true
		var c := int(cell_d["c"])
		var r := int(cell_d["r"])
		if not Grid.in_bounds(c, r):
			_bad_input("战斗输入越界格: (%d,%d) %s" % [c, r, str(input.get("defId"))])
			return
		var i := Grid.cell_index(c, r)
		if _occ[i] != -1:
			_bad_input("战斗输入重叠格: (%d,%d) %s 与 uid %d 冲突" % [c, r, str(input.get("defId")), _occ[i]])
			return
		var u := Unit.create(input)
		if u == null:
			_bad_input("战斗输入含无法构造的单位: %s" % str(input.get("defId")))
			return
		units.append(u)
		_next_uid = maxi(_next_uid, u.uid + 1)
		_occ[i] = u.uid

	# 2) 羁绊（按队伍升序，先数值后钩子）
	var teams := {}
	for u: Unit in units:
		teams[u.team] = true
	var team_list: Array = teams.keys()
	team_list.sort()
	for team: int in team_list:
		if not _hooks.has(team):
			_hooks[team] = _create_hooks()
	_sorted_teams = _hooks.keys().duplicate()
	_sorted_teams.sort()
	var traits_cfg: Dictionary = cfg.get("traits", {})
	for team: int in team_list:
		var team_units := _team_units_of(team)
		Traits.apply_traits(self, team, traits_cfg.get(str(team), []), team_units)

	# 2.5) 装备：状态修正进 trait（与羁绊叠加），行为钩子进队伍 hooks
	for team: int in team_list:
		var team_units := _team_units_of(team)
		for u: Unit in team_units:
			ItemFx.apply_item_mods(u, u.item_ids)
		ItemFx.apply_item_hooks(self, team, team_units)

	# 3) 开场钩子（刺客跳后排、天庭护盾、护卫护盾…）
	for team: int in team_list:
		for fn: Callable in _hooks[team]["onBattleStart"]:
			fn.call(self, team)

	var spawn: Array = []
	for u: Unit in units:
		spawn.append({
			"uid": u.uid, "defId": String(u.entry["id"]), "team": u.team, "star": u.star,
			"cell": Grid.cell_dict(u.cell), "maxHp": u.max_hp, "hp": u.hp,
		})
	emit({"t": "start", "tick": 0, "units": spawn})


func _cache_cfg() -> void:
	_mana_per_attack = Spec.c("MANA_PER_ATTACK", 10.0)
	_mana_from_damage_ratio = Spec.c("MANA_FROM_DAMAGE_RATIO", 32.0)
	_mana_from_damage_cap = Spec.c("MANA_FROM_DAMAGE_CAP", 15.0)
	_mana_regen_per_sec = Spec.c("MANA_REGEN_PER_SEC", 2.0)
	_mana_lock_after_cast = Spec.c("MANA_LOCK_AFTER_CAST", 0.5)
	_cast_windup = Spec.c("CAST_WINDUP_SECONDS", 0.35)
	_attack_windup_ratio = Spec.c("ATTACK_WINDUP_RATIO", 0.38)
	_retarget_interval = Spec.c("RETARGET_INTERVAL", 0.4)
	_shield_cap_ratio = Spec.c("SHIELD_CAP_RATIO", 0.45)
	_resist_base = Spec.c("RESIST_BASE", 100.0)
	_timeout_win_ratio = Spec.c("TIMEOUT_WIN_RATIO", 0.02)


func _create_hooks() -> Dictionary:
	return {
		"onBattleStart": [], "onTick": [], "onPreAttack": [], "onAttackHit": [],
		"onDamageDealt": [], "onIncomingDamage": [], "onDamageTaken": [],
		"onKill": [], "onDeath": [], "onCast": [], "onShieldBreak": [], "onHealOverflow": [],
	}


func _team_units_of(team: int) -> Array:
	var out := []
	for u: Unit in units:
		if u.team == team:
			out.append(u)
	return out


# ───────────────── 事件 ─────────────────

func emit(e: Dictionary) -> void:
	if _record_events:
		events.append(e)
	if _sink.is_valid():
		_sink.call(e)


func fx(kind: String, opts: Dictionary) -> void:
	var e := {"t": "fx", "tick": tick, "kind": kind}
	for k: String in ["uid", "cell", "targetUid", "radius", "team", "params"]:
		if opts.has(k) and opts[k] != null:
			e[k] = opts[k]
	emit(e)


# ───────────────── 查询 ─────────────────

func unit_by_uid(uid: int) -> Unit:
	for u: Unit in units:
		if u.uid == uid:
			return u
	return null


func alive_units() -> Array:
	var out := []
	for u: Unit in units:
		if u.alive:
			out.append(u)
	return out


func allies_of(u: Unit) -> Array:
	var out := []
	for x: Unit in units:
		if x.alive and x.team == u.team:
			out.append(x)
	return out


func enemies_of(u: Unit) -> Array:
	var out := []
	for x: Unit in units:
		if x.alive and x.team != u.team:
			out.append(x)
	return out


func hooks_of(team: int) -> Dictionary:
	var h: Dictionary = _hooks.get(team, null)
	if h == null:
		h = _create_hooks()
		_hooks[team] = h
		_sorted_teams = _hooks.keys().duplicate()
		_sorted_teams.sort()
	return h


func enemy_teams_of(team: int) -> Array:
	var out := []
	for t: int in _hooks.keys():
		if t != team:
			out.append(t)
	out.sort()
	return out


func occupied(c: int, r: int) -> bool:
	if not Grid.in_bounds(c, r):
		return true
	return _occ[Grid.cell_index(c, r)] != -1


func unit_at(c: int, r: int) -> Unit:
	if not Grid.in_bounds(c, r):
		return null
	var uid := _occ[Grid.cell_index(c, r)]
	if uid == -1:
		return null
	return unit_by_uid(uid)


func units_in_radius(center: Vector2i, radius: float, team: Variant = null) -> Array:
	var out := []
	for u: Unit in units:
		if not u.alive:
			continue
		if team != null and u.team != int(team):
			continue
		if Grid.chebyshev(u.cell, center) <= radius:
			out.append(u)
	return out


func overtime_amp() -> float:
	if tick < OVERTIME_START_TICK:
		return 0.0
	return (float(tick - OVERTIME_START_TICK) / float(TICK_RATE)) * Spec.mech("overtimeAmpPerSec")


# ───────────────── 目标选择 ─────────────────

func resolve_targets(u: Unit, mode: String, count: int = 1) -> Array:
	var enemies := []
	for x: Unit in units:
		if x.is_targetable() and x.team != u.team:
			enemies.append(x)
	var allies := []
	for x: Unit in units:
		if x.alive and x.team == u.team:
			allies.append(x)
	match mode:
		"self":
			return [u]
		"currentTarget":
			var t: Unit = unit_by_uid(u.target_uid)
			if t != null and t.alive:
				return [t]
			return _pick_nearest_enemy(u)
		"enemyNearest":
			return _pick_nearest_enemy(u)
		"enemyLowestHp":
			return _slice_by(enemies, func(x): return x.hp / x.max_hp, count)
		"enemyHighestAtk":
			return _slice_by(enemies, func(x): return -x.eff_atk(), count)
		"enemyFarthest":
			return _slice_by(enemies, func(x): return -float(Grid.chebyshev(x.cell, u.cell)), count)
		"allyLowestHp":
			return _slice_by(allies, func(x): return x.hp / x.max_hp, count)
		"allAllies":
			return allies
		"allEnemies":
			return enemies
		"deadAlly":
			var out := []
			for x: Unit in units:
				if not x.alive and x.team == u.team and not x.is_minion:
					out.append(x)
			return out
		"enemyDensest":
			var cell := _densest_enemy_cell(u, 1)
			return _slice_by(enemies, func(x): return float(Grid.chebyshev(x.cell, cell)), count)
		"enemyHalfBoard":
			var cell2 := _enemy_half_board_cell(u)
			return _slice_by(enemies, func(x): return float(Grid.chebyshev(x.cell, cell2)), count)
		"enemyLongestLine":
			var cell3 := _longest_line_endpoint(u)
			var dir_c: int = sign(cell3.x - u.cell.x)
			var dir_r: int = sign(cell3.y - u.cell.y)
			var along := func(c: Vector2i) -> float:
				var dc := c.x - u.cell.x
				var dr := c.y - u.cell.y
				var on_line := 1
				if dir_c == 0 and dir_r == 0:
					on_line = 0
				elif dir_c != 0 and dir_r != 0:
					on_line = 0 if (dc * dir_c == dr * dir_r and dc * dir_c > 0) else 1
				elif dir_c != 0:
					on_line = 0 if (dr == 0 and dc * dir_c > 0) else 1
				else:
					on_line = 0 if (dc == 0 and dr * dir_r > 0) else 1
				return float(on_line * 100 + Grid.chebyshev(c, u.cell))
			return _slice_by(enemies, func(x): return along.call(x.cell), count)
		_:
			return []


func _slice_by(list: Array, key_fn: Callable, count: int) -> Array:
	var sorted: Array = ParityUtil.stable_sort_by(list, key_fn)
	return sorted if count >= sorted.size() else sorted.slice(0, count)


## 最近敌人：BFS 距离场（隔人墙不误判）；嘲讽优先；平局取小 uid
func _pick_nearest_enemy(u: Unit) -> Array:
	var enemies := []
	for x: Unit in units:
		if x.is_targetable() and x.team != u.team:
			enemies.append(x)
	if enemies.is_empty():
		return []
	var field := _distance_field(u)
	var best: Unit = null
	var best_d := INF
	for e: Unit in enemies:
		var d: float = field[Grid.cell_index(e.cell.x, e.cell.y)]
		if d < 0:
			# 目标格被自身占据，取周围最小可达距离（固定邻居顺序）
			d = INF
			for off: Vector2i in [Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(0, 1),
					Vector2i(-1, -1), Vector2i(1, -1), Vector2i(-1, 1), Vector2i(1, 1)]:
				var c := e.cell.x + off.x
				var r := e.cell.y + off.y
				if not Grid.in_bounds(c, r):
					continue
				var v: float = field[Grid.cell_index(c, r)]
				if v >= 0 and v < d:
					d = v
		if d < 0:
			d = 999.0
		var taunted := false
		for s: Status in e.statuses:
			if s.kind == "taunt":
				taunted = true
				break
		var score: float = d - 100.0 if taunted else d
		if score < best_d or (score == best_d and best != null and e.uid < best.uid):
			best_d = score
			best = e
	return [best] if best != null else []


func _distance_field(u: Unit) -> PackedFloat32Array:
	var dist := PackedFloat32Array()
	dist.resize(Grid.COLS * Grid.ROWS)
	dist.fill(-1.0)
	var start_idx := Grid.cell_index(u.cell.x, u.cell.y)
	dist[start_idx] = 0.0
	var queue := PackedInt32Array()
	queue.resize(Grid.COLS * Grid.ROWS)
	var head := 0
	var tail := 0
	queue[tail] = start_idx
	tail += 1
	while head < tail:
		var cur := queue[head]
		head += 1
		var cc := cur % Grid.COLS
		var cr := (cur - cc) / Grid.COLS
		var d: float = dist[cur]
		for i: int in 8:
			var off: Vector2i = Grid.NEIGHBOR_OFFSETS[i]
			var nc := cc + off.x
			var nr := cr + off.y
			if not Grid.in_bounds(nc, nr):
				continue
			var ni := Grid.cell_index(nc, nr)
			if dist[ni] != -1.0:
				continue
			var occ_uid := _occ[ni]
			if occ_uid != -1 and occ_uid != u.uid:
				continue
			dist[ni] = d + 1.0
			queue[tail] = ni
			tail += 1
	return dist


func resolve_target_cell(u: Unit, mode: String) -> Vector2i:
	match mode:
		"self":
			return u.cell
		"enemyDensest":
			return _densest_enemy_cell(u, 1)
		"enemyHalfBoard":
			return _enemy_half_board_cell(u)
		"enemyLongestLine":
			return _longest_line_endpoint(u)
		_:
			var targets: Array = resolve_targets(u, mode, 1)
			return targets[0].cell if not targets.is_empty() else u.cell


func _densest_enemy_cell(u: Unit, radius: int) -> Vector2i:
	var foes := []
	for x: Unit in units:
		if x.is_targetable() and x.team != u.team:
			foes.append(x)
	if foes.is_empty():
		return u.cell
	return densest(foes, radius)


func _enemy_half_board_cell(u: Unit) -> Vector2i:
	var foes := []
	for x: Unit in units:
		if x.is_targetable() and x.team != u.team:
			foes.append(x)
	if foes.is_empty():
		return u.cell
	var sc := 0.0
	var sr := 0.0
	for f: Unit in foes:
		sc += float(f.cell.x)
		sr += float(f.cell.y)
	var n := float(foes.size())
	return Vector2i(int(ParityUtil.js_round(sc / n)), int(ParityUtil.js_round(sr / n)))


func _longest_line_endpoint(u: Unit) -> Vector2i:
	var foes := []
	for x: Unit in units:
		if x.is_targetable() and x.team != u.team:
			foes.append(x)
	if foes.is_empty():
		return u.cell
	var dirs: Array = [Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(0, 1),
		Vector2i(-1, -1), Vector2i(1, -1), Vector2i(-1, 1), Vector2i(1, 1)]
	var best_dir: Vector2i = dirs[0]
	var best_count := -1
	var best_dist := INF
	for d: Vector2i in dirs:
		var count := 0
		var dist := INF
		for i: int in range(1, 9):
			var c := u.cell.x + d.x * i
			var r := u.cell.y + d.y * i
			if not Grid.in_bounds(c, r):
				break
			for f: Unit in foes:
				if f.cell.x == c and f.cell.y == r:
					count += 1
					if i < dist:
						dist = float(i)
		if count > best_count or (count == best_count and dist < best_dist):
			best_count = count
			best_dist = dist
			best_dir = d
	var c := u.cell.x
	var r := u.cell.y
	for i: int in range(1, 9):
		var nc := u.cell.x + best_dir.x * i
		var nr := u.cell.y + best_dir.y * i
		if not Grid.in_bounds(nc, nr):
			break
		c = nc
		r = nr
	return Vector2i(c, r)


# ───────────────── 数值结算 ─────────────────

func roll_skill_crit(src: Unit) -> bool:
	return rng.chance(minf(1.0, src.tstate.skill_crit_chance))


func deal_damage(src, dst: Unit, raw: float, type: String, opts: Dictionary = {}) -> float:
	# NaN/Infinity 是数据污染立即终止；非正数是合法空操作
	if not dst.alive:
		return 0.0
	if not ParityUtil.js_finite(raw):
		push_error("非法伤害值: %s（src=%d dst=%d）" % [str(raw), src.uid if src != null else -1, dst.uid])
		return 0.0
	if raw <= 0.0:
		return 0.0
	var source: String = opts.get("source", "skill")

	# 无敌在数值与随机结算之前短路（不掷骰、不进抗性链、不触发任何钩子）
	var invuln := false
	for s: Status in dst.statuses:
		if s.kind == "invuln":
			invuln = true
			break
	if invuln:
		if not opts.get("silent", false):
			emit({
				"t": "damage", "tick": tick,
				"srcUid": src.uid if src != null else -1, "dstUid": dst.uid,
				"amount": 0.0, "type": type, "crit": false, "kill": false, "source": source,
			})
		return 0.0

	var amount: float = raw * (1.0 + (src.damage_amp if src != null else 0.0)) * (1.0 + overtime_amp())

	# 暴击唯一结算点（调用方已决则 forceCrit 传入，只乘倍率不再掷骰）
	var crit := false
	var caller_decided: bool = opts.get("forceCrit", null) == true
	var can_crit: bool = caller_decided or opts.get("canCrit", null) == true
	if src != null and can_crit:
		crit = caller_decided or rng.chance(maxf(0.0, src.crit_chance))
		if crit:
			amount *= src.crit_mult
	elif src != null and not caller_decided and opts.get("canCrit", null) != true \
			and source == "skill" and src.tstate.skill_crit_chance > 0.0:
		var cd: Variant = opts.get("critDecided", null)
		crit = bool(cd) if cd != null else rng.chance(minf(1.0, src.tstate.skill_crit_chance))
		if crit:
			amount *= src.tstate.skill_crit_mult if src.tstate.skill_crit_mult > 0.0 else src.crit_mult

	# 易伤
	var vuln := 0.0
	for s: Status in dst.statuses:
		if s.kind == "vulnerability":
			vuln += s.value
	amount *= 1.0 + vuln / 100.0

	# 抗性
	if type == "physical":
		var armor := dst.eff_armor()
		if src != null:
			armor *= 1.0 - minf(0.85, src.tstate.armor_pen)
		amount *= _resist_base / (_resist_base + armor)
		amount *= 1.0 - minf(0.9, dst.tstate.physical_dr)
	elif type == "magic":
		amount *= _resist_base / (_resist_base + dst.eff_mr())
		amount *= 1.0 - minf(0.9, dst.tstate.magic_dr)

	# 通用减伤：真伤按契约无视抗性与减伤（易伤仍生效）
	if type != "true":
		var dr := dst.tstate.all_dr
		for s: Status in dst.statuses:
			if s.kind == "dr":
				dr += s.value / 100.0
		amount *= 1.0 - minf(0.9, dr)
	if amount < 0.0:
		amount = 0.0

	# 真伤单跳上限（抗性/减伤之后、护盾之前；处决跳豁免）
	if type == "true" and not opts.get("ignoreTrueCap", false) and Spec.mech("trueHitCapRatio") > 0.0:
		var cap := dst.max_hp * Spec.mech("trueHitCapRatio")
		if amount > cap:
			amount = cap

	# 伤害重定向：扣血前确定份额，派生伤害延后到本次命中完整结算后执行
	var incoming := {"amount": amount, "deferred": []}
	var h_dst: Dictionary = _hooks.get(dst.team, {})
	for fn: Callable in h_dst.get("onIncomingDamage", []):
		fn.call(self, dst, src, incoming, type, opts)
	amount = maxf(0.0, incoming["amount"])

	# 护盾吸收（含状态同步与破盾钩子）
	var absorbed := 0.0
	if dst.shield > 0.0:
		absorbed = minf(dst.shield, amount)
		dst.shield -= absorbed
		amount -= absorbed
		emit({"t": "shield", "tick": tick, "uid": dst.uid, "amount": -absorbed, "total": dst.shield})
		if absorbed > 0.0 and dst.shield > 0.001:
			for s: Status in dst.statuses:
				if s.kind == "shield":
					s.value = dst.shield
					break
		if dst.shield <= 0.001:
			dst.shield = 0.0
			var n := dst.statuses.size()
			var kept := []
			for s: Status in dst.statuses:
				if s.kind != "shield":
					kept.append(s)
			dst.statuses = kept
			if dst.statuses.size() != n:
				emit({"t": "status", "tick": tick, "uid": dst.uid, "kind": "shield", "dur": 0.0, "value": 0.0, "added": false})
			for fn: Callable in h_dst.get("onShieldBreak", []):
				fn.call(self, dst)

	# 有效伤害口径：只计真正被移除的量（生命扣到 0 即止）——吸血/反弹/统计三通道放大防线
	var before := dst.hp
	dst.hp = maxf(0.0, dst.hp - amount)
	var hp_loss := before - dst.hp
	var final := hp_loss + absorbed

	dst.taken_damage += final
	if src != null:
		src.dealt_damage += final
	dst.taken_by_type[type] = float(dst.taken_by_type.get(type, 0.0)) + final
	if src != null:
		src.dealt_by_type[type] = float(src.dealt_by_type.get(type, 0.0)) + final
	dst.absorbed_damage += absorbed

	# 受击回蓝（护盾吸收额计入 final 是有意口径）
	var mana_gain := minf(
		_mana_from_damage_cap,
		(final / dst.max_hp) * _mana_from_damage_ratio * dst.tstate.mana_from_damage_mult)
	if not dst.is_minion and dst.mana_lock <= 0.0 and mana_gain > 0.0:
		dst.mp = minf(dst.max_mp, dst.mp + mana_gain)
		emit({"t": "mana", "tick": tick, "uid": dst.uid, "mp": dst.mp, "maxMp": dst.max_mp})

	# 吸血：普攻 = 普吸+全吸；其余伤害只吃全吸
	if src != null and final > 0.0:
		var pct: float = (src.lifesteal + src.omnivamp) if opts.get("isAttack", false) == true else src.omnivamp
		if pct > 0.0:
			heal(src, src, final * pct)

	var kill := dst.hp <= 0.0
	if not opts.get("silent", false):
		emit({
			"t": "damage", "tick": tick,
			"srcUid": src.uid if src != null else -1, "dstUid": dst.uid,
			"amount": ParityUtil.js_round(final), "type": type, "crit": crit, "kill": kill, "source": source,
		})

	var h_src: Dictionary = _hooks.get(src.team if src != null else -1, {})
	if src != null:
		for fn: Callable in h_src.get("onDamageDealt", []):
			fn.call(self, src, dst, final, type, source)
	for fn: Callable in h_dst.get("onDamageTaken", []):
		fn.call(self, dst, src, final, type, opts)

	if kill:
		_kill_unit(dst, src)
	for apply: Callable in incoming["deferred"]:
		apply.call()
	return final


func heal(src, dst: Unit, amount: float) -> float:
	if not dst.alive:
		return 0.0
	if not ParityUtil.js_finite(amount):
		push_error("非法治疗值: %s（src=%d dst=%d）" % [str(amount), src.uid if src != null else -1, dst.uid])
		return 0.0
	if amount <= 0.0:
		return 0.0
	var amt: float = amount * (1.0 + ((src.tstate.heal_amp) if src != null else 0.0))
	if tick >= OVERTIME_START_TICK:
		amt *= Spec.mech("overtimeSustainFactor")
	var wound := 0.0
	for s: Status in dst.statuses:
		if s.kind == "wound":
			wound += s.value
	amt *= 1.0 - minf(0.9, wound / 100.0)
	var before := dst.hp
	dst.hp = minf(dst.max_hp, dst.hp + amt)
	var healed := dst.hp - before
	var overflow := maxf(0.0, amt - healed)
	# 记账：dst 记收治；src 仅异体时记产出（自奶双记会虚高一倍）
	dst.healed += healed
	if src != null and src != dst:
		src.healed += healed
	if healed > 0.5:
		emit({"t": "heal", "tick": tick, "srcUid": src.uid if src != null else -1, "dstUid": dst.uid, "amount": ParityUtil.js_round(healed)})
	if overflow > 0.5:
		for fn: Callable in _hooks.get(dst.team, {}).get("onHealOverflow", []):
			fn.call(self, dst, src, overflow)
	return healed


## 护盾口径：unit.shield 为当前总量；shield 事件 amount=增量 total=总量；状态 value 存总量；
## 续盾=刷新（时长取大者，数值并入）。alreadySustained：加时衰减只允许吃一次。
func add_shield(src, dst: Unit, amount: float, dur: float, opts: Dictionary = {}) -> void:
	if not dst.alive:
		return
	if not ParityUtil.js_finite(amount) or not ParityUtil.js_finite(dur):
		push_error("非法护盾参数: amount=%s dur=%s" % [str(amount), str(dur)])
		return
	if amount <= 0.0:
		return
	var sustain := 1.0
	if not opts.get("alreadySustained", false) and tick >= OVERTIME_START_TICK:
		sustain = Spec.mech("overtimeSustainFactor")
	var amt: float = amount * (1.0 + ((src.tstate.shield_amp) if src != null else 0.0)) * sustain
	var before := dst.shield
	dst.shield = minf(dst.shield + amt, dst.max_hp * _shield_cap_ratio)
	var added := dst.shield - before
	var existing: Status = null
	for s: Status in dst.statuses:
		if s.kind == "shield":
			existing = s
			break
	if existing != null:
		existing.ticks = maxi(existing.ticks, int(ParityUtil.js_round(dur * TICK_RATE)))
		existing.value = dst.shield
	else:
		var s := Status.new()
		s.kind = "shield"
		s.ticks = int(ParityUtil.js_round(dur * TICK_RATE))
		s.value = dst.shield
		s.src_uid = src.uid if src != null else -1
		dst.statuses.append(s)
	emit({"t": "shield", "tick": tick, "uid": dst.uid, "amount": ParityUtil.js_round(added), "total": ParityUtil.js_round(dst.shield)})
	emit({"t": "status", "tick": tick, "uid": dst.uid, "kind": "shield", "dur": dur, "value": ParityUtil.js_round(dst.shield), "added": true})


func add_status(src: Unit, dst: Unit, kind: String, dur: float, value: float, src_tag: String = "") -> void:
	if not dst.alive:
		return
	if not ParityUtil.js_finite(dur) or not ParityUtil.js_finite(value):
		push_error("非法状态参数: dur=%s value=%s kind=%s" % [str(dur), str(value), kind])
		return
	if CONTROL_KINDS.has(kind) and (dst.cc_immune > 0 or dst.has_status("ccImmune")):
		return
	var ticks := maxi(1, int(ParityUtil.js_round(dur * TICK_RATE)))
	var e := {"t": "status", "tick": tick, "uid": dst.uid, "kind": kind, "dur": dur, "value": value, "added": true}
	if src_tag != "":
		e["src"] = src_tag
	if not STACKABLE_KINDS.has(kind):
		for s: Status in dst.statuses:
			if s.kind == kind:
				s.ticks = maxi(s.ticks, ticks)
				s.value = maxf(s.value, value)
				s.src_uid = src.uid
				if src_tag != "":
					s.src = src_tag
				emit(e)
				return
	var s := Status.new()
	s.kind = kind
	s.ticks = ticks
	s.value = value
	s.src_uid = src.uid
	s.src = src_tag
	dst.statuses.append(s)
	emit(e)


func remove_status(u: Unit, kind: String) -> void:
	var kept := []
	for s: Status in u.statuses:
		if s.kind != kind:
			kept.append(s)
	u.statuses = kept
	emit({"t": "status", "tick": tick, "uid": u.uid, "kind": kind, "dur": 0.0, "value": 0.0, "added": false})


## 只摘除该 kind 的一条（最旧叠层）：burn/bleed 多条共存时「净化一个减益」的语义
func remove_one_status(u: Unit, kind: String) -> void:
	var idx := -1
	for i: int in u.statuses.size():
		if (u.statuses[i] as Status).kind == kind:
			idx = i
			break
	if idx < 0:
		return
	u.statuses.remove_at(idx)
	emit({"t": "status", "tick": tick, "uid": u.uid, "kind": kind, "dur": 0.0, "value": 0.0, "added": false})


func add_dot(src: Unit, dst: Unit, kind: String, dps: float, dur: float, type: String) -> void:
	if not dst.alive:
		return
	if not ParityUtil.js_finite(dps) or not ParityUtil.js_finite(dur):
		push_error("非法 DoT 参数: dps=%s dur=%s" % [str(dps), str(dur)])
		return
	if dps <= 0.0:
		return
	# 结算类型随状态走（burn=法术、bleed 由调用方定），tickDots 不按 kind 硬编码
	var s := Status.new()
	s.kind = kind
	s.ticks = int(ParityUtil.js_round(dur * TICK_RATE))
	s.value = dps
	s.src_uid = src.uid
	s.dtype = type
	dst.statuses.append(s)
	emit({"t": "status", "tick": tick, "uid": dst.uid, "kind": kind, "dur": dur, "value": ParityUtil.js_round(dps), "added": true})
	emit({"t": "fx", "tick": tick, "kind": "burnTick" if kind == "burn" else "bleedTick", "uid": dst.uid})


# ───────────────── 位移 / 召唤 / 复活 ─────────────────

func teleport(u: Unit, cell: Vector2i, dur: float) -> void:
	if not u.alive:
		return
	if not Grid.in_bounds(cell.x, cell.y):
		return
	# 落点被占改落就近空格；满盘无空则取消（无条件覆写 occ 会造"幽灵"）
	var dest := cell
	if _occ[Grid.cell_index(cell.x, cell.y)] != -1:
		var free: Variant = _nearest_free_cell_to(cell, 3)
		if free == null:
			return
		dest = free
	var from := u.cell
	_occ[Grid.cell_index(from.x, from.y)] = -1
	u.cell = dest
	_occ[Grid.cell_index(dest.x, dest.y)] = u.uid
	u.move_from = from
	u.move_to = dest
	u.move_valid = true
	u.move_t = 0.0
	u.move_dur = dur
	emit({"t": "blink", "tick": tick, "uid": u.uid, "from": Grid.cell_dict(from), "to": Grid.cell_dict(dest), "dur": dur})


func _nearest_free_cell_to(origin: Vector2i, max_ring: int) -> Variant:
	for ring: int in range(0, max_ring + 1):
		for dr: int in range(-ring, ring + 1):
			for dc: int in range(-ring, ring + 1):
				if maxi(absi(dc), absi(dr)) != ring:
					continue
				var c := origin.x + dc
				var r := origin.y + dr
				if not Grid.in_bounds(c, r):
					continue
				if _occ[Grid.cell_index(c, r)] == -1:
					return Vector2i(c, r)
	return null


func knockback(u: Unit, from: Vector2i, distance: int) -> void:
	if not u.alive:
		return
	var dc: int = sign(u.cell.x - from.x)
	var dr: int = sign(u.cell.y - from.y)
	var i := distance
	while i >= 1:
		var c := u.cell.x + dc * i
		var r := u.cell.y + dr * i
		if Grid.in_bounds(c, r) and _occ[Grid.cell_index(c, r)] == -1:
			teleport(u, Vector2i(c, r), 0.18)
			return
		i -= 1


func summon(src: Unit, cell: Vector2i, hp_pct: float, atk_pct: float) -> Unit:
	# 对象总量阀（含阵亡）：units 整场只增不减
	if units.size() >= 64:
		return null
	if not Grid.in_bounds(cell.x, cell.y):
		return null
	var dest := cell
	if _occ[Grid.cell_index(cell.x, cell.y)] != -1:
		var free: Variant = _nearest_free_cell_to(cell, 3)
		if free == null:
			return null
		dest = free
	var uid := _next_uid
	_next_uid += 1
	var m := Unit.create_minion(uid, src, dest, hp_pct, atk_pct)
	if m == null:
		return null
	units.append(m)
	_occ[Grid.cell_index(dest.x, dest.y)] = uid
	# 中途增援走 spawn（start 契约 = 每局恰一次）
	emit({
		"t": "spawn", "tick": tick,
		"units": [{
			"uid": uid, "defId": String(src.entry["id"]), "team": src.team, "star": 1,
			"cell": Grid.cell_dict(dest), "maxHp": m.max_hp, "hp": m.hp,
		}],
	})
	return m


func revive(u: Unit, hp_pct: float, src: Unit) -> void:
	if u.alive:
		return
	if not ParityUtil.js_finite(hp_pct):
		push_error("非法复活比例: %s（uid=%d）" % [str(hp_pct), u.uid])
		return
	var pct := maxf(0.0, minf(1.0, hp_pct))
	# 复活位置 = 死亡点；先占位后改状态（失败的复活必须保持完整死亡态）
	var anchor: Vector2i = u.death_cell if u.death_cell_valid else src.cell
	var dest: Variant = _nearest_free_cell_to(anchor, 3)
	if dest == null:
		for r: int in Grid.ROWS:
			if dest != null:
				break
			for c: int in Grid.COLS:
				if _occ[Grid.cell_index(c, r)] == -1:
					dest = Vector2i(c, r)
					break
	if dest == null:
		return

	u.alive = true
	u.revived = true
	u.hp = maxf(1.0, ParityUtil.js_round(u.max_hp * pct))
	u.statuses = []
	u.shield = 0.0
	u.mp = u.max_mp
	u.attack_cd = 0.0
	u.windup_left = 0.0
	u.cast_windup_left = 0.0
	u.move_valid = false
	u.move_t = 0.0
	u.move_dur = 0.0
	u.move_cd = 0.0
	u.retarget_cd = 0.0
	u.target_uid = -1
	u.cell = dest
	_occ[Grid.cell_index(dest.x, dest.y)] = u.uid
	emit({"t": "mana", "tick": tick, "uid": u.uid, "mp": u.mp, "maxMp": u.max_mp})
	# 复活复用 heal 事件做表现，统计侧补账
	u.healed += u.hp
	if src != u:
		src.healed += u.hp
	emit({"t": "heal", "tick": tick, "srcUid": src.uid, "dstUid": u.uid, "amount": u.hp})
	emit({
		"t": "spawn", "tick": tick,
		"units": [{
			"uid": u.uid, "defId": String(u.entry["id"]), "team": u.team, "star": u.star,
			"cell": Grid.cell_dict(dest), "maxHp": u.max_hp, "hp": u.hp,
		}],
	})


func add_zone(o: Dictionary) -> void:
	if not ParityUtil.js_finite(float(o["dur"])) or not ParityUtil.js_finite(float(o["dps"])) \
			or not ParityUtil.js_finite(float(o["radius"])) or float(o["radius"]) < 0.0:
		push_error("非法领域参数: dur=%s dps=%s radius=%s" % [str(o["dur"]), str(o["dps"]), str(o["radius"])])
		return
	var st = o.get("status", null)
	if st != null and (not ParityUtil.js_finite(float(st["dur"])) or not ParityUtil.js_finite(float(st["value"]))):
		push_error("非法领域状态参数: dur=%s value=%s" % [str(st["dur"]), str(st["value"])])
		return
	var z := o.duplicate()
	z["id"] = _zone_id
	_zone_id += 1
	z["endsAtTick"] = tick + int(ParityUtil.js_round(float(o["dur"]) * TICK_RATE))
	_zones.append(z)


func schedule(delay_seconds: float, fn: Callable) -> void:
	if not ParityUtil.js_finite(delay_seconds):
		push_error("非法延迟: %s" % str(delay_seconds))
		return
	_scheduled.append({
		"atTick": tick + maxi(1, int(ParityUtil.js_round(delay_seconds * TICK_RATE))),
		"seq": _seq,
		"fn": fn,
	})
	_seq += 1


## 延迟复活专用通道：checkEnd 在复活兑现前不终局
func schedule_revive(u: Unit, delay_seconds: float, hp_pct: float) -> void:
	if not ParityUtil.js_finite(delay_seconds) or not ParityUtil.js_finite(hp_pct):
		push_error("非法复活延迟/比例: %s / %s" % [str(delay_seconds), str(hp_pct)])
		return
	_pending_revives[u.uid] = u.team
	var target_uid := u.uid
	var target := u
	schedule(delay_seconds, func(api):
		_pending_revives.erase(target_uid)
		if not target.alive:
			api.revive(target, hp_pct, target))


# ───────────────── 死亡 ─────────────────

func _kill_unit(u: Unit, killer: Unit) -> void:
	if not u.alive:
		return
	u.hp = 0.0
	u.alive = false
	u.death_cell = u.cell
	u.death_cell_valid = true
	u.shield = 0.0
	u.statuses = []
	u.windup_left = 0.0
	u.cast_windup_left = 0.0
	var idx := Grid.cell_index(u.cell.x, u.cell.y)
	if _occ[idx] == u.uid:
		_occ[idx] = -1
	if killer != null:
		killer.kills += 1
	emit({"t": "death", "tick": tick, "uid": u.uid, "killerUid": killer.uid if killer != null else -1})
	if killer != null:
		for fn: Callable in _hooks.get(killer.team, {}).get("onKill", []):
			fn.call(self, killer, u)
		for h: Callable in killer.kill_handlers:
			h.call(self, u)
	for fn: Callable in _hooks.get(u.team, {}).get("onDeath", []):
		fn.call(self, u, killer)


# ───────────────── 主循环 ─────────────────

func step() -> void:
	if finished or _invalid:
		return
	tick += 1

	# 1) 队伍钩子
	for team: int in _sorted_teams:
		var h: Dictionary = _hooks[team]
		for fn: Callable in h["onTick"]:
			fn.call(self, team, tick)

	# 2) 持续效果先结算末跳，再递减并清理状态
	if tick % EFFECT_INTERVAL == 0:
		_tick_dots()
		_tick_zones()
	_tick_statuses()

	# 3) 延迟任务（按 (tick, seq) 排序保证确定）
	if not _scheduled.is_empty():
		var due: Array = []
		var keep: Array = []
		for t: Dictionary in _scheduled:
			(due if int(t["atTick"]) <= tick else keep).append(t)
		_scheduled = keep
		if not due.is_empty():
			due.sort_custom(func(a, b):
				if int(a["atTick"]) != int(b["atTick"]):
					return int(a["atTick"]) < int(b["atTick"])
				return int(a["seq"]) < int(b["seq"]))
			for t: Dictionary in due:
				(t["fn"] as Callable).call(self)

	# 4) 单位行为（构造即 uid 升序 ⇒ 索引序稳定；奇数 tick 反向遍历抹平先手偏差）
	var count := units.size()
	var reverse := tick % 2 == 1
	for k: int in count:
		var u: Unit = units[count - 1 - k] if reverse else units[k]
		if not u.alive or finished:
			continue
		_update_unit(u)

	# 5) 结算判定
	_check_end()


func _update_unit(u: Unit) -> void:
	# 移动插值推进
	if u.move_dur > 0.0:
		u.move_t += DT
		if u.move_t >= u.move_dur:
			u.move_t = u.move_dur
			u.move_dur = 0.0

	# 回蓝 / 自然回复
	if u.mana_lock > 0.0:
		u.mana_lock -= DT
	elif not u.is_minion:
		u.mp = minf(u.max_mp, u.mp + (_mana_regen_per_sec + u.tstate.mana_per_sec) * DT)
	if u.tstate.hp_regen_pct_per_sec > 0.0 and u.hp < u.max_hp:
		var sustain := Spec.mech("overtimeSustainFactor") if tick >= OVERTIME_START_TICK else 1.0
		u.hp = minf(u.max_hp, u.hp + u.max_hp * u.tstate.hp_regen_pct_per_sec * DT * sustain)

	if u.move_cd > 0.0:
		u.move_cd -= DT
	if u.attack_cd > 0.0:
		u.attack_cd -= DT
	if u.retarget_cd > 0.0:
		u.retarget_cd -= DT

	# 攻击前摇进行中
	if u.windup_left > 0.0:
		u.windup_left -= DT
		if u.windup_left <= 0.0:
			_resolve_attack(u)
		return

	# 吟唱中
	if u.cast_windup_left > 0.0:
		u.cast_windup_left -= DT
		if u.cast_windup_left <= 0.0:
			_resolve_cast(u)
		return

	# 控制判定
	if u.has_status("stun"):
		return

	# 施法
	if not u.is_minion and u.mp >= u.max_mp and not u.has_status("silence"):
		u.cast_windup_left = _cast_windup
		emit({"t": "castStart", "tick": tick, "uid": u.uid, "skillId": String(u.entry["skill"]), "windup": _cast_windup})
		return

	# 选目标
	if u.retarget_cd <= 0.0 or u.target_uid < 0:
		var nearest: Array = _pick_nearest_enemy(u)
		var t: Unit = nearest[0] if not nearest.is_empty() else null
		u.target_uid = t.uid if t != null else -1
		u.retarget_cd = _retarget_interval
		if t == null:
			return
	var target: Unit = unit_by_uid(u.target_uid)
	if target == null or not target.alive:
		u.target_uid = -1
		u.retarget_cd = 0.0
		return

	var dist := Grid.chebyshev(u.cell, target.cell)
	if dist <= u.range:
		if u.attack_cd <= 0.0 and not u.has_status("disarm"):
			_begin_attack(u, target)
		return

	# 移动
	if u.move_cd > 0.0:
		return
	var next: Variant = Grid.step_toward_attack_position(u.cell, target.cell, u.range, func(c: int, r: int):
		return occupied(c, r))
	if next == null:
		u.move_cd = 0.2
		return
	var from := u.cell
	_occ[Grid.cell_index(from.x, from.y)] = -1
	u.cell = next
	_occ[Grid.cell_index(next.x, next.y)] = u.uid
	u.move_from = from
	u.move_to = next
	u.move_valid = true
	u.move_t = 0.0
	u.move_dur = u.eff_move_time()
	u.move_cd = u.move_dur
	emit({"t": "move", "tick": tick, "uid": u.uid, "from": Grid.cell_dict(from), "to": Grid.cell_dict(next), "dur": u.move_dur})


func _begin_attack(u: Unit, target: Unit) -> void:
	var interval := 1.0 / u.eff_aspd()
	var windup := interval * _attack_windup_ratio
	u.attack_cd = interval
	u.windup_left = windup
	u.windup_total = windup
	u.windup_target_uid = target.uid
	var is_ranged := u.range > 1
	emit({"t": "attackStart", "tick": tick, "uid": u.uid, "targetUid": target.uid, "windup": windup, "isRanged": is_ranged})
	if is_ranged:
		emit({
			"t": "projectile", "tick": tick, "uid": u.uid, "targetUid": target.uid,
			"from": Grid.cell_dict(u.cell), "to": Grid.cell_dict(target.cell),
			"dur": windup, "kind": "arrow" if u.range >= 4 else "orb",
		})


func _resolve_attack(u: Unit) -> void:
	var target: Unit = unit_by_uid(u.windup_target_uid)
	u.windup_left = 0.0
	if target == null or not target.alive:
		return

	var mod := {"forceCrit": false, "bonusMagic": 0.0, "bonusPhysical": 0.0}
	for fn: Callable in _hooks.get(u.team, {}).get("onPreAttack", []):
		fn.call(self, u, target, mod)

	# 龙渊「施法附魔」：消耗走 removeOneStatus（状态事件流记账）
	if u.has_status("spellCharge"):
		for s: Status in u.statuses:
			if s.kind == "spellCharge":
				mod["bonusMagic"] += s.value
				break
		remove_one_status(u, "spellCharge")

	var base := u.eff_atk()
	# 暴击只在这里掷一次骰，倍率交由 deal_damage 统一结算
	var crit: bool = mod["forceCrit"] or rng.chance(maxf(0.0, u.crit_chance))
	fx("impact", {"uid": u.uid, "targetUid": target.uid, "params": {"crit": 1.0 if crit else 0.0}})
	var dealt: float = deal_damage(u, target, base, "physical", {
		"source": "attack", "isAttack": true, "canCrit": false, "forceCrit": crit,
	})
	if float(mod["bonusMagic"]) > 0.0:
		deal_damage(u, target, float(mod["bonusMagic"]), "magic", {"source": mod.get("bonusMagicSource", "trait")})
		fx("impact", {"uid": u.uid, "targetUid": target.uid, "params": {"hue": 2.0}})
	if float(mod["bonusPhysical"]) > 0.0:
		# 附加物伤（机关第 4 击等）保持可暴击：canCrit 交给 dealDamage 掷骰
		deal_damage(u, target, float(mod["bonusPhysical"]), "physical", {"source": mod.get("bonusPhysicalSource", "trait"), "isAttack": true, "canCrit": true})
		fx("impact", {"uid": u.uid, "targetUid": target.uid, "params": {"hue": 0.0}})

	u.attack_count += 1
	if not u.is_minion and u.mana_lock <= 0.0:
		u.mp = minf(u.max_mp, u.mp + _mana_per_attack)
		emit({"t": "mana", "tick": tick, "uid": u.uid, "mp": u.mp, "maxMp": u.max_mp})
	for fn: Callable in _hooks.get(u.team, {}).get("onAttackHit", []):
		fn.call(self, u, target, dealt, "physical")


func _resolve_cast(u: Unit) -> void:
	u.cast_windup_left = 0.0
	if not u.alive:
		return
	u.mp = 0.0
	u.mana_lock = _mana_lock_after_cast
	u.cast_count += 1
	emit({"t": "mana", "tick": tick, "uid": u.uid, "mp": 0.0, "maxMp": u.max_mp})
	emit({"t": "cast", "tick": tick, "uid": u.uid, "skillId": String(u.entry["skill"]), "params": {"star": float(u.star)}})
	Skills.execute_skill(self, u)
	for fn: Callable in _hooks.get(u.team, {}).get("onCast", []):
		fn.call(self, u)


func _tick_statuses() -> void:
	for u: Unit in units:
		if not u.alive or u.statuses.is_empty():
			continue
		var shield_expired := false
		for s: Status in u.statuses:
			s.ticks -= 1
		var kept := []
		for s: Status in u.statuses:
			if s.ticks > 0:
				kept.append(s)
				continue
			if s.kind == "shield":
				shield_expired = true
			emit({"t": "status", "tick": tick, "uid": u.uid, "kind": s.kind, "dur": 0.0, "value": 0.0, "added": false})
		u.statuses = kept
		if shield_expired:
			# 自然到期与破盾同口径发 shield 事件（余量归零账）
			emit({"t": "shield", "tick": tick, "uid": u.uid, "amount": -ParityUtil.js_round(u.shield), "total": 0.0})
			u.shield = 0.0


func _tick_dots() -> void:
	var dt := 1.0 / Spec.c("DOT_TICKS_PER_SEC", 2.0)
	for u: Unit in units:
		if not u.alive:
			continue
		for s: Status in u.statuses:
			# 本 tick 内前面的 DoT 可能已把 u 打死（killUnit 整体替换 statuses）——死亡即停
			if not u.alive:
				break
			if s.kind != "burn" and s.kind != "bleed":
				continue
			var src := unit_by_uid(s.src_uid)
			var type := s.dtype if s.dtype != "" else ("magic" if s.kind == "burn" else "true")
			emit({"t": "fx", "tick": tick, "kind": "burnTick" if s.kind == "burn" else "bleedTick", "uid": u.uid})
			deal_damage(src, u, s.value * dt, type, {"source": "dot"})


func _tick_zones() -> void:
	if _zones.is_empty():
		return
	var dt := 1.0 / Spec.c("DOT_TICKS_PER_SEC", 2.0)
	for z: Dictionary in _zones:
		var follow_uid: Variant = z.get("followUid", null)
		if follow_uid != null:
			var f := unit_by_uid(int(follow_uid))
			if f != null and f.alive:
				z["cell"] = f.cell
		if float(z["dps"]) > 0.0:
			var src := unit_by_uid(int(z["srcUid"]))
			for e: Unit in units_in_radius(z["cell"], float(z["radius"])):
				if e.team == int(z["team"]):
					continue
				deal_damage(src, e, float(z["dps"]) * dt, String(z["type"]), {"source": "trait"})
		var st = z.get("status", null)
		if st != null:
			var src := unit_by_uid(int(z["srcUid"]))
			if src != null:
				# 每 0.5 秒对范围内敌人重施整段时长（v1.9 起既定口径，勿截断）
				for e: Unit in units_in_radius(z["cell"], float(z["radius"])):
					if e.team == int(z["team"]):
						continue
					add_status(src, e, String(st["kind"]), float(st["dur"]), float(st["value"]))
		if tick % (TICK_RATE * 2) == 0:
			fx(String(z.get("fx", "groundMark")), {"cell": Grid.cell_dict(z["cell"]), "radius": float(z["radius"])})
	var kept: Array = []
	for z: Dictionary in _zones:
		if int(z["endsAtTick"]) > tick:
			kept.append(z)
	_zones = kept


func _check_end() -> void:
	if finished:
		return
	var alive_by_team := {}
	for u: Unit in units:
		if not u.alive:
			continue
		alive_by_team[u.team] = int(alive_by_team.get(u.team, 0)) + 1
	# 只对「已无存活单位的一方」的待复活等待
	var revive_pending := false
	for t: int in _pending_revives.values():
		if not alive_by_team.has(t):
			revive_pending = true
			break
	if alive_by_team.size() == 1:
		if revive_pending:
			return
		var winner: int = alive_by_team.keys()[0]
		var has_champion := false
		for u: Unit in units:
			if u.alive and not u.is_minion and u.team == winner:
				has_champion = true
				break
		_finish(winner if has_champion else null, false)
		return
	if alive_by_team.size() == 0:
		if revive_pending:
			return
		_finish(null, false)
		return
	if tick >= _max_ticks:
		# 超时裁定：只算非召唤物；排序按 ratio 本身（键先升序再按比例稳定降序 = JS 数值键序+稳定序）
		var ratio := {}
		var champ_alive := {}
		var teams_asc: Array = alive_by_team.keys()
		teams_asc.sort()
		for team: int in teams_asc:
			var champs := []
			for u: Unit in units:
				if u.team == team and not u.is_minion:
					champs.append(u)
			var n_alive := 0
			var cur := 0.0
			var mx := 0.0
			for u: Unit in champs:
				if u.alive:
					n_alive += 1
				cur += maxf(0.0, u.hp)
				mx += u.max_hp
			champ_alive[team] = n_alive
			ratio[team] = (cur / mx) if mx > 0.0 else 0.0
		var teams_sorted: Array = ratio.keys()
		teams_sorted.sort_custom(func(a, b):
			if float(ratio[b]) != float(ratio[a]):
				return float(ratio[a]) > float(ratio[b])
			return int(a) < int(b))
		var winner: Variant = null
		if teams_sorted.size() < 2:
			winner = teams_sorted[0] if teams_sorted.size() == 1 and int(champ_alive.get(teams_sorted[0], 0)) > 0 else null
		elif int(champ_alive.get(teams_sorted[0], 0)) > 0 and int(champ_alive.get(teams_sorted[1], 0)) == 0:
			winner = teams_sorted[0]
		else:
			winner = teams_sorted[0] if float(ratio[teams_sorted[0]]) - float(ratio[teams_sorted[1]]) > _timeout_win_ratio else null
		_finish(winner, true)


func _finish(winner, timeout: bool) -> void:
	finished = true
	var survivors := {}
	var remaining_hp_ratio := {}
	var by_team := {}
	for u: Unit in units:
		if u.is_minion:
			continue
		if not by_team.has(u.team):
			by_team[u.team] = []
		(by_team[u.team] as Array).append(u)
	for team: int in by_team.keys():
		var team_units: Array = by_team[team]
		if not survivors.has(team):
			survivors[team] = []
		for u: Unit in team_units:
			if u.alive:
				(survivors[team] as Array).append(u.uid)
		var cur := 0.0
		var mx := 0.0
		for u: Unit in team_units:
			cur += maxf(0.0, u.hp)
			mx += u.max_hp
		remaining_hp_ratio[team] = (cur / mx) if mx > 0.0 else 0.0
	for u: Unit in units:
		if u.is_minion and not survivors.has(u.team):
			survivors[u.team] = []
	result = {"winner": winner, "ticks": tick, "survivors": survivors, "remainingHpRatio": remaining_hp_ratio, "timeout": timeout}
	emit({"t": "end", "tick": tick, "winner": winner, "timeout": timeout})


func run() -> Dictionary:
	var guard := 0
	while not finished and guard < _max_ticks + 10:
		step()
		guard += 1
	if result.is_empty():
		_finish(null, true)
	return result


## 敌人最密集格（邻域计分，平局取行优先的最小格）
static func densest(foes: Array, radius: int) -> Vector2i:
	var best := Vector2i(0, 0)
	var best_score := -1.0
	for r: int in Grid.ROWS:
		for c: int in Grid.COLS:
			var score := 0.0
			for f: Unit in foes:
				var d := Grid.chebyshev(Vector2i(c, r), f.cell)
				if d <= radius:
					score += 1.0 + float(radius - d)
			if score > best_score:
				best_score = score
				best = Vector2i(c, r)
	return best
