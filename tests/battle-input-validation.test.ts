/**
 * 战斗输入校验回归（B4）。
 *
 * 构造时对重复 uid / 越界格 / 重叠格显式抛错（与 createUnit「未知棋子即抛」
 * 同契约）。旧代码静默跳过重叠格会腐坏 occ 占位表 —— 寻路与命中全盘错位。
 */
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import type { BattleUnitInput } from '../src/core/types';

const unit = (uid: number, team: 0 | 1, c: number, r: number, defId = 'pan'): BattleUnitInput => ({
  uid,
  defId,
  team,
  star: 1,
  cell: { c, r },
});

describe('Battle 构造输入校验', () => {
  it('重复 uid → 抛错', () => {
    expect(
      () =>
        new Battle(
          { seed: 1, units: [unit(1, 0, 0, 4), unit(1, 1, 0, 3, 'ajiu')], traits: {} },
          null,
          false,
        ),
    ).toThrow(/重复 uid/);
  });

  it('越界格 → 抛错（列越界与行越界）', () => {
    expect(
      () => new Battle({ seed: 1, units: [unit(1, 0, 8, 4)], traits: {} }, null, false),
    ).toThrow(/越界格/);
    expect(
      () => new Battle({ seed: 1, units: [unit(1, 0, 0, 8)], traits: {} }, null, false),
    ).toThrow(/越界格/);
    expect(
      () => new Battle({ seed: 1, units: [unit(1, 0, -1, 4)], traits: {} }, null, false),
    ).toThrow(/越界格/);
  });

  it('重叠格 → 抛错', () => {
    expect(
      () =>
        new Battle(
          { seed: 1, units: [unit(1, 0, 2, 4), unit(2, 0, 2, 4, 'ajiu')], traits: {} },
          null,
          false,
        ),
    ).toThrow(/重叠格/);
  });

  it('合法输入照常构造（不误伤）', () => {
    const b = new Battle(
      { seed: 1, units: [unit(1, 0, 0, 4), unit(101, 1, 0, 3, 'ajiu')], traits: {} },
      null,
      false,
    );
    expect(b.units.length).toBe(2);
  });
});
