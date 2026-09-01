import { describe, expect, it } from 'vitest';
import { createUnit } from '../src/core/unit';
import { Rng } from '../src/core/rng';
import { CHAMPIONS } from '../src/data/champions';
import { generateBeastBoard } from '../src/game/beast';
import { autoPlace } from '../src/game/comp';
import { CardPool } from '../src/game/pool';

describe('损坏输入与极端阵容', () => {
  it('自动站位在棋盘满员时截断而不是冻结或重叠', () => {
    const ids = Array.from({ length: 33 }, (_, index) => CHAMPIONS[index % CHAMPIONS.length].id);
    const placed = autoPlace(ids, 1);
    const cells = new Set([...placed.values()].map((cell) => `${cell.c},${cell.r}`));
    expect(placed.size).toBe(32);
    expect(cells.size).toBe(32);
  });

  it('非法星级和损坏卡池不会生成无效资源', () => {
    const input = { uid: 1, defId: 'ajiu', team: 0 as const, cell: { c: 0, r: 0 } };
    expect(() => createUnit({ ...input, star: 0 as never })).toThrow();
    expect(() => createUnit({ ...input, star: Number.NaN as never })).toThrow();

    const pool = new CardPool();
    const full = pool.snapshot();
    pool.restore({ ajiu: -1, __unknown__: 3 });
    expect(pool.snapshot()).toEqual(full);
  });

  it('墨兽阵容在各阶段都按宣告数量实际落地', () => {
    for (let round = 0; round <= 30; round += 3) {
      const board = generateBeastBoard(round, new Rng(1000 + round));
      expect(board.filter(Boolean).length).toBe(Math.min(8, 2 + Math.floor(round / 4)));
    }
  });
});
