extends SceneTree
## 性能回归探针（headless，无节点入树——音频/特效节点在 headless teardown 不稳定）：
## 验证 sfx 配方池的合成缓存语义（首合成 80ms 级、复用微秒级）。
## fx 渲染预算由窗口冒烟 perf 探针的 fx_peak 采样覆盖（特效节点的生命周期归场景）。
func _initialize() -> void:
	var sfx = load("res://audio/sfx.gd").new()
	var fails := 0
	var t0 := Time.get_ticks_usec()
	sfx.prewarm_sounds(["star3"])
	var first := Time.get_ticks_usec() - t0
	t0 = Time.get_ticks_usec()
	sfx.prewarm_sounds(["star3"])
	var again := Time.get_ticks_usec() - t0
	# 池内已满变体：直接走渲染计时口径校验（_render_wav 纯函数可入线程）
	t0 = Time.get_ticks_usec()
	var w: AudioStreamWAV = sfx._render_wav(sfx._layers_for("star3"))
	var rerender := Time.get_ticks_usec() - t0
	print("SFX star3 first-synth=%.1fms prewarm-replay=%.2fms rerender=%.1fms pool=%d" % [
		first / 1000.0, again / 1000.0, rerender / 1000.0, (sfx._pool["star3"] as Array).size()])
	# 契约 1：二次预热必须命中池跳过合成（<2ms）
	if again > 2000:
		print("SFX_FAIL prewarm replay not cached")
		fails += 1
	# 契约 2：满池契约 —— 预载后池须恰 VARIANTS_PER_SOUND 个变体（2.4.0 起播放
	# 路径零 worker 派出的前提：池常满，play 不再触发后室补变体）
	if int((sfx._pool["star3"] as Array).size()) != sfx.VARIANTS_PER_SOUND:
		print("SFX_FAIL pool size")
		fails += 1
	# 契约 3：首合成落在合成耗时量级（>5ms——纯 GDScript 逐样本合成的真实成本；
	# 若某天实现换 C#/预烘资产此断言重审）
	if first < 5000:
		print("SFX_FAIL first synth suspiciously fast")
		fails += 1
	print("PERF_PROBE ", "OK" if fails == 0 else "FAIL(%d)" % fails)
	quit(1 if fails > 0 else 0)
