## 确定性伪随机数发生器（mulberry32）—— 与冻结仓 src/core/rng.ts 逐位对齐。
## 战斗内核的唯一随机源；本工程内核目录禁止使用 randi()/randf() 等引擎随机。
##
## JS 语义移植要点（对拍正确性的根基，改动前先读 docs/PARITY_CODEC.md）：
## 1. 所有中间值按 uint32（0..4294967295）位型保存。JS 的 `>>>` 在 uint32 表示下
##    等价于本实现的 `>>`（操作数恒非负）；JS 的 `^` 结果与本实现的按位异或同位型
##    （JS 可能给出负 int32，但位串一致，后续 `>>>` 按 uint32 解释又回到同一表示）。
## 2. Math.imul 是 int32 截断乘法；64 位中间积可能溢出 int64，故用 imul32() 分半相乘。
## 3. `t ^= t + imul(...)` 中 JS 的加法可达 2^33，ToInt32 即 mod 2^32——用 & U32_MAX 复刻。
class_name Rng
extends RefCounted

const U32_MAX: int = 0xFFFFFFFF

var _s: int


func _init(seed: int) -> void:
	_s = seed & U32_MAX


## Math.imul 的位级等价（操作数与结果均为 uint32 位型）。
static func imul32(a: int, b: int) -> int:
	var lo: int = (a & 0xFFFF) * (b & 0xFFFF)
	var mid: int = ((a >> 16) * (b & 0xFFFF) + (a & 0xFFFF) * (b >> 16)) & 0xFFFF
	return (lo + mid * 65536) & U32_MAX


## [0, 1)
func next() -> float:
	_s = (_s + 0x6D2B79F5) & U32_MAX
	var t: int = _s
	t = imul32(t ^ (t >> 15), t | 1)
	t = t ^ ((t + imul32(t ^ (t >> 7), t | 61)) & U32_MAX)
	t = (t ^ (t >> 14)) & U32_MAX
	return float(t) / 4294967296.0


## [min, max)
func float_range(min_v: float, max_v: float) -> float:
	return min_v + next() * (max_v - min_v)


## [min, max] 整数
func int_range(min_v: int, max_v: int) -> int:
	return int(floor(float_range(float(min_v), float(max_v) + 1.0)))


## [0, n) 整数。n 非正数返回 0（与 TS 契约一致：负 n 静默腐化下游取值属缺陷，不复制）。
func intn(n: int) -> int:
	if not (n > 0):
		return 0
	return int(floor(next() * float(n)))


func chance(p: float) -> bool:
	return next() < p


func pick(arr: Array) -> Variant:
	if arr.is_empty():
		push_error("Rng.pick: 空数组")
		return null
	return arr[intn(arr.size())]


## Fisher-Yates，原地洗牌
func shuffle(arr: Array) -> Array:
	var i: int = arr.size() - 1
	while i > 0:
		var j: int = intn(i + 1)
		var tmp: Variant = arr[i]
		arr[i] = arr[j]
		arr[j] = tmp
		i -= 1
	return arr


## 不放回抽 n 个（严格小于判定 + 跳过零权重 + 兜底取末位正权重，逐句对齐 TS）。
func sample_weighted(items: Array, weights: Array, n: int) -> Array:
	var pool: Array = items.duplicate()
	var w: Array = weights.duplicate()
	var out: Array = []
	var count: int = mini(n, pool.size())
	for k: int in count:
		var total: float = 0.0
		for i: int in w.size():
			total += maxf(0.0, float(w[i]))
		if total <= 0.0:
			break
		var roll: float = next() * total
		var chosen: int = -1
		for i: int in w.size():
			if float(w[i]) <= 0.0:
				continue
			roll -= float(w[i])
			if roll < 0.0:
				chosen = i
				break
		if chosen < 0:
			var i2: int = w.size() - 1
			while i2 >= 0:
				if float(w[i2]) > 0.0:
					chosen = i2
					break
				i2 -= 1
		out.append(pool[chosen])
		pool.remove_at(chosen)
		w.remove_at(chosen)
	return out


func duplicate_rng() -> Rng:
	return Rng.new(_s)


var state: int:
	get:
		return _s
	set(v):
		_s = v & U32_MAX


## 由字符串生成稳定种子（FNV-1a 32 位；种子串均为 ASCII/BMP，无代理对差异）。
static func hash_seed(s: String) -> int:
	var h: int = 2166136261
	for i: int in s.length():
		h = h ^ s.unicode_at(i)
		h = imul32(h, 16777619)
	return h
