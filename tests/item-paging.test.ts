import { describe, expect, it } from 'vitest';
import { ITEM_BAR_SLOTS } from '../src/core/config';
import { absoluteItemIndex, clampItemPage, itemPageCount } from '../src/render/game/itemPaging';

/**
 * 器匣溢出分页的纯映射契约。
 *
 * 系统回收（卖出/淘汰/墨兽掉落）按守恒口径允许器匣超过版面 10 格 ——
 * 分页让溢出资产重新可见可操作。视觉网格恒为 2×5=10 格，本组测试钉死
 * 「页数 / 页码钳制 / 视觉格→绝对索引」三条换算口径，几何不变。
 */
describe('器匣分页映射', () => {
  it('页数：空匣与满页一页，溢出按 10 格进位', () => {
    expect(itemPageCount(0)).toBe(1);
    expect(itemPageCount(1)).toBe(1);
    expect(itemPageCount(ITEM_BAR_SLOTS)).toBe(1);
    expect(itemPageCount(ITEM_BAR_SLOTS + 1)).toBe(2);
    expect(itemPageCount(ITEM_BAR_SLOTS * 3)).toBe(3);
    expect(itemPageCount(ITEM_BAR_SLOTS * 3 + 1)).toBe(4);
  });

  it('页码钳制：负数与越界收回合法区间，空匣恒第 0 页', () => {
    expect(clampItemPage(0, 0)).toBe(0);
    expect(clampItemPage(-2, ITEM_BAR_SLOTS * 2)).toBe(0);
    expect(clampItemPage(1, ITEM_BAR_SLOTS + 1)).toBe(1);
    expect(clampItemPage(5, ITEM_BAR_SLOTS + 1)).toBe(1);
    expect(clampItemPage(Number.NaN, ITEM_BAR_SLOTS * 2)).toBe(0);
  });

  it('可视格 → 绝对索引：下一页首格 = 上一页末格 + 1，不重不漏', () => {
    expect(absoluteItemIndex(0, 0)).toBe(0);
    expect(absoluteItemIndex(0, ITEM_BAR_SLOTS - 1)).toBe(ITEM_BAR_SLOTS - 1);
    expect(absoluteItemIndex(1, 0)).toBe(ITEM_BAR_SLOTS);
    expect(absoluteItemIndex(2, 4)).toBe(ITEM_BAR_SLOTS * 2 + 4);
    // 全域单射：任何页/格组合不映射到同一绝对索引
    const seen = new Set<number>();
    for (let page = 0; page < 4; page++) {
      for (let v = 0; v < ITEM_BAR_SLOTS; v++) {
        const abs = absoluteItemIndex(page, v);
        expect(seen.has(abs)).toBe(false);
        seen.add(abs);
      }
    }
  });
});
