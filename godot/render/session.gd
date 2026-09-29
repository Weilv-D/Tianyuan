## 全局会话单例（autoload: Sess）——场景切换数据、字体与音频总线的启动咽喉。
## 对应 Phaser 版 main.ts 的启动职责（字体预载 / 音频解锁 / 场景数据传递）。
extends Node

## 场景切换附带数据（对应 Phaser SceneData：{fresh, daily, resultPending, pair, config…}；
## 对局 Match 实例也经此传递——各场景一律走 scene_data.get("match")）
var scene_data: Dictionary = {}

## 字体：篆体（标题/徽章/印章）与正文（宋体系统字体，夜宴口径）
var seal_font: FontFile
var body_font: SystemFont

## 音频三总线（bgm / sfx / ui —— 夜宴音频设计的 Godot 落地骨架）
var bus_ready := false
var bgm
var sfx

## 场景转场幕布（transition.ts 对齐：160ms 淡出夜色 → 切场 → 淡入）
var _fade: ColorRect
## --battle-smoke 占用中：boot 序章让路（不得再转发 game_scene 把战斗场景顶掉——曾致
## 该探针永远落在 game/menu，战斗路径回归钉失效，2026-09-29 第十四轮审查实证）
var battle_smoke := false

## 启动预载（帧预算制，主线程分片）：序章 3.4s 淡入期内把 108 张贴图与音效预池
## 吃完，主线程每帧最多干 90ms —— hitch 被淡入掩盖，全程零跨线程。
## 纪律：**不用 WorkerThreadPool 载贴图** —— worker 的 ResourceLoader.load 会在
## RenderingServer 越权建 RID，与主线程并发即退出期段错误/挂死（2.4.0 实证二相
## 故障 EXIT=139/124，最小复现 = worker 载 3 张 ctex 后 quit；2.1.0「线程池化
## 预载」只压低了概率，未除根 —— 探针门禁的 EXIT 验收钉死此判例）。
var _prime_queue: Array = []
var _atlas_done := false
## 转场进行中（墨晕吞没→换场→淡入）。键盘入口一律短路：转场窗口内按键会在
## 「结算已跑、phase 未翻」的中间态上做出第二个动作（空格=回合双结算，2.4.1 修复）
var transitioning := false
var _fade_tw: Tween = null

## 启动预载的音效配方（对局首批发音；池填满 VARIANTS_PER_SOUND 变体）
const PRIME_SOUNDS := [
	"coin", "ui", "uiBig", "warn", "levelup", "star3", "skillBig",
	"shoot", "heal", "shield", "cast", "death", "victory", "defeat",
]


func prime_assets() -> void:
	if not _prime_queue.is_empty():
		return
	for c: Dictionary in Spec.champions:
		_prime_queue.append("res://assets/pieces/%s.png" % String(c["id"]))
	for it: Dictionary in Spec.items:
		_prime_queue.append("res://assets/items/%s.png" % String(it["id"]))
	# 音效全变体池：每具名配方 VARIANTS_PER_SOUND 个变体，逐片合成（闭包按值捕获
	# 逐个局部副本 —— 循环变量直捕是 2.3.0 已判的闭包共享事故）
	for n: String in PRIME_SOUNDS:
		var nm := String(n)
		for v: int in 3:
			_prime_queue.append(func() -> void: sfx.pool_variant(nm))
	_prime_step()


## 帧预算分片：每帧最多 90ms，剩余挂下一帧（协程宿主张 = Sess 常驻，换场不死）
func _prime_step() -> void:
	var budget := Time.get_ticks_msec() + 90
	while not _prime_queue.is_empty() and Time.get_ticks_msec() < budget:
		var item: Variant = _prime_queue.pop_front()
		if item is Callable:
			(item as Callable).call()  # 音效变体单片合成
		else:
			ResourceLoader.load(String(item), "Texture2D")
	if not _prime_queue.is_empty():
		await get_tree().process_frame
		_prime_step()
		return
	# 器物谱纹理烘焙收口：预载完成后主线程一次成型（ImageTexture 必须主线程提交）
	if not _atlas_done:
		_atlas_done = true
		FxAtlas.prewarm()


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	# 进程级规格装载：图鉴等场景可能先于任何对局路径触达 Spec（静态直读不触发
	# ensure，全库 60+ 处直读靠调用顺序侥幸——在会话咽喉统一装载）
	Spec.ensure()
	_load_fonts()
	_setup_audio_buses()
	_setup_fade()
	_setup_smoke()


## 转场幕布：常驻 CanvasLayer 顶层，go() 走淡出→切场→淡入（硬切是「草稿感」的来源之一）
func _setup_fade() -> void:
	var cl := CanvasLayer.new()
	cl.layer = 100
	add_child(cl)
	_fade = ColorRect.new()
	_fade.color = Color.WHITE
	# 墨晕转场：shader progress 驱动的「墨渍吞没」前沿（分形噪声打散）
	var mat := ShaderMaterial.new()
	mat.shader = load("res://render/ink_transition.gdshader")
	mat.set_shader_parameter("progress", 0.0)
	_fade.material = mat
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	cl.add_child(_fade)
	bgm = load("res://audio/bgm.gd").new()
	bgm.name = "Bgm"
	add_child(bgm)
	sfx = load("res://audio/sfx.gd").new()
	sfx.name = "Sfx"
	add_child(sfx)


## 实机冒烟钩子（__qa 精神的 Godot 版）：--smoke=<tag>,<frames>[,keyd] —— 跑 N 帧后截图
## 存 .tmp-shots-godot/<tag>.png（不入库）并退出 0；供门禁/视觉验收批次复用。
## keyd 后缀：第 40/41 帧合成 D 键 press/release，结尾输出 UI_KEY_D 行（商店 digest 变化 =
## 键盘层存活；_unhandled_key_input 曾拼错整层死亡，2026-09-29 审查修复的回归钉）。
## --battle-smoke：快进到人类参战轮直进战斗场景（死亡/弹道/演出路径的窗口实机冒烟），
## 跑满 1200 帧后截图 .tmp-shots-godot/battle.png 并 quit(0)——可自动化（AGENTS.md 战斗
## 路径回归钉）。boot 经 Sess.battle_smoke 标志让路，不转发 game_scene。
func _setup_smoke() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--smoke="):
			_run_smoke(a.substr(8))
		elif a == "--autostart":
			scene_data = { "match": Match.new(20260928, "你", "normal") }
		elif a == "--battle-smoke":
			battle_smoke = true
			_battle_smoke()


## 快进到人类参战的一轮，直进战斗场景（渲染路径：_sync_all 死亡除名/弹道坐标/震屏）。
## 跑满 1200 帧（含死亡/弹道全过程）后截图落 .tmp-shots-godot/battle.png 并退出 0。
func _battle_smoke() -> void:
	battle_smoke = true
	var m := Match.new(20260929, "你", "normal")
	for i: int in 12:
		m.begin_round()
		# 塞三枚上场棋子：空场在「空阵直胜」修复后 0 秒速败，战斗画面无从谈起
		#（探针目的是渲染路径：弹道/死亡/震屏的实机冒烟）
		var hb := m.human()
		for slot: int in 3:
			if hb["board"][slot] == null:
				hb["board"][slot] = GameState.create_unit(String(Spec.champions[slot]["id"]), 1)
		if not m.pairings.is_empty() and m.round > 1:
			var me: Dictionary = {}
			for q: Dictionary in m.pairings:
				if int(q["a"]) == 0 or int(q["b"]) == 0:
					me = q
			if not me.is_empty():
				var cfg := m.build_battle_config(me, bool(me["swap"]))
				m.settle_round()
				m.end_round()
				scene_data = { "match": m, "pair": me, "config": cfg }
				# deferred 链：本函数的换场先注册、boot._ready 的转发后注册——
				# 后注册者胜出。battle_smoke 标志令 boot 直接让路（见 boot.gd）
				get_tree().change_scene_to_file.call_deferred("res://render/battle_scene.tscn")
				await _smoke_frames(1200)
				var dir := ProjectSettings.globalize_path("res://.tmp-shots-godot")
				DirAccess.make_dir_recursive_absolute(dir)
				var img := get_viewport().get_texture().get_image()
				img.save_png("%s/battle.png" % dir)
				print("SMOKE_SHOT battle")
				get_tree().quit(0)
				return
		m.settle_round()
		m.end_round()
	push_error("battle-smoke: 12 轮内未遇到人类参战轮")
	get_tree().quit(1)


## 公共帧等待（await 链：本节点是常驻 autoload，场景切换不会中断它）
func _smoke_frames(n: int) -> void:
	for i: int in n:
		await get_tree().process_frame


func _enter_game() -> void:
	get_tree().change_scene_to_file("res://render/game_scene.tscn")


func _run_smoke(spec_txt: String) -> void:
	var spec: PackedStringArray = spec_txt.split(",")
	var tag := spec[0]
	var frames := int(spec[1]) if spec.size() > 1 else 120
	var keyd := spec.size() > 2 and spec[2] == "keyd"
	var hover := spec.size() > 2 and spec[2] == "hover"
	var perf := spec.size() > 2 and spec[2] == "perf"
	var buy := spec.size() > 2 and spec[2] == "buy"
	var frame_ms: Array = []
	var fx_peak := 0
	var shop_before := ""
	var gold_before := -1.0
	for i: int in frames:
		var t0 := Time.get_ticks_usec()
		await get_tree().process_frame
		if perf:
			frame_ms.append(float(Time.get_ticks_usec() - t0) / 1000.0)
			var sc = get_tree().current_scene
			var fx = sc.get("fx_layer") if sc != null else null
			if fx != null:
				fx_peak = maxi(fx_peak, fx.get_child_count())
			elif i == 60:
				print("PERF_DIAG scene=", sc.name if sc != null else "null", " has_fx=", fx != null)
		if hover and i == 30:
			# 塞一枚备战棋子并刷新，给悬停详情卡一个命中目标
			var hm: Match = scene_data.get("match", null)
			if hm != null:
				Spec.ensure()
				hm.human()["bench"][0] = GameState.create_unit(String(Spec.champions[0]["id"]), 1)
				get_tree().current_scene.call_deferred("refresh_all")
		elif hover and i == 70:
			var ev := InputEventMouseMotion.new()
			var pos := Vector2(Layout.BENCH_X + Layout.BENCH_CELL / 2.0, Layout.BENCH_Y + Layout.BENCH_CELL / 2.0)
			# parse_input_event 收窗口像素坐标：canvas_items 模式下窗口尺寸 ≠ 设计尺寸，
			# 设计坐标须按 win/design 比换算（否则命中点缩到左上别处）
			var win := get_window()
			pos *= Vector2(win.size.x / float(Layout.W), win.size.y / float(Layout.H))
			ev.position = pos
			ev.global_position = pos
			Input.parse_input_event(ev)
		elif hover and i == 96:
			var sc = get_tree().current_scene
			var card = sc.get("detail_card")
			var views_n: int = sc.get("unit_views").size() if sc.get("unit_views") != null else -1
			var pos3 := Vector2(Layout.BENCH_X + Layout.BENCH_CELL / 2.0, Layout.BENCH_Y + Layout.BENCH_CELL / 2.0)
			var u_at = sc.call("_unit_at", pos3)
			print("UI_HOVER scene=", sc.name, " views=", views_n, " unit_at=", u_at != null,
				" hover_iid=", sc.get("detail_hover_iid"), " ", "OK detail-card" if card != null else "FAIL no-card")
		elif hover and i == 100:
			# 64 棋子全量技能描述回填：崩卡（dict/bool params）与未替换占位（键表缺口）都要抓
			var sc4 = get_tree().current_scene
			var bad := 0
			var resid := 0
			for c: Dictionary in Spec.champions:
				var sk: Dictionary = c["skillSpec"]
				var txt: String = sc4.call("_fmt_skill_desc", String(sk["desc"]), sk.get("params", {}))
				if txt.is_empty():
					bad += 1
				elif txt.contains("{"):
					resid += 1
					print("DESC_RESID ", c["id"], " ", txt.substr(0, 60))
			print("DESC_ALL n=", Spec.champions.size(), " bad=", bad, " residual=", resid)
		if buy and i == 40:
			# 商店卡合成触发（输入链本身由 keyd/hover 探针覆盖，这里只验
			# _on_buy → _fly_coin 金币飞行 → 羁绊激活检测 → refresh 全链）
			var bm: Match = scene_data.get("match", null)
			if bm != null:
				bm.human()["gold"] = 40.0
			var sc3 = get_tree().current_scene
			if sc3 != null and sc3.get("shop_buttons") != null:
				var b0: Button = (sc3.get("shop_buttons") as Array)[0]
				b0.pressed.emit()
		elif buy and i == 46:
			# 购买成功 = 金币减少（autoDeploy 开启时棋子直接上台，bench 常驻 0——以金币为据）
			var bm2: Match = scene_data.get("match", null)
			var gold2 := float(bm2.human()["gold"]) if bm2 != null else -1.0
			var sc4 = get_tree().current_scene
			var views_n: int = sc4.get("unit_views").size() if sc4 != null and sc4.get("unit_views") != null else -1
			print("UI_BUY gold=", gold2, " views=", views_n, " ", "OK purchased" if gold2 < 40.0 else "FAIL unspent")
		if keyd and i == 40:
			var m: Match = scene_data.get("match", null)
			if m != null:
				# 注金防假阴性：开局金 0 时 reroll 被验金拦截，商店不变与键盘死亡不可区分
				m.human()["gold"] = 50.0
				shop_before = ",".join((m.human()["shop"] as Array).map(func(v): return str(v)))
				gold_before = float(m.human()["gold"])
			var ev := InputEventKey.new()
			ev.keycode = KEY_D
			ev.pressed = true
			Input.parse_input_event(ev)
		elif keyd and i == 41:
			var ev2 := InputEventKey.new()
			ev2.keycode = KEY_D
			ev2.pressed = false
			Input.parse_input_event(ev2)
	await RenderingServer.frame_post_draw
	# 截图目录随运行体落位：编辑器跑 → 工程内 godot/.tmp-shots-godot；导出 exe 跑 →
	# exe 旁 out/.tmp-shots-godot。旧写法 res://../ 在编辑器下指到仓库根（污染隔离边界）
	var dir := ProjectSettings.globalize_path("res://.tmp-shots-godot")
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
	if perf and frame_ms.size() > 4:
		var sorted_ms := frame_ms.duplicate()
		sorted_ms.sort()
		var avg := 0.0
		for v: float in sorted_ms:
			avg += v
		avg /= sorted_ms.size()
		print("SMOKE_PERF avg=%.1fms worst=%.1fms p95=%.1fms fx_peak=%d" % [
			avg, sorted_ms[-1], sorted_ms[int(sorted_ms.size() * 0.95)], fx_peak])
	if keyd:
		var m2: Match = scene_data.get("match", null)
		if m2 == null:
			print("UI_KEY_D FAIL no-match")
		else:
			var shop_after := ",".join((m2.human()["shop"] as Array).map(func(v): return str(v)))
			var gold_after := float(m2.human()["gold"])
			print("UI_KEY_D ", "OK shop-changed gold " + str(gold_before) + "->" + str(gold_after) if shop_after != shop_before else "FAIL shop-unchanged")
	get_tree().quit(0)


func _exit_tree() -> void:
	# 退出纪律（2.4.0 实证修正 2.1.0 判例）：**不在退出期清 FxAtlas static 缓存**。
	# 2.1.0 曾以「static 析构晚于 RenderingServer 拆除」为由在 _exit_tree 调
	# release_all() 主动释放；实证在本机构建（4.7.1）适得其反——该调用落在拆树
	# 途中， dying 节点/样式盒仍持纹理 last-ref，ImageTexture 析构的 RID 释放撞上
	# 正在拆除的 RenderingServer = 段错误（EXIT=139；buy/battle 探针复现，
	# 基线 battle 探针同崩 —— 同根）。静态缓存任其泄漏：引擎 ObjectDB 退出路径
	# 对泄漏资源打警告而不析构，实证 EXIT=0（menu/hud/hover/buy 四探针验收）。
	pass


func _load_fonts() -> void:
	seal_font = load("res://assets/fonts/YiShanBeiZhuanTi.ttf")
	# 正文走系统宋体（现版 Phaser 用浏览器宋体渲染正文，Godot 等价物 = SystemFont）
	body_font = SystemFont.new()
	body_font.font_names = PackedStringArray(["SimSun", "Microsoft YaHei", "serif"])


func _setup_audio_buses() -> void:
	if bus_ready:
		return
	# 三总线：Master → BGM / SFX / UI（混响挂在 SFX）。音量起始值走 user://prefs.json
	# （2.4.1 审查修复：原硬编码 0.5/0.75/0.6，用户改音量重启后滑杆显示已存值而总线
	# 在默认值——静默失效的状态分裂；DEFAULT_PREFS 同值兜底）
	var prefs: Dictionary = SaveStore.load_prefs()
	for bus_name: String in ["BGM", "SFX", "UI"]:
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
	_apply_prefs_volume(prefs)
	bus_ready = true


## 音量/静音偏好 → 总线（设置面板保存与启动回放共用同一入口）
func _apply_prefs_volume(prefs: Dictionary) -> void:
	for pair: Array in [["BGM", "volBgm"], ["SFX", "volSfx"], ["UI", "volUi"]]:
		var v: Variant = prefs.get(String(pair[1]), null)
		var lin: float = 0.5 if not ParityUtil.js_finite(v) else clampf(float(v), 0.0, 1.0)
		AudioServer.set_bus_volume_db(AudioServer.get_bus_index(String(pair[0])),
			linear_to_db(lin) if lin > 0.0 else linear_to_db(0.0001))
	var m: Variant = prefs.get("muted", false)
	AudioServer.set_bus_mute(AudioServer.get_bus_index("Master"), m == true)


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
	_transition_to(path)


## 墨晕吞没 → 切场 → 墨散；吞没期间吞输入防误点（transition.fadeTo 同口径）。
## shader 前沿由分形噪声打散（墨渍渗纸的不规则吞没线），替代纯 alpha 淡入淡出。
## 幕布未就绪/不在树（探针直换等路径）回退硬切。
func _transition_to(path: String) -> void:
	if _fade == null or not is_inside_tree():
		get_tree().change_scene_to_file(path)
		return
	# 连发 go()：先杀在途转场 tween（两条同写 progress 的补间会互相拉扯目标场景）
	if _fade_tw != null and _fade_tw.is_valid():
		_fade_tw.kill()
	_fade.mouse_filter = Control.MOUSE_FILTER_STOP
	transitioning = true
	var mat := _fade.material as ShaderMaterial
	var tw := create_tween()
	_fade_tw = tw
	tw.tween_method(func(v: float) -> void: mat.set_shader_parameter("progress", v), 0.0, 1.0, 0.24)
	tw.tween_callback(func() -> void: get_tree().change_scene_to_file(path))
	tw.tween_method(func(v: float) -> void: mat.set_shader_parameter("progress", v), 1.0, 0.0, 0.28)
	tw.tween_callback(func() -> void:
		_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
		transitioning = false
		_fade_tw = null)
