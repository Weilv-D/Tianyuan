import { describe, expect, it } from 'vitest';
import { bfsTo, chebyshev, stepTowardAttackPosition } from '../src/core/grid';
import type { Cell } from '../src/core/types';

describe('战场移动', () => {
  it('单位会绕开占用格，且不会落入已占用的目标格', () => {
    const walls = new Set(['4,1', '4,2', '4,3', '4,4', '4,5', '4,6']);
    const blocked = (c: number, r: number) => walls.has(`${c},${r}`);
    const result = bfsTo({ c: 0, r: 3 }, (c, r) => c === 7 && r === 3, blocked);

    expect(result).not.toBeNull();
    let previous: Cell = { c: 0, r: 3 };
    for (const cell of result!.path) {
      expect(blocked(cell.c, cell.r)).toBe(false);
      expect(chebyshev(previous, cell)).toBeLessThanOrEqual(1);
      previous = cell;
    }

    expect(bfsTo({ c: 0, r: 0 }, (c, r) => c === 3 && r === 3, (c, r) => c === 3 && r === 3)).toBeNull();
  });

  it('进入攻击距离后停下，目标被完全包围时也不会踩进占用格', () => {
    expect(stepTowardAttackPosition({ c: 2, r: 2 }, { c: 3, r: 3 }, 1, () => false)).toBeNull();

    const target = { c: 4, r: 4 };
    const surrounded = (c: number, r: number) => chebyshev({ c, r }, target) <= 1;
    expect(stepTowardAttackPosition({ c: 0, r: 0 }, target, 1, surrounded)).toBeNull();
  });
});
