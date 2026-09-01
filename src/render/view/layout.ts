/**
 * 全局布局常量 —— 分区坐标与间距的唯一真源（v1.3.0「夜宴」重排）。
 *
 * 编排取自夜宴样稿：顶栏 92px（导航/品牌/数值）→ 居中大漆盘 → 盘下阶段条 →
 * 备战席细条 → 底部牌铺（器匣 | 商肆 | 操作列）；左轨羁绊、右栏敌情。
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

// ── 阶段条（盘下：— 备 战 — 开战 · 空格 00:30 —）─────
export const PHASE_Y = BOARD_Y + BOARD_SIZE + 28; // 772 文字基线带中心

// ── 备战席（盘正下方发丝细条，9 格对齐格线宽）─────────
export const BENCH_CELL = 64;
export const BENCH_N = 9;
export const BENCH_W = BENCH_CELL * BENCH_N; // 576 = 格线宽
export const BENCH_X = GRID_X; // 672
export const BENCH_Y = PHASE_Y + 40; // 812：框顶（BENCH_Y-24=788）须避开阶段条计时条（至 PHASE_Y+14）

// ── 商店（样稿 .scard 窄卡 × 5，宽对齐备战席带）───────
export const SHOP_CW = 120;
/** 卡高 164：卡底 1056 给注脚行留出 1058→~1077 的落地带 —— 旧 170 时注脚
 * 顶到 1064，13px@1.12 的行高直接越过 1080 设计底缘被画布裁字。 */
export const SHOP_CH = 164;
export const SHOP_GAP = 12;
export const SHOP_W = SHOP_CW * 5 + SHOP_GAP * 4; // 648
export const SHOP_X = (W - SHOP_W) / 2; // 636
export const SHOP_Y = 892;
/** 商肆注脚行（「商 肆」/「刷新 · N 金」）顶缘：卡底 +2，行高（13px@1.12 ≈ 19px）
 *  底缘 ~1077，收在 1080 之内 —— 契约测试按 SHOP_FOOT_Y + 20 ≤ H 钉死。 */
export const SHOP_FOOT_DY = 2;
export const SHOP_FOOT_Y = SHOP_Y + SHOP_CH + SHOP_FOOT_DY;

// ── 器匣（店左 2×5 网格）──────────────────────────────
export const ITEM_SIZE = 52;
export const ITEM_GAP = 6;
export { ITEM_BAR_SLOTS } from '../../core/config';
export const ITEM_COLS = 5;
export const ITEM_ROWS = 2;
export const ITEM_BAR_W = ITEM_COLS * (ITEM_SIZE + ITEM_GAP) - ITEM_GAP; // 284
export const ITEM_BAR_X = 334; // 框左缘 324（外扩 10）须与记事栏右缘（LOG_X+LOG_W=312）净距 ≥ 4
export const ITEM_BAR_Y = 900;
/** 卸载按钮：器匣框顶（ITEM_BAR_Y-24）上方的独立行，绘制底缘与框顶净距 6、命中区（Button 外扩 5）不触框 */
export const UNLOAD_BTN_DY = -56;

// ── 操作列（店右 2×3）与出售印 ─────────────────────────
// ACT_Y 896：出售印底缘（SELL_Y+SELL_SIZE=878）与首行按钮净距 18px
export const ACT_X = 1304;
export const ACT_Y = 896;
export const ACT_BTN_W = 132;
export const ACT_BTN_H = 46;
/** 出售朱印：与备战席同带（把棋子拖到印上卖出） */
export const SELL_X = 1300;
export const SELL_Y = BENCH_Y;
export const SELL_SIZE = 66;

// ── 羁绊轨（左，样稿 rail）─────────────────────────────
export const RAIL_X = 66; // 圆环中心 x
export const RAIL_Y = 158; // 首环中心 y
export const RAIL_PITCH = 44; // 环心距：必须 ≥ 徽章显示尺寸 40 + 净距，否则圆环叠压

// ── 敌情（右上）与战报（右下） ─────────────────────────
export const INTEL_X = W - 48; // 右缘对齐
export const INTEL_Y = 140;
export const SIDE_W = 282;
export const REPORT_X = W - 48 - SIDE_W; // 1590
export const REPORT_Y = 620;

// ── 记事（左下） ────────────────────────────────────────
// 宽 264：右缘 312，给器匣烘焙框（左缘 324）让出 12px 净距——
// 旧 282（右缘 330）被框/签/提示行压住 4~6px。实际最宽行 ≈135px，收窄无换行风险。
export const LOG_X = 48;
export const LOG_Y = 820;
export const LOG_W = 264;
export const LOG_H = 224;

// ── 悬停详情卡 ─────────────────────────────────────────
/** 棋子悬停卡：含已穿装备一行（F2），技能描述最多三行 */
export const DETAIL_W = 300;
export const DETAIL_H = 284;
