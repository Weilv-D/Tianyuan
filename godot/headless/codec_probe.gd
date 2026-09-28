extends SceneTree
## 编解码往返验收：读 data/codec_fixture.json（TS 侧 parity_codec.mjs 生成），
## 逐事件重编码比对 + 流摘要比对。全等才退出码 0。
## 用法：godot --headless --path godot --script res://headless/codec_probe.gd

func _initialize() -> void:
	var f := FileAccess.open("res://data/codec_fixture.json", FileAccess.READ)
	if f == null:
		print('CODEC_JSON {"ok":false,"error":"fixture missing (先跑 node --import tsx tools/parity_codec.mjs)"}')
		quit(1)
		return
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	f.close()
	var fx: Dictionary = parsed
	var events: Array = fx.get("events")
	var lines: Array = fx.get("lines")
	var want_digest: String = fx.get("fnv1a32")

	var mismatches: Array = []
	var got: PackedStringArray = []
	for i: int in events.size():
		var line: String = Codec.encode_event(events[i])
		got.append(line)
		if line != String(lines[i]):
			mismatches.append({"i": i, "want": String(lines[i]), "got": line})

	var got_digest := ParityUtil.fnv1a32_hex("\n".join(got))
	var ok := mismatches.is_empty() and got_digest == want_digest
	var first: Dictionary = mismatches[0] if not mismatches.is_empty() else {}
	print("CODEC_JSON " + JSON.stringify({
		"ok": ok,
		"events": events.size(),
		"fnv1a32": got_digest,
		"want_fnv1a32": want_digest,
		"mismatch_count": mismatches.size(),
		"first_mismatch": first,
	}))
	quit(0 if ok else 1)
