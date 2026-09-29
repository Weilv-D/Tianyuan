## BGM 路由与播放（夜宴音频三总线之 BGM 面）—— 原版典藏音乐层（D4）的 Godot 版。
## 曲目 = 原版选定的 CC0 四曲（见 music_tracks.gd），按四心境循环；无程序化兜底
## （2026-09-29 用户裁决：占位合成路径整体移除，曲目缺失即静默）。
## 切换带 0.45s 淡出 + 0.7s 淡入（对齐原版总线 ramp 节奏）；同心境不重启。
class_name Bgm
extends Node

var player: AudioStreamPlayer
var mood := ""
var _fade_tw: Tween


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	player = AudioStreamPlayer.new()
	player.bus = "BGM"
	add_child(player)


func _kill_fade() -> void:
	if _fade_tw != null and _fade_tw.is_valid():
		_fade_tw.kill()
	_fade_tw = null


func set_mood(new_mood: String) -> void:
	if mood == new_mood and player.playing:
		return
	var track: AudioStreamOggVorbis = MusicTracks.stream_for(new_mood)
	if track == null:
		_kill_fade()
		player.stop()
		mood = new_mood
		return
	if player.playing:
		# 换曲先杀旧 fade：未决的 _switch 回调会把刚切好的曲子再顶掉一次
		_kill_fade()
		_fade_tw = create_tween()
		_fade_tw.tween_property(player, "volume_db", -40.0, 0.45)
		_fade_tw.tween_callback(func() -> void: _switch(track, new_mood))
	else:
		_switch(track, new_mood)


func _switch(track: AudioStreamOggVorbis, new_mood: String) -> void:
	mood = new_mood
	player.stream = track
	player.volume_db = -40.0
	player.play()
	_kill_fade()
	_fade_tw = create_tween()
	_fade_tw.tween_property(player, "volume_db", 0.0, 0.7)


func stop() -> void:
	# 连 stop 一起杀：否则 0.45s 内 pending 的 _switch 会把刚停的 BGM 复活
	_kill_fade()
	player.stop()
	mood = ""
