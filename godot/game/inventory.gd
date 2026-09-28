## 装备栏与装配（src/game/inventory.ts 对齐版）。
## 规则：一个棋子最多 3 件；成品可卸下且拆回两个组件（误操作可挽回）。
## 容量分层：玩家主动卸装严守 ITEM_BAR_SLOTS；stripItems（卖出/淘汰/合成吃子）
## 允许溢出 —— 装备不该因卖牌蒸发，守恒优先于容量。
class_name Inventory
extends RefCounted

const MAX_ITEMS_PER_UNIT := 3


## 两组件按排序键查配方（TS combine：RECIPE_INDEX[[a,b].sort().join('+')]）
static func combine(a: String, b: String) -> Variant:
	Spec.ensure()
	var pair := [a, b]
	pair.sort()
	var key := "+".join(pair)
	return Spec.recipe_index.get(key, null)


## 把一件装备放进装备栏（未知 id 显式告警兜底，不炸结算流程）
static func add_item(p: Dictionary, item_id: String) -> void:
	Spec.ensure()
	if not Spec.item_by_id.has(item_id):
		push_warning("[inventory] 忽略未知装备 id：%s" % item_id)
		return
	(p["items"] as Array).append(item_id)


## 从装备栏移除一件
static func remove_item(p: Dictionary, item_id: String) -> bool:
	var items: Array = p["items"]
	var i := items.find(item_id)
	if i < 0:
		return false
	items.remove_at(i)
	return true


## 把装备栏里的一件装备装到某个棋子上；身上已有可合成组件则自动合成
static func equip_item(p: Dictionary, iid: int, item_id: String) -> Dictionary:
	Spec.ensure()
	if not Spec.item_by_id.has(item_id):
		return { "ok": false, "reason": "未知装备" }
	if not (p["items"] as Array).has(item_id):
		return { "ok": false, "reason": "装备栏里没有这件" }
	var u: Variant = GameState.find_unit(p, iid)
	if u == null:
		return { "ok": false, "reason": "找不到这个棋子" }
	if u.get("isBeast", false):
		return { "ok": false, "reason": "不能给墨兽装装备" }

	# 先看能否与身上的装备合成
	if String((Spec.item_by_id[item_id] as Dictionary).get("tier", "")) == "component":
		var u_items: Array = u["items"]
		for i: int in u_items.size():
			var other: String = u_items[i]
			if String((Spec.item_by_id.get(other, {}) as Dictionary).get("tier", "")) != "component":
				continue
			var out: Variant = combine(item_id, other)
			if out == null:
				continue
			# 合成：两件变一件，不额外占位
			u_items.remove_at(i)
			u_items.append(out)
			remove_item(p, item_id)
			return { "ok": true, "combined": out }

	if (u["items"] as Array).size() >= MAX_ITEMS_PER_UNIT:
		return { "ok": false, "reason": "这个棋子已经装满 %d 件" % MAX_ITEMS_PER_UNIT }
	(u["items"] as Array).append(item_id)
	remove_item(p, item_id)
	return { "ok": true }


## 卸下一件装备回到装备栏。成品拆回两个组件；单件卸装同样预检器匣容量
static func unequip_item(p: Dictionary, iid: int, item_id: String) -> Dictionary:
	Spec.ensure()
	var u: Variant = GameState.find_unit(p, iid)
	if u == null:
		return { "ok": false, "reason": "找不到这个棋子" }
	var u_items: Array = u["items"]
	var i := u_items.find(item_id)
	if i < 0:
		return { "ok": false, "reason": "身上没有这件装备" }
	var def: Variant = Spec.item_by_id.get(item_id, null)
	var recipe: Variant = def.get("recipe", null) if def is Dictionary else null
	var gain := 2 if (def is Dictionary and String(def.get("tier", "")) == "combined" and recipe != null) else 1
	if (p["items"] as Array).size() + gain > int(Spec.c("ITEM_BAR_SLOTS")):
		return { "ok": false, "reason": "器匣空间不足" }
	u_items.remove_at(i)
	if def is Dictionary and String(def.get("tier", "")) == "combined" and recipe != null:
		(p["items"] as Array).append(recipe[0])
		(p["items"] as Array).append(recipe[1])
	else:
		(p["items"] as Array).append(item_id)
	return { "ok": true }


## 卸载器通道：全部卸回器匣，成品拆组件；容量不足整体拒绝（all-or-nothing）
static func unequip_all(p: Dictionary, iid: int) -> Dictionary:
	Spec.ensure()
	var u: Variant = GameState.find_unit(p, iid)
	if u == null:
		return { "ok": false, "count": 0, "reason": "找不到这个棋子" }
	if (u["items"] as Array).is_empty():
		return { "ok": false, "count": 0, "reason": "身上没有装备" }
	var gain := 0
	for id: String in u["items"]:
		var def: Variant = Spec.item_by_id.get(id, null)
		if def is Dictionary and String(def.get("tier", "")) == "combined" and def.get("recipe", null) != null:
			gain += 2
		else:
			gain += 1
	if (p["items"] as Array).size() + gain > int(Spec.c("ITEM_BAR_SLOTS")):
		return { "ok": false, "count": 0, "reason": "器匣空间不足" }
	strip_items(p, u)
	return { "ok": true, "count": gain }


## 把一个棋子的装备全部剥下来放回器匣（卖出 / 淘汰 / 布阵溢出时用）
static func strip_items(p: Dictionary, u: Dictionary) -> void:
	Spec.ensure()
	var items: Array = p["items"]
	for id: String in (u["items"] as Array).duplicate():
		var def: Variant = Spec.item_by_id.get(id, null)
		if def is Dictionary and String(def.get("tier", "")) == "combined" and def.get("recipe", null) != null:
			items.append(def["recipe"][0])
			items.append(def["recipe"][1])
		else:
			items.append(id)
	u["items"] = []


# ── 三轴配装估值（模拟器与 AI 共用同一套判断） ──────────────

## 棋子的「普攻 / 法术 / 承伤」三轴投影。星级成长与内核同源（STAR_* 真源）
static func unit_axes(def_id: String, star: int) -> Array:
	Spec.ensure()
	var champ: Variant = Spec.champion_by_id.get(def_id, null)
	if champ == null:
		return [0.0, 0.0, 0.0]
	var si := int(min(2, max(0, star - 1)))
	var s := Spec.star_scale("STAR_POWER_SCALE", si)
	var hp_s := Spec.star_scale("STAR_HP_SCALE", si)
	var b: Dictionary = champ["base"]
	var atk := float(b["atk"]) * s * float(b["aspd"]) * (1.0 + float(b["critChance"]) * (float(b["critMult"]) - 1.0))
	var sp := float(b["sp"]) * s * (100.0 / 60.0) * 2.5
	var tank := float(b["hp"]) * hp_s * 0.02 + float(b["armor"]) * 0.6 + float(b["mr"]) * 0.6
	return [atk, sp, tank]


static func item_axes(item_id: String, def_id: String, star: int) -> Array:
	Spec.ensure()
	var def: Variant = Spec.item_by_id.get(item_id, null)
	var champ: Variant = Spec.champion_by_id.get(def_id, null)
	if def == null or champ == null:
		return [0.0, 0.0, 0.0]
	var si := int(min(2, max(0, star - 1)))
	var s := Spec.star_scale("STAR_POWER_SCALE", si)
	var b: Dictionary = champ["base"]
	var ib: Dictionary = def.get("bonus", {})
	var im: Dictionary = def.get("mods", {})
	var atk := float(ib.get("atk", 0.0)) * float(b["aspd"]) \
		+ float(b["atk"]) * s * float(ib.get("aspd", 0.0)) \
		+ float(ib.get("critChance", 0.0)) * 40.0 \
		+ float(ib.get("critMult", 0.0)) * 25.0 \
		+ float(ib.get("omnivamp", 0.0)) * 30.0 \
		+ float(ib.get("lifesteal", 0.0)) * 20.0 \
		+ float(im.get("armorPen", 0.0)) * 55.0
	var sp := float(ib.get("sp", 0.0)) * 1.6 \
		+ float(im.get("skillAmp", 0.0)) * 120.0 \
		+ float(im.get("manaPerSec", 0.0)) * 12.0 \
		+ float(ib.get("startMp", 0.0)) * 1.2 \
		+ float(im.get("skillCritChance", 0.0)) * 60.0 \
		+ float(im.get("healAmp", 0.0)) * 60.0 \
		+ ((float(im["manaFromDamageMult"]) - 1.0) * 90.0 if im.has("manaFromDamageMult") and float(im["manaFromDamageMult"]) != 0.0 else 0.0)
	var tank := float(ib.get("hp", 0.0)) * 0.02 \
		+ float(ib.get("armor", 0.0)) * 0.6 \
		+ float(ib.get("mr", 0.0)) * 0.6 \
		+ float(im.get("physicalDr", 0.0)) * 160.0 \
		+ float(im.get("magicDr", 0.0)) * 160.0 \
		+ float(im.get("allDr", 0.0)) * 160.0 \
		+ float(im.get("hpRegenPctPerSec", 0.0)) * 900.0
	return [atk, sp, tank]


static func _axes_dot_fit(ua: float, us: float, ut: float, ia: float, is_: float, it: float) -> float:
	var nu := sqrt(ua * ua + us * us + ut * ut)
	if nu == 0.0:
		nu = 1.0
	var ni := sqrt(ia * ia + is_ * is_ + it * it)
	if ni == 0.0:
		ni = 1.0
	return (ua * ia + us * is_ + ut * it) / (nu * ni)


## 这件装备装在这个棋子身上值不值（三轴归一化点积）
static func item_fit_score(u: Dictionary, item_id: String) -> float:
	var ua2 = unit_axes(u["defId"], int(u["star"]))
	var ia2 = item_axes(item_id, u["defId"], int(u["star"]))
	return _axes_dot_fit(ua2[0], ua2[1], ua2[2], ia2[0], ia2[1], ia2[2])


## 给一串装备挑持有者（模拟器与「一键装备」共用）。
## powerOf 的 0.35 次幂让装备倾向核心棋子而非最缺它的那个。
static func assign_items(units: Dictionary, item_ids: Array, max_per_unit: int = MAX_ITEMS_PER_UNIT) -> Dictionary:
	var carried := {}
	var power_of := func(def_id: String, star: int) -> float:
		var ax = unit_axes(def_id, star)
		return float(ax[0]) + float(ax[1]) + float(ax[2])
	var fit_of := func(def_id: String, star: int, item_id: String) -> float:
		var ua2 = unit_axes(def_id, star)
		var ia2 = item_axes(item_id, def_id, star)
		return _axes_dot_fit(ua2[0], ua2[1], ua2[2], ia2[0], ia2[1], ia2[2])
	for item_id: String in item_ids:
		var best: Variant = null
		var best_score := -INF
		for def_id: String in units.keys():
			var star := int(units[def_id])
			var have := (carried.get(def_id, []) as Array).size() if carried.has(def_id) else 0
			if have >= max_per_unit:
				continue
			var sc: float = fit_of.call(def_id, star, item_id) * pow(power_of.call(def_id, star), 0.35)
			if sc > best_score:
				best_score = sc
				best = def_id
		if best != null:
			if not carried.has(best):
				carried[best] = []
			(carried[best] as Array).append(item_id)
	return carried


## 自动分配装备（AI 与「一键装备」共用）：给核心棋子，不给最缺它的那个
static func auto_equip(p: Dictionary) -> void:
	for item_id: String in (p["items"] as Array).duplicate():
		var best_iid := -1
		var best_score := -INF
		for u in p["board"]:
			if u == null or not (u is Dictionary):
				continue
			if u.get("isBeast", false):
				continue
			if (u["items"] as Array).size() >= MAX_ITEMS_PER_UNIT:
				continue
			var sc: float = item_fit_score(u, item_id) * pow(GameState.power_score(u), 0.35)
			if sc > best_score:
				best_score = sc
				best_iid = int(u["iid"])
		if best_iid >= 0:
			equip_item(p, best_iid, item_id)
