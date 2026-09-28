import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { computeTraits } from '../src/game/comp';
import { TRAIT_BY_ID } from '../src/data/traits';
import { unitInput } from './helpers';

/**
 * 羁绊档位映射（comp.computeTraits）与「团队加成只结算一次」的回归。
 *
 * 这两条是平衡数据的地基：档位 off-by-one 或同名重复计数会让**全表**羁绊强度
 * 系统性偏移，而平衡矩阵是手动专项门禁（不在 CI 内），套件若不看守就只能靠人眼。
 * 剑宗全队破甲曾误嵌在成员循环内（4 剑宗叠到 0.48 而非 0.12，历史平衡数据全带
 * 这份虚高），回归断言在此钉死。
 */

function battleWith(ids: readonly string[]): Battle {
  const units = ids.map((id, i) => unitInput(id, 0, { c: i, r: 0 }));
  units.push(unitInput('duanyue', 1, { c: 0, r: 4 }));
  return new Battle({ seed: 1, units, traits: { 0: computeTraits(ids), 1: [] } }, null, true);
}

describe('羁绊档位映射（computeTraits）', () => {
  it('同名棋子只计一次：两张同名不等于两个羁绊数', () => {
    const guardian = computeTraits(['pan', 'pan']).find((t) => t.id === 'guardian');
    expect(guardian?.count).toBe(1);
    expect(guardian?.tier).toBe(-1); // 1 < 首档 2 → 未激活
  });

  it('断点 [2,4,6]：2 人 = 首档、4 人 = 二档、6 人 = 三档', () => {
    expect(computeTraits(['pan', 'lingxiao']).find((t) => t.id === 'guardian')).toMatchObject({ count: 2, tier: 0 });
    expect(computeTraits(['pan', 'lingxiao', 'xuanwu', 'budong']).find((t) => t.id === 'guardian')).toMatchObject({ count: 4, tier: 1 });
    expect(
      computeTraits(['pan', 'lingxiao', 'xuanwu', 'budong', 'zhenyue', 'canglan']).find((t) => t.id === 'guardian'),
    ).toMatchObject({ count: 6, tier: 2 });
  });

  it('每个档位索引都落在断点表内（越界索引会让数值表取 undefined 回落默认）', () => {
    const roster = ['pan', 'lingxiao', 'xuanwu', 'budong', 'zhenyue', 'canglan', 'moyan', 'guicheng', 'jiaohan'];
    const traits = computeTraits(roster);
    for (const t of traits) {
      const def = TRAIT_BY_ID[t.id];
      expect(def, `未知羁绊 ${t.id}`).toBeTruthy();
      expect(t.tier).toBeLessThan(def.breakpoints.length);
      expect(t.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('断点表本身自洽：档位色与文案与断点等长', () => {
    for (const def of Object.values(TRAIT_BY_ID)) {
      expect(def.colors.length, `${def.id} colors`).toBe(def.breakpoints.length);
      expect(def.effectText.length, `${def.id} effectText`).toBe(def.breakpoints.length);
    }
  });
});

describe('团队加成只结算一次（剑宗全队破甲历史缺陷回归）', () => {
  it('4 剑宗：非成员友军的全队破甲 = 单次 20%（叠成 4× 即回归）', () => {
    const battle = battleWith(['duanyue', 'wujiu', 'yingsha', 'qingming', 'pan']);
    const ally = battle.units.find((u) => u.entry.id === 'pan');
    const member = battle.units.find((u) => u.entry.id === 'duanyue');
    expect(ally).toBeTruthy();
    expect(member).toBeTruthy();
    // 非成员只吃"全队"那一段：min(penCap 0.2, 0.04 + 4×0.04) = 0.20
    expect(ally!.trait.armorPen).toBeCloseTo(0.2, 5);
    // 成员 = 自身 18% + 全队 20%
    expect(member!.trait.armorPen).toBeCloseTo(0.38, 5);
  });
});
