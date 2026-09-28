extends Node2D
class_name BoardView
## 大漆盘（BoardView.ts 对齐版）：8×8 共 640px，准备与战斗共用。
## 视觉分层（自下而上）：漆盘底 → 鎏金框 → 星位/中线 → 宣纸微光 → 棋盘格格线 →
## 悬停高亮。全部 _draw 程序化（漆纹噪声着色器版登记于 M3 增强 batch，见 MILESTONES）。
##
## 坐标换算（含 CELL_CONTENT_DY=8 的内容下沉 —— 命中与格心解耦）。

const CELL_CONTENT_DY := 8

var hover_cell := Vector2i(-1, -1)
var placeable_cells := {}  # Vector2i -> true（拖拽落点染色）
var battle_mode := false   # true = 8×8 全域观战；false = 准备（下半 4 行可放）


func _draw() -> void:
	var pad := float(Layout.BOARD_PAD)
	var size := float(Layout.BOARD_SIZE)
	# 盘体
	draw_rect(Rect2(0, 0, size, size), Color(Palette.INK[900], 0.95))
	# 盘心微光
	draw_rect(Rect2(-size * 0.05, -size * 0.05, size * 1.1, size * 1.1), Color(Palette.INK[600], 0.08))
	# 鎏金框（双线）
	draw_rect(Rect2(1, 1, size - 2, size - 2), Palette.GILT["deep"], false, 4.5)
	draw_rect(Rect2(1, 1, size - 2, size - 2), Color(Palette.GILT["base"], 0.16), false, 10.5)
	# 中线（阵营界）：上朱下玉各微染
	draw_line(Vector2(pad, size / 2.0), Vector2(size - pad, size / 2.0), Color(Palette.MOON["base"], 0.4), 1.5, true)
	draw_rect(Rect2(pad, pad, size - pad * 2, size / 2.0 - pad), Color(Palette.CINNABAR["base"], 0.045))
	draw_rect(Rect2(pad, size / 2.0, size - pad * 2, size / 2.0 - pad), Color(Palette.SPIRIT["base"], 0.045))
	# 星位 + 天元
	for star: Vector2i in [Vector2i(2, 2), Vector2i(6, 2), Vector2i(2, 6), Vector2i(6, 6)]:
		draw_circle(cell_center(star.x, star.y), 2.0, Color(Palette.MOON["light"], 0.35))
	draw_circle(cell_center(4, 4), 2.6, Color(Palette.GILT["base"], 0.4))
	draw_arc(cell_center(4, 4), 6.0, 0, TAU, 24, Color(Palette.GILT["base"], 0.25), 1.0)
	# 格线（棋盘格 + 发丝线 + 四角刻痕）
	for r: int in 8:
		for c: int in 8:
			var x := pad + c * Layout.CELL + 2
			var y := pad + r * Layout.CELL + 2
			var cell_c := Palette.INK[700] if (r + c) % 2 == 0 else Palette.INK[800]
			draw_rect(Rect2(x, y, Layout.CELL - 4, Layout.CELL - 4), Color(cell_c, 0.85))
			draw_rect(Rect2(x, y, Layout.CELL - 4, Layout.CELL - 4), Color(Palette.INK[500], 0.55), false, 1.0)
	# 悬停高亮（可放置 / 悬停）
	for cell: Vector2i in placeable_cells:
		var rc := Rect2(pad + cell.x * Layout.CELL + 2, pad + cell.y * Layout.CELL + 2, Layout.CELL - 4, Layout.CELL - 4)
		draw_rect(rc, Color(Palette.SPIRIT["base"], 0.16))
		draw_rect(rc, Color(Palette.SPIRIT["light"], 0.5), false, 1.5)
	if hover_cell.x >= 0:
		var rc2 := Rect2(pad + hover_cell.x * Layout.CELL + 2, pad + hover_cell.y * Layout.CELL + 2, Layout.CELL - 4, Layout.CELL - 4)
		draw_rect(rc2, Color(Palette.PAPER[100], 0.10))
		draw_rect(rc2, Color(Palette.PAPER[200], 0.55), false, 1.5)


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
		queue_redraw()


func set_placeable(cells: Dictionary) -> void:
	placeable_cells = cells
	queue_redraw()
