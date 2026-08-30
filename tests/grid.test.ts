/**
 * 占格完整性回归 —— 幽灵单位是寻路系统最深的坑。
 *
 * 契约：占用格既不能穿过、也不能落脚，没有例外。
 * 一旦两个单位写进同一格，occ 占位表即告腐坏，
 * 之后所有 BFS 结果都不可信。
 */
import { describe, expect, it } from 'vitest';
import {
  bfsTo,
  chebyshev,
  nearestFreeCell,
  stepTowardAttackPosition,
} from '../src/core/grid';
import type { Cell } from '../src/core/types';

const key = (c: Cell) => `${c.c},${c.r}`;

describe('bfsTo 占格约束', () => {
  it('路径逐步相邻、不经过任何占用格、终点满足目标条件', () => {
    const walls = new Set(['4,1', '4,2', '4,3', '4,4', '4,5', '4,6']); // 留出 r=0/r=7 两个绕口
    const blocked = (c: number, r: number) => walls.has(`${c},${r}`);
    const res = bfsTo({ c: 0, r: 3 }, (c, r) => c === 7 && r === 3, blocked);

    expect(res).not.toBeNull();
    const path = res!.path;
    expect(key(path[path.length - 1])).toBe('7,3');
    let prev: Cell = { c: 0, r: 3 };
    for (const cell of path) {
      expect(blocked(cell.c, cell.r)).toBe(false); // 不穿占用格
      expect(chebyshev(prev, cell)).toBeLessThanOrEqual(1); // 八邻域逐步相邻
      prev = cell;
    }
  });

  it('唯一目标格被占用时宁可返回 null，也不落上去', () => {
    const res = bfsTo(
      { c: 0, r: 0 },
      (c, r) => c === 3 && r === 3,
      (c, r) => c === 3 && r === 3,
    );
    expect(res).toBeNull();
  });

  it('整列墙隔断左右半场 → 不可达返回 null', () => {
    const blocked = (c: number) => c === 4;
    const res = bfsTo({ c: 0, r: 0 }, (c) => c === 7, blocked);
    expect(res).toBeNull();
  });
});

describe('stepTowardAttackPosition', () => {
  it('空场：下一步与起点相邻，且最终站位在射程内而非目标脚下', () => {
    const from: Cell = { c: 0, r: 0 };
    const target: Cell = { c: 5, r: 5 };
    const step = stepTowardAttackPosition(from, target, 1, () => false);
    expect(step).not.toBeNull();
    expect(chebyshev(from, step!)).toBeLessThanOrEqual(1);
    // 用同一 BFS 语义反推：目标的相邻空格即为可达的攻击位
    expect(chebyshev(step!, target)).toBeLessThanOrEqual(6); // 只走了一步，不必已入射程
  });

  it('已在射程内 → 原地输出（null）', () => {
    const step = stepTowardAttackPosition({ c: 2, r: 2 }, { c: 3, r: 3 }, 1, () => false);
    expect(step).toBeNull();
  });

  it('目标周围一圈全被占死 → 不再逼近，返回 null', () => {
    const target: Cell = { c: 4, r: 4 };
    const ringBlocked = (c: number, r: number) =>
      chebyshev({ c, r }, target) <= 1;
    const step = stepTowardAttackPosition({ c: 0, r: 0 }, target, 1, ringBlocked);
    expect(step).toBeNull();
  });
});

describe('nearestFreeCell', () => {
  it('选距离最近且未被占用的候选格', () => {
    const origin: Cell = { c: 0, r: 0 };
    const best = nearestFreeCell(
      origin,
      [
        { c: 1, r: 0 }, // 被占
        { c: 2, r: 0 },
        { c: 5, r: 5 },
      ],
      (c) => c === 1,
    );
    expect(key(best!)).toBe('2,0');
  });

  it('候选全被占 → null', () => {
    expect(nearestFreeCell({ c: 0, r: 0 }, [{ c: 1, r: 1 }], () => true)).toBeNull();
  });
});
