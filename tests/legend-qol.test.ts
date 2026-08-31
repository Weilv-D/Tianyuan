import { describe, expect, it } from 'vitest';
import { createUnit } from '../src/core/unit';
import { canPlace } from '../src/game/state';
import { unequipAll } from '../src/game/inventory';
import { makePlayer, unitInput, mkBattle } from './helpers';
import type { Star } from '../src/core/types';

/**
 * 1.7.0 特性契约：
 * - 五费三星·天命（LEGEND_T3）：数值再乘 + 免疫控制 + 开战护盾 + 全能吸血
 * - 同名棋子允许同时上场（羁绊计数仍唯一，在 traits/computeTraits 层）
 * - 卸载器：全身装备一键回器匣，容量不足整体拒绝
 */

describe('五费三星 · 天命', () => {
  const cell = { c: 0, r: 0 };

  function ratio(defId: string, star: Star): { hp: number; atk: number } {
    const a = createUnit({ uid: 1, defId, team: 0, cell, star: 1 });
    const b = createUnit({ uid: 2, defId, team: 0, cell, star });
    return { hp: b.maxHp / a.maxHp, atk: b.atk / a.atk };
  }

  it('3★ 五费：生命/攻击在天命层再乘（高于普通三星倍率）', () => {
    // 普通三星：hp ×3.24、atk ×2.1；五费三星再乘 1.6/1.5
    const five = ratio('haotian', 3);
    expect(five.hp).toBeCloseTo(3.24 * 1.6, 2);
    expect(five.atk).toBeCloseTo(2.1 * 1.5, 2);
    const four = ratio('zhenyue', 3);
    expect(four.hp).toBeCloseTo(3.24, 2);
    expect(four.atk).toBeCloseTo(2.1, 2);
  });

  it('3★ 五费：开战护盾 25% 最大生命 + 全能吸血 15% + 免疫控制', () => {
    const u = createUnit({ uid: 3, defId: 'haotian', team: 0, cell, star: 3 });
    expect(u.shield).toBe(Math.round(u.maxHp * 0.25));
    expect(u.omnivamp).toBeCloseTo(0.15, 4);
    expect(u.ccImmune).toBeGreaterThan(0);
  });

  it('非五费三星不触发天命；五费一星不触发', () => {
    const four = createUnit({ uid: 4, defId: 'zhenyue', team: 0, cell, star: 3 });
    expect(four.shield).toBe(0);
    expect(four.ccImmune).toBe(0);
    expect(four.omnivamp).toBe(0);

    const fiveOne = createUnit({ uid: 5, defId: 'haotian', team: 0, cell, star: 1 });
    expect(fiveOne.shield).toBe(0);
    expect(fiveOne.ccImmune).toBe(0);
  });

  it('天命单位实战免疫控制（眩晕被拒绝；普通单位照常生效）', () => {
    const battle = mkBattle([
      unitInput('haotian', 0, cell, { star: 3 }),
      unitInput('ajiu', 1, { c: 7, r: 7 }),
    ]);
    const legend = battle.units.find((u) => u.entry.id === 'haotian')!;
    const foe = battle.units.find((u) => u.entry.id === 'ajiu')!;
    battle.addStatus(foe, legend, 'stun', 2, 0);
    expect(legend.statuses.some((s) => s.kind === 'stun')).toBe(false);
    battle.addStatus(legend, foe, 'stun', 2, 0);
    expect(foe.statuses.some((s) => s.kind === 'stun')).toBe(true);
  });
});

describe('同名棋子允许同时上场', () => {
  it('场上已有同名时，另一张同名仍可上阵（canPlace 放行）', () => {
    const p = makePlayer();
    p.board[0] = { iid: 1, defId: 'ajiu', star: 1 as Star, items: [] };
    const dupe = { iid: 2, defId: 'ajiu', star: 1 as Star, items: [] };
    p.bench[0] = dupe;
    const check = canPlace(p, 2, 'board', 20);
    expect(check.ok).toBe(true);
  });

  it('人口上限仍生效（未占格 + 满人口拒绝）', () => {
    const p = makePlayer({ level: 1 });
    p.board[0] = { iid: 1, defId: 'ajiu', star: 1 as Star, items: [] };
    const u = { iid: 2, defId: 'qingming', star: 1 as Star, items: [] };
    p.bench[0] = u;
    const check = canPlace(p, 2, 'board', 21);
    expect(check.ok).toBe(false);
  });
});

describe('卸载器（unequipAll）', () => {
  it('全身装备回器匣：组件原样、成品拆回两组件', () => {
    const p = makePlayer();
    // 无敌甲（成品，配方两组件）+ 一件组件
    const u = { iid: 1, defId: 'ajiu', star: 1 as Star, items: ['duanhun', 'xuanjia'] };
    p.bench[0] = u;
    const r = unequipAll(p, 1);
    expect(r.ok).toBe(true);
    expect(u.items.length).toBe(0);
    expect(p.items.length).toBe(3); // 成品拆 2 + 组件 1
  });

  it('器匣空间不足：整体拒绝，装备原封不动', () => {
    const p = makePlayer();
    p.items = Array.from({ length: 9 }, () => 'xuanjia');
    const u = { iid: 1, defId: 'ajiu', star: 1 as Star, items: ['duanhun', 'xuanjia'] };
    p.bench[0] = u;
    const before = u.items.length;
    const r = unequipAll(p, 1);
    expect(r.ok).toBe(false);
    expect(u.items.length).toBe(before);
    expect(p.items.length).toBe(9);
  });

  it('空身棋子：拒绝并说明', () => {
    const p = makePlayer();
    p.bench[0] = { iid: 1, defId: 'ajiu', star: 1 as Star, items: [] };
    const r = unequipAll(p, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('没有装备');
  });
});
