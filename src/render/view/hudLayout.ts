/**
 * HUD 几何真源 —— 羁绊轨徽章、诸侯计分板行、羁绊悬停笺的纯函数布局。
 *
 * 场景代码只引用这里产出的坐标，不许再写裸数字；tests/hud-layout.test.ts
 * 用同一组函数做遮挡不变量回归（文字不出容器、元素两两不相交、轨不出栏）。
 * 纯算术、零 Phaser 依赖，可在 node 测试里直接运行。
 */

import { LOG_Y, RAIL_PITCH, RAIL_Y, SIDE_W } from './layout';
import { renderedSize } from './textScaleBase';

/** 徽章外环半径（逻辑 px）。traitIcons 的烘焙与各应用位共用此口径。 */
export const BADGE_R = 16;
/** 徽章图标显示边长（烘焙逻辑盒 40×40） */
export const BADGE_SIZE = 40;

// ── 羁绊轨 ─────────────────────────────────────────────

/** 轨可承载的羁绊上限（=TRAITS 全量）；运行期只挂"场上有棋子"的羁绊，此值仅用于最坏情形校验 */
export const RAIL_ITEMS = 17;
/**
 * 滚动视口（enableScroll 的遮罩窗）：徽章 40 + 右侧计数，一窗收全。
 * 旧视口宽 48 只罩得住圆环，计数串（右缘到 RAIL_X+38）被遮罩裁掉——
 * 玩家看到的"1/4"只剩半截，即此根因。
 */
export const RAIL_VIEW_W = 76;
export const RAIL_VIEW_H = 660;
/**
 * 计数相对环心的横向偏移：计数放环右侧外（origin 0,0.5）。
 * 圆内只留篆字——小字号 mono 的真实墨迹高度带抗锯齿余量后必然蹭到 r16 底弧，
 * 实机截图证实过，环内不放任何第二元素。12px 是 HUD 信息字号下限
 * （FIT 缩放到 1366×768 后仍可读），10px 在小窗下不可辨。
 */
export const RAIL_COUNT_DX = 21;
/** 篆字墨迹半高（14px 字面 ≈0.92em）：环内净空校验用 */
export const RAIL_GLYPH_INK_HALF = 6.4;
/** 最宽计数串（"0/9"，12px mono ≈0.6em/字）：环右净空与悬浮笺避让校验用 */
export const RAIL_COUNT_W = 22;

/** 第 i 枚徽章的环心（相对 traitContainer；traitContainer 挂在 RAIL_X, RAIL_Y） */
export function railBadgeY(i: number): number {
  return i * RAIL_PITCH;
}

/** 计数文字位置（相对单枚徽章容器，origin 0,0.5） */
export function railCountPos(): { x: number; y: number } {
  return { x: RAIL_COUNT_DX, y: 0 };
}

/** 轨的收尾 y（相对 traitContainer；全量 17 族同轨的最坏情形，供滚动内容高度计算） */
export function railBottomY(): number {
  return (RAIL_ITEMS - 1) * RAIL_PITCH + BADGE_R;
}

/** 命中区（相对单枚徽章容器）：罩住圆环与右侧计数串全部墨迹 */
export function railBadgeHit(): { x: number; y: number; w: number; h: number } {
  return { x: -BADGE_SIZE / 2, y: -BADGE_SIZE / 2, w: BADGE_SIZE / 2 + RAIL_COUNT_DX + RAIL_COUNT_W, h: BADGE_SIZE };
}

/**
 * 轨是否越进左下「记事」栏（不变量：必须为 false）。
 * 轨内容在遮罩窗（RAIL_Y-20 → +RAIL_VIEW_H）内滚动，真正可能侵入记事栏的
 * 是视口底缘而非内容尾端——环距与上轨数变化都不该让此不变量误报。
 */
export function railOverlapsLog(): boolean {
  return RAIL_Y - 20 + RAIL_VIEW_H > LOG_Y - 12;
}

// ── 诸侯计分板行（右栏，行高 30）────────────────────────
// 列位按**渲染字号**（textScale 放大后）定预算 —— 历史事故：按声明 13px 给
// 名字列 92px 预算，字号基线放大后 7 全角名实际渲染 105px，静默压进血条。
// 改字号基线时这里的列位随 renderedSize 自动重排，不必手同步。

/** 渲染字号（textScale 放大后的实际值） */
const NAME_RENDERED = renderedSize(13); // 15
const LV_RENDERED = renderedSize(12); // 13

// 列位链式推导：每列从上一列的右缘 + 6px 净距推出，禁止重复写字面量 ——
// 历史事故：lvX 公式里硬编码旧血条宽 72，血条收窄后 lvX 没跟上，行尾静默越栏。
const NAME_BUDGET = 7 * NAME_RENDERED + 1;
const BAR_X = 36 + NAME_BUDGET + 6;
/** 血条 68：lv/streak 提到 12px 后行尾预算贴死 SIDE_W，血条让 4px 保住 reportRowFitsSide */
const BAR_W = 68;
const LV_X = BAR_X + BAR_W + 6;
const LV_BUDGET = Math.ceil(4 * 0.55 * LV_RENDERED); // "Lv10" mono 4 字
const STREAK_X = LV_X + LV_BUDGET + 4;

export const REPORT_ROW = {
  rowH: 30,
  hpX: 0,
  hpSize: 12,
  nameX: 36,
  nameSize: 13,
  /** 名字列预算：最长 7 个全角名按渲染字号收进，超出由渲染层 clipToWidth 截断 */
  nameMaxW: NAME_BUDGET,
  barX: BAR_X,
  barW: BAR_W,
  lvX: LV_X,
  lvSize: 12,
  streakX: STREAK_X,
  streakSize: 12,
  /** 连胜注最宽（"胜9"两全角 × 渲染 13px） */
  streakMaxW: 2 * renderedSize(12),
} as const;

/** 行尾不出右栏（导出供测试口径复算） */
export const REPORT_ROW_END = REPORT_ROW.streakX + REPORT_ROW.streakMaxW;

/** 行内元素矩形（y 为行局部坐标）。供场景与遮挡测试共用。 */
export function reportRowRects(nameLen: number): {
  name: { x: number; w: number };
  bar: { x: number; w: number };
  lv: { x: number; w: number };
  streak: { x: number; w: number };
} {
  const C = REPORT_ROW;
  const cjk = (n: number, size: number): number => n * size;
  return {
    name: { x: C.nameX, w: Math.min(cjk(nameLen, NAME_RENDERED), C.nameMaxW) },
    bar: { x: C.barX, w: C.barW },
    lv: { x: C.lvX, w: cjk(4, 0.55 * LV_RENDERED) },
    streak: { x: C.streakX, w: C.streakMaxW },
  };
}

// ── 羁绊悬停笺 ─────────────────────────────────────────

export const RAIL_POPUP_W = 250;

/**
 * 悬停笺高度与分栏：效果块行数动态计入，描述永远跟在效果块之后 ——
 * 效果多行时不再压住描述（旧实现描述钉死 y=58，五行效果压穿底板）。
 */
export function railPopupLayout(effectLines: number, descLines: number): {
  w: number;
  h: number;
  effectY: number;
  descY: number;
} {
  const w = RAIL_POPUP_W;
  const effectY = 36;
  const effectH = effectLines > 0 ? effectLines * 17 + 6 : 0;
  const descY = effectY + effectH + 6;
  const h = descY + descLines * 16 + 12;
  return { w, h, effectY, descY };
}

/** 笺体不越出屏底（给定的 py 已由调用方钳制） */
export function railPopupClampY(railY: number, h: number): number {
  return Math.min(Math.max(140, railY - 10), 860 - h);
}

/** 计分板行右缘不出栏（不变量） */
export function reportRowFitsSide(): boolean {
  return REPORT_ROW.streakX + REPORT_ROW.streakMaxW <= SIDE_W;
}

// ── 棋子卡装备图标（UnitPortrait 绘制与 hitTest 命中共用此几何）──────
// 历史事故：cards.ts 放大图标（0.17→0.22）后 hitTest 未同步，点装备卸单件
// 错位 4~6px。公式收拢到这里，两侧只许引用、不许再各写一份。

/** 单枚装备图标的边长（sz = 棋子卡边长）。v1.9 放大：0.22→0.26 —— 点选热区与
 *  可读性同步扩大；3×(0.26sz)+2×2 在 66px 卡内仍留 ≥8px 右缘。 */
export function portraitItemSlotSize(sz: number): number {
  return Math.max(14, Math.round(sz * 0.26));
}

/** 图标间缝与卡内左上起点 */
export const PORTRAIT_ITEM_GAP = 2;
export const PORTRAIT_ITEM_PAD = { x: 4, y: 5 } as const;

/** 第 i 枚图标的矩形（卡局部坐标，左上原点）。供 cards.ts 定位与 hitTest 命中。 */
export function portraitItemSlotRect(i: number, sz: number): { x: number; y: number; w: number; h: number } {
  const w = portraitItemSlotSize(sz);
  return { x: PORTRAIT_ITEM_PAD.x + i * (w + PORTRAIT_ITEM_GAP), y: PORTRAIT_ITEM_PAD.y, w, h: w };
}

/**
 * 点按热区矩形（视觉之外外扩，保证 44px 误触容差）。
 *
 * 视觉图标 17px 时点按热区极小，移动端或快速鼠标下 4~6px 漂移即判"没点中"；
 * 视觉保持精致，热区单独外扩 —— 两者分离是可触性与可读性兼得的唯一路径。
 */
export function portraitItemSlotHitRect(i: number, sz: number): { x: number; y: number; w: number; h: number } {
  const r = portraitItemSlotRect(i, sz);
  const pad = 6;
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}
