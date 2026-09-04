import { describe, expect, it } from 'vitest';
import { SHIELD_CAP_RATIO, TIMEOUT_WIN_RATIO, TICK_RATE } from '../src/core/config';
import { Battle } from '../src/core/battle';
import { cornerPair, mkBattle } from './helpers';
import { skillDamage } from '../src/core/skills';

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

  it('部分吸收后 shield 状态 value 同步为剩余总量', () => {
    const battle = mkBattle(cornerPair());
    const target = battle.units[1];
    battle.addShield(null, target, target.maxHp * SHIELD_CAP_RATIO, 30);
    // 打掉大半盾（不清零）：unit.shield 扣减，shield 状态 value 必须同步扣减
    const dealt = battle.dealDamage(null, target, target.shield * 0.6, 'true');
    expect(dealt).toBeGreaterThan(0);
    const st = target.statuses.find((s) => s.kind === 'shield');
    expect(st?.value).toBeCloseTo(target.shield, 6);
    // 残余状态 value 仍 = 当前总量：此后继续吸收也不漂移
    const dealt2 = battle.dealDamage(null, target, 1, 'true');
    const st2 = target.statuses.find((s) => s.kind === 'shield');
    expect(dealt2).toBe(1);
    expect(st2?.value).toBeCloseTo(target.shield, 6);
  });

  it('护盾被完全打破时 shield 状态一并移除', () => {
    const battle = mkBattle(cornerPair());
    const target = battle.units[1];
    battle.addShield(null, target, target.maxHp * 0.3, 30);
    battle.dealDamage(null, target, target.shield + 5, 'true');
    expect(target.shield).toBe(0);
    expect(target.statuses.some((s) => s.kind === 'shield')).toBe(false);
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

describe('治疗与暴击的记账口径', () => {
  it('自体治疗单计；异体治疗各记其位；复活量计入 healed', () => {
    const b = mkBattle(cornerPair());
    const [a, d] = b.units;
    // 自体（吸血/自奶）是同一条治疗：dst 计收治、src 不再重复记产出 ——
    // 双记会让结算面板的治疗量虚高一倍
    a.hp = 10;
    const selfGain = b.heal(a, a, 100, 'skill');
    expect(a.healed).toBeCloseTo(selfGain, 4);
    // 异体：收治记在受者、产出记在施者
    d.hp = 10;
    const otherGain = b.heal(a, d, 100, 'skill');
    expect(d.healed).toBeCloseTo(otherGain, 4);
    expect(a.healed).toBeCloseTo(selfGain + otherGain, 4);
    // 复活复用 heal 事件做表现，统计侧必须同账（影响全部复活通道）
    const before = a.healed;
    a.alive = false;
    b.revive(a, 0.5, d);
    expect(a.healed).toBeCloseTo(before + a.hp, 4);
    expect(d.healed).toBeCloseTo(otherGain + a.hp, 4); // 自体那份只记在 a 自己身上
  });

  it('术士真伤拆分的技能只掷一颗暴击骰，两段共享同一判定', () => {
    const b = mkBattle(cornerPair());
    const [caster, target] = b.units;
    caster.trait.skillTrueRatio = 0.3;
    caster.trait.skillCritChance = 1; // 必暴：判定次数与两段判定值都可精确断言
    let rolls = 0;
    const orig = b.rng.next.bind(b.rng);
    b.rng.next = () => {
      rolls++;
      return orig();
    };
    const dealt = skillDamage(b, caster, target, 100, 'magic');
    // 旧实现拆成两段各掷一次（rolls=2），可出现"半爆"且实际暴击覆盖翻倍
    expect(rolls).toBe(1);
    const segments = b.drainEvents().filter((e) => e.t === 'damage' && e.source === 'skill');
    expect(segments).toHaveLength(2); // 真伤段 + 原类型段
    expect(segments.every((e) => e.t === 'damage' && e.crit === true)).toBe(true);
    expect(dealt).toBeGreaterThan(0);
  });

  it('scheduleRevive/addZone 的非法数值入队即抛（拖到兑现时才炸就不是边界即抛）', () => {
    const b = mkBattle(cornerPair());
    const [a] = b.units;
    // NaN 延迟会造出 atTick=NaN 的永不到期条目：pendingRevives 悬空、checkEnd 永不终局
    expect(() => b.scheduleRevive(a, NaN, 0.5)).toThrow();
    expect(() => b.scheduleRevive(a, 2, Number.NaN)).toThrow();
    // NaN dps 会在 zone tick 循环中途被 dealDamage 拦下，此前已命中的敌人构成部分提交
    expect(() => b.addZone({ cell: a.cell, radius: 1, dur: 2, srcUid: a.uid, team: a.team, dps: Number.NaN, type: 'magic' })).toThrow();
    expect(() => b.addZone({ cell: a.cell, radius: -1, dur: 2, srcUid: a.uid, team: a.team, dps: 10, type: 'magic' })).toThrow();
  });

  it('无技能暴击来源时不额外消耗随机流', () => {
    const b = mkBattle(cornerPair());
    const [caster, target] = b.units;
    caster.trait.skillTrueRatio = 0.3; // 有拆分、无惊雷锤
    let rolls = 0;
    const orig = b.rng.next.bind(b.rng);
    b.rng.next = () => {
      rolls++;
      return orig();
    };
    skillDamage(b, caster, target, 100, 'magic');
    expect(rolls).toBe(0);
  });
});
