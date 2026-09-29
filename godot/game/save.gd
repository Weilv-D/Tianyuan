## 本地存档（src/game/save.ts 对齐版，存储从 localStorage 换 user:// 文件）。
## 存整个 Match 的可序列化快照（含 RNG 状态与卡池），读回来是同一局。
##
## Godot 版口径（M2 决策登记）：
## - 独立起档、不迁移 v2（不背 localStorage 时代包袱），只认 v3 载荷；
## - 普通档与每日挑战档分文件（跨模式不污染，对应 TS v3.1 分键裁决）；
## - GDScript 无 try/catch：Match.from_json 的失败协议是返回 null（TS 是 throw），
##   本文件按「坏档即无档」同口径消化，绝不把游戏卡在启动页；
## - savedAt 仅排查用元数据，不进 seed/rng 流（Time 白名单唯一授权点）。
class_name SaveStore
extends RefCounted

const PATH_BY_MODE := {
	"normal": "user://save_v3.json",
	"daily": "user://save_v3_daily.json",
}


static func _key_of(mode: String) -> String:
	return PATH_BY_MODE.get(mode, PATH_BY_MODE["normal"])


static func _load_data(raw: String) -> Variant:
	# 空串判空先于 parse：JSON.parse_string("") 每次打一条引擎 ERROR（日志噪音）
	var parsed: Variant = JSON.parse_string(raw) if raw.strip_edges() != "" else null
	if parsed == null or not (parsed is Dictionary):
		return null
	var v: Variant = parsed.get("v", null)
	if v != 3:
		return null
	var d: Variant = parsed.get("data", null)
	if not (d is Dictionary):
		return null
	# 骨架校验（from_json 假定字段的粗筛，深层结构由 from_json 清洗层兜住）
	if not (d.get("players", null) is Array) or (d["players"] as Array).is_empty():
		return null
	if not ParityUtil.js_finite(d.get("rngState", null)) or not ParityUtil.js_finite(d.get("round", null)):
		return null
	if not (d.get("phase", null) is String) or not (d.get("pool", null) is Dictionary):
		return null
	if not (d.get("ghosts", null) is Array):
		return null
	return d


static func _read_file(path: String) -> String:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return ""
	var raw := f.get_as_text()
	f.close()
	return raw


static func _write_file(path: String, text: String) -> bool:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(text)
	f.close()
	return true


static func has_save(mode: String = "normal") -> bool:
	var path := _key_of(mode)
	var raw := _read_file(path)
	if not raw.is_empty():
		if _load_data(raw) != null:
			return true
		# 键存在不等于有可用存档：损坏载荷清掉，避免每次都走判定失败路径
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	return false


static func save_match(m: Match) -> bool:
	# 失败必须显式暴露（返回 false），否则「继续」静默读到上一次成功的旧档
	var payload := JSON.stringify({ "v": 3, "savedAt": int(Time.get_unix_time_from_system() * 1000.0), "mode": m.mode, "data": m.to_json() })
	return _write_file(_key_of(m.mode), payload)


static func load_match(mode: String = "normal") -> Variant:
	var path := _key_of(mode)
	var raw := _read_file(path)
	if not raw.is_empty():
		var data: Variant = _load_data(raw)
		if data != null:
			var m: Variant = Match.from_json(data)
			if m != null:
				return m
			# 骨架通过但深层结构损坏：与「损坏即无档」同口径，坏档自愈并喊出来
			push_warning("[save] 存档结构损坏，已作废并清除（模式 %s）" % mode)
			DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
			return null
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	return null


## 清除指定模式的存档（对局结束/放弃只清本局模式）
static func clear_save(mode: String = "normal") -> void:
	DirAccess.remove_absolute(ProjectSettings.globalize_path(_key_of(mode)))


# ── 玩家偏好（与对局存档分开存，换局不丢） ──────────────────

const PREF_PATH := "user://prefs.json"

const DEFAULT_PREFS := {
	"volBgm": 0.5,
	"volSfx": 0.75,
	"volUi": 0.6,
	"muted": false,
	"autoDeploy": true,
	"calm": false,
}


## Godot 版口径：无 matchMedia prefers-reduced-motion 等价系统查询，
## 静观模式首启按标准默认（false），用户在设置面板主动开启后以用户为准。
static func load_prefs() -> Dictionary:
	var out: Dictionary = DEFAULT_PREFS.duplicate()
	var pref_raw := _read_file(PREF_PATH)
	var parsed: Variant = JSON.parse_string(pref_raw) if pref_raw.strip_edges() != "" else null
	if not (parsed is Dictionary):
		return out
	var v: Variant = parsed.get("volBgm", null)
	if ParityUtil.js_finite(v):
		out["volBgm"] = clampf(float(v), 0.0, 1.0)
	v = parsed.get("volSfx", null)
	if ParityUtil.js_finite(v):
		out["volSfx"] = clampf(float(v), 0.0, 1.0)
	v = parsed.get("volUi", null)
	if ParityUtil.js_finite(v):
		out["volUi"] = clampf(float(v), 0.0, 1.0)
	if parsed.get("muted", null) is bool:
		out["muted"] = parsed["muted"]
	if parsed.get("autoDeploy", null) is bool:
		out["autoDeploy"] = parsed["autoDeploy"]
	if parsed.get("calm", null) is bool:
		out["calm"] = parsed["calm"]
	return out


static func save_prefs(prefs: Dictionary) -> bool:
	return _write_file(PREF_PATH, JSON.stringify(prefs))
