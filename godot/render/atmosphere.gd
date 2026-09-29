extends Node2D
class_name Atmosphere
## 环境氛围层（BoardView.setPhase 对齐版）：灵尘（准备）/ 余烬（战斗）双粒子系
## + 全屏宣纸颗粒与暗角的统一挂载点。
##
## 灵尘：盘底缓慢上浮的青白微尘，是「夜宴有活气」的底噪；
## 余烬：战斗阶段的朱金烬点，决赛圈加密转亮 —— 局势烈度的氛围通道。
## 倍速下由宿主 set_speed_gate 抑制（deco_suppressed 同口径）。

const EMBER_AMOUNT := 24

var _motes: CPUParticles2D
var _embers: CPUParticles2D


## 五场景统一的质感底座：全屏宣纸颗粒（0.02 —— 数码感的天敌）。
## 暗角纹理已烘焙但 web 版从未上屏（压四角会盖 HUD），此处同口径不挂。
static func dress(root: Node, w: float, h: float) -> void:
	var grain := FxAtlas.grain_overlay(w, h)
	grain.z_index = 2000
	root.add_child(grain)


func _ready() -> void:
	_motes = _make_motes()
	_embers = _make_embers()
	add_child(_motes)
	add_child(_embers)
	set_phase("prep")


## 盘面尺寸对齐（宿主传 Layout.BOARD_SIZE 系）
func setup_area(board_pad: float, grid_w: float, grid_h: float, board_h: float) -> void:
	# 灵尘自盘底升起（x 居盘心向两侧扩满）；余烬盘心全域
	_motes.position = Vector2(board_pad + grid_w / 2.0, board_h)
	_motes.emission_rect_extents = Vector2(grid_w / 2.0, 4.0)
	_embers.position = Vector2(board_pad + grid_w / 2.0, board_pad + grid_h / 2.0)
	_embers.emission_rect_extents = Vector2(grid_w / 2.0, grid_h / 2.0)


## 阶段切换：prep 灵尘 / battle 余烬 / final 余烬加密转亮
func set_phase(phase: String) -> void:
	match phase:
		"prep":
			_motes.emitting = true
			_phase_embers = false
			_embers.emitting = false
			_embers.color_initial_ramp = _ember_ramp(false)
			_embers.amount = EMBER_AMOUNT
		"battle":
			_motes.emitting = true
			_phase_embers = true
			_embers.emitting = not deco_suppressed
			_embers.color_initial_ramp = _ember_ramp(false)
			_embers.amount = EMBER_AMOUNT
		"final":
			_motes.emitting = true
			_phase_embers = true
			_embers.emitting = not deco_suppressed
			_embers.color_initial_ramp = _ember_ramp(true)
			_embers.amount = EMBER_AMOUNT * 2


## 倍速装饰抑制（与 effects_layer.deco_suppressed 同源切换）。
## 相位意图另存：抑制期用「当前实际值」当期望值会单向锁死——切回常速后余烬永不复燃
## （战斗中 4×→1× 后决赛圈加密失效；2.4.1 审查修复）
var deco_suppressed := false:
	set(v):
		deco_suppressed = v
		if _embers != null:
			_embers.emitting = not v and _phase_embers
var _phase_embers := false


func _make_motes() -> CPUParticles2D:
	var p := CPUParticles2D.new()
	p.material = FxAtlas.add_material()
	p.amount = 40
	p.lifetime = 9.0
	p.preprocess = 6.0
	p.direction = Vector2(0, -1)
	p.spread = 12.0
	p.gravity = Vector2.ZERO
	p.initial_velocity_min = 6.0
	p.initial_velocity_max = 16.0
	p.scale_amount_min = 0.05
	p.scale_amount_max = 0.10
	p.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	# 颜色：MOON.base / SPIRIT.light / PAPER[200] 三色随机 —— 用 color_initial_ramp
	var g := Gradient.new()
	g.colors = PackedColorArray([Palette.MOON["base"], Palette.SPIRIT["light"], Palette.PAPER[200]])
	g.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
	p.color_initial_ramp = g
	var fade := Gradient.new()
	fade.set_color(0, Color(1, 1, 1, 0.35))
	fade.set_color(1, Color(1, 1, 1, 0.0))
	p.color_ramp = fade
	p.texture = FxAtlas.texture(FxAtlas.GLOW)
	p.z_index = 5
	return p


func _make_embers() -> CPUParticles2D:
	var p := CPUParticles2D.new()
	p.material = FxAtlas.add_material()
	p.amount = EMBER_AMOUNT
	p.lifetime = 2.6
	p.preprocess = 2.0
	p.direction = Vector2(0, -1)
	p.spread = 30.0
	p.gravity = Vector2.ZERO
	p.initial_velocity_min = 10.0
	p.initial_velocity_max = 26.0
	p.scale_amount_min = 0.06
	p.scale_amount_max = 0.12
	p.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	var fade := Gradient.new()
	fade.set_color(0, Color(1, 1, 1, 0.5))
	fade.set_color(1, Color(1, 1, 1, 0.0))
	p.color_ramp = fade
	p.texture = FxAtlas.texture(FxAtlas.INK_DOT)
	p.z_index = 5
	return p


func _ember_ramp(final: bool) -> Gradient:
	var g := Gradient.new()
	if final:
		g.colors = PackedColorArray([Palette.CINNABAR["light"], Palette.GILT["light"], Palette.CINNABAR["base"]])
	else:
		g.colors = PackedColorArray([Palette.CINNABAR["base"], Palette.GILT["base"], Palette.CINNABAR["light"]])
	g.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
	return g
