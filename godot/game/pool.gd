## 共享卡池与商店（src/game/pool.ts 对齐版）。
## 8 名玩家共享同一个卡池 —— 别人抓走了，你就抓不到。
## counts 保持 CHAMPIONS 名单序（TS Map 插入序等价；snapshot 语义比对按键值）。
class_name CardPool
extends RefCounted

var counts: Dictionary = {}


func _init() -> void:
	Spec.ensure()
	var pool_counts: Dictionary = Spec.cfg.get("POOL_COUNTS", {})
	for c: Dictionary in Spec.champions:
		counts[c["id"]] = int(pool_counts.get(str(int(c["cost"])), 0))


func remaining(def_id: String) -> int:
	return int(counts.get(def_id, 0))


## 取走一张。成功返回 true，池中无货返回 false。
func take(def_id: String) -> bool:
	var n := int(counts.get(def_id, 0))
	if n <= 0:
		return false
	counts[def_id] = n - 1
	return true


## 归还一张（卖棋 / 淘汰时回池）。不设上钳：调用方与 take 严格对称，
## 钳制会把守恒破坏静默成吞牌。名单外 id 直接拒收（纵深防御）。
func give(def_id: String) -> void:
	Spec.ensure()
	if not Spec.champion_by_id.has(def_id):
		return
	counts[def_id] = int(counts.get(def_id, 0)) + 1


## 归还一个棋子（按星级拆成对应张数）
func give_unit(def_id: String, star: int) -> void:
	var n := 1 if star == 1 else (3 if star == 2 else 9)
	for i: int in n:
		give(def_id)


func remaining_by_cost(cost: int) -> int:
	Spec.ensure()
	var n := 0
	for id: String in Spec.champion_ids_by_cost.get(str(cost), []):
		n += remaining(id)
	return n


func total_remaining() -> int:
	var n := 0
	for v in counts.values():
		n += int(v)
	return n


func snapshot() -> Dictionary:
	return counts.duplicate()


## 跨版本/脏档守卫：逐键清洗，而不是整池重置（整池重置会让一张坏键把其余
## 未损坏的键也膨胀回满池 —— 凭空造卡）。口径全部朝守恒保守方向收：
## 未知 id 丢弃；非整数/负数归 0；超本版池容钳到满池；缺项按满池补。
func restore(data) -> void:
	Spec.ensure()
	var pool_counts: Dictionary = Spec.cfg.get("POOL_COUNTS", {})
	var next := {}
	for c: Dictionary in Spec.champions:
		next[c["id"]] = int(pool_counts.get(str(int(c["cost"])), 0))
	var dirt := 0
	if data is Dictionary:
		for k: String in data.keys():
			var champion: Variant = Spec.champion_by_id.get(k, null)
			if champion == null:
				dirt += 1
				continue
			var max_n := int(pool_counts.get(str(int(champion["cost"])), 0))
			var v: Variant = data[k]
			if not ParityUtil.js_is_int(v) or int(v) < 0:
				next[k] = 0
				dirt += 1
			elif int(v) > max_n:
				next[k] = max_n
				dirt += 1
			else:
				next[k] = int(v)
	if dirt > 0:
		push_warning("[pool] 存档卡池与本版名单不一致，已清洗 %d 个键（丢弃/钳制），其余按档保留" % dirt)
	counts = next


# ── 商店 ──────────────────────────────────────────────────

## 刷一次商店。逐格独立抽取：先按等级概率表掷费用档位，再在该档位
## 池中仍有货的棋子里按剩余库存加权取一个；档位空则全池加权兜底。
## table 缺省 null = 读全局 SHOP_ODDS 真源（确定性契约）；
## 平衡工具链可注入本地覆盖表，绝不原地改写真源。
static func roll_shop(pool: CardPool, rng: Rng, level: int, table = null) -> Array:
	Spec.ensure()
	var odds_table: Array = table if table is Array else Spec.cfg.get("SHOP_ODDS", [])
	var li := int(max(0, min(odds_table.size() - 1, level - 1)))
	var odds: Array = odds_table[li]
	var out: Array = []
	var slots := int(Spec.c("SHOP_SLOTS"))

	for s: int in slots:
		# 1) 掷费用档位（严格小于 + 跳过零概率档）
		var total := 0.0
		for i: int in odds.size():
			total += max(0.0, float(odds[i]))
		var roll := rng.next() * total
		var cost_tier := odds.size() - 1
		for i: int in odds.size():
			if float(odds[i]) <= 0.0:
				continue
			roll -= float(odds[i])
			if roll < 0.0:
				cost_tier = i
				break
		if float(odds[cost_tier]) <= 0.0:
			for i: int in range(odds.size() - 1, -1, -1):
				if float(odds[i]) > 0.0:
					cost_tier = i
					break

		var candidates: Array = []
		for id: String in Spec.champion_ids_by_cost.get(str(cost_tier + 1), []):
			if pool.remaining(id) > 0:
				candidates.append(id)

		# 2) 该档位空了 → 从全部有货的棋子里按剩余库存加权
		if candidates.is_empty():
			var all: Array = []
			for c: Dictionary in Spec.champions:
				if pool.remaining(c["id"]) > 0:
					all.append(c["id"])
			if all.is_empty():
				out.append(null)
				continue
			var weights_all: Array = []
			for id: String in all:
				weights_all.append(pool.remaining(id))
			candidates = [_weighted_pick(all, weights_all, rng)]

		# 3) 同档位内按剩余库存加权：剩得多的更容易出现
		var weights: Array = []
		for id: String in candidates:
			weights.append(pool.remaining(id))
		var picked = _weighted_pick(candidates, weights, rng)
		out.append(picked)
	return out


## 与 core/rng.sample_weighted 同口径：严格小于判定 + 跳过零权重
static func _weighted_pick(items: Array, weights: Array, rng: Rng):
	var total := 0.0
	for w in weights:
		total += max(0.0, float(w))
	if total <= 0.0:
		return items[0]
	var roll := rng.next() * total
	for i: int in items.size():
		if float(weights[i]) <= 0.0:
			continue
		roll -= float(weights[i])
		if roll < 0.0:
			return items[i]
	for i: int in range(items.size() - 1, -1, -1):
		if float(weights[i]) > 0.0:
			return items[i]
	return items[items.size() - 1]
