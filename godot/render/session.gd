## 全局会话单例（autoload: Sess）——场景切换数据、字体与音频总线的启动咽喉。
## 对应 Phaser 版 main.ts 的启动职责（字体预载 / 音频解锁 / 场景数据传递）。
extends Node

## 当前对局（Match 实例；null = 未在对局中）
var match = null
## 场景切换附带数据（对应 Phaser SceneData：{fresh, daily, resultPending, pair, config…}）
var scene_data: Dictionary = {}

## 字体：篆体（标题/徽章/印章）与正文（宋体系统字体，夜宴口径）
var seal_font: FontFile
var body_font: SystemFont

## 音频三总线（bgm / sfx / ui —— 夜宴音频设计的 Godot 落地骨架）
var bus_ready := false
var bgm


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_load_fonts()
	_setup_audio_buses()
	_setup_smoke()
	bgm = load("res://audio/bgm.gd").new()
	bgm.name = "Bgm"
	add_child(bgm)


## 实机冒烟钩子（__qa 精神的 Godot 版）：--smoke=<tag>,<frames> —— 跑 N 帧后截图
## 存 .tmp-shots-godot/<tag>.png（不入库）并退出 0；供门禁/视觉验收批次复用。
func _setup_smoke() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--smoke="):
			_run_smoke(a.substr(8))
		elif a == "--autostart":
			scene_data = { "match": Match.new(20260928, "你", "normal") }


func _enter_game() -> void:
	get_tree().change_scene_to_file("res://render/game_scene.tscn")


func _run_smoke(spec_txt: String) -> void:
	var spec: PackedStringArray = spec_txt.split(",")
	var tag := spec[0]
	var frames := int(spec[1]) if spec.size() > 1 else 120
	for i: int in frames:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var dir := ProjectSettings.globalize_path("res://../.tmp-shots-godot")
	DirAccess.make_dir_recursive_absolute(dir)
	# 布局自检：窗口尺寸 vs 视口可见矩形（canvas_items 生效 = 视口恒 1920x1080 且内容缩放进窗口）
	var win := get_window()
	var vis := get_viewport().get_visible_rect()
	print('SMOKE_LAYOUT win=%dx%d visible_rect=%dx%d origin=%s content_scale=%s' % [
		win.size.x, win.size.y, vis.size.x, vis.size.y, vis.position,
		get_viewport().content_scale_factor])
	var img := get_viewport().get_texture().get_image()
	img.save_png("%s/%s.png" % [dir, tag])
	print("SMOKE_SHOT ", tag)
	get_tree().quit(0)


func _load_fonts() -> void:
	seal_font = load("res://assets/fonts/YiShanBeiZhuanTi.ttf")
	# 正文走系统宋体（现版 Phaser 用浏览器宋体渲染正文，Godot 等价物 = SystemFont）
	body_font = SystemFont.new()
	body_font.font_names = PackedStringArray(["SimSun", "Microsoft YaHei", "serif"])


func _setup_audio_buses() -> void:
	if bus_ready:
		return
	# 三总线：Master → BGM / SFX / UI（混响挂在 SFX；音量由 prefs 起始，M3 占位 0.5/0.75/0.6）
	for bus_name in ["BGM", "SFX", "UI"]:
		var idx := AudioServer.bus_count
		AudioServer.add_bus(idx)
		AudioServer.set_bus_name(idx, bus_name)
		AudioServer.set_bus_send(idx, "Master")
	var sfx := AudioServer.get_bus_index("SFX")
	if AudioServer.get_bus_effect_count(sfx) == 0:
		var rev := AudioEffectReverb.new()
		rev.room_size = 0.35
		rev.damping = 0.7
		rev.wet = 0.12
		AudioServer.add_bus_effect(sfx, rev)
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index("BGM"), linear_to_db(0.5))
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index("SFX"), linear_to_db(0.75))
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index("UI"), linear_to_db(0.6))
	bus_ready = true


## 极简合成音占位（新音乐样曲过审前的 UI 反馈；夜宴禁荧光原则下取短促低吟）
func blip(bus_name: String, freq: float = 440.0, dur: float = 0.06, gain: float = 0.18) -> void:
	var idx := AudioServer.get_bus_index(bus_name)
	if idx < 0:
		return
	var player := AudioStreamPlayer.new()
	player.bus = bus_name
	var buf := AudioStreamWAV.new()
	var rate := 22050
	var n := int(dur * rate)
	var data := PackedByteArray()
	data.resize(n * 2)
	for i: int in n:
		var t := float(i) / float(rate)
		var env := (1.0 - float(i) / float(n)) * gain
		var v := int(sin(TAU * freq * t) * env * 32767.0)
		data.encode_s16(i * 2, v)
	buf.format = AudioStreamWAV.FORMAT_16_BITS
	buf.mix_rate = rate
	buf.stereo = false
	buf.data = data
	player.stream = buf
	player.finished.connect(player.queue_free)
	add_child(player)
	player.play()


## 场景切换（带数据；对应 Phaser fadeTo）。BGM 心境随场景自动路由
## （menu→menu；game_scene→prep；battle→battle；result→final）。
func go(path: String, data: Dictionary = {}) -> void:
	scene_data = data
	var mood := "menu"
	if path.contains("game_scene"):
		mood = "prep"
	elif path.contains("battle"):
		mood = "battle"
	elif path.contains("result"):
		mood = "final"
	bgm.set_mood(mood)
	get_tree().change_scene_to_file(path)
