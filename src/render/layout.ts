/**
 * 全局布局常量 —— 分区坐标与间距的唯一真源。
 *
 * 背景：血条与等级文字的重叠 bug 根因是坐标魔法数字散落在各 build 方法里，
 * "改一处忘一处"。任何分区（顶栏/棋盘/备战席/器匣/商店/指挥台/侧面板）的
 * 位置与尺寸只在这里定义；场景内只允许引用，不允许再写裸坐标。
 *
 * 间距纪律（四舍五入到 4 的倍数，与 GRID 一致）：
 *   GAP.tight  = 4   同族紧贴（棋盘→备战席→器匣的垂直栈）
 *   GAP.normal = 8   常规分区之间的呼吸
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

// ── 棋盘（准备阶段，己方半场 4×8） ─────────────────────
export const CELL = 100;
export const HALF_ROWS = 4;
export const BOARD_W = CELL * 8;
export const BOARD_H = CELL * HALF_ROWS;
export const BOARD_X = 560;
export const BOARD_Y = 70;

// ── 备战席 ─────────────────────────────────────────────
export const BENCH_CELL = 86;
export const BENCH_N = 9;
export const BENCH_W = BENCH_CELL * BENCH_N;
export const BENCH_X = (W - BENCH_W) / 2;
export const BENCH_Y = BOARD_Y + BOARD_H + 12;

// ── 器匣（备战席正下方，同一类"库存"垂直栈） ───────────
export const ITEM_SIZE = 50;
export const ITEM_GAP = 8;
export const ITEM_BAR_SLOTS = 10;
export const ITEM_BAR_W = ITEM_BAR_SLOTS * (ITEM_SIZE + ITEM_GAP) - ITEM_GAP;
export const ITEM_BAR_X = 412;
/** 器匣槽顶：与备战席框架保持 4px 紧贴（界格签压线的同族语汇） */
export const ITEM_BAR_Y = 590;

// ── 商店 ───────────────────────────────────────────────
export const SHOP_CW = 208;
export const SHOP_CH = 200;
export const SHOP_GAP = 14;
export const SHOP_W = SHOP_CW * 5 + SHOP_GAP * 4;
export const SHOP_X = (W - SHOP_W) / 2;
export const SHOP_Y = 688;

// ── 底部指挥台 ─────────────────────────────────────────
export const BOTTOM_Y = 904;
export const BOTTOM_H = 160;

/** 指挥台内部分区。所有偏移相对面板左缘（LEFT_X）或内容基线（cy = BOTTOM_Y + 14）。 */
export const BOTTOM = {
  /** 内容基线（"状态/操作/出售"标题行的 y） */
  baseY: BOTTOM_Y + 14,
  /** 左列（状态）内边距 */
  padX: 24,
  /** 状态列宽：血条/收入行不超过此宽，与等级列保持 36px 空隙 */
  statusW: 280,
  /** 等级/经验列 x（相对面板左缘）。须 ≥ padX + statusW + 36 */
  levelX: 340,
  /** 操作区 x（相对面板左缘） */
  actionX: 560,
} as const;

// ── 侧面板（上：羁绊/诸侯；下：记事/战报） ─────────────
export const LEFT_X = 16;
export const LEFT_W = 520;
export const LEFT_UP_Y = 70;
export const LEFT_UP_H = 400;
export const SIDE_DOWN_Y = 486;
export const SIDE_DOWN_H = 344;
export const SIDE_DOWN_W = 380;
export const RIGHT_X = W - 16 - LEFT_W;
export const RIGHT_DOWN_X = W - 16 - SIDE_DOWN_W;

// ── 悬停详情卡 ─────────────────────────────────────────
/** 棋子悬停卡：含已穿装备一行（F2），技能描述最多三行 */
export const DETAIL_W = 300;
export const DETAIL_H = 284;
