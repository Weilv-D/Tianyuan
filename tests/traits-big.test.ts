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

    battle.dealDamage(enemy, ally, 1000, 'physical', { source: 'attack' });
    expect(members.some((member) => member.takenDamage > 0)).toBe(true);

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
});
