## 羁绊运行时（src/core/traits.ts）。静态数值开局写面板；行为钩子挂队伍。
## 高档位包含低档位效果。所有数字经 Spec.tune（调参面，线上进程读默认值）。
## GDScript 闭包按值捕获标量 —— 跨回调共享的可变状态（围攻 nowTick 等）必须装箱进字典。
class_name Traits
extends RefCounted


static func _is_member(members: Array, u: Unit) -> bool:
	return members.has(u)


static func _enemies_near(api, u: Unit, radius: int) -> Array:
	var out := []
	for x: Unit in api.units:
		if x.alive and x.team != u.team and Grid.chebyshev(x.cell, u.cell) <= radius:
			out.append(x)
	return out


static func _allies_near(api, u: Unit, radius: int) -> Array:
	var out := []
	for x: Unit in api.units:
		if x.alive and x.team == u.team and Grid.chebyshev(x.cell, u.cell) <= radius:
			out.append(x)
	return out


static func _tuner(id: String) -> Callable:
	return func(key: String, def: float) -> float:
		return Spec.tune(id, key, def)


## id → 实现（ctx = {api, team, tier, members, teamUnits}）
static var IMPL: Dictionary = {}


static func _init_impls() -> void:
	if not IMPL.is_empty():
		return

	# ══════════════ 天庭 [生存] ══════════════
	IMPL["tian"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("tian")
		var tier: int = int(members[0].tstate.tier.get("tian", 0)) if not members.is_empty() else 0
		var pct: float = t.call("shield1", 0.24) if tier >= 1 else t.call("shield0", 0.08)
		var team0: int = members[0].team if not members.is_empty() else 0
		(api.hooks_of(team0)["onBattleStart"] as Array).append(func(_a, _team):
			for u: Unit in members:
				api.add_shield(null, u, u.max_hp * pct, 999.0))
		if tier >= 1:
			(api.hooks_of(members[0].team)["onShieldBreak"] as Array).append(func(a, unit):
				if not _is_member(members, unit):
					return
				api.fx("nova", {"uid": unit.uid, "radius": 1, "params": {"hue": 0}})
				for e: Unit in _enemies_near(api, unit, 1):
					api.deal_damage(unit, e, unit.eff_sp() * t.call("novaSp", 1.6), "magic", {"source": "trait"}))

	# ══════════════ 幽冥 [生存] ══════════════
	IMPL["youming"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("youming")
		var tier: int = int(members[0].tstate.tier.get("youming", 0))
		(api.hooks_of(members[0].team)["onDeath"] as Array).append(func(a, victim, _killer):
			# 亡语只算棋子本体，召唤物不算
			if victim.is_minion:
				return
			var allies := []
			for x: Unit in a.units:
				if x.alive and x.team == victim.team:
					allies.append(x)
			if not allies.is_empty():
				var nearest: Unit = allies[0]
				var best := INF
				for al: Unit in allies:
					var d := Grid.chebyshev(al.cell, victim.cell)
					if d < best:
						best = d
						nearest = al
				a.heal(null, nearest, victim.max_hp * t.call("deathHeal", 0.06))
			# 四档：首次阵亡复活（与不朽衣解耦，按来源独立计数各自一次）
			if tier >= 1 and _is_member(members, victim) and not victim.is_minion and not victim.trait_stacks.get("youmingRevived", false):
				victim.trait_stacks["youmingRevived"] = true
				a.revive(victim, t.call("reviveHp", 0.1), victim)
				a.add_status(victim, victim, "aspdUp", 999.0, t.call("reviveAspd", 30.0))
				a.add_status(victim, victim, "dr", t.call("reviveFragileDur", 4.0), -t.call("reviveFragilePct", 35.0))
				a.fx("summon", {"uid": victim.uid}))

	# ══════════════ 山海 [节奏] ══════════════
	IMPL["shanhai"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("shanhai")
		var tier: int = int(members[0].tstate.tier.get("shanhai", 0))
		var total_pct: float = t.call("bleed1", 0.16) if tier >= 1 else t.call("bleed0", 0.08)
		(api.hooks_of(members[0].team)["onAttackHit"] as Array).append(func(a, src, dst, _amount, _type):
			if not _is_member(members, src):
				return
			a.add_dot(src, dst, "bleed", (dst.max_hp * total_pct) / 3.0, 3.0, "true")
			if tier >= 1:
				a.add_status(src, dst, "wound", 3.0, t.call("wound", 40.0)))

	# ══════════════ 剑宗 [经济] ══════════════
	IMPL["jianzong"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("jianzong")
		var tier: int = int(members[0].tstate.tier.get("jianzong", 0))
		for u: Unit in members:
			u.crit_chance += t.call("crit", 0.2)
			if tier >= 1:
				u.crit_mult += t.call("critMult", 0.2)
				u.tstate.armor_pen = minf(0.85, u.tstate.armor_pen + t.call("armorPen", 0.18))
		if tier >= 1:
			# 全队小额破甲铺垫：单次生效（人数在公式里自缩放；历史误嵌循环叠 4 次）
			var pen: float = minf(t.call("penCap", 0.2), t.call("penBase", 0.04) + members.size() * t.call("penStep", 0.04))
			for ally: Unit in api.units:
				if ally.team != members[0].team:
					continue
				ally.tstate.armor_pen = minf(0.85, ally.tstate.armor_pen + pen)
		if tier >= 1:
			(api.hooks_of(members[0].team)["onKill"] as Array).append(func(a, killer, _victim):
				if not _is_member(members, killer):
					return
				# 击杀回蓝吃施法锁定窗（与其余增量通道同口径）
				if killer.mana_lock > 0.0:
					return
				killer.mp = minf(killer.max_mp, killer.mp + t.call("killMana", 20.0))
				a.emit({"t": "mana", "tick": a.tick, "uid": killer.uid, "mp": killer.mp, "maxMp": killer.max_mp}))

	# ══════════════ 妖族 [生存] ══════════════
	IMPL["yaozu"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("yaozu")
		var tier: int = int(members[0].tstate.tier.get("yaozu", 0))
		for u: Unit in members:
			u.omnivamp += t.call("vamp1", 0.36) if tier >= 1 else t.call("vamp0", 0.15)
		if tier >= 1:
			(api.hooks_of(members[0].team)["onDamageTaken"] as Array).append(func(a, dst, _src, _amount, _type, _opts):
				if not _is_member(members, dst) or dst.yaozu_transformed or not dst.alive:
					return
				if dst.hp / dst.max_hp > t.call("transformAt", 0.6):
					return
				dst.yaozu_transformed = true
				a.heal(dst, dst, dst.max_hp * t.call("transformHeal", 0.24))
				a.fx("healWave", {"uid": dst.uid})
				# 化形清负面走状态事件流（逐条补 removed 账）
				var purged := []
				var kept := []
				for s: Status in dst.statuses:
					if s.kind == "stun" or s.kind == "silence" or s.kind == "disarm" or s.kind == "slow":
						purged.append(s)
					else:
						kept.append(s)
				if not purged.is_empty():
					dst.statuses = kept
					for s: Status in purged:
						a.emit({"t": "status", "tick": a.tick, "uid": dst.uid, "kind": s.kind, "dur": 0.0, "value": 0.0, "added": false})
				a.add_status(dst, dst, "aspdUp", 6.0, t.call("transformAspd", 35.0))
				a.add_status(dst, dst, "dr", 6.0, t.call("transformDr", 35.0))
				a.add_status(dst, dst, "atkUp", 6.0, t.call("transformAtk", 15.0))
				a.fx("buffAura", {"uid": dst.uid, "params": {"hue": 1}})
				a.emit({"t": "status", "tick": a.tick, "uid": dst.uid, "kind": "transform", "dur": 6.0, "value": 1.0, "added": true}))

	# ══════════════ 墨门 [生存] ══════════════
	IMPL["momen"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("momen")
		var tier: int = int(members[0].tstate.tier.get("momen", 0))
		var dr: float = t.call("drHigh", 0.2) if tier >= 2 else t.call("drLow", 0.1)
		for u: Unit in members:
			u.tstate.all_dr = minf(0.9, u.tstate.all_dr + dr)
			u.max_hp = ParityUtil.js_round(u.max_hp * (1.0 + t.call("hpUp", 0.1)))
			u.hp = u.max_hp
		if tier >= 1:
			for u: Unit in api.units:
				if u.team == members[0].team:
					u.tstate.all_dr = minf(0.9, u.tstate.all_dr + t.call("teamDr", 0.08))
			for u: Unit in members:
				u.tstate.hp_regen_pct_per_sec += t.call("regen", 0.018)
		if tier >= 2:
			# 兼爱：友军所受伤害 30% 转由存活墨门均摊（noShare 防递归；silent 防飘字刷屏）
			(api.hooks_of(members[0].team)["onIncomingDamage"] as Array).append(func(a, dst, src, damage, type, opts):
				if opts.get("noShare", false) or not dst.alive:
					return
				if _is_member(members, dst):
					return
				var alive := []
				for m: Unit in members:
					if m.alive:
						alive.append(m)
				if alive.is_empty():
					return
				var shared: float = damage["amount"] * t.call("sharePct", 0.3)
				var per: float = shared / alive.size()
				damage["amount"] = damage["amount"] - shared
				(damage["deferred"] as Array).append(func():
					for m: Unit in alive:
						a.deal_damage(src, m, per, type, {"source": "trait", "noShare": true, "silent": true})))

	# ══════════════ 兵家 [节奏] ══════════════
	IMPL["bingjia"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("bingjia")
		var tier: int = int(members[0].tstate.tier.get("bingjia", 0))
		for u: Unit in members:
			u.atk = ParityUtil.js_round(u.atk * (1.0 + t.call("atkUp", 0.20)))
		if tier >= 1:
			for u: Unit in api.units:
				if u.team != members[0].team:
					continue
				u.perm_atk_pct += t.call("teamAtk", 0.22)
				u.perm_aspd_pct += t.call("teamAspd", 0.17)
			# 攻城：对高护甲目标普攻附伤
			(api.hooks_of(members[0].team)["onPreAttack"] as Array).append(func(_a, src, dst, mod):
				if src.team != members[0].team:
					return
				if dst.eff_armor() < t.call("siegeArmor", 55.0):
					return
				mod["bonusPhysical"] += src.atk * t.call("siegeAtk", 0.15))
		if tier >= 2:
			var team: int = members[0].team
			(api.hooks_of(team)["onKill"] as Array).append(func(a, killer, _victim):
				if killer.team != team:
					return
				var mult: float = 2.0 if _is_member(members, killer) else 1.0
				var atk: float = t.call("growAtk", 0.26) * mult
				var aspd: float = t.call("growAspd", 0.18) * mult
				for u: Unit in a.units:
					if not u.alive or u.team != team:
						continue
					u.perm_atk_pct += atk
					u.perm_aspd_pct += aspd
				a.fx("buffAura", {"uid": killer.uid, "params": {"hue": 1}}))

	# ══════════════ 机关 [节奏] ══════════════
	IMPL["jiguan"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("jiguan")
		var tier: int = int(members[0].tstate.tier.get("jiguan", 0))
		for u: Unit in members:
			u.base_armor += t.call("armor", 22.0)
			u.tstate.thorn_resist = minf(0.9, t.call("thornResist", 0.65))
		var team: int = members[0].team
		if tier >= 1:
			var pen: float = t.call("pen", 0.0)
			for u: Unit in members:
				u.tstate.armor_pen = minf(0.85, u.tstate.armor_pen + pen)
		# 每 5 秒永久攻速（低档）
		if tier < 1:
			(api.hooks_of(team)["onTick"] as Array).append(func(a, _team, tick):
				if tick == 0 or tick % (5 * 30) != 0:
					return
				for u: Unit in members:
					if not u.alive:
						continue
					u.perm_aspd_pct += t.call("tickAspd", 0.1)
					a.emit({"t": "status", "tick": tick, "uid": u.uid, "kind": "jiguanStack", "dur": 0.0, "value": 1.0, "added": true}))
		# 围攻：友军近窗内先动手，本成员跟进攻击时追加物伤（自缩放，对甲墙特异）
		var gang_atk: float = t.call("gangAtk", 6.0)
		var gang_min_armor: float = t.call("gangMinArmor", 0.0)
		var gang_target_t2: float = t.call("gangTargetT2", 1.0)
		if gang_atk > 0:
			var window_ticks: int = maxi(1, int(ParityUtil.js_round(t.call("gangWindow", 0.75) * 30.0)))
			var last_hit := {}
			var state := {"now": 0}
			(api.hooks_of(team)["onTick"] as Array).append(func(_a, _team, tick):
				state["now"] = tick)
			# onDamageTaken 按受害者队伍分发：要观测"友军打了敌方"，记录器挂敌方 hooks
			for foe: int in api.enemy_teams_of(team):
				(api.hooks_of(foe)["onDamageTaken"] as Array).append(func(_a, dst, src, _amount, _type, _opts):
					if src == null or src == dst or src.team != team:
						return
					if not dst.alive:
						return
					last_hit[dst.uid] = {"tick": state["now"], "srcUid": src.uid})
			(api.hooks_of(team)["onPreAttack"] as Array).append(func(_a, src, dst, mod):
				if not _is_member(members, src):
					return
				var rec = last_hit.get(dst.uid, null)
				if rec == null or rec["srcUid"] == src.uid:
					return
				if int(state["now"]) - int(rec["tick"]) > window_ticks:
					return
				if gang_target_t2 > 0 and int(dst.tstate.tier.get("guardian", -1)) < 2:
					return
				if gang_min_armor > 0 and dst.eff_armor() < gang_min_armor:
					return
				mod["bonusPhysical"] += src.atk * gang_atk * (dst.eff_armor() / (100.0 + dst.eff_armor())))
		if tier >= 1:
			# 构装护体 + 攻速叠层 + 第 4 击
			for u: Unit in members:
				u.base_mr += t.call("constructMr", 10.0)
			(api.hooks_of(team)["onAttackHit"] as Array).append(func(_a, src, _dst, _amount, _type):
				if not _is_member(members, src):
					return
				var s: float = float(src.trait_stacks.get("jiguan", 0.0)) + 1.0
				src.trait_stacks["jiguan"] = s
				if s <= 8.0:
					src.perm_aspd_pct += t.call("stackAspd", 0.12))
			(api.hooks_of(team)["onPreAttack"] as Array).append(func(_a, src, dst, mod):
				if not _is_member(members, src):
					return
				if (src.attack_count + 1) % 4 == 0:
					mod["bonusPhysical"] += src.atk * t.call("fourthHitAtk", 1.8)
					mod["bonusPhysical"] += dst.max_hp * t.call("fourthHitGiant", 0.0)
					mod["bonusPhysical"] += dst.eff_armor() * t.call("fourthHitCrush", 0.0))

	# ══════════════ 丹鼎 [节奏] ══════════════
	IMPL["danding"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("danding")
		var tier: int = int(members[0].tstate.tier.get("danding", 0))
		for u: Unit in members:
			u.tstate.hp_regen_pct_per_sec += t.call("regen", 0.015)
			if tier >= 1:
				u.tstate.mana_per_sec += t.call("manaPerSec", 3.0)
		if tier >= 1:
			(api.hooks_of(members[0].team)["onHealOverflow"] as Array).append(func(a, target, _src, overflow):
				if not _is_member(members, target):
					return
				a.add_shield(null, target, overflow, 999.0, {"alreadySustained": true}))

	# ══════════════ 龙渊 [技能] ══════════════
	IMPL["longyuan"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("longyuan")
		var tier: int = int(members[0].tstate.tier.get("longyuan", 0))
		var team: int = members[0].team
		for u: Unit in members:
			u.sp += t.call("spFlat", 30.0)
			if tier >= 1:
				u.tstate.skill_amp += t.call("skillAmp", 0.32)
		if tier >= 1:
			for u: Unit in api.units:
				if u.team != team:
					continue
				u.sp += t.call("teamSp", 18.0)
				u.tstate.skill_amp += t.call("teamAmp", 0.09)
		if tier >= 1:
			(api.hooks_of(team)["onCast"] as Array).append(func(a, unit):
				if not _is_member(members, unit):
					return
				a.add_status(unit, unit, "spellCharge", 4.0, unit.eff_sp() * t.call("spellChargeSp", 0.8))
				a.fx("buffAura", {"uid": unit.uid, "params": {"hue": 2}}))

	# ══════════════ 武将 ══════════════
	IMPL["warrior"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("warrior")
		var tier: int = int(members[0].tstate.tier.get("warrior", 0))
		var defaults := [0.2, 0.45, 0.75]
		var pct: float = t.call("atk%d" % tier, defaults[tier] if tier < 3 else 0.2)
		for u: Unit in members:
			u.atk = ParityUtil.js_round(u.atk * (1.0 + pct))
		if tier >= 1:
			(api.hooks_of(members[0].team)["onAttackHit"] as Array).append(func(a, src, _dst, _amount, _type):
				if not _is_member(members, src):
					return
				var s: float = float(src.trait_stacks.get("warrior", 0.0))
				if s >= 10.0:
					return
				src.trait_stacks["warrior"] = s + 1.0
				src.perm_atk_pct += t.call("stackAtk", 0.025)
				if s + 1.0 == 10.0:
					a.fx("buffAura", {"uid": src.uid, "params": {"hue": 1}}))
		if tier >= 2:
			for u: Unit in members:
				u.tstate.physical_dr += t.call("physDr", 0.18)

	# ══════════════ 护卫 ══════════════
	IMPL["guardian"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("guardian")
		var tier: int = int(members[0].tstate.tier.get("guardian", 0))
		var hp_defaults := [0.14, 0.24, 0.28]
		var armor_defaults := [16.0, 26.0, 32.0]
		var hp_pct: float = t.call("hp%d" % tier, hp_defaults[tier] if tier < 3 else 0.14)
		var armor: float = t.call("armor%d" % tier, armor_defaults[tier] if tier < 3 else 16.0)
		var swap_cut: float = t.call("t2ArmorCut", 0.0) if tier >= 2 else 0.0
		var swap_hp: float = t.call("t2HpGain", 0.0) if tier >= 2 else 0.0
		for u: Unit in members:
			u.max_hp = ParityUtil.js_round(u.max_hp * (1.0 + hp_pct + swap_hp))
			u.hp = u.max_hp
			u.base_armor += armor * (1.0 - swap_cut)
		var team: int = members[0].team
		if tier >= 1:
			(api.hooks_of(team)["onBattleStart"] as Array).append(func(a, _team):
				for u: Unit in members:
					for al: Unit in _allies_near(a, u, 1):
						if al == u:
							continue
						a.add_shield(u, al, u.max_hp * t.call("allyShield", 0.12), 999.0))
		if tier >= 2:
			for u: Unit in members:
				u.atk = ParityUtil.js_round(u.atk * t.call("guard6Atk", 1.15))
			(api.hooks_of(team)["onTick"] as Array).append(func(a, _team, tick):
				if tick == 0 or tick % (3 * 30) != 0:
					return
				for u: Unit in members:
					if not u.alive:
						continue
					a.add_shield(u, u, u.max_hp * t.call("shieldRegen", 0.014), 999.0))
			# 荆棘：单秒衰减/封顶以 tick 界重置（MECH 软化通道，默认档=禁用）
			var thorn_sec := {}
			(api.hooks_of(team)["onTick"] as Array).append(func(_a, _team, tick):
				if tick % 30 != 0:
					return
				thorn_sec.clear())
			(api.hooks_of(team)["onDamageTaken"] as Array).append(func(a, dst, src, _amount, type, opts):
				if type != "physical" or opts.get("noReflect", false):
					return
				if src == null or not _is_member(members, dst) or not dst.alive or not src.alive:
					return
				var st: Dictionary = thorn_sec.get(dst.uid, null)
				if st == null:
					st = {"hits": 0, "sum": 0.0}
					thorn_sec[dst.uid] = st
				var hp_thorns: float = t.call("t2ThornsHpPct", 0.0) if tier >= 2 else 0.0
				var base: float = dst.max_hp * hp_thorns if hp_thorns > 0.0 else dst.base_armor * t.call("thornsArmorRatio", 0.52)
				var resist: float = 1.0 - src.tstate.thorn_resist
				var decayed: float = base * resist * pow(Spec.mech("thornDecayPerHit"), float(st["hits"]))
				var sec_cap: float = dst.max_hp * Spec.mech("thornSecCapHpRatio") if Spec.mech("thornSecCapHpRatio") > 0.0 else INF
				var dmg: float = minf(decayed, maxf(0.0, sec_cap - float(st["sum"])))
				if dmg <= 0.0:
					return
				st["hits"] = int(st["hits"]) + 1
				st["sum"] = float(st["sum"]) + dmg
				a.deal_damage(dst, src, dmg, "physical", {"source": "trait", "noReflect": true}))

	# ══════════════ 刺客 [站位] ══════════════
	IMPL["assassin"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("assassin")
		var tier: int = int(members[0].tstate.tier.get("assassin", 0))
		for u: Unit in members:
			u.crit_chance += t.call("crit", 0.2)
			if tier >= 1:
				u.crit_mult += t.call("critMult", 0.35)
		var team: int = members[0].team
		if tier >= 1:
			# 猎盾：对护盾目标的附伤（刺客流对护盾墙的条件化通道）
			(api.hooks_of(team)["onPreAttack"] as Array).append(func(_a, src, dst, mod):
				if not _is_member(members, src) or dst.shield <= 0.0:
					return
				mod["bonusPhysical"] += dst.max_hp * t.call("breakerPct", 0.05))
		(api.hooks_of(members[0].team)["onBattleStart"] as Array).append(func(a, _team):
			# 延迟 1.0s 跃入（等前排咬住），落地 0.7s 烟遁无敌
			a.schedule(Spec.c("ASSASSIN_LEAP_DELAY", 1.0), func(api2):
				for u: Unit in members:
					if not u.alive:
						continue
					var foes := []
					for x: Unit in api2.units:
						if x.alive and x.team != u.team:
							foes.append(x)
					if foes.is_empty():
						continue
					var back_row: int = foes[0].cell.y
					for f: Unit in foes:
						if absi(f.cell.y - u.cell.y) > absi(back_row - u.cell.y):
							back_row = f.cell.y
					var candidates := []
					var r_second: int = back_row + (-1 if u.cell.y > back_row else 1)
					for c: int in Grid.COLS:
						for r: int in [back_row, r_second]:
							if r >= 0 and r < Grid.ROWS and not api2.occupied(c, r):
								candidates.append(Vector2i(c, r))
					if candidates.is_empty():
						continue
					var sorted_c: Array = ParityUtil.stable_sort_by(candidates, func(p):
						var dc := int(p.x) - u.cell.x
						var dr := int(p.y) - u.cell.y
						return sqrt(float(dc * dc + dr * dr)))
					var dest: Vector2i = sorted_c[0]
					api2.teleport(u, dest, 0.28)
					if tier >= 1:
						api2.add_status(u, u, "aspdUp", 5.0, t.call("leapAspd", 35.0))
					api2.add_status(u, u, "invuln", Spec.c("ASSASSIN_SMOKE_DURATION", 0.7), 0.0)
					api2.fx("dashTrail", {"uid": u.uid, "cell": Grid.cell_dict(dest)})
					# 攻其不备：烟遁散去瞬间突袭落点最近敌人（不受分摊）
					if tier >= 1:
						api2.schedule(Spec.c("ASSASSIN_SMOKE_DURATION", 0.7), func(api3):
							if not u.alive:
								return
							var foes3 := []
							for x: Unit in api3.units:
								if x.alive and x.team != u.team:
									foes3.append(x)
							if foes3.is_empty():
								return
							var mark: Unit = foes3[0]
							var best := INF
							for f: Unit in foes3:
								var d := Grid.chebyshev(f.cell, u.cell)
								if d < best:
									best = d
									mark = f
							api3.deal_damage(u, mark, mark.max_hp * t.call("openerPct", 0.12), "physical", {"source": "trait", "noShare": true})
							api3.fx("dashTrail", {"uid": u.uid, "cell": Grid.cell_dict(mark.cell)}))))

	# ══════════════ 神射 ══════════════
	IMPL["marksman"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("marksman")
		var tier: int = int(members[0].tstate.tier.get("marksman", 0))
		for u: Unit in members:
			u.range += 1
			u.atk = ParityUtil.js_round(u.atk * (1.0 + t.call("atk", 0.15)))
		if tier >= 1:
			for u: Unit in members:
				u.crit_mult += t.call("critMult", 0.3)
			(api.hooks_of(members[0].team)["onPreAttack"] as Array).append(func(_a, src, _dst, mod):
				if not _is_member(members, src):
					return
				if src.attack_count % 3 == 2:
					mod["forceCrit"] = true)

	# ══════════════ 方士 [技能] ══════════════
	IMPL["mage"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("mage")
		var tier: int = int(members[0].tstate.tier.get("mage", 0))
		var sp_defaults := [24.0, 46.0, 78.0]
		var sp_flat: float = t.call("sp%d" % tier, sp_defaults[tier] if tier < 3 else 24.0)
		for u: Unit in members:
			u.sp += sp_flat
		if tier >= 1:
			(api.hooks_of(members[0].team)["onBattleStart"] as Array).append(func(a, _team):
				var pool := []
				for x: Unit in a.units:
					if x.alive and x.team == members[0].team:
						pool.append(x)
				for u: Unit in pool:
					a.add_shield(null, u, u.max_hp * t.call("shield", 0.16), 999.0))
		if tier >= 2:
			(api.hooks_of(members[0].team)["onBattleStart"] as Array).append(func(a, _team):
				var pool := []
				for x: Unit in a.units:
					if x.alive and x.team == members[0].team:
						pool.append(x)
				for u: Unit in pool:
					a.add_shield(null, u, u.max_hp * t.call("shield2", 0.06), 999.0))
		if tier >= 1:
			for u: Unit in api.units:
				if u.team != members[0].team:
					continue
				u.sp += t.call("teamSp", 14.0)
				u.tstate.skill_amp += t.call("teamAmp", 0.06)
		if tier >= 2:
			for u: Unit in api.units:
				if u.team != members[0].team:
					continue
				u.sp += t.call("teamSp2", 10.0)
				u.tstate.skill_amp += t.call("teamAmp2", 0.05)
		var team: int = members[0].team
		if tier >= 1:
			(api.hooks_of(team)["onDamageDealt"] as Array).append(func(a, src, dst, _amt, _type, source):
				if source != "skill" or not _is_member(members, src):
					return
				a.add_status(src, dst, "mrShred", 4.0, t.call("shred", 20.0)))
		if tier >= 2:
			(api.hooks_of(team)["onDamageDealt"] as Array).append(func(a, src, dst, amount, type, source):
				if source != "skill" or not _is_member(members, src):
					return
				for e: Unit in a.units_in_radius(dst.cell, 1):
					if e == dst or e.team == src.team or not e.alive:
						continue
					a.deal_damage(src, e, amount * t.call("splash", 0.55), type, {"source": "trait"}))

	# ══════════════ 术士 ══════════════
	IMPL["warlock"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var t: Callable = _tuner("warlock")
		var tier: int = int(members[0].tstate.tier.get("warlock", 0))
		for u: Unit in members:
			u.tstate.skill_true_ratio = t.call("true1", 0.3) if tier >= 1 else t.call("true0", 0.15)
		if tier >= 1:
			(api.hooks_of(members[0].team)["onDamageDealt"] as Array).append(func(a, src, dst, _amt, _type, source):
				if source != "skill" or not _is_member(members, src):
					return
				a.add_status(src, dst, "wound", 3.0, t.call("wound", 30.0)))

	# ══════════════ 丹师 ══════════════
	IMPL["support"] = func(ctx: Dictionary):
		var api = ctx["api"]
		var members: Array = ctx["members"]
		var team_units: Array = ctx["teamUnits"]
		var t: Callable = _tuner("support")
		var tier: int = int(members[0].tstate.tier.get("support", 0))
		for u: Unit in team_units:
			u.tstate.hp_regen_pct_per_sec += t.call("regen", 0.012)
		if tier >= 1:
			for u: Unit in members:
				u.tstate.heal_amp += t.call("healAmp", 0.8)
				u.tstate.shield_amp += t.call("shieldAmp", 0.8)
			(api.hooks_of(members[0].team)["onDeath"] as Array).append(func(a, victim, _killer):
				if victim.is_minion:
					return
				for u: Unit in a.units:
					if not u.alive or u.team != victim.team:
						continue
					var cur: float = float(u.trait_stacks.get("supportAspdStacks", 0.0))
					if cur >= 5.0:
						continue
					u.trait_stacks["supportAspdStacks"] = cur + 1.0
					a.add_status(victim, u, "aspdUp", 8.0, t.call("deathAspd", 20.0)))


static func compute_active_traits(units: Array, trait_id: String) -> Dictionary:
	var members := []
	for u: Unit in units:
		if not u.is_minion and ((u.entry.get("origins", []) as Array).has(trait_id) or (u.entry.get("classes", []) as Array).has(trait_id)):
			members.append(u)
	# 同名棋子只计一次（升星不叠加羁绊数）
	var unique := {}
	for u: Unit in members:
		unique[u.entry["id"]] = true
	return {"members": members, "count": unique.size()}


## 在战斗开局套用全部羁绊。顺序契约：先静态数值后钩子；
## 钩子注册顺序 = 羁绊 id 字典序 → 装备（items_core 固定序），SHIELD_CAP 的
## "谁先吃满额度"依赖此顺序 —— 改动前先想清楚。
static func apply_traits(api, team: int, active: Array, team_units: Array) -> void:
	_init_impls()
	var sorted: Array = (active as Array).duplicate()
	sorted.sort_custom(func(a, b):
		return String(a["id"]) < String(b["id"]))
	for at: Dictionary in sorted:
		var tier: int = int(at["tier"])
		if tier < 0:
			continue
		var members: Array = compute_active_traits(team_units, String(at["id"]))["members"]
		if members.is_empty():
			continue
		# 存 0-based 档位（0=首档）——历史 +1 事故的修正口径
		for m: Unit in members:
			m.tstate.tier[String(at["id"])] = tier
		var impl: Callable = IMPL.get(String(at["id"]), Callable())
		if not impl.is_valid():
			push_error("未知羁绊实现: %s —— traits 数据与 TRAIT_IMPL 脱节" % String(at["id"]))
			continue
		impl.call({"api": api, "team": team, "tier": tier, "members": members, "teamUnits": team_units})
