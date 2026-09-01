import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import type { BattleConfig } from '../src/core/types';

const MOMEN = ['moyan', 'yunchu', 'chiji', 'guicheng', 'xuanji', 'baitao', 'yusuan', 'moliu', 'mozhai'];

function momenBattle(): Battle {
  const config: BattleConfig = {
    seed: 20260829,
    units: [
      ...MOMEN.map((defId, index) => ({
        uid: 10 + index,
        defId,
        team: 0 as const,
        star: 1 as const,
        cell: { c: index % 4, r: Math.floor(index / 4) },
      })),
      { uid: 30, defId: 'duanyue', team: 0, star: 1, cell: { c: 4, r: 0 } },
      { uid: 90, defId: 'ajiu', team: 1, star: 1, cell: { c: 4, r: 7 } },
    ],
    traits: { 0: [{ id: 'momen', count: 9, tier: 2 }], 1: [] },
    maxTicks: 600,
  };
  return new Battle(config, null, false);
}

describe('大羁绊玩法', () => {
  it('墨门会替非成员队友分担伤害，且不会递归扩散', () => {
    const battle = momenBattle();
    const ally = battle.unitByUid(30)!;
    const enemy = battle.unitByUid(90)!;
    const members = MOMEN.map((_, index) => battle.unitByUid(10 + index)!);

    // 输入 500：端岳 1★（甲 24 / 血 700）结算后 ≈371，远低于生命 —— 两边都不触发
    // 「final 只计实际扣血」的过量钳制，70/30 比例断言与钳制语义解耦（钳制若改回
    // 全额口径本测试同样成立）。
    const allyLoss = battle.dealDamage(enemy, ally, 500, 'physical', { source: 'attack' });
    const sharedLoss = members.reduce((sum, member) => sum + member.takenDamage, 0);

    const noShare = momenBattle();
    const baselineAlly = noShare.unitByUid(30)!;
    const baselineLoss = noShare.dealDamage(noShare.unitByUid(90)!, baselineAlly, 500, 'physical', { source: 'attack', noShare: true });

    expect(allyLoss).toBeCloseTo(baselineLoss * 0.7, 4);
    expect(sharedLoss).toBeGreaterThan(0);
    expect(allyLoss + sharedLoss).toBeLessThan(baselineLoss);

    const second = momenBattle();
    second.dealDamage(second.unitByUid(90)!, second.unitByUid(10)!, 1000, 'physical', { source: 'attack' });
    expect(MOMEN.slice(1).every((_, index) => second.unitByUid(11 + index)!.takenDamage === 0)).toBe(true);
  });

  it('兵家完成击杀后获得永久成长', () => {
    const battle = new Battle({
      seed: 42,
      units: [
        { uid: 1, defId: 'zhenfeng', team: 0, star: 2, cell: { c: 0, r: 3 } },
        { uid: 9, defId: 'ajiu', team: 1, star: 1, cell: { c: 0, r: 7 } },
      ],
      traits: { 0: [{ id: 'bingjia', count: 8, tier: 2 }], 1: [] },
      maxTicks: 600,
    }, null, false);
    const unit = battle.unitByUid(1)!;
    const attackBefore = unit.permAtkPct;
    battle.run();
    expect(battle.unitByUid(9)!.alive).toBe(false);
    expect(unit.permAtkPct).toBeGreaterThan(attackBefore);
    expect(unit.permAspdPct).toBeGreaterThan(0);
  });

  it('最后一名幽冥成员阵亡时仍会触发自身复活', () => {
    const battle = new Battle({
      seed: 43,
      units: [
        { uid: 1, defId: 'yeyou', team: 0, star: 1, cell: { c: 0, r: 6 } },
        { uid: 9, defId: 'jingyu', team: 1, star: 1, cell: { c: 7, r: 1 } },
      ],
      traits: { 0: [{ id: 'youming', count: 4, tier: 1 }], 1: [] },
      maxTicks: 600,
    }, null, false);
    const victim = battle.unitByUid(1)!;

    battle.dealDamage(battle.unitByUid(9)!, victim, victim.maxHp * 2, 'true');

    expect(victim.alive).toBe(true);
    expect(victim.traitStacks['youmingRevived']).toBe(1);
  });

  it('召唤物阵亡不触发幽冥亡语回血（亡语只认棋子本体）', () => {
    const battle = new Battle({
      seed: 44,
      units: [
        { uid: 1, defId: 'yeyou', team: 0, star: 1, cell: { c: 0, r: 6 } },
        { uid: 2, defId: 'yeyou', team: 0, star: 1, cell: { c: 1, r: 6 } },
        { uid: 9, defId: 'jingyu', team: 1, star: 1, cell: { c: 7, r: 1 } },
      ],
      traits: { 0: [{ id: 'youming', count: 2, tier: 0 }], 1: [] },
      maxTicks: 600,
    }, null, false);
    const ally = battle.unitByUid(1)!;
    const minion = battle.summon(battle.unitByUid(2)!, { c: 2, r: 6 }, 0.5, 0.5)!;
    expect(minion.isMinion).toBe(true);

    const hpBefore = ally.hp;
    minion.hp = 1;
    battle.dealDamage(battle.unitByUid(2)!, minion, 1e9, 'true');
    expect(minion.alive).toBe(false);
    // 若亡语把召唤物当「阵亡棋子」，最近友军会回 6% 召唤物最大生命
    expect(ally.hp).toBe(hpBefore);
  });

  it('召唤物阵亡不喂丹师攻速叠层', () => {
    const battle = new Battle({
      seed: 45,
      units: [
        { uid: 1, defId: 'qinghe', team: 0, star: 1, cell: { c: 0, r: 6 } },
        { uid: 2, defId: 'baitao', team: 0, star: 1, cell: { c: 1, r: 6 } },
        { uid: 9, defId: 'jingyu', team: 1, star: 1, cell: { c: 7, r: 1 } },
      ],
      traits: { 0: [{ id: 'support', count: 2, tier: 1 }], 1: [] },
      maxTicks: 600,
    }, null, false);
    const minion = battle.summon(battle.unitByUid(1)!, { c: 2, r: 6 }, 0.5, 0.5)!;
    battle.dealDamage(battle.unitByUid(2)!, minion, 1e9, 'true');
    expect(minion.alive).toBe(false);
    for (const uid of [1, 2]) {
      const u = battle.unitByUid(uid)!;
      expect(u.traitStacks['supportAspdStacks'] ?? 0).toBe(0);
      expect(u.statuses.some((s) => s.kind === 'aspdUp')).toBe(false);
    }
  });
});
