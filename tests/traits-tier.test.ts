import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { computeTraits } from '../src/game/comp';
import type { BattleConfig } from '../src/core/types';

/**
 * 档位门控与"团队效果单次生效"回归。
 *
 * 背景（2026-08-30 M1）：历史上 applyTraits 存 1-based 档位导致全部条件档
 * 提前一档生效（已修）；剑宗/龙渊的团队加成块又误嵌在成员循环内，
 * 4 人时全队收益叠 4 次（已修）。这些测试钉住两条约定：
 *   1. computeTraits 的 0-based 档位映射（2 人=首档、4 人=二档，不提前）
 *   2. 团队级加成按"单次生效"结算，与成员数量解耦
 */

const byTier = (defIds: string[], id: string) => computeTraits(defIds).find((t) => t.id === id)!;

describe('档位门控（computeTraits 0-based）', () => {
  it('断点 [2,4]：2 人 = 首档（tier 0），不是二档', () => {
    const t = byTier(['qinghe', 'kutong'], 'danding');
    expect(t.count).toBe(2);
    expect(t.tier).toBe(0);
  });

  it('断点 [2,4]：4 人 = 二档（tier 1）', () => {
    const t = byTier(['qinghe', 'kutong', 'bainiang', 'baopu'], 'danding');
    expect(t.tier).toBe(1);
  });

  it('断点 [3,6,9]：6 人 = 二档，不提前吃三档', () => {
    const ids = ['moyan', 'yunchu', 'chiji', 'guicheng', 'xuanji', 'baitao'];
    const t = byTier(ids, 'momen');
    expect(t.tier).toBe(1);
  });

  it('断点 [2,5,8]：5 人 = 二档', () => {
    const ids = ['zhenfeng', 'jinghong', 'xijue', 'paoche', 'guzhen'];
    const t = byTier(ids, 'bingjia');
    expect(t.tier).toBe(1);
  });

  it('不足首档 = tier -1（未激活）', () => {
    const t = byTier(['moyan', 'yunchu'], 'momen');
    expect(t.tier).toBe(-1);
  });

  it('丹鼎 2 人不吃 4 人档的回蓝（行为级门控，走 computeTraits 真实链路）', () => {
    // 2 丹鼎 + 1 敌方：首档只有回血没有回蓝。
    // Battle 不自动套羁绊 —— traits 由调用方计算传入（与实机同链路）。
    const units = [
      { uid: 1, defId: 'qinghe', team: 0 as const, star: 1 as const, cell: { c: 0, r: 3 } },
      { uid: 2, defId: 'kutong', team: 0 as const, star: 1 as const, cell: { c: 1, r: 3 } },
      { uid: 3, defId: 'ajiu', team: 1 as const, star: 1 as const, cell: { c: 0, r: 7 } },
    ];
    const battle = new Battle(
      { seed: 7, units, traits: { 0: computeTraits(['qinghe', 'kutong']), 1: [] }, maxTicks: 90 },
      null,
      true,
    );
    const qinghe = battle.unitByUid(1)!;
    expect(qinghe.trait.manaPerSec).toBe(0); // 首档无回蓝
    expect(qinghe.trait.hpRegenPctPerSec).toBeGreaterThan(0); // 首档有回血
  });
});

describe('团队加成单次生效（剑宗/龙渊修复回归）', () => {
  /** 4 剑宗 + 1 非剑宗友军：观察非成员吃到的全队破甲 */
  const jzConfig = (): BattleConfig => ({
    seed: 11,
    units: [
      { uid: 1, defId: 'duanyue', team: 0 as const, star: 1 as const, cell: { c: 0, r: 3 } },
      { uid: 2, defId: 'yingsha', team: 0 as const, star: 1 as const, cell: { c: 1, r: 3 } },
      { uid: 3, defId: 'wujiu', team: 0 as const, star: 1 as const, cell: { c: 2, r: 3 } },
      { uid: 4, defId: 'qingming', team: 0 as const, star: 1 as const, cell: { c: 3, r: 3 } },
      { uid: 5, defId: 'pan', team: 0 as const, star: 1 as const, cell: { c: 4, r: 3 } },
      { uid: 9, defId: 'ajiu', team: 1 as const, star: 1 as const, cell: { c: 0, r: 7 } },
    ],
    traits: { 0: [{ id: 'jianzong', count: 4, tier: 1 }], 1: [] },
    maxTicks: 30,
  });

  it('4 剑宗：非成员友军的全队破甲 = 单次 20%（历史 bug 会叠到 80%）', () => {
    const battle = new Battle(jzConfig(), null, true);
    const outsider = battle.unitByUid(5)!;
    // pen = min(0.20, 0.04 + 4×0.04) = 0.20，单次写入
    expect(outsider.trait.armorPen).toBeCloseTo(0.2, 5);
  });

  it('4 剑宗：成员自身破甲 = 18%（自身档，不被团队块覆盖叠加）', () => {
    const battle = new Battle(jzConfig(), null, true);
    const member = battle.unitByUid(1)!;
    // 成员自身 armorPen 是赋值语义（0.18），随后团队块 +0.20 → 0.38
    expect(member.trait.armorPen).toBeCloseTo(0.18 + 0.2, 5);
  });

  /** 4 龙渊 + 1 非龙渊友军：观察非成员吃到的全队法强/增伤 */
  const lyConfig = (): BattleConfig => ({
    seed: 13,
    units: [
      { uid: 1, defId: 'yuansu', team: 0 as const, star: 1 as const, cell: { c: 0, r: 3 } },
      { uid: 2, defId: 'aoyin', team: 0 as const, star: 1 as const, cell: { c: 1, r: 3 } },
      { uid: 3, defId: 'canglan', team: 0 as const, star: 1 as const, cell: { c: 2, r: 3 } },
      { uid: 4, defId: 'hanxing', team: 0 as const, star: 1 as const, cell: { c: 3, r: 3 } },
      { uid: 5, defId: 'pan', team: 0 as const, star: 1 as const, cell: { c: 4, r: 3 } },
      { uid: 9, defId: 'ajiu', team: 1 as const, star: 1 as const, cell: { c: 0, r: 7 } },
    ],
    traits: { 0: [{ id: 'longyuan', count: 4, tier: 1 }], 1: [] },
    maxTicks: 30,
  });

  it('4 龙渊：非成员友军获得单次 +18 法强 / +9% 技能增伤（历史 bug 会叠 4 次）', () => {
    const battle = new Battle(lyConfig(), null, true);
    const outsider = battle.unitByUid(5)!;
    const def = outsider.entry.base;
    expect(outsider.sp).toBe(def.sp + 18);
    expect(outsider.trait.skillAmp).toBeCloseTo(0.09, 5);
  });

  it('4 龙渊：成员自身 = 基础 + 30（档内）+ 18（全队），不随人数翻倍', () => {
    const battle = new Battle(lyConfig(), null, true);
    const member = battle.unitByUid(1)!;
    const def = member.entry.base;
    expect(member.sp).toBe(def.sp + 30 + 18);
  });
});
