## BGM 路由与占位播放（夜宴音频三总线之 BGM 面）。
## 音乐全新重制（样曲过审制）——过审前用程序化五声音阶 pad 占位：
## 宫商角徵羽（C D E G A）低音长音铺底，八拍一小节循环，BGM 总线低音量。
## 场景路由 set_mood：menu / prep / battle / final（ART_BIBLE 心境分类）。
class_name Bgm
extends Node

var player: AudioStreamPlayer
var mood := ""
var _timer: Timer

# 四心境参数：根音（Hz，A=440 律）与音阶密度
const MOODS := {
	"menu": { "root": 130.81, "step": 8.0, "gain": 0.16 },    # C3 静谧
	"prep": { "root": 146.83, "step": 6.0, "gain": 0.13 },    # D3 沉思
	"battle": { "root": 110.00, "step": 3.0, "gain": 0.18 },  # A2 紧张
	"final": { "root": 98.00, "step": 10.0, "gain": 0.15 },   # G2 苍茫
}
# 五声音阶音程比（相对根音，两个八度内）
const PENTA := [1.0, 9.0 / 8.0, 5.0 / 4.0, 3.0 / 2.0, 5.0 / 3.0, 2.0, 9.0 / 4.0]


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	player = AudioStreamPlayer.new()
	player.bus = "BGM"
	add_child(player)
	_timer = Timer.new()
	_timer.timeout.connect(_tick)
	add_child(_timer)


func set_mood(new_mood: String) -> void:
	if mood == new_mood:
		return
	mood = new_mood
	var cfg: Dictionary = MOODS.get(new_mood, MOODS["menu"])
	_timer.wait_time = float(cfg["step"])
	if not _timer.is_stopped() or new_mood != "":
		_timer.start()
	if not player.playing:
		_tick()


func stop() -> void:
	_timer.stop()
	player.stop()


## 每拍：长衰减正弦 pad（宫系统五声，随机取音级 —— 非对局随机源白名单：BGM 氛围不进 rng 流）
func _tick() -> void:
	var cfg: Dictionary = MOODS.get(mood, MOODS["menu"])
	var root: float = float(cfg["root"])
	var ratio: float = PENTA[randi() % PENTA.size()]
	if mood == "battle" and randf() < 0.3:
		ratio *= 0.5  # 战斗心境偶落低八度
	var freq := root * ratio
	var dur: float = float(cfg["step"]) * 1.6
	var gain: float = float(cfg["gain"])
	# 双振荡（根音 + 纯五度泛音）长音
	player.stream = _make_tone([freq, freq * 1.5], [1.0, 0.35], dur, gain)
	player.play()


func _make_tone(freqs: Array, gains: Array, dur: float, gain: float) -> AudioStreamWAV:
	var rate := 22050
	var n := int(dur * rate)
	var data := PackedByteArray()
	data.resize(n * 2)
	var attack := int(rate * 0.25)
	var release_from := int(float(n) * 0.45)
	for i: int in n:
		var t := float(i) / float(rate)
		var env := 1.0
		if i < attack:
			env = float(i) / float(attack)
		elif i > release_from:
			env = 1.0 - (float(i) - float(release_from)) / float(n - release_from)
		var v := 0.0
		for k: int in freqs.size():
			v += sin(TAU * float(freqs[k]) * t) * float(gains[k])
		data.encode_s16(i * 2, int(clampf(v * env * gain, -1.0, 1.0) * 32767.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = rate
	wav.stereo = false
	wav.data = data
	return wav
