/**
 * 战斗结算公式回归。
 *
 * 这里锁死的是"曾经出过事故"的四条契约：
 * 1. 暴击唯一结算点：dealDamage 之外的路径不得掷骰，forceCrit 只乘一次倍率。
 * 2. 真实伤害无视抗性与减伤（易伤是增伤，仍然生效——由护甲侧用例间接保障）。
 * 3. 吸血语义：普攻吸血只在 isAttack，全能吸血覆盖一切伤害。
 * 4. DoT 结算类型随状态走（山海流血 = 真伤），不能按 kind 硬编码。
 * 5. 超时判定：双方剩余生命差距 ≥ TIMEOUT_WIN_RATIO 才判胜，势均力敌为平局。
 */
import { describe, expect, it } from 'vitest';
import { RESIST_BASE, TIMEOUT_WIN_RATIO, TICK_RATE } from '../src/core/config';
import { effArmor } from '../src/core/unit';
import type { Battle } from '../src/core/battle';
import type { BattleEvent } from '../src/core/events';
import { cornerPair, mkBattle } from './helpers';

const physExpect = (raw: number, armor: number): number =>
  (raw * RESIST_BASE) / (RESIST_BASE + armor);

describe('暴击：唯一结算点', () => {
  it('未声明 canCrit 的伤害永不暴击（即便暴击率 100%）', () => {
    const b = mkBattle(cornerPair());
    const [src, dst] = b.units;
    src.critChance = 1;
    src.critMult = 2;
    const expected = physExpect(200, effArmor(dst));
    for (let i = 0; i < 20; i++) {
      dst.hp = dst.maxHp;
      expect(b.dealDamage(src, dst, 200, 'physical')).toBeCloseTo(expected, 3);
    }
  });

  it('canCrit=true 且暴击率 100% 时恰好乘一次倍率（不是平方）', () => {
    const b = mkBattle(cornerPair());
    const [src, dst] = b.units;
    src.critChance = 1;
    src.critMult = 2;
    const expected = physExpect(200, effArmor(dst)) * 2;
    expect(b.dealDamage(src, dst, 200, 'physical', { canCrit: true })).toBeCloseTo(expected, 3);
  });

  it('forceCrit=true 时暴击率为 0 也必定暴击（阿玖"本次必定暴击"语义）', () => {
    const b = mkBattle(cornerPair());
    const [src, dst] = b.units;
    src.critChance = 0;
    src.critMult = 1.5;
    const expected = physExpect(200, effArmor(dst)) * 1.5;
    expect(b.dealDamage(src, dst, 200, 'physical', { forceCrit: true })).toBeCloseTo(expected, 3);
  });

  it('canCrit=true 但暴击率 0 时 50 连击全部不暴击', () => {
    const b = mkBattle(cornerPair());
    const [src, dst] = b.units;
    src.critChance = 0;
    src.critMult = 10;
    const expected = physExpect(50, effArmor(dst));
    for (let i = 0; i < 50; i++) {
      dst.hp = dst.maxHp;
      expect(b.dealDamage(src, dst, 50, 'physical', { canCrit: true })).toBeCloseTo(expected, 3);
    }
  });
});

describe('抗性与真实伤害', () => {
  it('物理伤害严格按 RESIST_BASE/(RESIST_BASE+护甲) 减伤', () => {
    const b = mkBattle(cornerPair({ bonus: { armor: 300 } }));
    const dst = b.units[1];
    const expected = physExpect(200, effArmor(dst));
    expect(b.dealDamage(null, dst, 200, 'physical')).toBeCloseTo(expected, 3);
  });

  it('真实伤害无视巨额双抗：全额落血', () => {
    const b = mkBattle(cornerPair({ bonus: { armor: 5000, mr: 5000 } }));
    const dst = b.units[1];
    const before = dst.hp;
    expect(b.dealDamage(null, dst, 100, 'true')).toBeCloseTo(100, 4);
    expect(before - dst.hp).toBeCloseTo(100, 4);
  });

  it('护甲堆到封顶值时物理伤害被压到三成，真伤仍是全额', () => {
    const bPhys = mkBattle(cornerPair({ bonus: { armor: 100000 } }));
    const bTrue = mkBattle(cornerPair({ bonus: { armor: 100000 } }));
    const dst = bPhys.units[1];
    const phys = bPhys.dealDamage(null, dst, 100, 'physical');
    const tru = bTrue.dealDamage(null, bTrue.units[1], 100, 'true');
    // 护甲被 RESIST_CAP 封顶 → 减伤有下限；真伤完全绕开它
    expect(phys).toBeCloseTo(physExpect(100, effArmor(dst)), 3);
    expect(phys).toBeLessThan(tru * 0.5);
    expect(tru).toBeCloseTo(100, 4);
  });
});

describe('吸血语义', () => {
  it('普攻吸血只在 isAttack=true 时生效，技能伤害不吃', () => {
    const b = mkBattle(cornerPair());
    const [src, dst] = b.units;
    src.lifesteal = 0.5;
    src.omnivamp = 0;
    b.dealDamage(null, src, 300, 'true'); // 先打掉一些血，给回复留出空间
    const hp0 = src.hp;

    const dealt = b.dealDamage(src, dst, 100, 'true', { isAttack: true });
    expect(src.hp - hp0).toBeCloseTo(dealt * 0.5, 3);

    src.hp = hp0; // 重置后用技能口径再打一次
    b.dealDamage(src, dst, 100, 'true', { source: 'skill' });
    expect(src.hp).toBeCloseTo(hp0, 5);
  });

  it('全能吸血（omnivamp）对技能伤害同样生效', () => {
    const b = mkBattle(cornerPair());
    const [src, dst] = b.units;
    src.lifesteal = 0;
    src.omnivamp = 0.3;
    b.dealDamage(null, src, 300, 'true');
    const hp0 = src.hp;

    const dealt = b.dealDamage(src, dst, 100, 'true', { source: 'skill' });
    expect(src.hp - hp0).toBeCloseTo(dealt * 0.3, 3);
  });
});

describe('DoT 结算类型随状态走', () => {
  const dotEvents = (b: Battle) =>
    b.events.filter(
      (e): e is Extract<BattleEvent, { t: 'damage' }> => e.t === 'damage' && e.source === 'dot',
    );

  it('同为流血：真伤口径每跳全额，法术口径被魔抗压到约三成', () => {
    const mk = (dtype: 'true' | 'magic') => {
      const b = mkBattle(cornerPair({ bonus: { mr: 4000 } }), 77, 2 * TICK_RATE);
      b.addDot(b.units[0], b.units[1], 'bleed', 120, 2, dtype);
      b.run();
      return b;
    };
    const tru = dotEvents(mk('true'));
    const mag = dotEvents(mk('magic'));
    expect(tru.length).toBeGreaterThanOrEqual(3); // 2s 至少跳 3 次（每 0.5s 一跳）
    for (const e of tru) {
      expect(e.type).toBe('true');
      expect(e.amount).toBeCloseTo(120 * 0.5, 0); // 每跳 = dps × 半秒，无视魔抗
    }
    for (const e of mag) {
      expect(e.type).toBe('magic');
      // 魔抗 4000 被 RESIST_CAP 封顶在 220 → 每跳 ≈ 60 × 100/320
      expect(e.amount).toBeCloseTo(120 * 0.5 * (RESIST_BASE / (RESIST_BASE + 220)), 0);
    }
  });
});

describe('超时判定', () => {
  it('双方满血超时 → 平局；一方残血超时 → 对方按剩余生命判胜', () => {
    const even = mkBattle(cornerPair(), 7, TICK_RATE / 2).run();
    expect(even.timeout).toBe(true);
    expect(even.winner).toBeNull();

    const hurt = mkBattle(cornerPair(), 7, TICK_RATE / 2);
    const victim = hurt.units[1];
    hurt.dealDamage(null, victim, victim.maxHp * (TIMEOUT_WIN_RATIO + 0.1), 'true');
    const res = hurt.run();
    expect(res.timeout).toBe(true);
    expect(res.winner).toBe(0);
  });
});
