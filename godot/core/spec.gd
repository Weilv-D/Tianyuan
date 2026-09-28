## 规格加载器：data/spec.json（由 tools/export_spec.mjs 从冻结仓单向导出）的唯一消费口。
## 内核与数据之间只经这里 —— Godot 侧永不 import ../src（隔离铁律见 docs/MILESTONES.md）。
class_name Spec
extends RefCounted

static var _loaded := false
static var champion_by_id: Dictionary = {}
static var item_by_id: Dictionary = {}
static var cfg: Dictionary = {}
static var trait_tuning: Dictionary = {}
static var trait_tuning_keys: Dictionary = {}
## M2 对局层增量：名单原序 / 费用索引 / 配方 / 羁绊定义（含 breakpoints）
static var champions: Array = []
static var champion_ids_by_cost: Dictionary = {}
static var items: Array = []
static var component_ids: Array = []
static var recipe_index: Dictionary = {}
static var traits_by_id: Dictionary = {}


static func ensure() -> void:
	if _loaded:
		return
	var f := FileAccess.open("res://data/spec.json", FileAccess.READ)
	if f == null:
		push_error("Spec: data/spec.json 缺失（先跑 npm run spec）")
		return
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	f.close()
	if parsed == null or not (parsed is Dictionary):
		push_error("Spec: spec.json 解析失败")
		return
	var p: Dictionary = parsed.get("payload", {})
	cfg = p.get("config", {})
	champions = p.get("champions", [])
	champion_by_id = {}
	for e: Dictionary in champions:
		champion_by_id[e["id"]] = e
	champion_ids_by_cost = p.get("championIdsByCost", {})
	items = p.get("items", [])
	item_by_id = {}
	for e: Dictionary in items:
		item_by_id[e["id"]] = e
	component_ids = p.get("componentIds", [])
	recipe_index = p.get("recipeIndex", {})
	traits_by_id = {}
	for e: Dictionary in p.get("traits", []):
		traits_by_id[e["id"]] = e
	trait_tuning = p.get("traitTuning", {})
	trait_tuning_keys = p.get("traitTuningKeys", {})
	_loaded = true


## 成品装备池（adventure「丹青成装」与墨兽胜场成品掉落共用；顺序 = ITEMS 原序）
static var _combined_ids: Array = []
static func combined_item_ids() -> Array:
	ensure()
	if _combined_ids.is_empty():
		for e: Dictionary in items:
			if e.get("tier", "") == "combined":
				_combined_ids.append(e["id"])
	return _combined_ids


## 数值常量读取（缺键报错返回默认——默认值与冻结仓字面量同源，兜底防 NaN 漏网）
static func c(k: String, def: float = 0.0) -> float:
	ensure()
	var v: Variant = cfg.get(k, null)
	if v == null:
		push_error("Spec: 常量缺失 %s" % k)
		return def
	return float(v)


static func mech(k: String) -> float:
	ensure()
	return float(cfg.get("MECH", {}).get(k, 0.0))


static func legend(k: String) -> float:
	ensure()
	return float(cfg.get("LEGEND_T3", {}).get(k, 0.0))


## 星级缩放表（索引 = star-1）
static func star_scale(table: String, si: int) -> float:
	ensure()
	var arr: Array = cfg.get(table, [])
	if si < 0 or si >= arr.size():
		push_error("Spec: 星级索引越近 %s[%d]" % [table, si])
		return 1.0
	return float(arr[si])


## 羁绊调参（与 src/data/tuning.ts 的 tune() 同语义：单点覆盖 → 整条缩放 → 默认值；
## 线上进程表为空，永远读到实现字面量）
static func tune(id: String, key: String, def: float) -> float:
	ensure()
	var keys: Dictionary = trait_tuning_keys.get(id, {})
	if keys.has(key):
		return float(keys[key])
	if trait_tuning.has(id):
		return def * float(trait_tuning[id])
	return def
