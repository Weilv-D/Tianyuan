/**
 * 全局布局常量 —— 分区坐标与间距的唯一真源（v1.3.0「夜宴」重排）。
 *
 * 编排取自夜宴样稿：顶栏 92px（导航/品牌/数值）→ 居中大漆盘 → 盘下阶段条 →
 * 备战席细条 → 底部牌铺（器匣 | 商肆 | 操作列）；左轨羁络、右栏敌情。
 * 任何分区的位置与尺寸只在这里定义；场景内只允许引用，不允许再写裸坐标。
 *
 * 关键裁决：准备与战斗共用同一张 640px 大漆盘（样稿 min(62vh,46vw) 的落地值），
 * 棋盘不再分"己方半场盘/战斗全景盘"两套几何。
 */

/** 设计分辨率（Scale.FIT 缩放，逻辑坐标恒定） */
export const W = 1920;
export const H = 1080;

export const GAP = {
  tight: 4,
  normal: 8,
  panel: 16,
} as const;

/** 通用面板：标题带高度 + 内容区内边距 */
export const PANEL_TITLE_H = 40;

// ── 顶栏（样稿 header）─────────────────────────────────
export const HEADER_H = 92;
export const NAV_X = 48; // 左导航（图鉴/羁绊/阵容）起点
export const NAV_GAP = 96; // 导航项间距

// ── 大漆盘（8×8，准备与战斗共用）──────────────────────
export const CELL = 72;
export const BOARD_PAD = 32; // 漆盘框线到格线的边距
export const HALF_ROWS = 4; // 己方可放置行数（下半 4 行；数据规则不变）
export const BOARD_SIZE = CELL * 8 + BOARD_PAD * 2; // 640
/** 漆盘图左上角（框线外沿）。准备与战斗共用此 x；战斗 y 见 BattleScene。 */
export const BOARD_X = (W - BOARD_SIZE) / 2; // 640
export const BOARD_Y = 104; // 准备阶段盘顶
/** 格线原点（盘内边距之后） */
export const GRID_X = BOARD_X + BOARD_PAD;
export const GRID_Y = BOARD_Y + BOARD_PAD;
/** 格线区宽高（8×CELL = 576） */
export const GRID_W = CELL * 8;
export const GRID_H = CELL * 8;

// 兼容旧引用点（逐处迁移后删除）：旧 BOARD_W/H 现为整盘
export const BOARD_W = BOARD_SIZE;
export const BOARD_H = BOARD_SIZE;

// ── 阶段条（盘下：— 备 战 — 开战 · 空格 00:30 —）─────
export const PHASE_Y = BOARD_Y + BOARD_SIZE + 28; // 772 文字基线带中心

// ── 备战席（盘正下方发丝细条，9 格对齐格线宽）─────────
export const BENCH_CELL = 64;
export const BENCH_N = 9;
export const BENCH_W = BENCH_CELL * BENCH_N; // 576 = 格线宽
export const BENCH_X = GRID_X; // 672
export const BENCH_Y = PHASE_Y + 22; // 794

// ── 商店（样稿 .scard 窄卡 × 5，宽对齐备战席带）───────
export const SHOP_CW = 120;
export const SHOP_CH = 170;
export const SHOP_GAP = 12;
export const SHOP_W = SHOP_CW * 5 + SHOP_GAP * 4; // 648
export const SHOP_X = (W - SHOP_W) / 2; // 636
export const SHOP_Y = 874;

// ── 器匣（店左 2×5 网格）──────────────────────────────
export const ITEM_SIZE = 46;
export const ITEM_GAP = 8;
export const ITEM_BAR_SLOTS = 10;
export const ITEM_COLS = 5;
export const ITEM_ROWS = 2;
export const ITEM_BAR_W = ITEM_COLS * (ITEM_SIZE + ITEM_GAP) - ITEM_GAP; // 262
export const ITEM_BAR_X = 356;
export const ITEM_BAR_Y = 900;

// ── 操作列（店右 2×3）与出售印 ─────────────────────────
export const ACT_X = 1304;
export const ACT_Y = 880;
export const ACT_BTN_W = 132;
export const ACT_BTN_H = 46;
/** 出售朱印：与备战席同带（把棋子拖到印上卖出） */
export const SELL_X = 1300;
export const SELL_Y = 794;
export const SELL_SIZE = 66;

// ── 羁络轨（左，样稿 rail）─────────────────────────────
export const RAIL_X = 66; // 圆环中心 x
export const RAIL_Y = 158; // 首环中心 y
export const RAIL_PITCH = 38; // 环心距

// ── 敌情（右上）与战报（右下） ─────────────────────────
export const INTEL_X = W - 48; // 右缘对齐
export const INTEL_Y = 140;
export const SIDE_W = 282;
export const REPORT_X = W - 48 - SIDE_W; // 1590
export const REPORT_Y = 620;

// ── 记事（左下） ────────────────────────────────────────
export const LOG_X = 48;
export const LOG_Y = 820;
export const LOG_W = 282;
export const LOG_H = 224;

// ── 悬停详情卡 ─────────────────────────────────────────
/** 棋子悬停卡：含已穿装备一行（F2），技能描述最多三行 */
export const DETAIL_W = 300;
export const DETAIL_H = 284;
