import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { PRESET_COMPS, buildTeam } from '../src/game/comp';
import { unitInput } from './helpers';
import type { AttackModifier } from '../src/core/api';
import type { Unit } from '../src/core/unit';
import type { BattleEvent as BattleEventShape } from '../src/core/events';

/**
 * 2v4 结构边修复（DESIGN §十三，2026-08-31）的行为契约：
 *
 *  1. 木石之躯（jiguan.thornResist）：机关构装体受到"反弹类"伤害
 *     （source==='trait' 的物理反弹）按抗性削减 —— 反伤可反制条件化；
 *  2. 围攻·破阵（jiguan.gangAtk + gangTargetT2）：友军先手后机关成员
 *     跟进攻击，对「护卫羁绊达 t2」的队伍成员追加物理伤 ——
 *     火力被结构性锁定在金刚阵上，其余九边零 collateral；
 *  3. 定档数据钉：gangAtk=6 / gangTargetT2=1 / thornResist=0.65
 *     （CRN n=250 全矩阵复验，极差 22.3%→15.4%，改动依据见 DESIGN）。
 */

/** 机关成员（公输）+ 队友（木机）对 t2 金甲阵（磐挂护卫档位） */
function gangBattle(foeGuardianTier: number | null): {
  battle: Battle;
  gongshu: Unit;
  muji: Unit;
  wall: Unit;
} {
  const foeTraits =
    foeGuardianTier === null ? [] : [{ id: 'guardian', count: 6, tier: foeGuardianTier }];
  const battle = new Battle(
    {
      seed: 20260831,
      units: [
        unitInput('gongshu', 0, { c: 1, r: 6 }),
        unitInput('muji', 0, { c: 6, r: 6 }),
        unitInput('pan', 1, { c: 3, r: 1 }, { star: 2 }),
      ],
      traits: { 0: [{ id: 'jiguan', count: 2, tier: 0 }], 1: foeTraits },
      maxTicks: 180,
    },
    null,
    true,
  );
  const gongshu = battle.units.find((u) => u.entry.id === 'gongshu')!;
  const muji = battle.units.find((u) => u.entry.id === 'muji')!;
  const wall = battle.units.find((u) => u.entry.id === 'pan')!;
  // 战场退化为纯计时：全部眩晕，伤害只由测试直接驱动
  for (const u of battle.units) battle.addStatus(u, u, 'stun', 999, 0);
  return { battle, gongshu, muji, wall };
}

/** 直调机关队的 onPreAttack 钩子，返回围攻附加量 */
type HookMap = Map<number, { onPreAttack: ((api: unknown, s: Unit, d: Unit, m: AttackModifier) => void)[] }>;

function preAttackBonus(b: Battle, src: Unit, dst: Unit): number {
  const mod: AttackModifier = { forceCrit: false, bonusMagic: 0, bonusPhysical: 0 };
  const hooks = (b as unknown as { hooks: HookMap }).hooks.get(src.team)!;
  for (const fn of hooks.onPreAttack) fn(b, src, dst, mod);
  return mod.bonusPhysical;
}

describe('木石之躯：机关构装体的反弹抗性', () => {
  it('机关成员受到的荆棘反弹按 0.65 削减，非机关队友照额承受', () => {
    const battle = new Battle(
      {
        seed: 20260901,
        units: [
          unitInput('gongshu', 0, { c: 1, r: 6 }),
          unitInput('jingyu', 0, { c: 6, r: 6 }),
          unitInput('budong', 1, { c: 3, r: 1 }, { star: 2 }),
        ],
        traits: { 0: [{ id: 'jiguan', count: 2, tier: 0 }], 1: [{ id: 'guardian', count: 6, tier: 2 }] },
        maxTicks: 180,
      },
      null,
      true,
    );
    const gongshu = battle.units.find((u) => u.entry.id === 'gongshu')!;
    const jingyu = battle.units.find((u) => u.entry.id === 'jingyu')!;
    const budong = battle.units.find((u) => u.entry.id === 'budong')!;
    for (const u of battle.units) battle.addStatus(u, u, 'stun', 999, 0);
    // 定档钉：机关成员的抗性来自默认 0.65
    expect(gongshu.trait.thornResist).toBeCloseTo(0.65, 6);
    expect(jingyu.trait.thornResist).toBe(0);

    const reflect = (target: Unit): number => {
      const from = battle.events.length;
      // 反弹触发口径：机关成员【主动攻击】护卫 → 护卫的荆棘钩子（按受害者队伍分发）反弹
      battle.dealDamage(target, budong, 1000, 'physical', { source: 'attack' });
      for (let i = battle.events.length - 1; i >= from; i--) {
        const e = battle.events[i] as Extract<BattleEventShape, { t: 'damage' }>;
        if (e.t === 'damage' && e.srcUid === budong.uid && e.dstUid === target.uid && e.source === 'trait') {
          return e.amount;
        }
      }
      return 0;
    };
    const onGongshu = reflect(gongshu);
    const onJingyu = reflect(jingyu);
    expect(onJingyu).toBeGreaterThan(0);
    expect(onGongshu).toBeGreaterThan(0);
    // 构装体承受的反弹显著低于非构装体（比值 ≈ 0.35，落在甲差扰动带内）
    expect(onGongshu / onJingyu).toBeGreaterThan(0.15);
    expect(onGongshu / onJingyu).toBeLessThan(0.5);
  });
});

describe('围攻·破阵：追加火力锁定在 t2 金甲阵', () => {
  it('友军先手后跟进攻击 t2 护卫目标 → 追加物理伤', () => {
    const { battle, gongshu, muji, wall } = gangBattle(2);
    // 队友木机先动了手（dealDamage 驱动 recorder）
    battle.dealDamage(muji, wall, 10, 'physical', { source: 'attack' });
    expect(preAttackBonus(battle, gongshu, wall)).toBeGreaterThan(0);
  });

  it('无队友先手 → 无追加（围攻不是无条件的常驻增伤）', () => {
    const { battle, gongshu, wall } = gangBattle(2);
    expect(preAttackBonus(battle, gongshu, wall)).toBe(0);
  });

  it('自己先手不算围攻（必须"另一名"友军）', () => {
    const { battle, gongshu, wall } = gangBattle(2);
    battle.dealDamage(gongshu, wall, 10, 'physical', { source: 'attack' });
    expect(preAttackBonus(battle, gongshu, wall)).toBe(0);
  });

  it('目标队伍护卫未达 t2（后期/亡语的单前排）→ 破阵不触发（collateral 隔离）', () => {
    const { battle, gongshu, muji, wall } = gangBattle(0);
    battle.dealDamage(muji, wall, 10, 'physical', { source: 'attack' });
    expect(preAttackBonus(battle, gongshu, wall)).toBe(0);
  });

  it('目标队伍无护卫 → 不触发', () => {
    const { battle, gongshu, muji, wall } = gangBattle(null);
    battle.dealDamage(muji, wall, 10, 'physical', { source: 'attack' });
    expect(preAttackBonus(battle, gongshu, wall)).toBe(0);
  });
});

describe('2v4 定档数据钉', () => {
  it('机关成员定档：thornResist 0.65（tuning 表为空的生产默认）', () => {
    const a = buildTeam(PRESET_COMPS[4], 0, 1);
    // 镜像对手必须走 buildTeam 的 team=1 路径（uid 换段、行翻到上半场）——
    // 旧写法直接复制 a.inputs 只换 team 号，uid 与格子双重冲突，
    // 在 B4 输入校验（battle.ts 构造抛错）落地后显式暴露
    const b = buildTeam(PRESET_COMPS[4], 1, 101);
    const battle = new Battle(
      { seed: 1, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } },
      null,
      true,
    );
    const gongshu = battle.units.find((u) => u.entry.id === 'gongshu')!;
    expect(gongshu.trait.thornResist).toBeCloseTo(0.65, 6);
  });

  it('荆棘 t2 卸甲保持关闭（t2ArmorCut 默认 0，曾两轮 A/B 证伪）', () => {
    // 定档通过行为断言：t2 成员 baseArmor = 基础 + armor2 全额（无 cut）
    const battle = new Battle(
      {
        seed: 2,
        units: [unitInput('budong', 0, { c: 3, r: 6 }, { star: 2 })],
        traits: { 0: [{ id: 'guardian', count: 6, tier: 2 }], 1: [] },
        maxTicks: 60,
      },
      null,
      true,
    );
    const budong = battle.units.find((u) => u.entry.id === 'budong')!;
    // 不动二星基础甲 48，t2 全额 +32（cut=0）
    expect(budong.baseArmor).toBe(48 + 32);
  });
});
