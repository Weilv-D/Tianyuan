/**
 * 器匣溢出分页的纯索引映射。
 *
 * 系统回收（卖出/合成吃子/淘汰/墨兽掉落）按守恒口径允许器匣超过版面
 * ITEM_BAR_SLOTS 格（inventory.stripItems / match.rollItemDrops：装备只进
 * 不出，超格部分不可见但仍入存档）。分页让溢出资产重新可见、可点选、可
 * 拖拽 —— 否则「一键装备摸得到、玩家摸不到」，同一件装备两套可达性。
 *
 * 视觉网格恒为 2×5=10 格，几何（layout.ts / hitTest.ts）不变；
 * 本模块只做「页数 / 页码钳制 / 视觉格→绝对索引」三条换算，可在 Node 里单测。
 */
import { ITEM_BAR_SLOTS } from '../../core/config';

/** 容纳 total 件装备需要的页数（至少 1 页：空匣也有稳定页码可停） */
export function itemPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / ITEM_BAR_SLOTS));
}

/** 页码钳制到 [0, 页数-1]；负数 / NaN 一律归 0（撤销与坏档后的自愈口径） */
export function clampItemPage(page: number, total: number): number {
  if (!Number.isFinite(page) || page < 0) return 0;
  return Math.min(page, itemPageCount(total) - 1);
}

/** 视觉格（0~ITEM_BAR_SLOTS-1）→ 器匣绝对索引 */
export function absoluteItemIndex(page: number, visual: number): number {
  return page * ITEM_BAR_SLOTS + visual;
}
