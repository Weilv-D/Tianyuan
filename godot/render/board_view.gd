extends Node2D
class_name BoardView
## 大漆盘（BoardView.ts 对齐版）：8×8 共 640px，准备与战斗共用。
## 视觉分层（自下而上，BoardView.ts 同构）：
##   盘体（_draw：漆盘/鎏金框/阵营微染/中线/星位/敌营纱幕）
##   → 盘心呼吸微光（包浆） → 格线层（逐格棋盘格+四角刻痕，入场次第浮现）
##   → 悬停/落点层 → 环境粒子（宿主挂 Atmosphere）。
##
## 漆纹由 lacquer.gdshader 叠层（z=-1 沉在盘体之下）。
## 坐标换算（含 CELL_CONTENT_DY=8 的内容下沉 —— 命中与格心解耦）。

const CELL_CONTENT_DY := 8

var hover_cell := Vector2i(-1, -1)
var placeable_cells := {}  # Vector2i -> true（拖拽落点染色）
var battle_mode := false   # true = 8×8 全域观战；false = 准备（下半 4 行可放）

var _hover_layer: Node2D


func _ready() -> void:
	var size := float(Layout.BOARD_SIZE)
	# 漆纹层：着色器生成的笔触漆纹叠在 _draw 底座之下（z=-1）
	var lacquer := ColorRect.new()
	lacquer.color = Color.WHITE
	lacquer.position = Vector2.ZERO
	lacquer.size = Vector2(size, size)
	var mat := ShaderMaterial.new()
	mat.shader = preload("res://render/lacquer.gdshader")
	lacquer.material = mat
	lacquer.z_index = -1
	add_child(lacquer)

	# 盘心微光：暗色 glow 给漆面「包浆」呼吸（sheen；层序在盘体上、格线下）
	var sheen := Sprite2D.new()
	sheen.texture = FxAtlas.texture(FxAtlas.GLOW)
	sheen.modulate = Color(Palette.INK[600], 0.30)
	sheen.position = Vector2(size / 2.0, size / 2.0)
	sheen.scale = Vector2.ONE * (size * 1.1 / 128.0)
	sheen.z_index = -1
	add_child(sheen)
	var breathe := sheen.create_tween().set_loops()
	breathe.tween_property(sheen, "modulate:a", 0.22, 2.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	breathe.tween_property(sheen, "modulate:a", 0.30, 2.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)

	# 格线层：独立子层承担入场「次第浮现」（460ms 淡入，烘焙纹理 stagger 同语言）
	var grid := _GridLines.new()
	grid.z_index = 0
	add_child(grid)
	grid.modulate.a = 0.0
	var tw := grid.create_tween()
	tw.tween_interval(0.12)
	tw.tween_property(grid, "modulate:a", 1.0, 0.46).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)

	# 悬停/落点层：最上（悬停描边永不被灵尘盖住）
	_hover_layer = _HoverLayer.new()
	_hover_layer.z_index = 6
	add_child(_hover_layer)

	_build_candle_lights()
	# 星位宝石（器物谱·琢面）：四星位 + 天元各嵌一粒小金宝石 —— 「漆奁嵌宝」
	_build_star_gems()


## 星位/天元宝石：Gem 纹理琢面 × GILT，天元加大并附宝光晕（原 draw_circle 墨点升级）
func _build_star_gems() -> void:
	for star: Vector2i in [Vector2i(2, 2), Vector2i(6, 2), Vector2i(2, 6), Vector2i(6, 6)]:
		var g := Artifacts.gem_pip(Color(Palette.GILT["light"], 0.85), 7.0)
		g.position = cell_center(star.x, star.y)
		g.z_index = 1
		add_child(g)
	var halo := Sprite2D.new()
	halo.texture = FxAtlas.texture(FxAtlas.GLOW)
	halo.material = FxAtlas.add_material()
	halo.modulate = Color(Palette.GILT["base"], 0.32)
	halo.position = cell_center(4, 4)
	halo.scale = Vector2.ONE * (26.0 / 128.0)
	halo.z_index = 1
	add_child(halo)
	var tyuan := Artifacts.gem_pip(Color(Palette.GILT["glow"], 0.95), 9.0)
	tyuan.position = cell_center(4, 4)
	tyuan.z_index = 1
	add_child(tyuan)


## 夜宴烛光（web 版没有的 2D 光照层）：棋盘两盏米金 PointLight2D 缓摇曳 ——
## 「夜宴有灯」的氛围底；blend ADD 在漆面上点出暖光池，与夜蓝底形成冷暖对比
func _build_candle_lights() -> void:
	var size := float(Layout.BOARD_SIZE)
	for cfg: Array in [[Vector2(size * 0.16, size * 0.2), 1.0], [Vector2(size * 0.84, size * 0.2), 0.86]]:
		var light := PointLight2D.new()
		light.texture = FxAtlas.texture(FxAtlas.GLOW)
		light.color = Palette.GILT["base"]
		light.energy = 0.9
		light.texture_scale = 4.6
		light.position = cfg[0]
		light.z_index = -2
		add_child(light)
		# 烛光摇曳：energy 呼吸 + 灯位微晃（双 tween 异频叠加，不机械）
		var t1 := light.create_tween().set_loops()
		t1.tween_property(light, "energy", 1.15 * float(cfg[1]), 2.3).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		t1.tween_property(light, "energy", 0.82 * float(cfg[1]), 2.9).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		var t2 := light.create_tween().set_loops()
		t2.tween_property(light, "position:x", float(cfg[0].x) - 5.0, 3.7).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		t2.tween_property(light, "position:x", float(cfg[0].x) + 5.0, 4.3).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


## 施法动态光：世界局部坐标处一盏光骤亮再熄（谁在吟唱，光先知道）
func flash_light(local_pos: Vector2, color: Color, dur := 0.8) -> void:
	var light := PointLight2D.new()
	light.texture = FxAtlas.texture(FxAtlas.GLOW)
	light.color = color
	light.energy = 0.0
	light.texture_scale = 3.2
	light.position = local_pos
	light.z_index = -2
	add_child(light)
	var tw := light.create_tween()
	tw.tween_property(light, "energy", 1.35, dur * 0.3).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(light, "energy", 0.0, dur * 0.7).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.tween_callback(light.queue_free)


func _draw() -> void:
	var pad := float(Layout.BOARD_PAD)
	var size := float(Layout.BOARD_SIZE)
	# 盘体
	draw_rect(Rect2(0, 0, size, size), Color(Palette.INK[900], 0.95))
	# 鎏金框（双线）+ 四角饰
	draw_rect(Rect2(4.5, 4.5, size - 9, size - 9), Color(Palette.GILT["base"], 0.5), false, 1.0)
	draw_rect(Rect2(10.5, 10.5, size - 21, size - 21), Color(Palette.GILT["base"], 0.16), false, 1.0)
	var tick := 16.0
	var m := 4.0
	for corner: Array in [[m, m, 1, 1], [size - m, m, -1, 1], [m, size - m, 1, -1], [size - m, size - m, -1, -1]]:
		var cx := float(corner[0])
		var cy := float(corner[1])
		var dx := float(corner[2])
		var dy := float(corner[3])
		draw_line(Vector2(cx, cy + tick * dy), Vector2(cx, cy), Color(Palette.GILT["light"], 0.8), 1.6)
		draw_line(Vector2(cx, cy), Vector2(cx + tick * dx, cy), Color(Palette.GILT["light"], 0.8), 1.6)
	# 中线（阵营界）：虚线点划
	var mid := size / 2.0
	var x := pad
	while x < size - pad:
		draw_line(Vector2(x, mid), Vector2(minf(x + 1.5, size - pad), mid), Color(Palette.GILT["light"], 0.22), 1.0)
		x += 9.5
	# 阵营微染：上敌朱 / 下我玉（极低饱和，潜意识暗示）
	draw_rect(Rect2(pad, pad, size - pad * 2, size / 2.0 - pad), Color(Palette.CINNABAR["deep"], 0.045))
	draw_rect(Rect2(pad, size / 2.0, size - pad * 2, size / 2.0 - pad), Color(Palette.SPIRIT["deep"], 0.045))
	# 敌营纱幕（仅准备模式）：上半 4 行压暗 —— 「敌营」与「我方阵地」一眼可读
	if not battle_mode:
		draw_rect(Rect2(pad, pad, size - pad * 2, size / 2.0 - pad), Color(Palette.INK[950], 0.34))
	# 星位四点 + 天元：围棋语汇的交叉点墨已升格为嵌宝（见 _build_star_gems）——
	# 此处仅保留天元外圈「宝光轮」（线与宝石的收口）
	draw_arc(cell_center(4, 4), 6.0, 0, TAU, 24, Color(Palette.GILT["light"], 0.3), 1.0)


## 格 → 像素（格心 + 内容下沉 8；与 TS cellToXY 同口径）
func cell_center(c: int, r: int) -> Vector2:
	return Vector2(Layout.BOARD_PAD + c * Layout.CELL + Layout.CELL / 2.0,
		Layout.BOARD_PAD + r * Layout.CELL + Layout.CELL / 2.0 + CELL_CONTENT_DY)


## 像素 → 格（局部坐标；越界/无中返回 (-1,-1)）
func xy_to_cell(p: Vector2) -> Vector2i:
	var c := int((p.x - Layout.BOARD_PAD) / Layout.CELL)
	var r := int((p.y - CELL_CONTENT_DY - Layout.BOARD_PAD) / Layout.CELL)
	if c < 0 or c >= 8 or r < 0 or r >= 8:
		return Vector2i(-1, -1)
	return Vector2i(c, r)


func set_hover(cell: Vector2i) -> void:
	if hover_cell != cell:
		hover_cell = cell
		if _hover_layer != null:
			_hover_layer.queue_redraw()


func set_placeable(cells: Dictionary) -> void:
	placeable_cells = cells
	if _hover_layer != null:
		_hover_layer.queue_redraw()


## 格线层：逐格棋盘格 + 发丝线 + 四角刻痕（web prepCell 同语言）
class _GridLines extends Node2D:
	func _draw() -> void:
		var pad := float(Layout.BOARD_PAD)
		for r: int in 8:
			for c: int in 8:
				var x := pad + c * Layout.CELL + 2
				var y := pad + r * Layout.CELL + 2
				var s := Layout.CELL - 4.0
				var cell_c := Palette.INK[700] if (r + c) % 2 == 0 else Palette.INK[800]
				draw_rect(Rect2(x, y, s, s), Color(cell_c, 0.85))
				draw_rect(Rect2(x, y, s, s), Color(Palette.INK[500], 0.55), false, 1.0)
				# 四角刻痕
				var k := 7.0
				var ink := Color(Palette.INK[500], 0.4)
				draw_line(Vector2(x + 4, y + 4), Vector2(x + 4 + k, y + 4), ink, 1.2)
				draw_line(Vector2(x + 4, y + 4), Vector2(x + 4, y + 4 + k), ink, 1.2)
				draw_line(Vector2(x + s - 4, y + s - 4), Vector2(x + s - 4 - k, y + s - 4), ink, 1.2)
				draw_line(Vector2(x + s - 4, y + s - 4), Vector2(x + s - 4, y + s - 4 - k), ink, 1.2)


## 悬停/落点层：可放置染色 → 悬停描边（web overlay 同语言：金线框 + 淡金填充）
class _HoverLayer extends Node2D:
	func _draw() -> void:
		var bv := get_parent() as BoardView
		if bv == null:
			return
		var pad := float(Layout.BOARD_PAD)
		for cell: Vector2i in bv.placeable_cells:
			var rc := Rect2(pad + cell.x * Layout.CELL + 2, pad + cell.y * Layout.CELL + 2, Layout.CELL - 4, Layout.CELL - 4)
			draw_rect(rc, Color(Palette.SPIRIT["base"], 0.16))
			draw_rect(rc, Color(Palette.SPIRIT["light"], 0.5), false, 1.5)
		if bv.hover_cell.x >= 0:
			var rc2 := Rect2(pad + bv.hover_cell.x * Layout.CELL + 2, pad + bv.hover_cell.y * Layout.CELL + 2, Layout.CELL - 4, Layout.CELL - 4)
			draw_rect(rc2, Color(Palette.GILT["base"], 0.08))
			draw_rect(rc2, Color(Palette.GILT["light"], 0.9), false, 1.5)
