## 具名音效层 —— src/audio/AudioEngine.ts 的 play()/SfxName（16 名）+ playPluck() 移植。
## 三基元 tone/noise/sweep + WebAudio biquad（RBJ cookbook 公式）逐参数移植；每次调用
## 现渲染立体声 WAV（jitter 每次重掷 = 表现层随机，与 TS 侧 Math.random 同口径，
## 不进对局 rng 流）。总线路由与原版一致：ui 系 → UI，其余 → SFX；混响由总线挂载统一。
class_name Sfx
extends Node

const RATE := 22050
## 同时在响的声部上限（弹道/命中连发的节点堆积防线）
const MAX_VOICES := 24
const PENTATONIC := [0, 2, 4, 7, 9]
const ROOT_HZ := 130.81

# 原版音效面里走 UI 总线的名字（其余全部走 SFX）
const UI_NAMES := {"coin": true, "ui": true, "uiBig": true, "warn": true}


func play(sound_name: String) -> void:
	var layers: Array = []
	var p := randf() * 0.36 - 0.18
	var k := 1.0
	match sound_name:
		"hit":
			k = 0.92 + randf() * 0.16
			layers.append(["noise", 0.035, 0.22, 2600.0 * k, 1.1, 0.0, "highpass", p])
			layers.append(["tone", 210.0 * k, 0.07, "triangle", 0.2, 0.0, 0.002, 1400.0, 0.8, p])
			layers.append(["sweep", 180.0 * k, 64.0, 0.1, 0.2, "sine", 0.0, p])
		"crit":
			k = 0.94 + randf() * 0.12
			layers.append(["noise", 0.13, 0.34, 1100.0 * k, 0.7, 0.0, "bandpass", p])
			layers.append(["noise", 0.05, 0.2, 3400.0 * k, 1.2, 0.0, "highpass", p])
			layers.append(["sweep", 150.0 * k, 46.0, 0.26, 0.32, "sine", 0.0, p])
			layers.append(["tone", 72.0, 0.2, "sine", 0.22, 0.02, 0.008, 500.0, 0.7, 0.0])
			layers.append(["tone", 1320.0 * k, 0.16, "sine", 0.07, 0.03, 0.004, 3600.0, 0.6, p * 0.6])
			layers.append(["tone", 1980.0 * k, 0.12, "sine", 0.045, 0.045, 0.004, 4200.0, 0.6, -p * 0.6])
		"shoot":
			k = 0.92 + randf() * 0.16
			layers.append(["tone", 620.0 * k, 0.06, "triangle", 0.16, 0.0, 0.002, 2400.0, 0.7, p])
			layers.append(["sweep", 1300.0 * k, 420.0, 0.09, 0.06, "sine", 0.0, p])
			layers.append(["noise", 0.08, 0.12, 2200.0 * k, 1.4, 0.0, "bandpass", p])
		"cast":
			layers.append(["sweep", 220.0, 920.0, 0.38, 0.15, "sine", 0.0, 0.0])
			layers.append(["tone", 660.0, 0.36, "triangle", 0.08, 0.02, 0.006, 1600.0, 0.7, 0.0])
			layers.append(["tone", 990.0, 0.32, "sine", 0.045, 0.06, 0.008, 2000.0, 0.6, 0.0])
		"skillBig":
			layers.append(["sweep", 120.0, 1400.0, 0.52, 0.22, "sawtooth", 0.0, 0.0])
			layers.append(["noise", 0.42, 0.32, 900.0, 0.6, 0.08, "bandpass", 0.0])
			layers.append(["tone", 60.0, 0.58, "sine", 0.38, 0.1, 0.02, 600.0, 0.8, 0.0])
			for i: int in 4:
				var pan := -0.22 if i % 2 == 0 else 0.22
				layers.append(["tone", _note_hz(i + 4, 1), 0.28, "triangle", 0.09, 0.12 + i * 0.05, 0.006, 2000.0, 0.6, pan])
		"heal":
			for i: int in 3:
				layers.append(["tone", _note_hz(i + 2, 1), 0.52, "sine", 0.11, i * 0.06, 0.01, 2400.0, 0.6, (i - 1) * 0.18])
			layers.append(["noise", 0.28, 0.07, 3400.0, 1.3, 0.0, "highpass", 0.0])
		"shield":
			layers.append(["tone", 320.0, 0.32, "triangle", 0.14, 0.0, 0.008, 1200.0, 0.7, -0.12])
			layers.append(["tone", 480.0, 0.28, "sine", 0.09, 0.03, 0.008, 1600.0, 0.6, 0.12])
			layers.append(["noise", 0.2, 0.09, 2200.0, 2.0, 0.0, "highpass", 0.0])
		"death":
			layers.append(["sweep", 340.0, 58.0, 0.58, 0.22, "sawtooth", 0.0, 0.0])
			layers.append(["noise", 0.4, 0.18, 520.0, 0.7, 0.05, "bandpass", 0.0])
			layers.append(["tone", 46.0, 0.52, "sine", 0.28, 0.1, 0.02, 500.0, 0.8, 0.0])
		"star3":
			for i: int in 6:
				var pan := -0.18 if i % 2 == 0 else 0.18
				layers.append(["tone", _note_hz(i, 1), 0.52, "triangle", 0.14, i * 0.075, 0.008, 2600.0, 0.6, pan])
				layers.append(["tone", _note_hz(i, 2), 0.36, "sine", 0.07, i * 0.075 + 0.02, 0.008, 3000.0, 0.5, pan])
			layers.append(["noise", 0.9, 0.11, 4200.0, 1.2, 0.1, "highpass", 0.0])
			layers.append(["tone", 64.0, 1.0, "sine", 0.32, 0.1, 0.02, 900.0, 0.7, 0.0])
		"levelup":
			for i: int in 4:
				var pan := -0.15 if i % 2 == 0 else 0.15
				layers.append(["tone", _note_hz(i, 1), 0.34, "triangle", 0.13, i * 0.06, 0.006, 2200.0, 0.6, pan])
		"coin":
			layers.append(["tone", 1180.0, 0.1, "sine", 0.15, 0.0, 0.004, 3000.0, 0.6, -0.1])
			layers.append(["tone", 1760.0, 0.14, "sine", 0.11, 0.035, 0.005, 3200.0, 0.6, 0.1])
		"ui":
			layers.append(["tone", 520.0, 0.05, "square", 0.045, 0.0, 0.003, 1800.0, 0.7, 0.0])
			layers.append(["noise", 0.04, 0.045, 3000.0, 1.5, 0.0, "highpass", 0.0])
		"uiBig":
			layers.append(["tone", 300.0, 0.14, "triangle", 0.11, 0.0, 0.006, 1400.0, 0.7, 0.0])
			layers.append(["tone", 600.0, 0.16, "sine", 0.07, 0.04, 0.008, 1800.0, 0.6, 0.0])
		"warn":
			layers.append(["tone", 180.0, 0.32, "sawtooth", 0.12, 0.0, 0.01, 900.0, 0.9, 0.0])
			layers.append(["tone", 118.0, 0.42, "sine", 0.16, 0.1, 0.02, 700.0, 0.7, 0.0])
		"victory":
			for i: int in 5:
				var pan := -0.14 if i % 2 == 0 else 0.14
				layers.append(["tone", _note_hz(i, 1), 0.7, "triangle", 0.14, i * 0.11, 0.01, 2400.0, 0.6, pan])
			layers.append(["tone", _note_hz(0, 2), 1.1, "sine", 0.15, 0.55, 0.02, 2200.0, 0.6, 0.0])
		"defeat":
			for i: int in 5:
				layers.append(["tone", _note_hz(4 - i, 0), 0.6, "sine", 0.13, i * 0.13, 0.012, 1600.0, 0.6, 0.0])
			layers.append(["tone", 54.0, 1.2, "sine", 0.26, 0.5, 0.02, 600.0, 0.8, 0.0])
		_:
			return
	_emit("UI" if UI_NAMES.get(sound_name, false) else "SFX", layers)


## 开战弦响（原版 GameScene:803 徵音起手 / LegendaryFx:94 宫音落印同款）
func play_pluck(freq: float) -> void:
	var pan := randf() * 0.3 - 0.15
	_emit("SFX", [
		["tone", freq, 0.52, "triangle", 0.11, 0.0, 0.004, 1600.0, 0.7, pan],
		["tone", freq * 2.0, 0.24, "sine", 0.048, 0.005, 0.004, 2200.0, 0.6, pan],
		["tone", freq * 3.0, 0.14, "sine", 0.024, 0.01, 0.004, 2600.0, 0.6, pan],
	])


func _note_hz(degree: int, octave: int) -> float:
	var d := floori(degree)
	var semi: int = PENTATONIC[((d % 5) + 5) % 5] + 12 * (octave + floori(d / 5.0))
	return ROOT_HZ * pow(2.0, semi / 12.0)


func _layer_end(l: Array) -> float:
	if l[0] == "tone":
		return float(l[5]) + float(l[2])
	if l[0] == "noise":
		return float(l[5]) + float(l[1])
	return float(l[6]) + float(l[3])


## 渲染发声：全部层混进一条立体声 WAV，单播放器挂对应总线。
## 累积缓冲用 Array（引用语义 —— Packed* 是值类型，传参后写入不落回）。
func _emit(bus: String, layers: Array) -> void:
	var total := 0.0
	for l: Array in layers:
		total = maxf(total, _layer_end(l))
	var n := int(total * RATE) + 64
	if n <= 0:
		return
	var left := []
	var right := []
	left.resize(n)
	right.resize(n)
	left.fill(0.0)
	right.fill(0.0)
	for l: Array in layers:
		_mix_layer(l, left, right)
	var data := PackedByteArray()
	data.resize(n * 4)
	for i: int in n:
		data.encode_s16(i * 4, int(clampf(float(left[i]), -1.0, 1.0) * 32767.0))
		data.encode_s16(i * 4 + 2, int(clampf(float(right[i]), -1.0, 1.0) * 32767.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = RATE
	wav.stereo = true
	wav.data = data
	# 并发上限：大规模团战弹道连发会在同帧堆出数十个 player（节点+整条 WAV）。
	# 超限强停最旧声部让位（remove_child 立即腾位，queue_free 帧末回收节点本体）
	while get_child_count() >= MAX_VOICES:
		var oldest := get_child(0) as AudioStreamPlayer
		if oldest == null:
			break
		oldest.stop()
		remove_child(oldest)
		oldest.queue_free()
	var player := AudioStreamPlayer.new()
	player.bus = bus
	player.stream = wav
	player.finished.connect(player.queue_free)
	add_child(player)
	player.play()


## 单层混入 —— 层布局：
##   tone  [0]"tone" [1]freq [2]dur [3]type [4]gain [5]when [6]attack [7]cutoff [8]q [9]pan
##   noise [0]"noise" [1]dur [2]gain [3]hz [4]q [5]when [6]ftype [7]pan
##   sweep [0]"sweep" [1]from [2]to [3]dur [4]gain [5]type [6]when [7]pan
func _mix_layer(l: Array, left: Array, right: Array) -> void:
	var kind: String = l[0]
	var when := 0.0
	var dur := 0.0
	var gain := 0.0
	var pan := 0.0
	var tone_hz := 0.0
	var to_hz := 0.0
	var wave := "sine"
	var attack := 0.005
	var cutoff := 0.0
	var fq := 0.7
	var ftype := ""
	if kind == "tone":
		tone_hz = float(l[1])
		dur = float(l[2])
		wave = String(l[3])
		gain = float(l[4])
		when = float(l[5])
		attack = float(l[6])
		cutoff = float(l[7])
		fq = float(l[8])
		pan = float(l[9])
		ftype = "lowpass"
	elif kind == "noise":
		dur = float(l[1])
		gain = float(l[2])
		tone_hz = float(l[3])
		fq = float(l[4])
		when = float(l[5])
		ftype = String(l[6])
		pan = float(l[7])
	else:
		tone_hz = float(l[1])
		to_hz = maxf(20.0, float(l[2]))
		dur = float(l[3])
		gain = float(l[4])
		wave = String(l[5])
		when = float(l[6])
		pan = float(l[7])
	var start := int(when * RATE)
	var ln := int(dur * RATE)
	if ln <= 0 or start >= left.size():
		return
	# RBJ biquad 系数 —— 滤波频率按层型取值：tone 用 cutoff（低通），
	# noise 用其滤波中心频率（highpass/bandpass）。曾误用 tone 的基频当滤波频率，
	# 全部 tone 被压成近纯基频、亮部尽失（2026-09-29 深查修复）
	var filter_hz := 0.0
	if kind == "tone":
		filter_hz = cutoff
	elif kind == "noise":
		filter_hz = tone_hz
	var b0 := 1.0
	var b1 := 0.0
	var b2 := 0.0
	var a1 := 0.0
	var a2 := 0.0
	if ftype != "" and filter_hz > 0.0 and filter_hz < RATE * 0.49:
		var w0 := TAU * filter_hz / RATE
		var cos_w := cos(w0)
		var alpha := sin(w0) / (2.0 * maxf(0.1, fq))
		var a0 := 1.0 + alpha
		if ftype == "lowpass":
			b0 = (1.0 - cos_w) / 2.0 / a0
			b1 = (1.0 - cos_w) / a0
			b2 = b0
		elif ftype == "highpass":
			b0 = (1.0 + cos_w) / 2.0 / a0
			b1 = -(1.0 + cos_w) / a0
			b2 = b0
		else:
			b0 = alpha / a0
			b1 = 0.0
			b2 = -alpha / a0
		a1 = -2.0 * cos_w / a0
		a2 = (1.0 - alpha) / a0
	var filtered := b0 != 1.0 or b1 != 0.0 or b2 != 0.0
	# 声像（等功率）
	var lg := cos((pan + 1.0) * PI / 4.0)
	var rg := sin((pan + 1.0) * PI / 4.0)
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	var ph := 0.0
	for i: int in ln:
		var idx := start + i
		if idx >= left.size():
			break
		var t := float(i) / RATE
		var s := 0.0
		if kind == "noise":
			s = randf() * 2.0 - 1.0
		else:
			var hz := tone_hz
			if kind == "sweep":
				hz = tone_hz * pow(to_hz / tone_hz, minf(1.0, t / dur))
			ph += hz / RATE
			var frac := fmod(ph, 1.0)
			match wave:
				"sine":
					s = sin(TAU * ph)
				"square":
					s = 1.0 if frac < 0.5 else -1.0
				"sawtooth":
					s = 2.0 * frac - 1.0
				_:
					s = 4.0 * absf(frac - 0.5) - 1.0
		# 包络（WebAudio exponentialRamp 的等比曲线）
		var env := 1.0
		if kind == "noise":
			env = pow(0.0001 / maxf(0.0001, gain), t / dur)
		elif kind == "sweep":
			var up := dur * 0.12
			env = pow(maxf(0.0002, gain) / 0.0001, minf(1.0, t / up))
			env *= pow(0.0001 / maxf(0.0002, gain), maxf(0.0, (t - up) / (dur - up)))
		else:
			env = pow(maxf(0.0002, gain) / 0.0001, minf(1.0, t / attack))
			env *= pow(0.0001 / maxf(0.0002, gain), maxf(0.0, (t - attack) / (dur - attack)))
		if filtered:
			var filt := b0 * s + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
			x2 = x1
			x1 = s
			y2 = y1
			y1 = filt
			s = filt
		var v := s * env * gain
		left[idx] = float(left[idx]) + v * lg
		right[idx] = float(right[idx]) + v * rg
