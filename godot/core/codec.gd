## 对拍编解码器 GDScript 侧（规格：docs/PARITY_CODEC.md；TS 镜像：godot/tools/codec.mjs）。
## 输入事件 Dictionary 键名与 TS BattleEvent 一致；数值统一走 float64 位型编码。
class_name Codec
extends RefCounted

const SAFE_STRING := "^[A-Za-z0-9_.|:-]*$"

## String.match 是 glob 不是正则；字符集校验必须走 RegEx（与 TS 侧 /…/test 同语义，空串合法）
static var _safe_re: RegEx = RegEx.create_from_string(SAFE_STRING)


static func num(v) -> String:
	return ParityUtil.f64_hex(float(v))


static func bool01(v: bool) -> String:
	return "1" if v else "0"


static func str_tok(s: String) -> String:
	if _safe_re.search(s) == null:
		push_error("codec: 字符串越界字符集: %s" % s)
	return '"' + s + '"'


static func has(e: Dictionary, k: String) -> bool:
	return e.get(k) != null


static func opt_num(e: Dictionary, k: String) -> PackedStringArray:
	if not has(e, k):
		return ["-"]
	return ["1", num(e[k])]


static func opt_cell(e: Dictionary, k: String) -> PackedStringArray:
	if not has(e, k):
		return ["-"]
	var c: Dictionary = e[k]
	return ["1", num(c.get("c")), num(c.get("r"))]


static func opt_str(e: Dictionary, k: String) -> PackedStringArray:
	if not has(e, k):
		return ["-"]
	return ["1", str_tok(e[k])]


static func params_of(e: Dictionary, k: String) -> PackedStringArray:
	if not has(e, k):
		return ["-"]
	var p: Dictionary = e[k]
	var keys: Array = p.keys()
	keys.sort()
	var out: PackedStringArray = ["1"]
	for key: String in keys:
		out.append(str_tok(key))
		out.append(num(p[key]))
	return out


static func units_of(us: Array) -> PackedStringArray:
	var out: PackedStringArray = [num(us.size())]
	for u: Dictionary in us:
		var c: Dictionary = u.get("cell")
		out.append(num(u.get("uid")))
		out.append(str_tok(u.get("defId")))
		out.append(num(u.get("team")))
		out.append(num(u.get("star")))
		out.append(num(c.get("c")))
		out.append(num(c.get("r")))
		out.append(num(u.get("maxHp")))
		out.append(num(u.get("hp")))
	return out


static func encode_event(e: Dictionary) -> String:
	var t: String = e.get("t")
	var toks: PackedStringArray = []
	match t:
		"start", "spawn":
			toks.append(str_tok(t))
			toks.append(num(e.get("tick")))
			var u: PackedStringArray = units_of(e.get("units"))
			for x in u:
				toks.append(x)
		"castStart":
			toks = [str_tok(t), num(e.get("tick")), num(e.get("uid")), str_tok(e.get("skillId")), num(e.get("windup"))]
		"cast":
			toks.append(str_tok(t))
			toks.append(num(e.get("tick")))
			toks.append(num(e.get("uid")))
			toks.append(str_tok(e.get("skillId")))
			for x in opt_num(e, "targetUid"):
				toks.append(x)
			for x in opt_cell(e, "cell"):
				toks.append(x)
			for x in params_of(e, "params"):
				toks.append(x)
		"attackStart":
			toks = [str_tok(t), num(e.get("tick")), num(e.get("uid")), num(e.get("targetUid")), num(e.get("windup")), bool01(e.get("isRanged"))]
		"projectile":
			var f: Dictionary = e.get("from")
			var to: Dictionary = e.get("to")
			toks = [str_tok(t), num(e.get("tick")), num(e.get("uid")), num(e.get("targetUid")),
				num(f.get("c")), num(f.get("r")), num(to.get("c")), num(to.get("r")),
				num(e.get("dur")), str_tok(e.get("kind"))]
		"damage":
			toks = [str_tok(t), num(e.get("tick")), num(e.get("srcUid")), num(e.get("dstUid")),
				num(e.get("amount")), str_tok(e.get("type")), bool01(e.get("crit")), bool01(e.get("kill")), str_tok(e.get("source"))]
		"heal":
			toks = [str_tok(t), num(e.get("tick")), num(e.get("srcUid")), num(e.get("dstUid")), num(e.get("amount"))]
		"mana":
			toks = [str_tok(t), num(e.get("tick")), num(e.get("uid")), num(e.get("mp")), num(e.get("maxMp"))]
		"shield":
			toks = [str_tok(t), num(e.get("tick")), num(e.get("uid")), num(e.get("amount")), num(e.get("total"))]
		"move", "blink":
			var mf: Dictionary = e.get("from")
			var mt: Dictionary = e.get("to")
			toks = [str_tok(t), num(e.get("tick")), num(e.get("uid")),
				num(mf.get("c")), num(mf.get("r")), num(mt.get("c")), num(mt.get("r")), num(e.get("dur"))]
		"status":
			toks.append(str_tok(t))
			toks.append(num(e.get("tick")))
			toks.append(num(e.get("uid")))
			toks.append(str_tok(e.get("kind")))
			toks.append(num(e.get("dur")))
			toks.append(num(e.get("value")))
			toks.append(bool01(e.get("added")))
			for x in opt_str(e, "src"):
				toks.append(x)
		"death":
			toks = [str_tok(t), num(e.get("tick")), num(e.get("uid")), num(e.get("killerUid"))]
		"fx":
			toks.append(str_tok(t))
			toks.append(num(e.get("tick")))
			toks.append(str_tok(e.get("kind")))
			for k: String in ["uid", "cell", "targetUid", "radius", "team"]:
				if k == "cell":
					for x in opt_cell(e, k):
						toks.append(x)
				else:
					for x in opt_num(e, k):
						toks.append(x)
			for x in params_of(e, "params"):
				toks.append(x)
		"end":
			toks.append(str_tok(t))
			toks.append(num(e.get("tick")))
			if has(e, "winner"):
				toks.append("1")
				toks.append(num(e.get("winner")))
			else:
				toks.append("-")
			toks.append(bool01(e.get("timeout")))
		_:
			push_error("codec: 未知事件类型 %s" % t)
			return "[ERROR]"
	return "[" + ",".join(toks) + "]"


static func fnv1a32_hex(s: String) -> String:
	return ParityUtil.fnv1a32_hex(s)
