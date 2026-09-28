extends SceneTree
## 平衡工具链 worker（批次包模式）。
## 设计变更记录（M4）：原计划「stdin/stdout 常驻 IPC」在 Godot 4.7 不可行——
## 子进程侧无 stdin 读取 API（OS.read_from_stdin 是 3.x 遗留，4.x 已移除）。
## 改为批次包：Node 把整批 jobs 写临时 JSON，经 --jobs=<path> 传入，worker
## 一次跑完输出结果退出。冷启动 0.2s 按**批**摊薄（一批 = 全部配对 × n 局），
## 吞吐与常驻池等价 —— 「避免每局冷启动」的原意图不变。
##
## 协议：stdout 首行 "BALANCE_JSON " + JSON（ASCII 键），退出码 0/1。
## CRN 金锁（与 balance/lib/seeds.ts 逐位一致）：
##   seed = (seedBase + pairIdx*104729 + k*7919) & 0xFFFFFFFF

const SEED_STEP_PAIR := 104729
const SEED_STEP_K := 7919


func _initialize() -> void:
	var jobs_path := ""
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--jobs="):
			jobs_path = a.substr(7)
	if jobs_path.is_empty():
		print("BALANCE_JSON " + JSON.stringify({ "ok": false, "error": "missing --jobs=" }))
		quit(1)
		return
	var f := FileAccess.open(jobs_path, FileAccess.READ)
	if f == null:
		print("BALANCE_JSON " + JSON.stringify({ "ok": false, "error": "jobs file unreadable" }))
		quit(1)
		return
	var msg: Variant = JSON.parse_string(f.get_as_text())
	f.close()
	if msg == null or not (msg is Dictionary):
		print("BALANCE_JSON " + JSON.stringify({ "ok": false, "error": "jobs parse failed" }))
		quit(1)
		return
	var t0 := Time.get_ticks_usec()
	var out: Dictionary = _run_pairs(msg)
	out["ms"] = (Time.get_ticks_usec() - t0) / 1000.0
	print("BALANCE_JSON " + JSON.stringify(out))
	quit(0)


func _run_pairs(msg: Dictionary) -> Dictionary:
	var seed_base := int(msg.get("seedBase", 0))
	var jobs: Array = msg.get("jobs", [])
	var results: Array = []
	var agg := {}
	for job: Dictionary in jobs:
		var pair_idx := int(job.get("pairIdx", 0))
		var k0 := int(job.get("k0", 0))
		var n := int(job.get("n", 0))
		var cfg_in: Dictionary = job.get("cfg", {})
		var wins0 := 0
		var wins1 := 0
		var draws := 0
		var ticks_total := 0
		var timeouts := 0
		for kk: int in n:
			var seed: int = (seed_base + pair_idx * SEED_STEP_PAIR + (k0 + kk) * SEED_STEP_K) & 0xFFFFFFFF
			var cfg: Dictionary = cfg_in.duplicate(true)  # 深拷贝必须：Battle.run() 会改写 units 条目（monster 标记等），浅拷贝跨局污染数据 → 超时局风暴
			cfg["seed"] = seed
			var battle := Battle.new(cfg, Callable(), false)
			var r: Dictionary = battle.run()
			var w: Variant = r.get("winner", null)
			if w == null:
				draws += 1
			elif int(w) == 0:
				wins0 += 1
			else:
				wins1 += 1
			ticks_total += int(r.get("ticks", 0))
			if bool(r.get("timeout", false)):
				timeouts += 1
			_collect_units(battle, agg)
		results.append({
			"pairIdx": pair_idx, "wins0": wins0, "wins1": wins1, "draws": draws,
			"ticksTotal": ticks_total, "timeouts": timeouts,
		})
		# 心跳：每完成一个配对打一行 stderr（挂死时最后心跳即卡点定位）
		printerr("[worker] pair %d done (%dms)" % [pair_idx, Time.get_ticks_usec() / 1000])
	var units_out: Array = []
	for key: String in agg.keys():
		units_out.append(agg[key])
	return { "ok": true, "results": results, "units": units_out }


## 逐单位聚合（对齐 engine.ts UnitAgg：召唤物归 (summon) 桶）
func _collect_units(battle: Battle, agg: Dictionary) -> void:
	for u in battle.units:
		var comp_idx := int(u.team)
		var def_id := String(u.entry["id"]) if not u.is_minion else "(summon)"
		var star := int(u.star)
		var key := "%d|%s|%d" % [comp_idx, def_id, star]
		var a: Dictionary = agg.get(key, {
			"compIdx": comp_idx, "defId": def_id, "star": star, "battles": 0, "deaths": 0,
			"dealt": 0.0, "taken": 0.0, "healed": 0.0, "absorbed": 0.0, "casts": 0,
			"dealtP": 0.0, "dealtM": 0.0, "dealtT": 0.0, "takenP": 0.0, "takenM": 0.0, "takenT": 0.0,
		})
		a["battles"] = int(a["battles"]) + 1
		if not u.alive:
			a["deaths"] = int(a["deaths"]) + 1
		a["dealt"] = float(a["dealt"]) + float(u.dealt_damage)
		a["taken"] = float(a["taken"]) + float(u.taken_damage)
		a["healed"] = float(a["healed"]) + float(u.healed)
		a["absorbed"] = float(a["absorbed"]) + float(u.absorbed_damage)
		a["casts"] = int(a["casts"]) + int(u.cast_count)
		a["dealtP"] = float(a["dealtP"]) + float(u.dealt_by_type.get("physical", 0.0))
		a["dealtM"] = float(a["dealtM"]) + float(u.dealt_by_type.get("magic", 0.0))
		a["dealtT"] = float(a["dealtT"]) + float(u.dealt_by_type.get("true", 0.0))
		a["takenP"] = float(a["takenP"]) + float(u.taken_by_type.get("physical", 0.0))
		a["takenM"] = float(a["takenM"]) + float(u.taken_by_type.get("magic", 0.0))
		a["takenT"] = float(a["takenT"]) + float(u.taken_by_type.get("true", 0.0))
		agg[key] = a
