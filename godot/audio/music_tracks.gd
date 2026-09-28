## 典藏音乐清单 —— 原版 src/music/manifest.ts（D4）的 Godot 侧镜像与单一真源。
## 四曲 = 原版选定的 CC0-1.0 授权曲（Kevin MacLeod，freepd.com），随包分发零署名义务，
## 出处仍如实登记（对齐原版 THIRD_PARTY_LICENSES 纪律；读我.txt 带一行脚注）。
## menu.ogg 已从 Theora 封装无损转出纯 Vorbis（sha256 因此与原仓不同，其余三曲字节一致）。
class_name MusicTracks

const TRACKS := [
	{
		"id": "menu", "file": "res://assets/audio/menu.ogg", "title": "Night Vigil",
		"artist": "Kevin MacLeod", "license": "CC0-1.0", "source": "https://freepd.com/epic.php",
		"sha256": "adc5a64c",
	},
	{
		"id": "prep", "file": "res://assets/audio/prep.ogg", "title": "Think About It",
		"artist": "Kevin MacLeod", "license": "CC0-1.0", "source": "https://freepd.com/epic.php",
		"sha256": "77099c32",
	},
	{
		"id": "battle", "file": "res://assets/audio/battle.ogg", "title": "Battle Ready",
		"artist": "Kevin MacLeod", "license": "CC0-1.0", "source": "https://freepd.com/epic.php",
		"sha256": "695bc172",
	},
	{
		"id": "final", "file": "res://assets/audio/final.ogg", "title": "Epic Boss Battle",
		"artist": "Kevin MacLeod", "license": "CC0-1.0", "source": "https://freepd.com/epic.php",
		"sha256": "e1cdca99",
	},
]

static var _cache := {}


static func stream_for(mood: String) -> AudioStreamOggVorbis:
	if _cache.has(mood):
		return _cache[mood]
	for t: Dictionary in TRACKS:
		if String(t["id"]) == mood:
			var s: AudioStreamOggVorbis = load(String(t["file"]))
			if s != null:
				s.loop = true
				_cache[mood] = s
				return s
	return null


static func credit_line() -> String:
	var artists := {}
	for t: Dictionary in TRACKS:
		artists[String(t["artist"])] = true
	return "音乐 %d 曲 · %s · CC0" % [TRACKS.size(), " · ".join(artists.keys())]
