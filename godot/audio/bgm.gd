## BGM 路由与播放（夜宴音频三总线之 BGM 面）—— 原版典藏音乐层（D4）的 Godot 版。
## 曲目 = 原版选定的 CC0 四曲（见 music_tracks.gd），按四心境循环；无程序化兜底
## （2026-09-29 用户裁决：占位合成路径整体移除，曲目缺失即静默）。
## 切换带 0.45s 淡出 + 0.7s 淡入（对齐原版总线 ramp 节奏）；同心境不重启。
class_name Bgm
extends Node

var player: AudioStreamPlayer
var mood := ""


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	player = AudioStreamPlayer.new()
	player.bus = "BGM"
	add_child(player)


func set_mood(new_mood: String) -> void:
	if mood == new_mood and player.playing:
		return
	var track: AudioStreamOggVorbis = MusicTracks.stream_for(new_mood)
	if track == null:
		player.stop()
		mood = new_mood
		return
	if player.playing:
		var tw := create_tween()
		tw.tween_property(player, "volume_db", -40.0, 0.45)
		tw.tween_callback(func() -> void: _switch(track, new_mood))
	else:
		_switch(track, new_mood)


func _switch(track: AudioStreamOggVorbis, new_mood: String) -> void:
	mood = new_mood
	player.stream = track
	player.volume_db = -40.0
	player.play()
	var tw := create_tween()
	tw.tween_property(player, "volume_db", 0.0, 0.7)


func stop() -> void:
	player.stop()
	mood = ""
