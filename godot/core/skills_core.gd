## 技能引擎（src/core/skills.ts）。所有伤害走 skill_damage：
## 星级缩放 → 技能增伤 → 真伤转化 → 暴击标记。
## GDScript 闭包按值捕获标量：多波计数（nova wave / volley fired）装箱进字典。
class_name Skills
extends RefCounted

## 固定逻辑 tick（30Hz）：与 battle.gd TICK_RATE 同值的文件级声明。
## 两处同字面量是有意为之——core 内文件级 const 不可跨文件引用（class_name 环形
## 依赖），改 tick 率必须双文件同步（对拍门禁的 FNV 摘要会立刻抓出轨）
const TICK_RATE := 30


const DEBUFF_KINDS: Array = [
	"stun", "silence", "disarm", "slow", "wound",
	"burn", "bleed", "armorShred", "mrShred", "vulnerability", "taunt",
]

## 增益白名单（DEBUFF 的显式补集）：未知种类安全 no-op，不静默强化施法者
const BUFF_KINDS: Array = [
	"atkUp", "aspdUp", "armorUp", "mrUp", "shield", "invuln", "stealth",
	"dr", "spellCharge", "ccImmune",
]


static func is_debuff(k: String) -> bool:
	return DEBUFF_KINDS.has(k)


static func is_buff(k: String) -> bool:
	return BUFF_KINDS.has(k)


## 技能原始伤害 = (攻击×atk倍率 + 法强×sp倍率 + 固定值) × 星级技能倍率 × 天命倍率
static func skill_raw(u: Unit, atk: float = 0.0, sp: float = 0.0, flat: float = 0.0) -> float:
	var legend: bool = int(u.entry["cost"]) == 5 and u.star == 3 and not u.is_minion and not u.is_monster
	return (atk * u.eff_atk() + sp * u.eff_sp() + flat) \
		* Spec.star_scale("STAR_SKILL_SCALE", u.star - 1) \
		* (Spec.legend("skillMult") if legend else 1.0)


## 统一技能伤害出口（术士真伤转化：整技能一颗暴击骰，两段共享判定）
static func skill_damage(api, src: Unit, dst: Unit, raw: float, type: String, force_crit: bool = false) -> float:
	var amp: float = 1.0 + src.tstate.skill_amp
	var tr: float = src.tstate.skill_true_ratio
	var total: float = raw * amp
	if tr > 0.0 and type != "true":
		var crit_decided: Variant = null
		if not force_crit and src.tstate.skill_crit_chance > 0.0:
			crit_decided = api.roll_skill_crit(src)
		var dealt: float = api.deal_damage(src, dst, total * tr, "true", {"source": "skill", "forceCrit": force_crit, "critDecided": crit_decided})
		dealt += api.deal_damage(src, dst, total * (1.0 - tr), type, {"source": "skill", "forceCrit": force_crit, "critDecided": crit_decided})
		return dealt
	return api.deal_damage(src, dst, total, type, {"source": "skill", "forceCrit": force_crit})


static func _apply_status(api, src: Unit, dst: Unit, p: Dictionary) -> void:
	var s = p.get("status", null)
	if s == null:
		return
	api.add_status(src, dst, String(s["kind"]), float(s["dur"]), float(s.get("value", 0.0)))


## 选中目标后的通用收尾：治疗、叠层、护盾
static func _on_hits(api, src: Unit, hit_count: int, p: Dictionary) -> void:
	var heal_on_hit: Variant = p.get("healOnHit", null)
	if heal_on_hit != null and hit_count > 0:
		api.heal(src, src, src.max_hp * float(heal_on_hit) * float(hit_count))
	var shield_on_hit: Variant = p.get("shieldOnHit", null)
	if shield_on_hit != null and hit_count > 0:
		api.add_shield(src, src, src.max_hp * float(shield_on_hit), 8.0)
	var stack_atk: Variant = p.get("stackAtkOnHit", null)
	if stack_atk != null and hit_count > 0:
		src.perm_atk_pct += float(stack_atk) * float(hit_count)


static func _foes_in(api, src: Unit, center: Vector2i, radius: float) -> Array:
	var out := []
	for x: Unit in api.units_in_radius(center, radius):
		if x.team != src.team and x.alive:
			out.append(x)
	return out


## 收集沿直线（含起点方向）经过的格子
static func _line_cells(from: Vector2i, to: Vector2i, length: int) -> Array:
	var dc: int = sign(to.x - from.x)
	var dr: int = sign(to.y - from.y)
	var out := []
	for i: int in range(1, length + 1):
		var c := from.x + dc * i
		var r := from.y + dr * i
		if not Grid.in_bounds(c, r):
			break
		out.append(Vector2i(c, r))
	return out


static var IMPL: Dictionary = {}


static func _init_impls() -> void:
	if not IMPL.is_empty():
		return

	# ─────────── 单体爆发 ───────────
	IMPL["strike"] = func(api, u: Unit, spec: Dictionary, target, cell: Vector2i):
		var p: Dictionary = spec["params"]
		var type: String = p.get("type", "physical")
		var radius: float = float(p.get("radius", 0.0))
		var hits := 0
		if radius > 0.0:
			var center: Vector2i = target.cell if target != null else cell
			api.fx("burst", {"uid": u.uid, "cell": Grid.cell_dict(center), "radius": radius, "params": {"hue": 0.0 if type == "physical" else 2.0}})
			for e: Unit in _foes_in(api, u, center, radius):
				var raw := skill_raw(u, float(p.get("atk", 0.0)), float(p.get("sp", 0.0)), float(p.get("flat", 0.0)))
				var threshold: Variant = p.get("threshold", null)
				if threshold != null and e.hp / e.max_hp < float(threshold):
					raw *= float(p.get("thresholdMult", 2.0))
				skill_damage(api, u, e, raw, type, p.get("forceCrit", false))
				_apply_status(api, u, e, p)
				hits += 1
		elif target != null:
			api.fx("slash", {"uid": u.uid, "targetUid": target.uid})
			var raw := skill_raw(u, float(p.get("atk", 0.0)), float(p.get("sp", 0.0)), float(p.get("flat", 0.0)))
			var threshold: Variant = p.get("threshold", null)
			if threshold != null and target.hp / target.max_hp < float(threshold):
				raw *= float(p.get("thresholdMult", 2.0))
			skill_damage(api, u, target, raw, type, p.get("forceCrit", false))
			_apply_status(api, u, target, p)
			hits = 1
		_on_hits(api, u, hits, p)

	# ─────────── 自身环爆 ───────────
	IMPL["nova"] = func(api, u: Unit, spec: Dictionary, _target, cell: Vector2i):
		var p: Dictionary = spec["params"]
		var type: String = p.get("type", "physical")
		var radius: float = float(p.get("radius", 1.0))
		var shots: int = int(p.get("shots", 1))
		var interval: float = float(p.get("interval", 0.4))
		if String(spec["target"]) != "self":
			api.fx("dashTrail", {"uid": u.uid, "cell": Grid.cell_dict(cell)})
			api.teleport(u, cell, 0.3)
		if p.get("invulnWhileCasting", false):
			api.add_status(u, u, "invuln", maxf(0.1, float(shots) * interval), 0.0)
		var st = p.get("status", null)
		if st != null and is_buff(String(st["kind"])):
			api.add_status(u, u, String(st["kind"]), float(st.get("dur", 6.0)), float(st.get("value", 0.0)))
		var state := {"wave": 0}
		# GDScript 局部 lambda 不能自引用 —— 装箱后经字典取自身
		var wf := {"fn": Callable()}
		wf["fn"] = func(a):
			# 多波技能施法者中途阵亡后不再继续结算
			if not u.alive:
				return
			state["wave"] = int(state["wave"]) + 1
			var wave: int = state["wave"]
			a.fx("nova", {"uid": u.uid, "radius": radius, "params": {"hue": 0.0 if type == "physical" else 2.0, "wave": float(wave)}})
			var hits := 0
			for e: Unit in _foes_in(a, u, u.cell, radius):
				skill_damage(a, u, e, skill_raw(u, float(p.get("atk", 0.0)), float(p.get("sp", 0.0)), float(p.get("flat", 0.0))), type, p.get("forceCrit", false))
				# 每波只补施非强控减益（stun/wound 已在施放瞬间一次性施加）
				if st != null:
					var k := String(st["kind"])
					if is_debuff(k) and k != "stun" and k != "wound":
						_apply_status(a, u, e, p)
				hits += 1
			_on_hits(a, u, hits, p)
			if wave < shots:
				a.schedule(interval, wf["fn"])
		# 强控/重伤在施放瞬间对范围内敌人一次性施加
		if st != null and (String(st["kind"]) == "stun" or String(st["kind"]) == "wound"):
			for e: Unit in _foes_in(api, u, u.cell, radius):
				api.add_status(u, e, String(st["kind"]), float(st.get("dur", 1.5)), float(st.get("value", 0.0)))
		wf["fn"].call(api)

	# ─────────── 指定点范围爆发 ───────────
	IMPL["aoe"] = func(api, u: Unit, spec: Dictionary, _target, cell: Vector2i):
		var p: Dictionary = spec["params"]
		var type: String = p.get("type", "magic")
		var radius: float = float(p.get("radius", 1.0))
		var run := func(a):
			if not u.alive:
				return
			a.fx("burst", {"uid": u.uid, "cell": Grid.cell_dict(cell), "radius": radius, "params": {"hue": 2.0 if type == "magic" else 0.0}})
			a.fx("groundMark", {"cell": Grid.cell_dict(cell), "radius": radius})
			var hits := 0
			for e: Unit in _foes_in(a, u, cell, radius):
				skill_damage(a, u, e, skill_raw(u, float(p.get("atk", 0.0)), float(p.get("sp", 0.0)), float(p.get("flat", 0.0))), type, p.get("forceCrit", false))
				_apply_status(a, u, e, p)
				hits += 1
			_on_hits(a, u, hits, p)
		var delay: Variant = p.get("delay", null)
		if delay != null and float(delay) > 0.0:
			api.fx("groundMark", {"cell": Grid.cell_dict(cell), "radius": radius, "params": {"telegraph": 1.0, "dur": float(delay)}})
			api.schedule(float(delay), run)
		else:
			run.call(api)

	# ─────────── 直线穿透 ───────────
	IMPL["line"] = func(api, u: Unit, spec: Dictionary, _target, cell: Vector2i):
		var p: Dictionary = spec["params"]
		var type: String = p.get("type", "physical")
		var length: int = int(p.get("length", 4))
		var cells := _line_cells(u.cell, cell, length)
		var last: Vector2i = cells[cells.size() - 1] if not cells.is_empty() else cell
		api.fx("beam", {"uid": u.uid, "cell": Grid.cell_dict(last), "params": {"hue": 3.0 if type == "magic" else 0.0}})
		var hits := 0
		for c: Vector2i in cells:
			var e: Unit = api.unit_at(c.x, c.y)
			if e != null and e.alive and e.team != u.team:
				skill_damage(api, u, e, skill_raw(u, float(p.get("atk", 0.0)), float(p.get("sp", 0.0)), float(p.get("flat", 0.0))), type, p.get("forceCrit", false))
				_apply_status(api, u, e, p)
				var kb: Variant = p.get("knockback", null)
				if kb != null:
					api.knockback(e, u.cell, int(kb))
				hits += 1
		_on_hits(api, u, hits, p)

	# ─────────── 光束扫射（含灼烧） ───────────
	IMPL["beam"] = func(api, u: Unit, spec: Dictionary, _target, cell: Vector2i):
		var p: Dictionary = spec["params"]
		var type: String = p.get("type", "magic")
		var length: int = int(p.get("length", 5))
		# beam 是引导蓄力系：蓄力窗只免控不吃无敌
		if p.get("ccImmuneWhileCasting", false):
			api.add_status(u, u, "ccImmune", 1.2, 0.0)
		var emit_at := func(a):
			if not u.alive:
				return
			var cells := _line_cells(u.cell, cell, length)
			var last: Vector2i = cells[cells.size() - 1] if not cells.is_empty() else cell
			a.fx("beam", {"uid": u.uid, "cell": Grid.cell_dict(last), "params": {"hue": 3.0}})
			var hits := 0
			for c: Vector2i in cells:
				var e: Unit = a.unit_at(c.x, c.y)
				if e != null and e.alive and e.team != u.team:
					skill_damage(a, u, e, skill_raw(u, float(p.get("atk", 0.0)), float(p.get("sp", 0.0)), float(p.get("flat", 0.0))), type, p.get("forceCrit", false))
					var dps_sp: Variant = p.get("dpsSp", null)
					var st = p.get("status", null)
					if dps_sp != null:
						var dot_dur: float = float(st["dur"]) if st != null else 4.0
						a.add_dot(u, e, "burn", skill_raw(u, 0.0, float(dps_sp)), dot_dur, "magic")
					if st != null and String(st["kind"]) != "burn":
						_apply_status(a, u, e, p)
					hits += 1
			_on_hits(a, u, hits, p)
		api.fx("castRing", {"uid": u.uid, "params": {"hue": 3.0}})
		api.schedule(0.55, emit_at)

	# ─────────── 突进斩 ───────────
	IMPL["dashStrike"] = func(api, u: Unit, spec: Dictionary, target, _cell):
		var p: Dictionary = spec["params"]
		var cf := {"fn": Callable()}
		cf["fn"] = func(a, t: Unit, depth: int):
			var type: String = p.get("type", "physical")
			# 落到目标身边最近的空格
			var dest: Variant = null
			var best := INF
			for dr: int in range(-1, 2):
				for dc: int in range(-1, 2):
					var c := t.cell.x + dc
					var r := t.cell.y + dr
					if not Grid.in_bounds(c, r):
						continue
					if a.occupied(c, r):
						continue
					var d := Grid.chebyshev(Vector2i(c, r), u.cell)
					if d < best:
						best = d
						dest = Vector2i(c, r)
			var fx_cell: Vector2i = dest if dest != null else t.cell
			a.fx("dashTrail", {"uid": u.uid, "cell": Grid.cell_dict(fx_cell)})
			if dest != null:
				a.teleport(u, dest, 0.22)
			var radius: float = float(p.get("radius", 0.0))
			var victims: Array = _foes_in(a, u, t.cell, radius) if radius > 0.0 else [t]
			a.fx("slash", {"uid": u.uid, "targetUid": t.uid})
			var hits := 0
			var killed := false
			for e: Unit in victims:
				var before := e.alive
				skill_damage(a, u, e, skill_raw(u, float(p.get("atk", 0.0)), float(p.get("sp", 0.0)), float(p.get("flat", 0.0))), type, p.get("forceCrit", false))
				if before and not e.alive:
					killed = true
				hits += 1
			_on_hits(a, u, hits, p)
			var reset_on_kill: Variant = p.get("resetOnKill", null)
			if killed and reset_on_kill != null:
				u.mp = minf(u.max_mp, u.max_mp * float(reset_on_kill))
				a.emit({"t": "mana", "tick": a.tick, "uid": u.uid, "mp": u.mp, "maxMp": u.max_mp})
				var max_repeats: Variant = p.get("maxRepeats", null)
				if max_repeats != null and depth < int(max_repeats):
					a.schedule(0.25, func(api2):
						if not u.alive:
							return
						var targets: Array = api2.resolve_targets(u, String(spec["target"]), 1)
						var t2: Unit = targets[0] if not targets.is_empty() else null
						if t2 != null:
							cf["fn"].call(api2, t2, depth + 1))
		if target != null:
			cf["fn"].call(api, target, 0)

	# ─────────── 连续弹幕 ───────────
	IMPL["volley"] = func(api, u: Unit, spec: Dictionary, target, _cell):
		var p: Dictionary = spec["params"]
		var type: String = p.get("type", "physical")
		var shots: int = int(p.get("shots", 3))
		var interval: float = float(p.get("interval", 0.5))
		var state := {"fired": 0, "target": target}
		var fr := {"fn": Callable()}
		fr["fn"] = func(a):
			if not u.alive:
				return
			var cur: Unit = state["target"]
			if cur == null or not cur.alive:
				var retargeted: Array = a.resolve_targets(u, "enemyNearest", 1)
				state["target"] = retargeted[0] if not retargeted.is_empty() else null
				cur = state["target"]
				if cur == null:
					return
			var fired: int = state["fired"]
			var is_last: bool = fired == shots - 1
			var mult: float = float(p.get("finalMult", 2.0)) if is_last else 1.0
			a.fx("pierce", {"uid": u.uid, "targetUid": cur.uid})
			a.emit({
				"t": "projectile", "tick": a.tick, "uid": u.uid, "targetUid": cur.uid,
				"from": Grid.cell_dict(u.cell), "to": Grid.cell_dict(cur.cell),
				"dur": 0.12, "kind": "arrow" if u.range >= 4 else "bolt",
			})
			skill_damage(a, u, cur, skill_raw(u, float(p.get("atk", 0.0)), float(p.get("sp", 0.0)), float(p.get("flat", 0.0))) * mult, type, p.get("forceCrit", false))
			# 弹幕自增益只认增益白名单；声明了 maxStacks 的按本源层封顶
			var st = p.get("status", null)
			if st != null and is_buff(String(st["kind"])):
				var src_tag := "skill:" + String(u.entry["id"])
				var live := 0
				for s: Status in u.statuses:
					if s.kind == String(st["kind"]) and s.src == src_tag:
						live += 1
				var max_stacks: Variant = p.get("maxStacks", null)
				if max_stacks == null or float(max_stacks) <= 0.0 or live < int(max_stacks):
					a.add_status(u, u, String(st["kind"]), float(st["dur"]), float(st.get("value", 0.0)), src_tag)
			state["fired"] = int(state["fired"]) + 1
			if int(state["fired"]) < shots:
				a.schedule(interval, fr["fn"])
		fr["fn"].call(api)

	# ─────────── 群体治疗 ───────────
	IMPL["healBurst"] = func(api, u: Unit, spec: Dictionary, target, _cell):
		var p: Dictionary = spec["params"]
		var amount: float = u.max_hp * float(p.get("value", 0.0)) + u.eff_sp() * float(p.get("sp", 0.0))
		var is_team_wide: bool = String(spec["target"]) == "allAllies"
		var list := []
		if is_team_wide:
			for x: Unit in api.units:
				if x.alive and x.team == u.team:
					list.append(x)
		else:
			var others := []
			for x: Unit in api.units:
				if x.alive and x.team == u.team and x != target:
					others.append(x)
			others = ParityUtil.stable_sort_by(others, func(x): return x.hp / x.max_hp)
			if target != null:
				list.append(target)
			if not others.is_empty():
				list.append(others[0])
		# shots 只用于单体模式的目标数上限；全体治疗不得被它截断
		var healed_list: Array = list if is_team_wide else list.slice(0, int(p.get("shots", list.size())))
		api.fx("healWave", {"uid": u.uid, "params": {"hue": 4.0}})
		var st = p.get("status", null)
		for al: Unit in healed_list:
			api.heal(u, al, amount)
			if st != null and is_buff(String(st["kind"])):
				api.add_status(u, al, String(st["kind"]), float(st["dur"]), float(st.get("value", 0.0)))
			var dr_: Variant = p.get("damageReduction", null)
			if dr_ != null:
				var dur_v: Variant = p.get("dur", null)
				if dur_v == null and st != null:
					dur_v = st.get("dur", null)
				var dur: float = float(dur_v) if dur_v != null else 6.0
				api.add_status(u, al, "dr", dur, float(dr_) * 100.0)
			api.fx("healWave", {"cell": Grid.cell_dict(al.cell)})
		# 白娘：对随机敌人施加重伤
		if String(spec["target"]) == "allAllies" and st != null and String(st["kind"]) == "wound":
			var foes := []
			for x: Unit in api.units:
				if x.alive and x.team != u.team:
					foes.append(x)
			api.rng.shuffle(foes)
			for e: Unit in foes.slice(0, int(p.get("shots", 3))):
				api.add_status(u, e, "wound", float(st["dur"]), float(st.get("value", 0.0)))
				api.fx("debuffMark", {"targetUid": e.uid})

	# ─────────── 群体护盾 ───────────
	IMPL["shieldAll"] = func(api, u: Unit, spec: Dictionary, _target, _cell):
		var p: Dictionary = spec["params"]
		var amount: float = u.max_hp * float(p.get("value", 0.0))
		var shield_dur: float = float(p.get("shieldDur", 8.0))
		for al: Unit in api.units:
			if not al.alive or al.team != u.team:
				continue
			api.add_shield(u, al, amount, shield_dur)
			var st = p.get("status", null)
			if st != null and is_buff(String(st["kind"])):
				api.add_status(u, al, String(st["kind"]), float(st["dur"]), float(st.get("value", 0.0)))
			var dr_: Variant = p.get("damageReduction", null)
			if dr_ != null:
				api.add_status(u, al, "dr", shield_dur, float(dr_) * 100.0)
			api.fx("shieldWall", {"cell": Grid.cell_dict(al.cell)})
		# 青丘：全体敌人魅惑（眩晕 + 易伤；易伤多驻留 vulnDur 缺省 +2 秒）
		var dur_v: Variant = p.get("dur", null)
		var vuln_v: Variant = p.get("vulnerability", null)
		if dur_v != null and vuln_v != null:
			var vuln_dur_v: Variant = p.get("vulnDur", null)
			var vuln_dur: float = float(vuln_dur_v) if vuln_dur_v != null else float(dur_v) + 2.0
			for e: Unit in api.units:
				if not e.alive or e.team == u.team:
					continue
				api.add_status(u, e, "stun", float(dur_v), 0.0)
				api.add_status(u, e, "vulnerability", vuln_dur, float(vuln_v) * 100.0)
				api.fx("debuffMark", {"targetUid": e.uid})

	# ─────────── 召唤 ───────────
	IMPL["summon"] = func(api, u: Unit, spec: Dictionary, _target, _cell):
		var p: Dictionary = spec["params"]
		var smon = p.get("summon", null)
		if smon == null:
			return
		api.fx("summon", {"uid": u.uid})
		for i: int in int(smon["count"]):
			var placed := false
			var ring := 1
			while ring <= 3 and not placed:
				var dr := -ring
				while dr <= ring and not placed:
					var dc := -ring
					while dc <= ring and not placed:
						# 只扫当前环：方形环遍历会把内环格子重扫一遍
						if maxi(absi(dr), absi(dc)) != ring:
							dc += 1
							continue
						var c := u.cell.x + dc
						var r := u.cell.y + dr
						if Grid.in_bounds(c, r) and not api.occupied(c, r):
							api.summon(u, Vector2i(c, r), float(smon["hpPct"]), float(smon["atkPct"]))
							api.fx("summon", {"cell": Grid.cell_dict(Vector2i(c, r))})
							placed = true
						dc += 1
					dr += 1
				ring += 1
		var st = p.get("status", null)
		if st != null and is_buff(String(st["kind"])):
			for al: Unit in api.units:
				if al.alive and al.team == u.team:
					api.add_status(u, al, String(st["kind"]), float(st["dur"]), float(st.get("value", 0.0)))

	# ─────────── 连锁 ───────────
	IMPL["chain"] = func(api, u: Unit, spec: Dictionary, target, _cell):
		var p: Dictionary = spec["params"]
		var type: String = p.get("type", "magic")
		var jumps: int = int(p.get("jumps", 3))
		var cur: Unit = target
		var hit_set := {}
		var i := 0
		while i < jumps:
			if cur == null or not cur.alive:
				break
			hit_set[cur.uid] = true
			var falloff: float = pow(1.0 - float(p.get("falloff", 0.15)), float(i))
			api.fx("beam", {"uid": u.uid, "targetUid": cur.uid, "params": {"hue": 5.0}})
			skill_damage(api, u, cur, skill_raw(u, float(p.get("atk", 0.0)), float(p.get("sp", 0.0)), float(p.get("flat", 0.0))) * falloff, type, false)
			_apply_status(api, u, cur, p)
			var next: Unit = null
			var best := INF
			for e: Unit in api.units:
				if not e.alive or e.team == u.team or hit_set.has(e.uid):
					continue
				var d := Grid.chebyshev(e.cell, cur.cell)
				if d < best:
					best = d
					next = e
			cur = next
			i += 1

	# ─────────── 全场处决 ───────────
	IMPL["execute"] = func(api, u: Unit, spec: Dictionary, _target, _cell):
		var p: Dictionary = spec["params"]
		var raw := skill_raw(u, float(p.get("atk", 0.0)), float(p.get("sp", 0.0)), float(p.get("flat", 0.0)))
		var threshold: float = float(p.get("threshold", 0.25))
		api.fx("nova", {"uid": u.uid, "radius": 8.0, "params": {"hue": 6.0}})
		var executed := 0
		for e: Unit in (api.units as Array).duplicate():
			if not e.alive or e.team == u.team:
				continue
			if e.hp / e.max_hp < threshold:
				# 斩杀一跳豁免真伤上限；量取恰好 hp+shield+1（+9999 会污染统计与吸血）
				api.deal_damage(u, e, e.hp + e.shield + 1.0, "true", {"source": "skill", "ignoreTrueCap": true})
				executed += 1
			else:
				skill_damage(api, u, e, raw, String(p.get("type", "true")), false)
		if executed > 0:
			var heal_pct: float = float(p.get("healPerExecute", 0.15)) * float(executed)
			for al: Unit in api.units:
				if al.alive and al.team == u.team:
					api.heal(u, al, al.max_hp * heal_pct)

	# ─────────── 自身强化 ───────────
	IMPL["selfBuff"] = func(api, u: Unit, spec: Dictionary, _target, _cell):
		var p: Dictionary = spec["params"]
		var dur: float = float(p.get("dur", 6.0))
		var src_tag := "skill:" + String(u.entry["id"])
		var value_v: Variant = p.get("value", null)
		if value_v != null:
			api.add_shield(u, u, u.max_hp * float(value_v), dur)
		var st = p.get("status", null)
		if st != null:
			api.add_status(u, u, String(st["kind"]), float(st.get("dur", dur)), float(st.get("value", 0.0)), src_tag)
		var extra = p.get("extraStatus", null)
		if extra != null:
			api.add_status(u, u, String(extra["kind"]), float(extra.get("dur", dur)), float(extra.get("value", 0.0)), src_tag)
		# 击杀续期：只刷本技能施加的层（killRenew）
		if p.get("killRenew", false) and not u.trait_stacks.get("selfBuffKillRenew", false):
			u.trait_stacks["selfBuffKillRenew"] = true
			u.kill_handlers.append(func(a, _victim):
				if not u.has_status("aspdUp"):
					return
				for s: Status in u.statuses:
					if (s.kind == "aspdUp" or s.kind == "atkUp") and s.src == src_tag:
						s.ticks = int(ParityUtil.js_round(dur * TICK_RATE))
				a.fx("buffAura", {"uid": u.uid, "params": {"hue": 1.0}}))
		if p.get("invulnWhileCasting", false):
			api.add_status(u, u, "invuln", dur, 0.0)
			api.add_status(u, u, "ccImmune", dur, 0.0)
		var dps_sp: Variant = p.get("dpsSp", null)
		var radius_v: Variant = p.get("radius", null)
		if dps_sp != null and radius_v != null:
			api.add_zone({
				"cell": u.cell, "radius": float(radius_v), "dur": dur, "srcUid": u.uid,
				"team": u.team, "dps": skill_raw(u, 0.0, float(dps_sp)),
				"type": String(p.get("type", "magic")), "followUid": u.uid, "fx": "groundMark",
			})
		# 磐：反弹所受伤害（锚定本次施放附带的增益；钩子只注册一次）
		var reflect_v: Variant = p.get("reflect", null)
		if reflect_v != null:
			var anchor: String = String(st["kind"]) if st != null else ""
			if not u.trait_stacks.get("reflectHooked", false):
				u.trait_stacks["reflectHooked"] = true
				(api.hooks_of(u.team)["onDamageTaken"] as Array).append(func(a, dst, src, amt, type, opts):
					if anchor != "" and not u.has_status(anchor):
						return
					if type != "physical" and type != "magic":
						return
					if opts.get("noReflect", false):
						return
					if dst.uid != u.uid or not u.alive or src == null or not src.alive:
						return
					a.deal_damage(u, src, maxf(1.0, float(amt) * float(reflect_v)), "physical", {"source": "skill", "noReflect": true}))
		api.fx("buffAura", {"uid": u.uid, "params": {"hue": 1.0}})

	# ─────────── 地面持续区域 ───────────
	IMPL["field"] = func(api, u: Unit, spec: Dictionary, _target, cell: Vector2i):
		var p: Dictionary = spec["params"]
		var radius_v: Variant = p.get("radius", 1.0)
		var dur_v: Variant = p.get("dur", 5.0)
		api.fx("groundMark", {"cell": Grid.cell_dict(cell), "radius": float(radius_v), "params": {"hue": 2.0}})
		var st = p.get("status", null)
		var zone_status: Variant = null
		if st != null:
			zone_status = {"kind": String(st["kind"]), "dur": float(st["dur"]), "value": float(st.get("value", 0.0))}
		api.add_zone({
			"cell": cell, "radius": float(radius_v), "dur": float(dur_v), "srcUid": u.uid,
			"team": u.team, "dps": skill_raw(u, 0.0, float(p.get("dpsSp", 0.0))),
			"type": String(p.get("type", "magic")), "status": zone_status, "fx": "groundMark",
		})
		var dr_v: Variant = p.get("damageReduction", null)
		if dr_v != null:
			api.add_status(u, u, "dr", float(dur_v), float(dr_v) * 100.0)

	# ─────────── 复活 ───────────
	IMPL["resurrect"] = func(api, u: Unit, spec: Dictionary, _target, _cell):
		var p: Dictionary = spec["params"]
		var dead := []
		for x: Unit in api.units:
			if not x.alive and x.team == u.team and not x.is_minion and not x.revived:
				dead.append(x)
		if not dead.is_empty():
			dead.sort_custom(func(a, b):
				if int(b.entry["cost"]) != int(a.entry["cost"]):
					return int(a.entry["cost"]) > int(b.entry["cost"])
				return a.uid < b.uid)
			var chosen: Unit = dead[0]
			api.fx("summon", {"cell": Grid.cell_dict(chosen.cell)})
			api.revive(chosen, float(p.get("value", 0.45)), u)
			api.fx("healWave", {"cell": Grid.cell_dict(chosen.cell)})
		else:
			for al: Unit in api.units:
				if al.alive and al.team == u.team:
					api.heal(u, al, al.max_hp * float(p.get("value", 0.45)))
					api.fx("healWave", {"cell": Grid.cell_dict(al.cell)})


## 施放技能的统一入口
static func execute_skill(api, u: Unit) -> void:
	_init_impls()
	var spec_v: Variant = u.entry.get("skillSpec", null)
	if not (spec_v is Dictionary) or (spec_v as Dictionary).is_empty():
		return
	var spec: Dictionary = spec_v
	var impl: Callable = IMPL.get(String(spec["kind"]), Callable())
	if not impl.is_valid():
		push_error("未知技能类型: %s（%s）—— champions 与 skills.IMPL 脱节" % [String(spec["kind"]), String(u.entry["id"])])
		return
	var targets: Array = api.resolve_targets(u, String(spec["target"]), 1)
	var target: Unit = targets[0] if not targets.is_empty() else null
	var cell: Vector2i = api.resolve_target_cell(u, String(spec["target"]))
	impl.call(api, u, spec, target, cell)
