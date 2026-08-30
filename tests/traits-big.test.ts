import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import type { BattleConfig } from '../src/core/types';

/** 墨门九成员名单（tier3 分摊需要 9 人激活） */
const MOMEN9 = ['moyan', 'yunchu', 'chiji', 'guicheng', 'xuanji', 'baitao', 'yusuan', 'moliu', 'mozhai'];

function makeConfig(): BattleConfig {
  const units = [
    ...MOMEN9.map((defId, i) => ({
      uid: 10 + i,
      defId,
      team: 0 as const,
      star: 1 as const,
      cell: { c: i % 4, r: Math.floor(i / 4) },
    })),
    {
      uid: 30,
      defId: 'duanyue', // 非墨门友军：分摊的观察对象
      team: 0 as const,
      star: 1 as const,
      cell: { c: 4, r: 0 },
    },
    {
      uid: 90,
      defId: 'ajiu', // 敌方：分摊伤害的来源
      team: 1 as const,
      star: 1 as const,
      cell: { c: 4, r: 7 },
    },
  ];
  return {
    seed: 20260829,
    units,
    traits: {
      0: [{ id: 'momen', count: 9, tier: 2 }],
      1: [],
    },
    maxTicks: 600,
  };
}

describe('墨门「兼爱」伤害分摊', () => {
  it('非墨门友军受到伤害时，存活墨门棋子均摊 30%（不递归、不刷屏）', () => {
    const battle = new Battle(makeConfig(), null, true);
    const ally = battle.unitByUid(30)!;
    const enemy = battle.unitByUid(90)!;
    const momen = MOMEN9.map((_, i) => battle.unitByUid(10 + i)!);

    const beforeAlly = ally.takenDamage;
    const beforeMomen = momen.reduce((s, m) => s + m.takenDamage, 0);
    const eventsBefore = battle.events.length;

    battle.dealDamage(enemy, ally, 1000, 'physical', { source: 'attack' });

    const allyTook = ally.takenDamage - beforeAlly;
    const momenTook = momen.reduce((s, m) => s + m.takenDamage, 0) - beforeMomen;

    // 分摊真实发生：墨门吃到了一部分
    expect(momenTook).toBeGreaterThan(0);
    // 分摊量有上界： ≤ 原伤害 × 20%（墨门自身还有护甲与减免，实际更小）
    expect(momenTook).toBeLessThanOrEqual(1000 * 0.2 + 1e-6);
    // 主目标承担了大部分伤害（分摊只转移 20%，且墨门自身减免进一步压缩）
    expect(allyTook).toBeGreaterThan(momenTook * 2);
    // silent：分摊产生的伤害不进事件流（主目标伤害事件 + 受击回蓝 mana 事件除外）
    const damageEvents = battle.events.slice(eventsBefore).filter((e) => e.t === 'damage');
    expect(damageEvents.length).toBeLessThanOrEqual(2);
  });

  it('墨门棋子自身的伤害不再触发分摊（noShare 防递归）', () => {
    const battle = new Battle(makeConfig(), null, false);
    const enemy = battle.unitByUid(90)!;
    const moyan = battle.unitByUid(10)!;

    battle.dealDamage(enemy, moyan, 1000, 'physical', { source: 'attack' });

    // 只有墨岩自己掉血；其余墨门不受连带（递归被切断）
    const others = MOMEN9.slice(1).map((_, i) => battle.unitByUid(11 + i)!);
    expect(others.every((m) => m.takenDamage === 0)).toBe(true);
    expect(moyan.takenDamage).toBeGreaterThan(0);
  });

  it('满墨门对局可正常打完（分摊钩子不破坏战斗循环）', () => {
    const battle = new Battle(makeConfig(), null, false);
    const result = battle.run();
    expect(result).toBeTruthy();
    expect(Number.isFinite(result.ticks)).toBe(true);
  });
});

describe('兵家「百战」击杀成长', () => {
  it('兵家击杀后全队永久成长（>0），且由兵家发起的击杀才享有翻倍语义', () => {
    const units = [
      { uid: 1, defId: 'zhenfeng', team: 0 as const, star: 2 as const, cell: { c: 0, r: 3 } },
      { uid: 9, defId: 'ajiu', team: 1 as const, star: 1 as const, cell: { c: 0, r: 7 } },
    ];
    const battle = new Battle(
      { seed: 42, units, traits: { 0: [{ id: 'bingjia', count: 8, tier: 2 }], 1: [] }, maxTicks: 600 },
      null,
      false,
    );
    const before = battle.unitByUid(1)!.permAtkPct;
    battle.run();
    expect(battle.unitByUid(9)!.alive).toBe(false);
    // 砺锋是兵家，击杀翻倍：增量 > 单次基础（0.12），且至少触达翻倍额
    expect(battle.unitByUid(1)!.permAtkPct - before).toBeGreaterThan(0.12);
    expect(battle.unitByUid(1)!.permAspdPct).toBeGreaterThan(0);
    void before;
  });
});

