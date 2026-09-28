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
