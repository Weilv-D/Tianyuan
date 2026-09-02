/**
 * 场景级命中检测 —— 纯函数（A1 抽取）。
 *
 * 输入必须是**世界坐标**（1920×1080 逻辑系）：调用方先用 screenToWorld 把
 * 画布像素换算过来。零 Phaser 依赖、零场景状态，tests/input-coords.test.ts
 * 直接调用即可对全部几何做往返断言。
 *
 * 几何唯一真源是 render/view/layout.ts；本文件只做算术，不允许再写裸坐标。
 */
import {
  BENCH_CELL,
  BENCH_W,
  BENCH_X,
  BENCH_Y,
  CELL,
  GRID_H,
  GRID_W,
  GRID_X,
  GRID_Y,
  HALF_ROWS,
  ITEM_BAR_SLOTS,
  ITEM_BAR_X,
  ITEM_BAR_Y,
  ITEM_COLS,
  ITEM_GAP,
  ITEM_ROWS,
  ITEM_SIZE,
} from '../view/layout';
import { portraitItemSlotHitRect } from '../view/hudLayout';

export interface HitSlot {
  where: 'board' | 'bench';
  slot: number;
}

/** 大漆盘（仅下半 4 行为己方数据槽位）+ 备战席。敌营 4 行返回 null。 */
export function hitSource(x: number, y: number): HitSlot | null {
  // 大漆盘 8 行全可见，但只有下半 4 行是数据阵地（敌营在数据层没有槽位）
  if (x >= GRID_X && x < GRID_X + GRID_W && y >= GRID_Y && y < GRID_Y + GRID_H) {
    const c = Math.floor((x - GRID_X) / CELL);
    const r = Math.floor((y - GRID_Y) / CELL);
    if (r < GRID_H / CELL - HALF_ROWS) return null; // 敌营：不可放置也不可选中
    return { where: 'board', slot: (r - (GRID_H / CELL - HALF_ROWS)) * 8 + c };
  }
  if (x >= BENCH_X && x < BENCH_X + BENCH_W && y >= BENCH_Y && y < BENCH_Y + BENCH_CELL) {
    return { where: 'bench', slot: Math.floor((x - BENCH_X) / BENCH_CELL) };
  }
  return null;
}

/** 拖拽落点：棋盘 / 备战席 / 出售印。sellRect 由调用方传入（HudPanels 的同一实例）。 */
export function hitTarget(
  x: number,
  y: number,
  sellRect: { contains: (px: number, py: number) => boolean } | null
): { where: 'board' | 'bench' | 'sell'; slot: number } | null {
  if (sellRect && sellRect.contains(x, y)) return { where: 'sell', slot: 0 };
  return hitSource(x, y);
}

/** 命中了器匣（2×5 网格）的哪一格，-1 表示没命中（含落在格间缝隙的情况）。 */
export function hitItemChip(x: number, y: number): number {
  const col = Math.floor((x - ITEM_BAR_X + ITEM_GAP / 2) / (ITEM_SIZE + ITEM_GAP));
  const row = Math.floor((y - ITEM_BAR_Y + ITEM_GAP / 2) / (ITEM_SIZE + ITEM_GAP));
  if (col < 0 || col >= ITEM_COLS || row < 0 || row >= ITEM_ROWS) return -1;
  const i = row * ITEM_COLS + col;
  if (i < 0 || i >= ITEM_BAR_SLOTS) return -1;
  // 落在格子里而不是缝隙里
  const left = ITEM_BAR_X + col * (ITEM_SIZE + ITEM_GAP);
  const top = ITEM_BAR_Y + row * (ITEM_SIZE + ITEM_GAP);
  return x >= left && x <= left + ITEM_SIZE && y >= top && y <= top + ITEM_SIZE ? i : -1;
}

/** 棋子身上装备图标（几何真源 hudLayout.portraitItemSlotRect，与 ui/cards.ts 的绘制同源）的点选，-1 表示没点中。 */
export function hitUnitItemSlot(
  x: number,
  y: number,
  where: HitSlot,
  itemCount: number
): number {
  if (itemCount === 0) return -1;
  const size = where.where === 'board' ? CELL - 6 : BENCH_CELL - 6;
  // UnitPortrait 挂在格左上 +3px（BoardBake），图标再从卡内 PAD 起排
  const px =
    (where.where === 'board' ? GRID_X + (where.slot % 8) * CELL : BENCH_X + where.slot * BENCH_CELL) + 3;
  const py =
    (where.where === 'board' ? GRID_Y + (Math.floor(where.slot / 8) + HALF_ROWS) * CELL : BENCH_Y) + 3;
  for (let i = 0; i < Math.min(3, itemCount); i++) {
    const r = portraitItemSlotHitRect(i, size);
    if (x >= px + r.x && x <= px + r.x + r.w && y >= py + r.y && y <= py + r.y + r.h) return i;
  }
  return -1;
}
