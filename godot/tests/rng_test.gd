extends GdUnitTestSuite
## RNG 冒烟测试：断言向量取自 2026-09-28 跨引擎对拍基线
## （tools/parity_check.mjs 六组全绿的同源数据；完整逐位验证走 qa 门禁的百万抽样）。
## 浮点断言一律走 f64 位型 hex——GdUnit4 的 is_equal 对 float 有精度口径差异，位型无歧义。

func test_seed_12345_first_three_draws() -> void:
	var rng := Rng.new(12345)
	assert_str(ParityUtil.f64_hex(rng.next())).is_equal("3fef59ef18a00000")
	assert_str(ParityUtil.f64_hex(rng.next())).is_equal("3fd3a1d440000000")
	assert_str(ParityUtil.f64_hex(rng.next())).is_equal("3fdefd38bc800000")


func test_state_snapshot_restore() -> void:
	var rng := Rng.new(777)
	for i: int in 10:
		rng.next()
	var snap := rng.state
	var a := rng.next()
	rng.state = snap
	assert_str(ParityUtil.f64_hex(rng.next())).is_equal(ParityUtil.f64_hex(a))


func test_hash_seed_vectors() -> void:
	assert_int(Rng.hash_seed("百战天元")).is_equal(3680692687)
	assert_int(Rng.hash_seed("daily-2026-09-28")).is_equal(1352298286)
	assert_int(Rng.hash_seed("")).is_equal(2166136261)


func test_intn_nonpositive_returns_zero() -> void:
	var rng := Rng.new(42)
	assert_int(rng.intn(0)).is_equal(0)
	assert_int(rng.intn(-3)).is_equal(0)


func test_shuffle_permutation_preserved() -> void:
	var rng := Rng.new(12345)
	var a: Array = []
	for k: int in 64:
		a.append(k)
	rng.shuffle(a)
	a.sort()
	for k: int in 64:
		assert_int(a[k]).is_equal(k)
