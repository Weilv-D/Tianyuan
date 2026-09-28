## 对拍公用原语——规格见 docs/PARITY_CODEC.md。
## f64_hex 是跨语言浮点相等性的根基：比较 IEEE754 位型而非十进制文本。
class_name ParityUtil
extends RefCounted


## float64 → 大端 8 字节小写 hex（与 JS DataView.setFloat64(0, v, false) 位级一致）
static func f64_hex(v: float) -> String:
	var buf := StreamPeerBuffer.new()
	buf.big_endian = true
	buf.put_double(v)
	return buf.data_array.hex_encode()


static func f64_from_hex(h: String) -> float:
	var bytes := PackedByteArray()
	bytes.resize(h.length() / 2)
	for i: int in bytes.size():
		bytes[i] = h.substr(i * 2, 2).hex_to_int()
	var buf := StreamPeerBuffer.new()
	buf.big_endian = true
	buf.data_array = bytes
	return buf.get_double()


static func fnv1a32(s: String) -> int:
	var h: int = 2166136261
	for b: int in s.to_utf8_buffer():
		h = h ^ b
		h = Rng.imul32(h, 16777619)
	return h


static func fnv1a32_hex(s: String) -> String:
	return "%08x" % fnv1a32(s)


static func sha256_hex(s: String) -> String:
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(s.to_utf8_buffer())
	return ctx.finish().hex_encode()


## bool → "1"/"0"（对拍行内布尔编码）
static func b01(v: bool) -> String:
	return "1" if v else "0"


## JS Math.round 语义（.5 向 +∞，即 floor(x+0.5)）——Godot round() 是远离零舍入，
## 负半数处两语言不一致。全内核的取整一律走这里，禁直接 round()。
static func js_round(v: float) -> float:
	return floor(v + 0.5)


## JS 稳定排序等价：key 为 float，并列按原索引。JS Array.sort 稳定而 Godot
## sort_custom 不保证 —— 目标选择/落点排序的跨引擎一致依赖本函数（units 构造即
## uid 升序，索引序 = JS 稳定序）。
static func stable_sort_by(arr: Array, key_fn: Callable) -> Array:
	var pairs := []
	pairs.resize(arr.size())
	for i: int in arr.size():
		pairs[i] = {"v": arr[i], "i": i, "k": float(key_fn.call(arr[i]))}
	pairs.sort_custom(func(a, b):
		if a["k"] != b["k"]:
			return a["k"] < b["k"]
		return a["i"] < b["i"])
	var out := []
	out.resize(pairs.size())
	for i: int in pairs.size():
		out[i] = pairs[i]["v"]
	return out


## JS Number.isFinite 等价（true/false；Godot 4 的 is_finite 只吃 float）
static func js_finite(v) -> bool:
	if v is int:
		return true
	if v is float:
		return is_finite(v)
	return false


## JS Number.isInteger 等价（JSON 解析出的 3.0 视为整数 3）
static func js_is_int(v) -> bool:
	if v is int:
		return true
	if v is float:
		return is_finite(v) and v == floor(v)
	return false
