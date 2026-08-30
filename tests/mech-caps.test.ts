import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { MECH, TICK_RATE } from '../src/core/config';
import { cornerPair, mkBattle, unitInput } from './helpers';
import type { BattleEvent } from '../src/core/events';
import type { Unit } from '../src/core/unit';

/**
 * M2「机制软化」回归测试。
 *
 * MECH 默认全禁用（0/1/0，回退依据见 config.ts 注释）——机制本身仍须钉死契约，
 * 因此各用例经 withMech 显式启用后断言，结束恢复默认：
 *  1. type==='true' 的单次伤害在结算后钳制到 dst.maxHp × MECH.trueHitCapRatio；
 *  2. 处决类技能的斩杀一跳（DamageOptions.ignoreTrueCap）豁免上限，仍可击杀；
 *  3. 荆棘反射同一秒内逐跳衰减：第 n 跳 = 基础值 × thornDecayPerHit^(n-1)；
 *  4. 同一护卫每秒反射总输出封顶于 maxHp × thornSecCapHpRatio，超出截断，
 *     且计数以 tick 界重置（tick % TICK_RATE === 0），不涉墙钟。
 */

/** 临时覆盖 MECH 字段跑断言，结束逐字段恢复默认值 */
function withMech(values: Partial<Record<keyof typeof MECH, number>>, fn: () => void): void {
  const prev: Record<string, number> = {};
  for (const k of Object.keys(values) as (keyof typeof MECH)[]) prev[k] = MECH[k];
  Object.assign(MECH, values);
  try {
    fn();
  } finally {
    Object.assign(MECH, prev);
  }
}

/** 无羁绊的 1v1：磐（近战）对 惊羽（远程），对角摆放，不 step 则互不干扰 */
function plainPair(): { battle: Battle; src: Unit; dst: Unit } {
  const battle = mkBattle(cornerPair());
  return {
    battle,
    src: battle.units.find((u) => u.team === 0)!,
    dst: battle.units.find((u) => u.team === 1)!,
  };
}

/**
 * 护卫（磐 · 二星）对 惊羽。磐挂护卫二档（tier 2）→ 注册荆棘反射钩子。
 * 惊羽被眩晕 + 缴械，磐被沉默 —— 战场自主行为退化为纯计时，
 * 反射只由测试直接驱动的 dealDamage 触发，断言不受自主攻击污染。
 */
function guardianPair(): { battle: Battle; guardian: Unit; foe: Unit } {
  const battle = new Battle(
    {
      seed: 20260830,
      units: [
        unitInput('pan', 0, { c: 0, r: 6 }, { star: 2 }),
        unitInput('jingyu', 1, { c: 7, r: 1 }),
      ],
      traits: { 0: [{ id: 'guardian', count: 2, tier: 2 }], 1: [] },
      maxTicks: 180,
    },
    null,
    true,
  );
  const guardian = battle.units.find((u) => u.team === 0)!;
  const foe = battle.units.find((u) => u.team === 1)!;
  battle.addStatus(foe, foe, 'stun', 999, 0);
  battle.addStatus(foe, foe, 'disarm', 999, 0);
  battle.addStatus(guardian, guardian, 'silence', 999, 0);
  return { battle, guardian, foe };
}

/** 窗口内最后一条"护卫反弹"伤害事件金额（source='trait' && type='physical'） */
function lastReflect(b: Battle, guardianUid: number, fromEventIdx: number): number | null {
  for (let i = b.events.length - 1; i >= fromEventIdx; i--) {
    const e = b.events[i] as Extract<BattleEvent, { t: 'damage' }>;
    if (e.t !== 'damage') continue;
    if (e.srcUid === guardianUid && e.source === 'trait' && e.type === 'physical') return e.amount;
  }
  return null;
}

/** 驱动一次"敌人物理攻击护卫"，返回本次触发的反射金额（未触发返回 null） */
function hitAndReflect(p: { battle: Battle; guardian: Unit; foe: Unit }, raw = 500): number | null {
  const from = p.battle.events.length;
  p.battle.dealDamage(p.foe, p.guardian, raw, 'physical', { source: 'attack' });
  return lastReflect(p.battle, p.guardian.uid, from);
}

describe('M2 机制软化：真伤单跳上限', () => {
  it('超限真伤被钳制到 MECH.trueHitCapRatio × dst.maxHp', () => {
    withMech({ trueHitCapRatio: 0.3 }, () => {
      const { battle, src, dst } = plainPair();
      const cap = dst.maxHp * MECH.trueHitCapRatio;
      const dealt = battle.dealDamage(src, dst, cap * 5 + 1234, 'true');
      // 无护盾无增益 → 结算值即钳制值
      expect(dealt).toBeCloseTo(cap, 6);
      expect(dst.hp).toBeCloseTo(dst.maxHp - cap, 6);
    });
  });

  it('未超限的真伤原样结算（不受上限影响）', () => {
    withMech({ trueHitCapRatio: 0.3 }, () => {
      const { battle, src, dst } = plainPair();
      const sub = dst.maxHp * MECH.trueHitCapRatio * 0.5;
      const dealt = battle.dealDamage(src, dst, sub, 'true');
      expect(dealt).toBeCloseTo(sub, 6);
    });
  });

  it('默认 0 = 不设上限：大额真伤原样结算（禁用态无操作）', () => {
    const { battle, src, dst } = plainPair();
    expect(MECH.trueHitCapRatio).toBe(0);
    const dealt = battle.dealDamage(src, dst, dst.maxHp * 3, 'true');
    expect(dealt).toBeCloseTo(dst.maxHp * 3, 6);
  });

  it('物理伤害不适用真伤上限（超限物理照常穿透）', () => {
    withMech({ trueHitCapRatio: 0.3 }, () => {
      const { battle, src, dst } = plainPair();
      const cap = dst.maxHp * MECH.trueHitCapRatio;
      const dealt = battle.dealDamage(src, dst, 99999, 'physical');
      // 物理走抗性公式但绝不被 30% 档钳制：若被误钳则不可能超过 cap
      expect(dealt).toBeGreaterThan(cap);
      expect(dst.alive).toBe(false);
    });
  });

  it('处决豁免一跳（ignoreTrueCap）无视上限，满血目标也可击杀', () => {
    withMech({ trueHitCapRatio: 0.3 }, () => {
      const { battle, src, dst } = plainPair();
      // 与 execute 技能同构的斩杀原始值：hp + shield + 9999
      const raw = dst.hp + dst.shield + 9999;
      const dealt = battle.dealDamage(src, dst, raw, 'true', { ignoreTrueCap: true });
      expect(dealt).toBeGreaterThan(dst.maxHp * MECH.trueHitCapRatio);
      expect(dst.alive).toBe(false);
    });
  });

  it('对照：同一原始值不带豁免时被钳制，不足以击杀满血目标', () => {
    withMech({ trueHitCapRatio: 0.3 }, () => {
      const { battle, src, dst } = plainPair();
      const raw = dst.hp + dst.shield + 9999;
      battle.dealDamage(src, dst, raw, 'true');
      expect(dst.alive).toBe(true);
      expect(dst.hp).toBeCloseTo(dst.maxHp * (1 - MECH.trueHitCapRatio), 6);
    });
  });
});

describe('M2 机制软化：荆棘反射衰减与封顶', () => {
  it('同一秒内第二跳反射严格小于第一跳，比例 = thornDecayPerHit', () => {
    withMech({ thornDecayPerHit: 0.6 }, () => {
      const p = guardianPair();
      const r1 = hitAndReflect(p);
      const r2 = hitAndReflect(p);
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r2!).toBeLessThan(r1!);
      // 反射金额经目标护甲结算，但同秒内减伤系数不变，比例应精确等于衰减系数
      expect(r2! / r1!).toBeCloseTo(MECH.thornDecayPerHit, 1);
    });
  });

  it('默认 1 = 无衰减：同秒连跳金额不变（禁用态无操作）', () => {
    const p = guardianPair();
    expect(MECH.thornDecayPerHit).toBe(1);
    const r1 = hitAndReflect(p);
    const r2 = hitAndReflect(p);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r2).toBe(r1);
  });

  it('每秒反射封顶：一秒内累计反射输出 ≤ maxHp × thornSecCapHpRatio，超出直接截断', () => {
    const p = guardianPair();
    // 封顶压到"半跳满额反射"对应的血量比例 → 第一跳即触及预算上限
    const fullHit = p.guardian.baseArmor * 0.52; // 与 guardian 实现同源的默认 thornsArmorRatio
    withMech({ thornSecCapHpRatio: (fullHit * 0.5) / p.guardian.maxHp }, () => {
      const amounts: number[] = [];
      for (let i = 0; i < 4; i++) amounts.push(hitAndReflect(p) ?? 0);
      const cap = p.guardian.maxHp * MECH.thornSecCapHpRatio;
      const sum = amounts.reduce((s, x) => s + x, 0);
      expect(amounts[0]).toBeGreaterThan(0);
      expect(sum).toBeLessThanOrEqual(cap + 1); // 事件金额为整数舍入，留 1 点容差
      expect(amounts[1]).toBe(0); // 预算耗尽后不再发出反射 —— 截断，而非延迟到下一秒
      expect(amounts[2]).toBe(0);
      expect(amounts[3]).toBe(0);
    });
  });

  it('默认 0 = 不封顶：同秒多跳全部满额（禁用态无操作，与 M1 行为逐位一致）', () => {
    const p = guardianPair();
    expect(MECH.thornSecCapHpRatio).toBe(0);
    const r1 = hitAndReflect(p);
    expect(hitAndReflect(p)).toBe(r1);
    expect(hitAndReflect(p)).toBe(r1);
  });

  it('跨秒重置：tick 界（tick % TICK_RATE === 0）后反射恢复满额', () => {
    withMech({ thornDecayPerHit: 0.6 }, () => {
      const p = guardianPair();
      const r1 = hitAndReflect(p);
      hitAndReflect(p); // 第二跳：衰减生效
      const r2 = hitAndReflect(p);
      expect(r2!).toBeLessThan(r1!);
      // 推进到下一个 tick 界 —— step() 开头的 onTick 在 tick % TICK_RATE === 0 时清零计数
      while (p.battle.tick % TICK_RATE !== 0 || p.battle.tick === 0) p.battle.step();
      const r3 = hitAndReflect(p);
      // 新的一秒：第一跳恢复满额，与跨秒前第一跳完全一致（同时点无余烬增伤）
      expect(r3).toBe(r1);
    });
  });
});
