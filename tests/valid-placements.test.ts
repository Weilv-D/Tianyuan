/**
 * validPlacements 回归：拖拽有效落点预显的纯函数地基。
 *
 * 契约：
 * 1. 备战席永远放得下（9 格全部可放置，不受人口限制）。
 * 2. 已在棋盘上的棋子可自由挪动（32 格全可放——交换语义，不受人口限制）。
 * 3. 从备战席移入棋盘受人口限制：人口满时空格拒绝、被占格仍可交换。
 * 4. 只枚举己方半场 + 备战席，不含敌营与出售印。
 * 5. 被拖的棋子必须已在场上/备战席（validPlacements 用 iid 定位来源）。
 */
import { describe, expect, it } from 'vitest';
import { canPlace, emptyBench, emptyBoard, validPlacements } from '../src/game/state';
import { makePlayer } from './helpers';
import type { UnitInstance } from '../src/game/state';
import type { Star } from '../src/core/types';

function unitOn(iid: number, star: Star = 1): UnitInstance {
  return { iid, defId: 'pan', star, items: [] };
}

function placeUnit(p: ReturnType<typeof makePlayer>, iid: number, where: 'board' | 'bench', slot: number): void {
  if (where === 'board') p.board[slot] = unitOn(iid);
  else p.bench[slot] = unitOn(iid);
}

describe('validPlacements', () => {
  it('备战席 9 格全部可放（不受人口限制）', () => {
    const p = makePlayer({ level: 1, board: emptyBoard(), bench: emptyBench() });
    placeUnit(p, 1, 'bench', 0);
    const v = validPlacements(p, 1);
    const bench = v.filter((t) => t.where === 'bench');
    expect(bench.length).toBe(9);
  });

  it('已在棋盘上的棋子可自由挪动：32 格全可放', () => {
    const p = makePlayer({ level: 1, board: emptyBoard(), bench: emptyBench() });
    placeUnit(p, 1, 'board', 0);
    const v = validPlacements(p, 1);
    expect(v.filter((t) => t.where === 'board').length).toBe(32);
  });

  it('从备战席移入：人口满时空格拒绝、被占格仍可交换', () => {
    const p = makePlayer({ level: 1, board: emptyBoard(), bench: emptyBench() });
    placeUnit(p, 2, 'board', 0); // 场上已站 1 人（占满 level 1 人口）
    placeUnit(p, 1, 'bench', 3); // 备战席的这枚要上场
    const v = validPlacements(p, 1);
    const board = v.filter((t) => t.where === 'board');
    // 空格因人口满被拒，只有被占的 slot 0 可交换
    expect(board.length).toBe(1);
    expect(board[0]).toEqual({ where: 'board', slot: 0 });
  });

  it('从备战席移入：人口未满时空格全可放', () => {
    const p = makePlayer({ level: 8, board: emptyBoard(), bench: emptyBench() });
    placeUnit(p, 1, 'bench', 2);
    const v = validPlacements(p, 1);
    expect(v.filter((t) => t.where === 'board').length).toBe(32);
  });

  it('不产出任何非棋盘/备战席目标', () => {
    const p = makePlayer({ board: emptyBoard(), bench: emptyBench() });
    placeUnit(p, 1, 'bench', 3);
    const v = validPlacements(p, 1);
    for (const t of v) {
      expect(t.where === 'board' || t.where === 'bench').toBe(true);
    }
    expect(v.length).toBe(32 + 9);
  });

  it('canPlace 严格防御越界和非整数槽位', () => {
    const p = makePlayer({ level: 5, board: emptyBoard(), bench: emptyBench() });
    placeUnit(p, 1, 'bench', 0);
    expect(canPlace(p, 1, 'board', -1).ok).toBe(false);
    expect(canPlace(p, 1, 'board', 32).ok).toBe(false);
    expect(canPlace(p, 1, 'board', Number.NaN).ok).toBe(false);
    expect(canPlace(p, 1, 'bench', -1).ok).toBe(false);
    expect(canPlace(p, 1, 'bench', 9).ok).toBe(false);
    expect(canPlace(p, 1, 'bench', 0).ok).toBe(true);
    expect(canPlace(p, 1, 'board', 0).ok).toBe(true);
  });
});
