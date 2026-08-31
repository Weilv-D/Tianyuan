import { describe, expect, it } from 'vitest';
import {
  ACT_BTN_W,
  ACT_X,
  BENCH_W,
  BENCH_X,
  BENCH_Y,
  BOARD_SIZE,
  BOARD_X,
  BOARD_Y,
  CELL,
  GRID_H,
  GRID_W,
  GRID_X,
  GRID_Y,
  HEADER_H,
  H,
  ITEM_BAR_W,
  ITEM_BAR_X,
  PHASE_Y,
  SELL_SIZE,
  SELL_X,
  SHOP_CH,
  SHOP_W,
  SHOP_X,
  SHOP_Y,
  W,
} from '../src/render/view/layout';
import { CINNABAR, GILT, INK, MOON, PAPER, RARITY_COLOR, SPIRIT, VOID, TEAM_COLOR } from '../src/render/view/palette';

/**
 * 布局契约测试（夜宴重排后的不变量）。
 *
 * 背景：分区坐标曾有"魔法数字散落、改一处忘一处"的历史 bug；v1.3.0 重排后，
 * 用单测把几何不变量钉死 —— 任何让面板重叠、越界、失去对齐的布局改动会在
 * `npm test` 就地报警，而不是等浏览器截图验收才发现。
 */

/** 大漆盘（准备与战斗共用的 8×8 盘） */
describe('大漆盘几何', () => {
  it('盘心水平居中', () => {
    expect(BOARD_X).toBe((W - BOARD_SIZE) / 2);
  });

  it('格线区是 8×CELL 且含于盘内', () => {
    expect(GRID_W).toBe(CELL * 8);
    expect(GRID_H).toBe(CELL * 8);
    expect(GRID_X).toBe(BOARD_X + (BOARD_SIZE - GRID_W) / 2);
    expect(GRID_Y).toBe(BOARD_Y + (BOARD_SIZE - GRID_H) / 2);
    expect(GRID_X + GRID_W).toBeLessThanOrEqual(BOARD_X + BOARD_SIZE);
    expect(GRID_Y + GRID_H).toBeLessThanOrEqual(BOARD_Y + BOARD_SIZE);
  });

  it('盘在顶栏之下且不出屏', () => {
    expect(BOARD_Y).toBeGreaterThanOrEqual(HEADER_H);
    expect(BOARD_Y + BOARD_SIZE).toBeLessThan(H);
    expect(BOARD_X).toBeGreaterThanOrEqual(0);
    expect(BOARD_X + BOARD_SIZE).toBeLessThanOrEqual(W);
  });
});

/** 垂直栈序：盘 → 阶段条 → 备战席 → 商肆，逐级向下不得回卷 */
describe('备战垂直栈序', () => {
  it('盘底 < 阶段条 < 备战席 < 商肆', () => {
    const boardBottom = BOARD_Y + BOARD_SIZE;
    const benchTop = BENCH_Y;
    expect(boardBottom).toBeLessThan(PHASE_Y);
    expect(PHASE_Y).toBeLessThan(benchTop);
    expect(benchTop).toBeLessThan(SHOP_Y);
  });

  it('商肆完整落在屏内', () => {
    expect(SHOP_Y + SHOP_CH).toBeLessThanOrEqual(H);
    expect(SHOP_X).toBeGreaterThanOrEqual(0);
    expect(SHOP_X + SHOP_W).toBeLessThanOrEqual(W);
  });
});

/** 水平带：备战席对齐格线宽；器匣 / 商肆 / 操作列 / 出售印互不越界 */
describe('备战水平带', () => {
  it('备战席细条与格线同宽同起点', () => {
    expect(BENCH_X).toBe(GRID_X);
    expect(BENCH_W).toBe(GRID_W);
  });

  it('器匣在商肆左侧且不重叠', () => {
    expect(ITEM_BAR_X + ITEM_BAR_W).toBeLessThanOrEqual(SHOP_X);
  });

  it('操作列不出右屏', () => {
    expect(ACT_X + ACT_BTN_W * 2 + 10).toBeLessThanOrEqual(W);
  });

  it('出售印在商肆右侧且不重叠', () => {
    expect(SELL_X).toBeGreaterThanOrEqual(SHOP_X + SHOP_W);
    expect(SELL_X + SELL_SIZE).toBeLessThanOrEqual(W);
  });
});

/** 色板纪律：紫色全域禁用（ART_BIBLE §2.3），含特效与稀有度 */
describe('色板禁紫', () => {
  const PURPLE_HUE: [number, number] = [265, 320]; // 色相环紫域（留 5° 余量防误伤胭脂/夜蓝）

  function hueOf(hex: number): number {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h: number;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    return (h + 360) % 360;
  }

  function satOf(hex: number): number {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  }

  const all: [string, number][] = [
    ...(Object.entries(INK) as [string, number][]).map(([k, v]) => [`INK.${k}`, v] as [string, number]),
    ...(Object.entries(PAPER) as [string, number][]).map(([k, v]) => [`PAPER.${k}`, v] as [string, number]),
    ...(Object.entries(CINNABAR) as [string, number][]).map(([k, v]) => [`CINNABAR.${k}`, v] as [string, number]),
    ...(Object.entries(GILT) as [string, number][]).map(([k, v]) => [`GILT.${k}`, v] as [string, number]),
    ...(Object.entries(SPIRIT) as [string, number][]).map(([k, v]) => [`SPIRIT.${k}`, v] as [string, number]),
    ...(Object.entries(VOID) as [string, number][]).map(([k, v]) => [`VOID.${k}`, v] as [string, number]),
    ...(Object.entries(MOON) as [string, number][]).map(([k, v]) => [`MOON.${k}`, v] as [string, number]),
    ...Object.entries(RARITY_COLOR).map(([k, v]) => [`RARITY.${k}`, v] as [string, number]),
    ...Object.entries(TEAM_COLOR).map(([k, v]) => [`TEAM.${k}`, v] as [string, number]),
  ];

  it.each(all)('%s 不落在紫域', (_name, hex) => {
    const h = hueOf(hex);
    const s = satOf(hex);
    const inPurple = h >= PURPLE_HUE[0] && h <= PURPLE_HUE[1] && s > 0.18;
    expect(inPurple, `0x${hex.toString(16)} hue=${h.toFixed(0)} sat=${s.toFixed(2)}`).toBe(false);
  });
});
