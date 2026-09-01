import { describe, expect, it } from 'vitest';
import { hitItemChip, hitSource, hitTarget } from '../src/render/game/hitTest';
import {
  BENCH_CELL,
  BENCH_X,
  BENCH_Y,
  CELL,
  GRID_X,
  GRID_Y,
  HALF_ROWS,
  ITEM_BAR_X,
  ITEM_BAR_Y,
  ITEM_GAP,
  ITEM_SIZE,
  SELL_SIZE,
  SELL_X,
  SELL_Y,
  BOARD_PAD,
} from '../src/render/view/layout';
import {
  BATTLE_BOARD_LX,
  BATTLE_BOARD_LY,
  BATTLE_BOARD_SCALE,
  battleWorldToLayer,
  screenToWorld,
} from '../src/render/view/viewScale';

const sellArea = {
  contains: (x: number, y: number) =>
    x >= SELL_X && x < SELL_X + SELL_SIZE && y >= SELL_Y && y < SELL_Y + SELL_SIZE,
};

describe('高分屏输入', () => {
  it('常见缩放下所有己方棋盘格和备战席仍命中正确位置', () => {
    for (const scale of [1, 1.25, 1.5, 2]) {
      for (let row = 0; row < HALF_ROWS; row++) {
        for (let col = 0; col < 8; col++) {
          const x = GRID_X + col * CELL + CELL / 2;
          const y = GRID_Y + (row + HALF_ROWS) * CELL + CELL / 2;
          const point = screenToWorld(x * scale, y * scale, scale);
          expect(hitSource(point.x, point.y), `K=${scale}`).toEqual({ where: 'board', slot: row * 8 + col });
        }
      }
      for (let slot = 0; slot < 9; slot++) {
        const x = BENCH_X + slot * BENCH_CELL + BENCH_CELL / 2;
        const y = BENCH_Y + BENCH_CELL / 2;
        const point = screenToWorld(x * scale, y * scale, scale);
        expect(hitSource(point.x, point.y), `K=${scale}`).toEqual({ where: 'bench', slot });
      }
    }
  });

  it('敌方棋盘不可拖动，出售区仍优先识别', () => {
    expect(hitSource(GRID_X + CELL / 2, GRID_Y + CELL / 2)).toBeNull();
    expect(hitTarget(SELL_X + SELL_SIZE / 2, SELL_Y + SELL_SIZE / 2, sellArea)).toEqual({
      where: 'sell',
      slot: 0,
    });
  });

  it('器匣格可点击且格间空隙不会误选', () => {
    for (let index = 0; index < 10; index++) {
      const col = index % 5;
      const row = Math.floor(index / 5);
      const x = ITEM_BAR_X + col * (ITEM_SIZE + ITEM_GAP) + ITEM_SIZE / 2;
      const y = ITEM_BAR_Y + row * (ITEM_SIZE + ITEM_GAP) + ITEM_SIZE / 2;
      expect(hitItemChip(x, y)).toBe(index);
    }
    expect(hitItemChip(ITEM_BAR_X + ITEM_SIZE + ITEM_GAP / 2, ITEM_BAR_Y + ITEM_SIZE / 2)).toBe(-1);
  });
});

describe('战斗棋盘层（BattleScene 指针逆变换）', () => {
  // 层真源 viewScale.BATTLE_BOARD_*：战斗时棋盘整体放大 1.25×，指针世界坐标
  // 须先平移再除缩放才能命中层内格。此处对全部己方格做「层内格心 → 世界 →
  // 局部」往返断言 —— 失败即玩家可见的「战斗中悬停详情卡/格子高亮错位」。
  it('K=1 与 K=2 下世界坐标逆变换到层内后仍命中正确的棋盘格', () => {
    for (const zoom of [1, 2]) {
      for (let row = 0; row < HALF_ROWS; row++) {
        for (let col = 0; col < 8; col++) {
          const localX = BOARD_PAD + col * CELL + CELL / 2;
          const localY = BOARD_PAD + row * CELL + CELL / 2;
          // 层内格心 → 世界（棋盘层正变换）→ 指针画布像素 → 世界 → 层内局部
          const worldX = BATTLE_BOARD_LX + localX * BATTLE_BOARD_SCALE;
          const worldY = BATTLE_BOARD_LY + localY * BATTLE_BOARD_SCALE;
          const world = screenToWorld(worldX * zoom, worldY * zoom, zoom);
          const layer = battleWorldToLayer(world.x, world.y);
          expect(layer.x).toBeCloseTo(localX, 6);
          expect(layer.y).toBeCloseTo(localY, 6);
        }
      }
    }
  });

  it('层外区域（左右面板）逆变换后落在棋盘格外，不会误命中己方格', () => {
    const layer = battleWorldToLayer(BATTLE_BOARD_LX - 120, BATTLE_BOARD_LY + 300);
    expect(layer.x).toBeLessThan(BOARD_PAD); // 左面板方向：落在盘外
  });
});
