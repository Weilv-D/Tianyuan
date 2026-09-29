## HUD 几何真源（src/render/view/hudLayout.ts 镜像）—— 羁绊轨徽章、计分板行、
## 悬停笺的纯函数布局。场景代码只引用这里产出的坐标，不许再写裸数字；
## tests/hud_layout_test.gd 用同一组函数做遮挡不变量回归（GdUnit4 移植）。
## 纯算术、零节点依赖。
##
## textScale 基线（TS textScaleBase）：渲染字号 = 声明字号 × TEXT_SCALE。
class_name HudLayout
extends RefCounted

## 文字缩放基线（TS renderedSize(13)=15 → 放大系数 15/13 ≈ 1.1538）
const TEXT_SCALE := 15.0 / 13.0

## 徽章外环半径（逻辑 px）
const BADGE_R := 16
## 徽章图标显示边长
const BADGE_SIZE := 40

# ── 羁绊轨 ──

const RAIL_ITEMS := 17
const RAIL_VIEW_W := 76
const RAIL_VIEW_H := 660
## 轨滚动视口的世界系矩形（真源）：遮罩窗与输入门共用
const RAIL_VIEW := {
	"x": Layout.RAIL_X - 24,
	"y": Layout.RAIL_Y - 20,
	"w": RAIL_VIEW_W,
	"h": RAIL_VIEW_H,
}
const RAIL_COUNT_DX := 21
const RAIL_GLYPH_INK_HALF := 6.4
const RAIL_COUNT_W := 22


## 第 i 枚徽章的行锚（世界 y；containerY = 轨容器实时 y）
static func rail_badge_world_y(i: int, container_y: float = Layout.RAIL_Y) -> float:
	return container_y + rail_badge_y(i)


## 第 i 行徽章点击命中矩形（世界系）
static func rail_badge_world_hit(i: int, container_y: float = Layout.RAIL_Y) -> Dictionary:
	var row := rail_badge_hit()
	return {
		"x": Layout.RAIL_X + row["x"],
		"y": container_y + rail_badge_y(i) + row["y"],
		"w": row["w"],
		"h": row["h"],
	}


## 悬停笺世界位置：左缘贴轨计数串右缘外 3px；py 沿徽章行 y 钳位
static func rail_popup_pos(rail_badge_world_y_pos: float, h: float) -> Dictionary:
	return {
		"x": Layout.RAIL_X + RAIL_COUNT_DX + RAIL_COUNT_W + 3,
		"y": rail_popup_clamp_y(rail_badge_world_y_pos, h),
	}


static func rail_badge_y(i: int) -> float:
	return i * Layout.RAIL_PITCH


## 计数文字位置（相对单枚徽章容器）
static func rail_count_pos() -> Vector2:
	return Vector2(RAIL_COUNT_DX, 0)


## 轨的收尾 y（最坏情形，滚动内容高度计算）
static func rail_bottom_y() -> float:
	return (RAIL_ITEMS - 1) * Layout.RAIL_PITCH + BADGE_R


## 命中区（相对单枚徽章容器）：罩住圆环与右侧计数串全部墨迹
static func rail_badge_hit() -> Dictionary:
	return {
		"x": -BADGE_SIZE / 2.0,
		"y": -BADGE_SIZE / 2.0,
		"w": BADGE_SIZE / 2.0 + RAIL_COUNT_DX + RAIL_COUNT_W,
		"h": float(BADGE_SIZE),
	}


## 行世界矩形是否落在轨视口内（遮罩裁渲染不裁输入 —— 输入必须同口径失效）
static func rail_row_visible(row_world_y: float, row_h: float) -> bool:
	return row_world_y + row_h > RAIL_VIEW["y"] and row_world_y < RAIL_VIEW["y"] + RAIL_VIEW["h"]


## 轨是否越进左下「记事」栏（不变量：必须为 false）
static func rail_overlaps_log() -> bool:
	return RAIL_VIEW["y"] + RAIL_VIEW["h"] > Layout.LOG_Y - 12


# ── 诸侯计分板行（右栏，行高 30）──
# 列位按渲染字号（放大后）定预算，链式推导禁止重复字面量。

const NAME_RENDERED := 15  # renderedSize(13)
const LV_RENDERED := 13    # renderedSize(12)
const NAME_BUDGET := 7 * NAME_RENDERED + 1  # 106
const BAR_X := 36 + NAME_BUDGET + 6
const BAR_W := 68
const LV_X := BAR_X + BAR_W + 6
## "Lv10" mono 4 字预算 = js_round(4×0.55×13) = 29（const 不允许函数调用，预算值随 LV_RENDERED 变动需同步）
const LV_BUDGET := 29

const REPORT_ROW := {
	"rowH": 30,
	"hpX": 0,
	"hpSize": 12,
	"nameX": 36,
	"nameSize": 13,
	"nameMaxW": NAME_BUDGET,
	"barX": BAR_X,
	"barW": BAR_W,
	"lvX": LV_X,
	"lvSize": 12,
	"streakX": LV_X + LV_BUDGET + 4,
	"streakSize": 12,
	"streakMaxW": 2 * LV_RENDERED,
}


## 行尾不出右栏（导出供测试口径复算）
static func report_row_end() -> float:
	return REPORT_ROW["streakX"] + REPORT_ROW["streakMaxW"]


## 行内元素矩形（y 为行局部坐标）
static func report_row_rects(name_len: int) -> Dictionary:
	var c := REPORT_ROW
	var name_w: float = min(float(name_len * NAME_RENDERED), float(c["nameMaxW"]))
	return {
		"name": { "x": c["nameX"], "w": name_w },
		"bar": { "x": c["barX"], "w": c["barW"] },
		"lv": { "x": c["lvX"], "w": 4 * 0.55 * LV_RENDERED },
		"streak": { "x": c["streakX"], "w": c["streakMaxW"] },
	}


## 计分板行右缘不出栏（不变量）
static func report_row_fits_side() -> bool:
	return REPORT_ROW["streakX"] + REPORT_ROW["streakMaxW"] <= Layout.SIDE_W


# ── 羁绊悬停笺 ──

## 详情卡横向几何（原 game_scene 裸写 66/48/40，无测试钉——2.4.1 收敛）：
## X_MIN=左栏右缘、X_RIGHT_PAD=屏右安全距、ANCHOR_DX=棋子右侧贴隙
const DETAIL_X_MIN := 66
const DETAIL_X_RIGHT_PAD := 48
const DETAIL_ANCHOR_DX := 40.0

const CAH_Y_MIN := 140
# 卡/笺底沿上界：器匣卸载+分页钮带顶 = ITEM_BAR_Y+UNLOAD_BTN_DY = 844，净距 6。
# 旧值 860 令成员卡下钳时压住按钮带 16px（PanelContainer STOP 吞点击）——跨契约
# 冲突 2.4.1 修复；golden 由 hud_layout_test 同步钉新值
const CAH_Y_MAX := 838
const CAH_MAX_H := CAH_Y_MAX - CAH_Y_MIN
const RAIL_POPUP_W := 250


## 悬停笺高度与分栏（效果块行数动态计入，描述永远跟在效果块之后）
static func rail_popup_layout(effect_lines: int, desc_lines: int) -> Dictionary:
	var effect_y := 36
	var effect_h := (effect_lines * 17 + 6) if effect_lines > 0 else 0
	var desc_y := effect_y + effect_h + 6
	var h := desc_y + desc_lines * 16 + 12
	return { "w": RAIL_POPUP_W, "h": h, "effectY": effect_y, "descY": desc_y }


## 笺体不越出屏底
static func rail_popup_clamp_y(rail_y: float, h: float) -> float:
	return min(max(CAH_Y_MIN, rail_y - 10.0), CAH_Y_MAX - h)


# ── 羁绊成员卡 ──

const TRAIT_MEMBER_COLS := 5
const TRAIT_MEMBER_PITCH := 92
const TRAIT_MEMBER_SIZE := 84
const TRAIT_MEMBER_X := Layout.RAIL_X - 24 + RAIL_VIEW_W + 6
const TRAIT_MEMBER_PAD := 16
const TRAIT_MEMBER_HEAD_H := 56
const TRAIT_MEMBER_HEAD_GAP := 10
const TRAIT_MEMBER_GRID_X := TRAIT_MEMBER_PAD
const TRAIT_MEMBER_GRID_Y := TRAIT_MEMBER_HEAD_H + TRAIT_MEMBER_HEAD_GAP


## 第 i 名成员的格子原点（网格局部坐标）
static func trait_member_cell(i: int) -> Vector2:
	return Vector2(
		(i % TRAIT_MEMBER_COLS) * TRAIT_MEMBER_PITCH,
		(i / TRAIT_MEMBER_COLS) * TRAIT_MEMBER_PITCH,
	)


## 卡宽：左右边距 + (cols-1)×PITCH + 立绘边长
static func trait_member_card_w() -> int:
	return TRAIT_MEMBER_PAD * 2 + (TRAIT_MEMBER_COLS - 1) * TRAIT_MEMBER_PITCH + TRAIT_MEMBER_SIZE


## 网格总高（rows = ceil(count/cols)）
static func trait_member_grid_h(member_count: int) -> int:
	var rows := maxi(1, int(ceil(float(member_count) / float(TRAIT_MEMBER_COLS))))
	return (rows - 1) * TRAIT_MEMBER_PITCH + TRAIT_MEMBER_SIZE


## 卡高：头部带 + 净距 + 网格 + 底缘留白
static func trait_member_card_h(member_count: int) -> int:
	return TRAIT_MEMBER_HEAD_H + TRAIT_MEMBER_HEAD_GAP + trait_member_grid_h(member_count) + 14


## 卡 y 钳位：靠近所点徽章，整卡收在 CAH 域内
static func trait_member_clamp_y(badge_world_y_pos: float, card_h: float) -> float:
	return min(max(CAH_Y_MIN, badge_world_y_pos - 12.0), CAH_Y_MAX - card_h)


# ── 棋子卡装备图标（绘制与命中共用几何）──

## 单枚装备图标边长（sz = 棋子卡边长）
static func portrait_item_slot_size(sz: float) -> int:
	return maxi(14, int(ParityUtil.js_round(sz * 0.26)))

const PORTRAIT_ITEM_GAP := 2
const PORTRAIT_ITEM_PAD := Vector2(4, 5)


## 第 i 枚图标的矩形（卡局部坐标）
static func portrait_item_slot_rect(i: int, sz: float) -> Dictionary:
	var w := portrait_item_slot_size(sz)
	return {
		"x": PORTRAIT_ITEM_PAD.x + i * (w + PORTRAIT_ITEM_GAP),
		"y": PORTRAIT_ITEM_PAD.y,
		"w": w,
		"h": w,
	}


## 点按热区矩形（视觉外扩 6px 容差）
static func portrait_item_slot_hit_rect(i: int, sz: float) -> Dictionary:
	var r := portrait_item_slot_rect(i, sz)
	var pad := 6
	return { "x": r["x"] - pad, "y": r["y"] - pad, "w": r["w"] + pad * 2, "h": r["h"] + pad * 2 }
