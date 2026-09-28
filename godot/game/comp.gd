## 阵容构建器（src/game/comp.ts 对齐版，M2 范围 = computeTraits）。
## buildTeam / PRESET_COMPS（演示预设与配装）属 M4 平衡工具链面，届时随工具链接通一并移植。
class_name Comp
extends RefCounted


## 计算一堆棋子激活的羁绊（同名棋子只计一次）。输出按羁绊 id 字典序。
static func compute_traits(def_ids: Array) -> Array:
	Spec.ensure()
	var seen := {}
	var unique: Array = []
	for id: String in def_ids:
		if not seen.has(id):
			seen[id] = true
			unique.append(id)
	var counter := {}
	for id: String in unique:
		var e: Variant = Spec.champion_by_id.get(id, null)
		if e == null:
			continue
		var ts: Array = (e["origins"] as Array).duplicate()
		ts.append_array(e["classes"])
		for t: String in ts:
			counter[t] = int(counter.get(t, 0)) + 1
	var keys := (counter.keys() as Array).duplicate()
	keys.sort()  # 字符串字典序 = TS (a<b?-1:1) 的全序，稳定性无歧义
	var out: Array = []
	for id: String in keys:
		var def: Variant = Spec.traits_by_id.get(id, null)
		if def == null:
			continue
		var count := int(counter[id])
		var tier := -1
		var bps: Array = def["breakpoints"]
		for i: int in bps.size():
			if count >= int(bps[i]):
				tier = i
		out.append({ "id": id, "count": count, "tier": tier })
	return out
