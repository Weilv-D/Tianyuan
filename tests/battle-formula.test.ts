import { describe, expect, it } from 'vitest';
import { SHIELD_CAP_RATIO, TIMEOUT_WIN_RATIO, TICK_RATE } from '../src/core/config';
import { Battle } from '../src/core/battle';
import { cornerPair, mkBattle } from './helpers';

describe('玩家可感知的战斗规则', () => {
  it('物理、真实、暴击和持续伤害保持各自结算语义', () => {
    const physicalBattle = mkBattle(cornerPair({ bonus: { armor: 5000, mr: 5000 } }));
    const trueBattle = mkBattle(cornerPair({ bonus: { armor: 5000, mr: 5000 } }));

    const physical = physicalBattle.dealDamage(null, physicalBattle.units[1], 100, 'physical');
    const trueDamage = trueBattle.dealDamage(null, trueBattle.units[1], 100, 'true');

    expect(physical).toBeLessThan(trueDamage);
    expect(trueDamage).toBeCloseTo(100, 4);

    const criticalBattle = mkBattle(cornerPair());
    const [attacker, target] = criticalBattle.units;
    attacker.critChance = 1;
    attacker.critMult = 2;
    const normal = criticalBattle.dealDamage(attacker, target, 100, 'physical');
    target.hp = target.maxHp;
    const critical = criticalBattle.dealDamage(attacker, target, 100, 'physical', { canCrit: true });
    expect(critical).toBeCloseTo(normal * attacker.critMult, 3);

    const dotTotal = (type: 'true' | 'magic'): number => {
      const battle = mkBattle(cornerPair({ bonus: { mr: 5000 } }), 77, 2 * TICK_RATE);
      battle.addDot(battle.units[0], battle.units[1], 'bleed', 120, 2, type);
      battle.run();
      let total = 0;
      for (const event of battle.events) {
        if (event.t === 'damage' && event.source === 'dot') total += event.amount;
      }
      return total;
    };
    expect(dotTotal('true')).toBe(240);
    expect(dotTotal('true')).toBeGreaterThan(dotTotal('magic'));
  });

  it('普攻吸血只治疗普攻，全能吸血也治疗技能伤害', () => {
    const battle = mkBattle(cornerPair());
    const [src, dst] = battle.units;
    battle.dealDamage(null, src, 300, 'true');
    const woundedHp = src.hp;

    src.lifesteal = 0.5;
    const attackDamage = battle.dealDamage(src, dst, 100, 'true', { isAttack: true });
    expect(src.hp - woundedHp).toBeCloseTo(attackDamage * 0.5, 3);

    src.hp = woundedHp;
    src.lifesteal = 0;
    src.omnivamp = 0.3;
    const skillDamage = battle.dealDamage(src, dst, 100, 'true', { source: 'skill' });
    expect(src.hp - woundedHp).toBeCloseTo(skillDamage * 0.3, 3);
  });

  it('护盾达到上限时事件只报告实际增加量', () => {
    const battle = mkBattle(cornerPair());
    const target = battle.units[1];
    target.shield = target.maxHp * SHIELD_CAP_RATIO - 41;

    battle.addShield(null, target, 328, 5);

    const events = battle.drainEvents();
    const event = events.find((candidate) => candidate.t === 'shield');
    expect(event?.amount).toBe(41);
    expect(event?.total).toBe(Math.round(target.shield));
    const status = events.find((candidate) => candidate.t === 'status' && candidate.kind === 'shield');
    expect(status?.t).toBe('status');
    if (status?.t !== 'status') throw new Error('缺少护盾状态事件');
    expect(status.value).toBe(Math.round(target.shield));
  });

  it('超时按双方存活生命判定，势均力敌时平局', () => {
    const even = mkBattle(cornerPair(), 7, TICK_RATE / 2).run();
    expect(even.timeout).toBe(true);
    expect(even.winner).toBeNull();

    const hurt = mkBattle(cornerPair(), 7, TICK_RATE / 2);
    const victim = hurt.units[1];
    hurt.dealDamage(null, victim, victim.maxHp * (TIMEOUT_WIN_RATIO + 0.1), 'true');
    expect(hurt.run().winner).toBe(0);

    const summoned = mkBattle(cornerPair(), 7, 1);
    const enemyChampion = summoned.units[1];
    summoned.summon(enemyChampion, { c: 6, r: 1 }, 1, 1);
    enemyChampion.hp = 0;
    enemyChampion.alive = false;
    summoned.step();
    expect(summoned.result?.timeout).toBe(true);
    expect(summoned.result?.winner).toBe(0);

    const minionOnly = mkBattle(cornerPair(), 8, TICK_RATE);
    const [summoner, lastEnemy] = minionOnly.units;
    expect(minionOnly.summon(summoner, { c: 1, r: 6 }, 1, 1)).not.toBeNull();
    minionOnly.dealDamage(null, summoner, summoner.maxHp * 2, 'true');
    minionOnly.dealDamage(null, lastEnemy, lastEnemy.maxHp * 2, 'true');
    minionOnly.step();
    expect(minionOnly.result?.timeout).toBe(false);
    expect(minionOnly.result?.winner).toBeNull();
  });

  it('损坏的战斗阵容在开战前被拒绝', () => {
    const duplicated = cornerPair();
    duplicated[1] = { ...duplicated[1], uid: duplicated[0].uid };
    expect(() => mkBattle(duplicated)).toThrow();

    expect(() => new Battle({
      seed: 1,
      units: [
        { uid: 1, defId: 'pan', team: 0, star: 1, cell: { c: 0, r: 0 } },
        { uid: 2, defId: 'ajiu', team: 1, star: 1, cell: { c: 0, r: 0 } },
      ],
      traits: { 0: [], 1: [] },
    })).toThrow();
  });
});
