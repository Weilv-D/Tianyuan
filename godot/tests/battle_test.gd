extends GdUnitTestSuite
## 战斗内核契约测试（M1）：确定性（同种子 ⇒ 同事件摘要）+ 守恒不变量。
## 逐位跨引擎一致性由 qa 门禁的百万级 RNG 对拍与 battle 对拍负责，此处守内核自洽。


static func _cfg(seed: int) -> Dictionary:
	Spec.ensure()
	var ids: Array = Spec.champion_by_id.keys()
	ids.sort()
	var units := []
	for i: int in 4:
		units.append({
			"uid": i + 1,
			"defId": ids[i],
			"team": 0 if i < 2 else 1,
			"star": 1 + (i % 3),
			"cell": {"c": 2 + i % 2 * 3, "r": 1 if i < 2 else 6},
		})
	return {"seed": seed, "units": units, "traits": {}}


static func _digest(b: Battle) -> String:
	var parts := PackedStringArray()
	for e: Dictionary in b.events:
		parts.append(Codec.encode_event(e))
	return ParityUtil.fnv1a32_hex("\n".join(parts))


func test_determinism_same_seed_same_digest() -> void:
	var a := Battle.new(_cfg(20260928))
	a.run()
	var b := Battle.new(_cfg(20260928))
	b.run()
	assert_str(_digest(b)).is_equal(_digest(a))
	assert_int(b.result["ticks"]).is_equal(int(a.result["ticks"]))


func test_battle_start_end_event_contract() -> void:
	var b := Battle.new(_cfg(31))
	b.run()
	assert_int(b.events.size()).is_greater(1)
	assert_str(String(b.events[0]["t"])).is_equal("start")
	assert_str(String(b.events[b.events.size() - 1]["t"])).is_equal("end")


func test_conservation_invariants() -> void:
	var b := Battle.new(_cfg(555))
	b.run()
	assert_int(b.units.size()).is_less_equal(64)
	for u: Unit in b.units:
		assert_float(u.max_hp).is_greater(0.0)
		if u.alive:
			assert_float(u.hp).is_greater_equal(0.0)
			assert_float(u.hp).is_less_equal(u.max_hp)
		else:
			assert_float(u.hp).is_equal(0.0)
		# 伤害统计守恒：总产出 ≥ 0 且分类型之和 == 总量
		var by_type: float = float(u.dealt_by_type["physical"]) + float(u.dealt_by_type["magic"]) + float(u.dealt_by_type["true"])
		assert_float(by_type).is_equal_approx(u.dealt_damage, 0.0001)
		var taken_by_type: float = float(u.taken_by_type["physical"]) + float(u.taken_by_type["magic"]) + float(u.taken_by_type["true"])
		assert_float(taken_by_type).is_equal_approx(u.taken_damage, 0.0001)
		assert_float(u.absorbed_damage).is_greater_equal(0.0)


func test_legend_t3_cc_immune() -> void:
	# 天命 3★五费天生免疫控制（cc_immune 曾漏移植：对拍语料无天命局未覆盖，此为回归钉）
	Spec.ensure()
	var five_ids: Array = Spec.champion_ids_by_cost.get("5", [])
	assert_int(five_ids.size()).is_greater(0)
	var bid := String(five_ids[0])
	var legend := Unit.create({"uid": 1, "defId": bid, "team": 0, "star": 3, "cell": {"c": 3, "r": 2}})
	var plain := Unit.create({"uid": 2, "defId": bid, "team": 0, "star": 1, "cell": {"c": 4, "r": 2}})
	assert_int(legend.cc_immune).is_equal(1_000_000_000)
	assert_int(plain.cc_immune).is_equal(0)
	var b := Battle.new({"seed": 7, "units": [
		{"uid": 1, "defId": bid, "team": 0, "star": 3, "cell": {"c": 3, "r": 2}},
		{"uid": 2, "defId": bid, "team": 1, "star": 1, "cell": {"c": 4, "r": 6}},
	], "traits": {}})
	b.add_status(b.units[0], b.units[0], "stun", 1.0, 0.0)
	assert_bool(b.units[0].has_status("stun")).is_false()
	b.add_status(b.units[1], b.units[1], "stun", 1.0, 0.0)
	assert_bool(b.units[1].has_status("stun")).is_true()
