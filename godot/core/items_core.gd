## 装备运行时（src/core/items.ts）。装备三层生效：面板属性（createUnit 并入）、
## 状态修正（开战前累加进 Unit.tstate）、行为钩子（注册进队伍 BattleHooks）。
## 钩子签名（与 battle.gd 的分发口径一一对应）：
##   onBattleStart(api, team) / onTick(api, team, tick) / onPreAttack(api, src, dst, mod)
##   onAttackHit(api, src, dst, amount, type) / onDamageDealt(api, src, dst, amount, type, source)
##   onIncomingDamage(api, dst, src, damage, type, opts) / onDamageTaken(api, dst, src, amount, type, opts)
##   onKill(api, killer, victim) / onDeath(api, victim, killer) / onCast(api, unit)
##   onShieldBreak(api, unit) / onHealOverflow(api, target, src, overflow)
class_name ItemFx
extends RefCounted


## 一件装备拆出的三层效果：bonus/mods 按件求和；params（钩子参数）同钩取 max
static func item_effects(item_ids: Array) -> Dictionary:
	Spec.ensure()
	var bonus := {}
	var mods := {}
	var hooks: Array = []
	var params := {}
	for id: String in item_ids:
		var def = Spec.item_by_id.get(id, null)
		# 名单外装备：push_error 后跳过该件（GDScript 无异常系统，TS 的 throw 整场
		# 作废降级为 log+skip——与未知棋子的 _bad_input 整场拒建不同口径；坏档/旧档
		# 带已删装备时跳过比整场报废更稳。报错必留痕，绝不静默）
		if def == null or def.is_empty():
			push_error("未知装备 id：%s" % id)
			continue
		var d_bonus: Dictionary = def.get("bonus", {})
		for k: String in d_bonus:
			bonus[k] = float(bonus.get(k, 0.0)) + float(d_bonus[k])
		var d_mods: Dictionary = def.get("mods", {})
		for k: String in d_mods:
			mods[k] = float(mods.get(k, 0.0)) + float(d_mods[k])
		for h: String in def.get("hooks", []):
			hooks.append(h)
		var d_params: Dictionary = def.get("params", {})
		for k: String in d_params:
			params[k] = maxf(float(params.get(k, 0.0)), float(d_params[k]))
	return {"bonus": bonus, "mods": mods, "hooks": hooks, "params": params}


## 装备状态修正累加进 TraitState（羁绊先写、装备后加，叠加生效）
static func apply_item_mods(u: Unit, item_ids: Array) -> void:
	if item_ids.is_empty():
		return
	var mods: Dictionary = item_effects(item_ids)["mods"]
	var t: TraitState = u.tstate
	if mods.get("armorPen", null) != null:
		t.armor_pen = minf(0.85, t.armor_pen + float(mods["armorPen"]))
	if mods.get("skillAmp", null) != null:
		t.skill_amp += float(mods["skillAmp"])
	if mods.get("physicalDr", null) != null:
		t.physical_dr = minf(0.9, t.physical_dr + float(mods["physicalDr"]))
	if mods.get("magicDr", null) != null:
		t.magic_dr = minf(0.9, t.magic_dr + float(mods["magicDr"]))
	if mods.get("manaPerSec", null) != null:
		t.mana_per_sec += float(mods["manaPerSec"])
	if mods.get("hpRegenPctPerSec", null) != null:
		t.hp_regen_pct_per_sec += float(mods["hpRegenPctPerSec"])
	if mods.get("healAmp", null) != null:
		t.heal_amp += float(mods["healAmp"])
	if mods.get("allDr", null) != null:
		t.all_dr = minf(0.9, t.all_dr + float(mods["allDr"]))
	# 倍率/绝对值语义取最大而非求和：两把狮心盾不该把承伤转蓝叠到 1.6
	if mods.get("manaFromDamageMult", null) != null:
		t.mana_from_damage_mult = maxf(t.mana_from_damage_mult, float(mods["manaFromDamageMult"]))
	if mods.get("skillCritChance", null) != null:
		t.skill_crit_chance = minf(1.0, t.skill_crit_chance + float(mods["skillCritChance"]))
	if mods.get("skillCritMult", null) != null:
		t.skill_crit_mult = maxf(t.skill_crit_mult, float(mods["skillCritMult"]))


## 取某件装备**本钩子**的参数值（params 键名是全局命名空间，必须带 hook 过滤；
## 聚合口径与 item_effects 一致：同钩多件取最大）
static func param_of(u: Unit, hook: String, key: String) -> float:
	Spec.ensure()
	var m := 0.0
	for id: String in u.item_ids:
		var def = Spec.item_by_id.get(id, null)
		if def == null or not (def.get("hooks", []) as Array).has(hook):
			continue
		var v: Variant = def.get("params", {}).get(key, null)
		if v != null:
			m = maxf(m, float(v))
	return m


static func _has(u: Unit, hook: String) -> bool:
	return (u.item_hooks as Array).has(hook)


static func _some_has(units: Array, hook: String) -> bool:
	for u: Unit in units:
		if _has(u, hook):
			return true
	return false


static func apply_item_hooks(api, team: int, units: Array) -> void:
	var h: Dictionary = api.hooks_of(team)

	# 断魂刃：击杀回复 18% 最大生命
	if _some_has(units, "executeHeal"):
		(h["onKill"] as Array).append(func(a, killer, _victim):
			if not _has(killer, "executeHeal") or not killer.alive:
				return
			var pct := param_of(killer, "executeHeal", "healPct")
			a.heal(killer, killer, killer.max_hp * pct))

	# 玄武甲：受到物理伤害按百分比反弹
	if _some_has(units, "thorns"):
		(h["onDamageTaken"] as Array).append(func(a, dst, src, amount, type, opts):
			if type != "physical" or opts.get("noReflect", false):
				return
			if not _has(dst, "thorns") or not dst.alive or src == null or not src.alive:
				return
			var reflect := param_of(dst, "thorns", "reflectPct")
			if reflect <= 0:
				return
			a.deal_damage(dst, src, amount * reflect, "physical", {"source": "item", "noReflect": true}))

	# 疾风履：越打越快（叠层挂 permAspdPct；只累加新增层数贡献，禁止按总量重算）
	if _some_has(units, "momentum"):
		(h["onAttackHit"] as Array).append(func(a, src, _dst, _amount, _type):
			if not _has(src, "momentum") or not src.alive:
				return
			if src.item_used.has("momentum"):
				return
			var per := param_of(src, "momentum", "aspdPerStack")
			var mx := param_of(src, "momentum", "maxStacks")
			var prev: float = float(src.trait_stacks.get("momentum", 0.0))
			var n: float = minf(mx, prev + 1.0)
			src.trait_stacks["momentum"] = n
			src.perm_aspd_pct += (n - prev) * per
			if n >= mx:
				src.item_used["momentum"] = true
				a.emit({"t": "fx", "tick": a.tick, "uid": src.uid, "kind": "buffAura", "params": {"hue": 1}}))

	# 回天符：治疗溢出转护盾（溢出额已吃加时衰减，alreadySustained 防双重衰减）
	if _some_has(units, "healToShield"):
		(h["onHealOverflow"] as Array).append(func(a, target, src, overflow):
			if src == null or not _has(src, "healToShield") or not target.alive:
				return
			a.add_shield(src, target, overflow * param_of(src, "healToShield", "shieldPct"), 6.0, {"alreadySustained": true}))

	# 不朽衣：首次阵亡复活（itemUsed 来源内互斥；与幽冥各自一次；延迟复活走 scheduleRevive 专用通道）
	if _some_has(units, "immortal"):
		(h["onDeath"] as Array).append(func(a, victim, _killer):
			if not _has(victim, "immortal") or victim.is_minion:
				return
			if victim.item_used.has("immortal"):
				return
			if victim.alive:
				return
			victim.item_used["immortal"] = true
			var delay := param_of(victim, "immortal", "reviveDelay")
			if delay > 0:
				a.schedule_revive(victim, delay, param_of(victim, "immortal", "hpPct"))
			elif not victim.alive:
				a.revive(victim, param_of(victim, "immortal", "hpPct"), victim)
			a.emit({"t": "fx", "tick": a.tick, "uid": victim.uid, "kind": "buffAura"}))

	# ── v1.9 全配方扩展钩子 ──

	# 贯日枪：普攻命中追加法伤
	if _some_has(units, "sunSpear"):
		(h["onAttackHit"] as Array).append(func(a, src, dst, _amount, _type):
			if not _has(src, "sunSpear") or not src.alive or not dst.alive:
				return
			var ratio := param_of(src, "sunSpear", "spRatio")
			if ratio <= 0:
				return
			a.deal_damage(src, dst, src.sp * ratio, "magic", {"source": "item"}))

	# 寒渊镰：普攻减速
	if _some_has(units, "frost"):
		(h["onAttackHit"] as Array).append(func(a, src, dst, _amount, _type):
			if not _has(src, "frost") or not src.alive or not dst.alive:
				return
			a.add_status(src, dst, "slow", param_of(src, "frost", "slowDur"), param_of(src, "frost", "slowPct")))

	# 缚龙爪：损血叠攻（节流 0.2s = tick%6）
	if _some_has(units, "berserk"):
		(h["onTick"] as Array).append(func(a, team, tick):
			if tick % 6 != 0:
				return
			for u: Unit in a.units:
				if u.team != team or not u.alive or not _has(u, "berserk"):
					continue
				var per := param_of(u, "berserk", "atkPerStep")
				var step := param_of(u, "berserk", "stepPct")
				var cap := param_of(u, "berserk", "capPct") * 100.0
				var steps: float = floor((1.0 - u.hp / u.max_hp) / maxf(0.01, step))
				var v := minf(cap, steps * per)
				var prev: float = float(u.trait_stacks.get("fulongPrev", 0.0))
				if v == prev:
					continue
				u.perm_atk_pct += (v - prev) / 100.0
				u.trait_stacks["fulongPrev"] = v)

	# 流星弩：击杀后攻速爆发（层数上限只数本源条目，src 标识同源判定）
	if _some_has(units, "killFrenzy"):
		(h["onKill"] as Array).append(func(a, killer, _victim):
			if not _has(killer, "killFrenzy") or not killer.alive:
				return
			var stacks := 0
			for s: Status in killer.statuses:
				if s.kind == "aspdUp" and s.src == "killFrenzy":
					stacks += 1
			if stacks >= param_of(killer, "killFrenzy", "maxStacks"):
				return
			a.add_status(killer, killer, "aspdUp", param_of(killer, "killFrenzy", "dur"), param_of(killer, "killFrenzy", "aspdPct"), "killFrenzy")
			a.fx("buffAura", {"uid": killer.uid, "params": {"hue": 0}}))

	# 赤练鞭：普攻上易伤
	if _some_has(units, "venom"):
		(h["onAttackHit"] as Array).append(func(a, src, dst, _amount, _type):
			if not _has(src, "venom") or not src.alive or not dst.alive:
				return
			a.add_status(src, dst, "vulnerability", param_of(src, "venom", "vulnDur"), param_of(src, "venom", "vulnPct")))

	# 青圭杖：施法后自盾
	if _some_has(units, "castShield"):
		(h["onCast"] as Array).append(func(a, u):
			if not _has(u, "castShield") or not u.alive:
				return
			a.add_shield(u, u, u.max_hp * param_of(u, "castShield", "shieldPct"), param_of(u, "castShield", "shieldDur")))

	# 追风履：每秒攻速成长（增量累加封顶）
	if _some_has(units, "windRunner"):
		(h["onTick"] as Array).append(func(a, team, tick):
			if tick % 30 != 0:
				return
			for u: Unit in a.units:
				if u.team != team or not u.alive or not _has(u, "windRunner"):
					continue
				var per := param_of(u, "windRunner", "aspdPerSec")
				var max_stacks: float = floor(param_of(u, "windRunner", "capPct") / maxf(0.01, per))
				var prev: float = float(u.trait_stacks.get("zhuifengStacks", 0.0))
				if prev >= max_stacks:
					continue
				u.trait_stacks["zhuifengStacks"] = prev + 1.0
				u.perm_aspd_pct += per / 100.0)

	# 玄铁重甲：周期净化自身减益（按优先序摘一个）
	if _some_has(units, "ironPurge"):
		const PURGE_ORDER: Array = [
			"stun", "silence", "disarm", "wound", "slow",
			"burn", "bleed", "vulnerability", "armorShred", "mrShred", "taunt",
		]
		(h["onTick"] as Array).append(func(a, team, tick):
			for u: Unit in a.units:
				if u.team != team or not u.alive or not _has(u, "ironPurge"):
					continue
				var every: int = maxi(1, int(ParityUtil.js_round(param_of(u, "ironPurge", "everyTicks"))))
				if tick % every != 0:
					continue
				for kind: String in PURGE_ORDER:
					var found := false
					for s: Status in u.statuses:
						if s.kind == kind:
							found = true
							break
					if not found:
						continue
					a.remove_one_status(u, kind)
					a.fx("buffAura", {"uid": u.uid})
					break)

	# 紫电镰：施法后攻速爆发（层数上限只数本源）
	if _some_has(units, "castAspd"):
		(h["onCast"] as Array).append(func(a, u):
			if not _has(u, "castAspd") or not u.alive:
				return
			var stacks := 0
			for s: Status in u.statuses:
				if s.kind == "aspdUp" and s.src == "castAspd":
					stacks += 1
			if stacks >= param_of(u, "castAspd", "maxStacks"):
				return
			a.add_status(u, u, "aspdUp", param_of(u, "castAspd", "dur"), param_of(u, "castAspd", "aspdPct"), "castAspd")
			a.fx("buffAura", {"uid": u.uid, "params": {"hue": 2}}))

	# 引魂灯：施法后治疗生命最低友军
	if _some_has(units, "castHeal"):
		(h["onCast"] as Array).append(func(a, u):
			if not _has(u, "castHeal") or not u.alive:
				return
			var targets: Array = a.resolve_targets(u, "allyLowestHp", 1)
			if targets.is_empty():
				return
			var t: Unit = targets[0]
			var healed: float = a.heal(u, t, u.sp * param_of(u, "castHeal", "healSpRatio"))
			if healed > 0.5:
				a.fx("healWave", {"uid": t.uid}))

	# 垂天翼：开战攻速
	if _some_has(units, "wingStart"):
		(h["onBattleStart"] as Array).append(func(a, team):
			for u: Unit in a.units:
				if u.team != team or not u.alive or not _has(u, "wingStart"):
					continue
				a.add_status(u, u, "aspdUp", param_of(u, "wingStart", "dur"), param_of(u, "wingStart", "aspdPct"), "wingStart"))

	# 九尾面：施法后标记，下次普攻必爆+追法伤
	if _some_has(units, "foxReady"):
		(h["onCast"] as Array).append(func(_a, u):
			if _has(u, "foxReady") and u.alive:
				u.trait_stacks["jiuweiReady"] = 1.0)
		(h["onPreAttack"] as Array).append(func(_a, src, _dst, mod):
			if not _has(src, "foxReady") or not float(src.trait_stacks.get("jiuweiReady", 0.0)):
				return
			src.trait_stacks["jiuweiReady"] = 0.0
			mod["forceCrit"] = true
			mod["bonusMagic"] += src.sp * param_of(src, "foxReady", "bonusSpRatio")
			mod["bonusMagicSource"] = "item")

	# 拂尘扇：每第 N 次普攻缴械目标
	if _some_has(units, "disarmSwat"):
		(h["onAttackHit"] as Array).append(func(a, src, dst, _amount, _type):
			if not _has(src, "disarmSwat") or not src.alive or not dst.alive:
				return
			var every: int = maxi(2, int(ParityUtil.js_round(param_of(src, "disarmSwat", "everyHits"))))
			var n: float = float(src.trait_stacks.get("fuchenHits", 0.0)) + 1.0
			if n < every:
				src.trait_stacks["fuchenHits"] = n
				return
			src.trait_stacks["fuchenHits"] = 0.0
			a.add_status(src, dst, "disarm", param_of(src, "disarmSwat", "disarmDur"), 0.0))

	# 霜翎环：普攻命中按最大生命百分比回复（amount≤0 = 被护盾全吃，不回）
	if _some_has(units, "onHitHeal"):
		(h["onAttackHit"] as Array).append(func(a, src, _dst, amount, _type):
			if not _has(src, "onHitHeal") or not src.alive:
				return
			if float(amount) <= 0.0:
				return
			a.heal(src, src, src.max_hp * param_of(src, "onHitHeal", "healPct")))

	# 紫金炉：普攻命中额外回蓝（与内核 +10 并行，吃法力锁与上限；必须补发 mana 事件）
	if _some_has(units, "onHitMana"):
		(h["onAttackHit"] as Array).append(func(a, src, _dst, _amount, _type):
			if not _has(src, "onHitMana") or not src.alive or src.is_minion:
				return
			if src.mana_lock > 0.0:
				return
			var before: float = src.mp
			src.mp = minf(src.max_mp, src.mp + param_of(src, "onHitMana", "mpPerHit"))
			if src.mp != before:
				a.emit({"t": "mana", "tick": a.tick, "uid": src.uid, "mp": src.mp, "maxMp": src.max_mp}))

	# 墨龙旗：开战全体减伤（多面旗 params 聚合取最大）
	if _some_has(units, "warBanner"):
		(h["onBattleStart"] as Array).append(func(a, team):
			var holder: Unit = null
			for u: Unit in a.units:
				if u.team == team and u.alive and _has(u, "warBanner"):
					holder = u
					break
			if holder == null:
				return
			for al: Unit in a.units:
				if al.team != team or not al.alive:
					continue
				a.add_status(holder, al, "dr", param_of(holder, "warBanner", "dur"), param_of(holder, "warBanner", "drPct"))
			a.fx("shieldWall", {"team": team}))

	# 摄魂铃：受普攻概率眩晕攻击者（内置冷却存 traitStacks）
	if _some_has(units, "bellStun"):
		(h["onDamageTaken"] as Array).append(func(a, dst, src, _amount, _type, opts):
			if not _has(dst, "bellStun") or not dst.alive or src == null or not src.alive:
				return
			if opts.get("source", null) != "attack":
				return
			var next: float = float(dst.trait_stacks.get("shehunNextTick", 0.0))
			if a.tick < next:
				return
			if not a.rng.chance(param_of(dst, "bellStun", "chance")):
				return
			dst.trait_stacks["shehunNextTick"] = float(a.tick) + param_of(dst, "bellStun", "cdTicks")
			a.add_status(dst, src, "stun", param_of(dst, "bellStun", "stunDur"), 0.0)
			a.fx("debuffMark", {"uid": src.uid}))
