## 全局布局常量 —— 分区坐标与间距的唯一真源（src/render/view/layout.ts 镜像，
## v1.3.0「夜宴」重排）。编排：顶栏 92px → 居中大漆盘 → 盘下阶段条 → 备战席细条
## → 底部牌铺（器匣 | 商肆 | 操作列）；左轨羁绊、右栏敌情。
## 关键裁决：准备与战斗共用同一张 640px 大漆盘。
class_name Layout
extends RefCounted

## 设计分辨率（窗口内容按此逻辑坐标缩放，逻辑坐标恒定）
const W := 1920
const H := 1080

const GAP_TIGHT := 4
const GAP_NORMAL := 8
const GAP_PANEL := 16

## 通用面板：标题带高度 + 内容区内边距
const PANEL_TITLE_H := 40

# ── 顶栏 ──
const HEADER_H := 92
const NAV_X := 48
const NAV_GAP := 96
## 顶栏五数值右对齐分列 1340..1780；金币列位（飞币锚与 stats 行共用——
## 双写字面量会在调列位时静默错锚，2.4.1 收敛）
const TOP_STAT_GOLD_X := 1450

# ── 大漆盘（8×8，准备与战斗共用）──
const CELL := 72
const BOARD_PAD := 32
const HALF_ROWS := 4
const BOARD_SIZE := CELL * 8 + BOARD_PAD * 2  # 640
const BOARD_X := (W - BOARD_SIZE) / 2  # 640
const BOARD_Y := 104  # 准备阶段盘顶
const GRID_X := BOARD_X + BOARD_PAD
const GRID_Y := BOARD_Y + BOARD_PAD
const GRID_W := CELL * 8
const GRID_H := CELL * 8

# ── 阶段条（盘下）──
const PHASE_Y := BOARD_Y + BOARD_SIZE + 28  # 772

# ── 备战席（盘正下方发丝细条，9 格对齐格线宽）──
const BENCH_CELL := 64
const BENCH_N := 9
const BENCH_W := BENCH_CELL * BENCH_N  # 576
const BENCH_X := GRID_X  # 672
const BENCH_Y := PHASE_Y + 40  # 812

# ── 商店 ──
const SHOP_CW := 120
const SHOP_CH := 164
const SHOP_GAP := 12
const SHOP_W := SHOP_CW * 5 + SHOP_GAP * 4  # 648
const SHOP_X := (W - SHOP_W) / 2  # 636
const SHOP_Y := 892
const SHOP_FOOT_DY := 2
const SHOP_FOOT_Y := SHOP_Y + SHOP_CH + SHOP_FOOT_DY

# ── 器匣（店左 2×5 网格）──
const ITEM_SIZE := 52
const ITEM_GAP := 6
const ITEM_COLS := 5
const ITEM_ROWS := 2
const ITEM_BAR_W := ITEM_COLS * (ITEM_SIZE + ITEM_GAP) - ITEM_GAP  # 284
const ITEM_BAR_X := 334
const ITEM_BAR_Y := 900
const UNLOAD_BTN_DY := -56

# ── 操作列（店右 2×3）与出售印 ──
const ACT_X := 1304
const ACT_Y := 896
const ACT_BTN_W := 132
const ACT_BTN_H := 46
const SELL_X := 1300
const SELL_Y := BENCH_Y
const SELL_SIZE := 66

# ── 羁绊轨（左）──
const RAIL_X := 66  # 圆环中心 x
const RAIL_Y := 158  # 首环中心 y
const RAIL_PITCH := 44  # 环心距 ≥ 徽章 40 + 净距

# ── 敌情（右上）与战报（右下）──
const INTEL_X := W - 48
const INTEL_Y := 140
const SIDE_W := 282
const REPORT_X := W - 48 - SIDE_W  # 1590
const REPORT_Y := 620
# 计分板八行（构建与点击命中同源——字面量双写会在调行高时错位）
const SCORE_ROW_Y := 338
const SCORE_ROW_STEP := 30

# ── 记事（左下）──
const LOG_X := 48
const LOG_Y := 820
const LOG_W := 264
const LOG_H := 224

# ── 悬停详情卡 ──
const DETAIL_W := 300
const DETAIL_H := 304
const DETAIL_SELL_BAND := 44
