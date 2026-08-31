/**
 * 输入坐标回归（A1）。
 *
 * DPR 底座（画布 1920K×1080K、相机 zoom=K）下，pointer.x/y 是画布像素，
 * 场景级命中检测全在 1920×1080 世界系 —— screenToWorld 是两界唯一咽喉。
 * 这里对换算与全部命中几何做纯函数断言，并钉死「K=2 屏幕输入换算后全命中」。
 */
import { describe, expect, it } from 'vitest';
import { screenToWorld } from '../src/render/view/viewScale';
import {
  hitItemChip,
  hitSource,
  hitTarget,
  hitUnitItemSlot,
} from '../src/render/game/hitTest';
import {
  BENCH_CELL,
  BENCH_X,
  BENCH_Y,
  CELL,
  GRID_X,
  GRID_Y,
  ITEM_BAR_X,
  ITEM_BAR_Y,
  ITEM_SIZE,
  ITEM_GAP,
  SELL_X,
  SELL_Y,
  SELL_SIZE,
  HALF_ROWS,
} from '../src/render/view/layout';
import { portraitItemSlotRect } from '../src/render/view/hudLayout';

/** hitTarget 只依赖 contains 结构（HudPanels 传的是 Phaser.Geom.Rectangle 实例） */
const sellRectOf = () => ({
  contains: (x: number, y: number) =>
    x >= SELL_X && x < SELL_X + SELL_SIZE && y >= SELL_Y && y < SELL_Y + SELL_SIZE,
});

describe('screenToWorld（画布像素 → 世界坐标）', () => {
  it.each([1, 1.25, 1.5, 2])('K=%s 下换算精确', (k) => {
    expect(screenToWorld(960 * k, 540 * k, k)).toEqual({ x: 960, y: 540 });
    expect(screenToWorld(0, 0, k)).toEqual({ x: 0, y: 0 });
    // 非整数倍：换算后应还原出世界值（误差来自浮点除法本身）
    const w = screenToWorld(1234.5 * k, 777.25 * k, k);
    expect(w.x).toBeCloseTo(1234.5, 10);
    expect(w.y).toBeCloseTo(777.25, 10);
  });

  it('推镜期间的临时 zoom 也能正确换算（celebrate punch = CAM_ZOOM×1.012）', () => {
    const z = 2 * 1.012;
    expect(screenToWorld(960 * z, 540 * z, z)).toEqual({ x: 960, y: 540 });
  });
});

describe('hitSource（棋盘 32 格 + 备战席 9 格）', () => {
  it('己方 4 行 32 格：格心往返命中且 slot 正确', () => {
    for (let r = 0; r < HALF_ROWS; r++) {
      for (let c = 0; c < 8; c++) {
        const x = GRID_X + c * CELL + CELL / 2;
        const y = GRID_Y + (r + HALF_ROWS) * CELL + CELL / 2;
        const hit = hitSource(x, y);
        expect(hit).toEqual({ where: 'board', slot: r * 8 + c });
      }
    }
  });

  it('敌营 4 行全部 null（不可选中）', () => {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 8; c += 2) {
        const x = GRID_X + c * CELL + CELL / 2;
        const y = GRID_Y + r * CELL + CELL / 2;
        expect(hitSource(x, y)).toBeNull();
      }
    }
  });

  it('备战席 9 格：格心命中且 slot 正确', () => {
    for (let s = 0; s < 9; s++) {
      const hit = hitSource(BENCH_X + s * BENCH_CELL + BENCH_CELL / 2, BENCH_Y + BENCH_CELL / 2);
      expect(hit).toEqual({ where: 'bench', slot: s });
    }
  });

  it('边界外返回 null；边界恰好含入', () => {
    expect(hitSource(GRID_X - 1, GRID_Y + 4 * CELL)).toBeNull();
    expect(hitSource(GRID_X + 8 * CELL, GRID_Y + 4 * CELL)).toBeNull();
    // 己方第 0 行上沿（= 敌营下沿）：含入己方
    expect(hitSource(GRID_X, GRID_Y + 4 * CELL + 1)).toEqual({ where: 'board', slot: 0 });
    // 备战席下方一条空带
    expect(hitSource(BENCH_X + 10, BENCH_Y + BENCH_CELL + 5)).toBeNull();
  });
});

describe('hitTarget（出售印）', () => {
  const sellRect = sellRectOf();

  it('出售印内命中 sell', () => {
    expect(hitTarget(SELL_X + SELL_SIZE / 2, SELL_Y + SELL_SIZE / 2, sellRect)).toEqual({
      where: 'sell',
      slot: 0,
    });
  });

  it('出售印外回落到棋盘/备战席/null', () => {
    expect(hitTarget(SELL_X - 5, SELL_Y - 5, sellRect)).toBeNull();
    const benchHit = hitTarget(BENCH_X + 5, BENCH_Y + 5, sellRect);
    expect(benchHit).toEqual({ where: 'bench', slot: 0 });
  });

  it('sellRect 传 null 时不出售（防御）', () => {
    expect(hitTarget(SELL_X + 1, SELL_Y + 1, null)).toBeNull();
  });
});

describe('hitItemChip（器匣 2×5）', () => {
  it('10 格格心命中且编号正确', () => {
    for (let i = 0; i < 10; i++) {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const x = ITEM_BAR_X + col * (ITEM_SIZE + ITEM_GAP) + ITEM_SIZE / 2;
      const y = ITEM_BAR_Y + row * (ITEM_SIZE + ITEM_GAP) + ITEM_SIZE / 2;
      expect(hitItemChip(x, y)).toBe(i);
    }
  });

  it('格间缝隙返回 -1', () => {
    const seamX = ITEM_BAR_X + ITEM_SIZE + ITEM_GAP / 2;
    expect(hitItemChip(seamX, ITEM_BAR_Y + ITEM_SIZE / 2)).toBe(-1);
  });

  it('器匣外返回 -1', () => {
    expect(hitItemChip(ITEM_BAR_X - 30, ITEM_BAR_Y + 10)).toBe(-1);
    expect(hitItemChip(ITEM_BAR_X + 10, ITEM_BAR_Y - 30)).toBe(-1);
  });
});

describe('hitUnitItemSlot（棋子装备图标，与 cards.ts 绘制几何同源）', () => {
  it('场上棋子第 1~3 件可点中，件间缝隙不误命中', () => {
    const where = { where: 'board' as const, slot: 3 * 8 + 4 };
    const size = CELL - 6;
    const px = GRID_X + 4 * CELL + 3;
    const py = GRID_Y + (3 + HALF_ROWS) * CELL + 3;
    // 期望值从几何真源 hudLayout.portraitItemSlotRect 推出，与绘制共用一份公式
    const r0 = portraitItemSlotRect(0, size);
    const r2 = portraitItemSlotRect(2, size);
    expect(hitUnitItemSlot(px + r0.x + r0.w / 2, py + r0.y + r0.h / 2, where, 3)).toBe(0);
    expect(hitUnitItemSlot(px + r2.x + r2.w / 2, py + r2.y + r2.h / 2, where, 3)).toBe(2);
    // 两件之间的缝隙不命中
    expect(hitUnitItemSlot(px + r0.x + r0.w + 1, py + r0.y + r0.h / 2, where, 3)).toBe(-1);
    // 第 4 件不渲染（Math.min(3, n)）：
    const r3 = portraitItemSlotRect(3, size);
    expect(hitUnitItemSlot(px + r3.x + r3.w / 2, py + r3.y + r3.h / 2, where, 4)).toBe(-1);
  });

  it('备战席棋子的图标几何按 BENCH_CELL 缩小', () => {
    const where = { where: 'bench' as const, slot: 2 };
    const size = 64 - 6;
    const px = BENCH_X + 2 * 64 + 3;
    const r0 = portraitItemSlotRect(0, size);
    expect(hitUnitItemSlot(px + r0.x + r0.w / 2, BENCH_Y + 3 + r0.y + r0.h / 2, where, 1)).toBe(0);
  });

  it('无装备直接 -1', () => {
    expect(hitUnitItemSlot(0, 0, { where: 'bench', slot: 0 }, 0)).toBe(-1);
  });
});

describe('K=2 全链路：屏幕输入 → 世界坐标 → 命中', () => {
  const K = 2;
  it('32 棋盘格 + 9 备战席格的屏幕坐标经换算后全部命中', () => {
    for (let r = 0; r < HALF_ROWS; r++) {
      for (let c = 0; c < 8; c++) {
        const wx = GRID_X + c * CELL + CELL / 2;
        const wy = GRID_Y + (r + HALF_ROWS) * CELL + CELL / 2;
        const p = screenToWorld(wx * K, wy * K, K);
        expect(hitSource(p.x, p.y)).toEqual({ where: 'board', slot: r * 8 + c });
      }
    }
    for (let s = 0; s < 9; s++) {
      const wx = BENCH_X + s * BENCH_CELL + BENCH_CELL / 2;
      const p = screenToWorld(wx * K, (BENCH_Y + BENCH_CELL / 2) * K, K);
      expect(hitSource(p.x, p.y)).toEqual({ where: 'bench', slot: s });
    }
  });

  it('器匣与出售印在 K=2 屏幕坐标下同样命中', () => {
    const chipWorld = { x: ITEM_BAR_X + 2 * (ITEM_SIZE + ITEM_GAP) + ITEM_SIZE / 2, y: ITEM_BAR_Y + ITEM_SIZE / 2 };
    const p = screenToWorld(chipWorld.x * K, chipWorld.y * K, K);
    expect(hitItemChip(p.x, p.y)).toBe(2);

    const sell = sellRectOf();
    const sp = screenToWorld((SELL_X + 5) * K, (SELL_Y + 5) * K, K);
    expect(hitTarget(sp.x, sp.y, sell)).toEqual({ where: 'sell', slot: 0 });
  });
});
