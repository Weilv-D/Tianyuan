extends SceneTree
## RNG 对拍探针（TS 侧镜像：godot/tools/parity_rng.mjs）。
## 用法：godot --headless --path godot --script res://headless/rng_parity.gd -- --seed=12345 --draws=1000000 --mode=rng|seq
## 输出：单行 `PARITY_JSON {...}`；与 TS 侧逐字段（fnv1a32/sha256/head/tail）比对。

func _initialize() -> void:
	var args := {}
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--"):
			var kv := a.substr(2).split("=", true, 2)
			args[kv[0]] = kv[1] if kv.size() > 1 else ""
	var seed_v: int = int(String(args.get("seed", "12345")))
	var draws: int = int(String(args.get("draws", "1000000")))
	var mode: String = String(args.get("mode", "rng"))

	var rng := Rng.new(seed_v)
	var lines: PackedStringArray = []
	if mode == "rng":
		for i: int in draws:
			lines.append(ParityUtil.f64_hex(rng.next()))
	else:
		for i: int in 100:
			lines.append(ParityUtil.f64_hex(rng.float_range(0.5, 1.5)))
		for i: int in 100:
			lines.append(str(rng.int_range(3, 10)))
		for i: int in 100:
			lines.append(str(rng.intn(64)))
		for i: int in 100:
			lines.append("1" if rng.chance(0.3) else "0")
		for i: int in 100:
			lines.append(str(rng.pick([11, 22, 33, 44, 55])))
		for i: int in 20:
			var a: Array = []
			for k: int in 64:
				a.append(k)
			rng.shuffle(a)
			lines.append(",".join(a.map(func(v): return str(v))))
		for i: int in 50:
			var picked: Array = rng.sample_weighted(
				[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [5, 0, 3, 1, 0, 2, 7, 0, 1, 4], 5)
			lines.append(",".join(picked.map(func(v): return str(v))))
		for s: String in ["duanyue", "百战天元", "daily-2026-09-28", ""]:
			lines.append(str(Rng.hash_seed(s)))

	var body := "\n".join(lines)
	var result := {
		"engine": "gd",
		"mode": mode,
		"seed": seed_v,
		"draws": draws if mode == "rng" else lines.size(),
		"fnv1a32": ParityUtil.fnv1a32_hex(body),
		"sha256": ParityUtil.sha256_hex(body),
		"head": lines.slice(0, 3),
		"tail": lines.slice(lines.size() - 3),
	}
	print("PARITY_JSON " + JSON.stringify(result))
	quit(0)
