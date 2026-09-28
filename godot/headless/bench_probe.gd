extends SceneTree
## rng 探针性能分段微基准（仅诊断用；计时 API 不进内核）。

func _initialize() -> void:
	var draws: int = 20000
	var rng := Rng.new(7)

	var t0 := Time.get_ticks_usec()
	var acc: float = 0.0
	for i: int in draws:
		acc += rng.next()
	var t1 := Time.get_ticks_usec()

	var lines: PackedStringArray = []
	for i: int in draws:
		lines.append(ParityUtil.f64_hex(rng.next()))
	var t2 := Time.get_ticks_usec()

	var body := "\n".join(lines)
	var dg := ParityUtil.fnv1a32_hex(body)
	var t3 := Time.get_ticks_usec()

	print("BENCH phase_next_ms=%.1f phase_hex_ms=%.1f phase_join_ms=%.1f acc=%.6f dg=%s" % [
		(t1 - t0) / 1000.0, (t2 - t1) / 1000.0, (t3 - t2) / 1000.0, acc, dg,
	])
	quit(0)
