extends SceneTree
## 战斗对拍探针：读 data/battle_fixture.json（TS 侧 battle_parity.mjs 生成），
## 每局重建 Battle → run() → 逐事件编码比对 + 结果比对。全等才退出码 0。
## 用法：godot --headless --path godot --script res://headless/battle_probe.gd [--case 名字过滤]

func _initialize() -> void:
	var f := FileAccess.open("res://data/battle_fixture.json", FileAccess.READ)
	if f == null:
		print('BATTLE_JSON {"ok":false,"error":"fixture missing（先跑 node --import tsx tools/battle_parity.mjs）"}')
		quit(1)
		return
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	f.close()
	var fx: Dictionary = parsed
	var filter := ""
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--case="):
			filter = a.substr(7)

	var cases: Array = fx["cases"]
	var total := 0
	var passed := 0
	var failures: Array = []
	var t0 := Time.get_ticks_usec()
	for case_d: Dictionary in cases:
		if filter != "" and not String(case_d["name"]).contains(filter):
			continue
		total += 1
		var cfg: Dictionary = (case_d["cfg"] as Dictionary).duplicate()
		cfg["seed"] = int(case_d["seed"])
		var b := Battle.new(cfg, Callable(), true)
		var result: Dictionary = b.run()
		var want_lines: Array = case_d["lines"]
		var mismatch := -1
		var want_line := ""
		var got_line := ""
		var got_lines: Array = []
		if b.events.size() != want_lines.size():
			mismatch = mini(b.events.size(), want_lines.size())
		var n := mini(b.events.size(), want_lines.size())
		for i: int in n:
			var line: String = Codec.encode_event(b.events[i])
			got_lines.append(line)
			if line != String(want_lines[i]):
				mismatch = i
				break
		if mismatch < 0 and b.events.size() != want_lines.size():
			mismatch = n
		if mismatch >= 0:
			want_line = String(want_lines[mismatch]) if mismatch < want_lines.size() else "<缺>"
			got_line = String(got_lines[mismatch]) if mismatch < got_lines.size() else "<缺>"
			var ctx := ""
			for w: int in range(maxi(0, mismatch - 3), mini(mismatch + 2, mini(want_lines.size(), got_lines.size()))):
				var wl: String = String(want_lines[w]).substr(0, 130)
				var gl: String = String(got_lines[w]).substr(0, 130)
				ctx += "[%d]%s %s%s\n" % [w, wl, gl, " <<<<" if w == mismatch else ""]
			# 终局单位快照差分（定位「事件外」的血量/位置/复活漂移）
			var units_diff: Array = []
			var want_units: Array = case_d.get("finalUnits", [])
			for i: int in mini(want_units.size(), b.units.size()):
				var wu: Dictionary = want_units[i]
				var gu: Unit = b.units[i]
				if int(wu["uid"]) != gu.uid or absf(float(wu["hp"]) - gu.hp) > 0.0001 \
						or absf(float(wu["maxHp"]) - gu.max_hp) > 0.0001 \
						or int(wu["cell"]["c"]) != gu.cell.x or int(wu["cell"]["r"]) != gu.cell.y \
						or bool(wu["alive"]) != gu.alive or bool(wu["revived"]) != gu.revived:
					units_diff.append({
						"ts": {"uid": int(wu["uid"]), "hp": float(wu["hp"]), "maxHp": float(wu["maxHp"]),
							"cell": [int(wu["cell"]["c"]), int(wu["cell"]["r"])], "alive": bool(wu["alive"]), "rev": bool(wu["revived"])},
						"gd": {"uid": gu.uid, "hp": gu.hp, "maxHp": gu.max_hp, "cell": [gu.cell.x, gu.cell.y], "alive": gu.alive, "rev": gu.revived},
					})
					if units_diff.size() >= 6:
						break
			failures.append({
				"case": String(case_d["name"]),
				"kind": "events",
				"index": mismatch,
				"ts_events": want_lines.size(),
				"gd_events": b.events.size(),
				"want": want_line.substr(0, 220),
				"got": got_line.substr(0, 220),
				"ctx": ctx,
				"units_diff": units_diff,
			})
			continue
		# 结果比对（winner/ticks/timeout/survivors；JSON 键是字符串、GDScript 键是 int——归一后比）
		var wr: Dictionary = case_d["result"]
		var want_surv: Dictionary = wr.get("survivors", {})
		var got_surv: Dictionary = result.get("survivors", {})
		var want_map := {}
		for team: String in want_surv.keys():
			want_map[int(team)] = want_surv[team]
		var got_map := {}
		for team: int in got_surv.keys():
			got_map[team] = got_surv[team]
		var surv_ok := want_map.keys().size() == got_map.keys().size()
		if surv_ok:
			for team: int in want_map.keys():
				var a1: Array = want_map[team]
				var b1: Array = got_map.get(team, [])
				if a1.size() != b1.size():
					surv_ok = false
					break
				for i: int in a1.size():
					if int(a1[i]) != int(b1[i]):
						surv_ok = false
						break
				if not surv_ok:
					break
		var winner_ok: bool = (wr.get("winner", null) == result.get("winner", null))
		if not winner_ok or int(wr["ticks"]) != int(result["ticks"]) or bool(wr["timeout"]) != bool(result["timeout"]) or not surv_ok:
			failures.append({
				"case": String(case_d["name"]),
				"kind": "result",
				"want": {"winner": wr.get("winner"), "ticks": wr.get("ticks"), "timeout": wr.get("timeout")},
				"got": {"winner": result.get("winner"), "ticks": result.get("ticks"), "timeout": result.get("timeout")},
				"surv_ok": surv_ok,
			})
			continue
		passed += 1
	var ms := (Time.get_ticks_usec() - t0) / 1000.0
	var first: Dictionary = failures[0] if not failures.is_empty() else {}
	var brief: Array = []
	for fl: Dictionary in failures:
		brief.append({"case": fl.get("case"), "kind": fl.get("kind"), "index": fl.get("index", -1)})
	print("BATTLE_JSON " + JSON.stringify({
		"ok": failures.is_empty(),
		"cases": total,
		"passed": passed,
		"failed": failures.size(),
		"ms": ms,
		"failures": brief,
		"first_failure": first,
	}))
	quit(0 if failures.is_empty() else 1)
