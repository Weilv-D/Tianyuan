import { describe, expect, it, afterEach } from 'vitest';
import { Battle } from '../src/core/battle';
import { resetTuning, TRAIT_TUNING_KEYS } from '../src/data/tuning';
import { CHAMPION_BY_ID } from '../src/data/champions';
import { effArmor } from '../src/core/unit';
import type { BattleConfig, BattleUnitInput } from '../src/core/types';

/**
 * 机关第 4 击通道回归（M 残留专项 + N 残留专项）。
 *
 * 量化结论（scripts/ab-pair.ts，CRN n=250，patch trait.jiguan.pen 扫档）：
 * 「机关→荆棘」边对穿甲全档不敏感（0.10~0.85 一律 0.0p；单场总输出实测
 * 仅 +20.5% @0.85，距翻盘悬崖 ~+37% 不足），同时非目标边剧烈移动
 * （0.85 档「机关→亡语」+58.4p）—— 故默认 0（冬眠），不作为 2v4 修复杠杆。
 * 本文件钉住通道行为本身：
 *   1. 二档起（tier 1）成员获得 armorPen；首档（tier 0）不获得
 *   2. 羁绊层 0.85 封顶（与 battle.ts 结算处的 min(0.85) 双保险）
 *   3. 非机关成员不受（不外溢全队）
 *   4. 默认冬眠：不写调参表时战斗结果与历史一致
 *
 * N 残留专项在此接续试配两根"输出构成置换"结构附加通道
 * （fourthHitGiant = 巨型杀手：第 4 击按 dst.maxHp×k 追加；
 *   fourthHitCrush = 破甲冲击：第 4 击按 effArmor(dst)×k 追加），
 * 八档/七档扫描（A 0.010~0.30 / B 0.3~7.0）「机关→荆棘」目标边全部
 * 0.0p（唯一例外 A@0.30 = +0.2p），非目标边剧烈漂移 —— 两键同样
 * 0 冬眠。下方用确定性战斗（关暴击/关施法的可控木桩）钉住两通道的
 * 冬眠一致性、结算语义与体量/护甲特异性，供"护卫 t2 形态置换"手术接续。
 */

const JIGUAN_IDS = ['gongshu', 'muji', 'pan', 'budong'] as const;

const config = (jiguanTier: number): BattleConfig => ({
  seed: 11,
  units: [
    ...JIGUAN_IDS.map((defId, i) => ({
      uid: i + 1,
      defId,
      team: 0 as const,
      star: 1 as const,
      cell: { c: i, r: 3 },
    })),
    { uid: 8, defId: 'canghao', team: 0 as const, star: 1 as const, cell: { c: 4, r: 3 } },
    { uid: 9, defId: 'ajiu', team: 1 as const, star: 1 as const, cell: { c: 0, r: 7 } },
  ],
  traits: { 0: [{ id: 'jiguan', count: 4, tier: jiguanTier }], 1: [] },
  maxTicks: 30,
});

afterEach(() => {
  resetTuning();
});

describe('机关穿甲通道（jiguan armorPen）', () => {
  it('二档（tier 1）起成员获得穿甲', () => {
    TRAIT_TUNING_KEYS['jiguan'] = { pen: 0.15 };
    const bt = new Battle(config(1), null, true);
    for (const id of JIGUAN_IDS) {
      const u = bt.units.find((x) => x.entry.id === id && x.team === 0)!;
      expect(u.trait.armorPen).toBeCloseTo(0.15, 6);
    }
  });

  it('首档（tier 0）不获得穿甲（二档起门控）', () => {
    TRAIT_TUNING_KEYS['jiguan'] = { pen: 0.15 };
    const bt = new Battle(config(0), null, true);
    const gongshu = bt.units.find((x) => x.entry.id === 'gongshu')!;
    expect(gongshu.trait.armorPen).toBe(0);
  });

  it('羁绊层 0.85 封顶（极端档不越界）', () => {
    TRAIT_TUNING_KEYS['jiguan'] = { pen: 2.0 };
    const bt = new Battle(config(1), null, true);
    const gongshu = bt.units.find((x) => x.entry.id === 'gongshu')!;
    expect(gongshu.trait.armorPen).toBe(0.85);
  });

  it('非机关成员不受：穿甲不外溢全队', () => {
    TRAIT_TUNING_KEYS['jiguan'] = { pen: 0.15 };
    const bt = new Battle(config(1), null, true);
    const canghao = bt.units.find((x) => x.entry.id === 'canghao' && x.team === 0)!;
    expect(canghao.trait.armorPen).toBe(0);
  });

  it('默认冬眠：不写调参表时 armorPen 恒 0（战斗结果与历史一致）', () => {
    const bt = new Battle(config(1), null, true);
    for (const id of JIGUAN_IDS) {
      const u = bt.units.find((x) => x.entry.id === id)!;
      expect(u.trait.armorPen).toBe(0);
    }
  });
});

describe('M 残留专项烧入数值钉（data 层回归）', () => {
  it('十殿处决阈值烧入 0.24 → 0.20（3v1 边修复的载体）', () => {
    const params = CHAMPION_BY_ID['shidian']!.skillSpec.params as Record<string, number>;
    expect(params.threshold).toBe(0.2);
  });
});

// ══════════════ 第 4 击结构附加通道（N 残留专项，0 冬眠） ══════════════

/** ajiu 的基础面板（木桩 bonus 用"目标总量 − 基础值"做精确覆盖） */
const DUMMY_DEF = CHAMPION_BY_ID['ajiu']!;

/** 四机关（可调档位）vs 一只可控木桩。
 *  dummy.armorTotal / dummy.hp 为木桩期望的**总量**（内部换算成 bonus 偏置，
 *  保证 effArmor(dummy) === armorTotal、maxHp === hp 精确成立）。
 *  机关与木桩全部负偏置关暴击（critChance）与关施法（startMp），
 *  木桩攻击力负偏置（永不还手）—— 第 4 击附加物伤的结算完全确定，
 *  可对"追加量 = dst.maxHp×k / effArmor(dst)×k（经护甲结算）"做精确断言。 */
const fourthHitConfig = (
  dummy: { hp: number; armorTotal: number },
  jiguanTier: number,
  maxTicks = 300,
): BattleConfig => ({
  seed: 20260831,
  units: [
    ...[0, 1, 2, 3].map((i): BattleUnitInput => ({
      uid: i + 1,
      defId: 'gongshu',
      team: 0 as const,
      star: 1 as const,
      cell: { c: i, r: 3 },
      bonus: { critChance: -1, startMp: -9999 },
    })),
    {
      uid: 100,
      defId: 'ajiu',
      team: 1 as const,
      star: 1 as const,
      cell: { c: 0, r: 7 },
      bonus: {
        hp: dummy.hp - DUMMY_DEF.base.hp,
        armor: dummy.armorTotal - DUMMY_DEF.base.armor,
        atk: -9999,
        startMp: -9999,
        critChance: -1,
      },
    },
  ],
  traits: { 0: [{ id: 'jiguan', count: 4, tier: jiguanTier }], 1: [] },
  maxTicks,
});

/** 汇总一场战斗里全部"第 4 击附加物伤"事件（source=trait 且 physical）。
 *  本场景 team 0 只挂机关一条羁绊，此类事件恰为 bonusPhysical 结算跳。 */
function fourthHitBonus(bt: Battle): { sum: number; hits: number } {
  let sum = 0;
  let hits = 0;
  for (const e of bt.events) {
    if (e.t !== 'damage') continue;
    if (e.type === 'physical' && e.source === 'trait' && e.srcUid >= 0) {
      sum += e.amount;
      hits += 1;
    }
  }
  return { sum, hits };
}

/** 跑一场并提取第 4 击附加总量、跳数与木桩实测 maxHp / effArmor。
 *  注意：结果依赖调用时的调参表状态 —— 基线参照必须在打补丁前跑。 */
function runFourthHit(
  dummy: { hp: number; armorTotal: number },
  jiguanTier = 1,
): { sum: number; hits: number; maxHp: number; armorEff: number } {
  const bt = new Battle(fourthHitConfig(dummy, jiguanTier), null, true);
  bt.run();
  const d = bt.units.find((u) => u.team === 1)!;
  return { ...fourthHitBonus(bt), maxHp: d.maxHp, armorEff: effArmor(d) };
}

describe('第 4 击结构附加通道（fourthHitGiant / fourthHitCrush，默认 0 冬眠）', () => {
  afterEach(() => {
    resetTuning();
  });

  it('首档（tier 0）整条第 4 击通道不生效（含结构附加）', () => {
    TRAIT_TUNING_KEYS['jiguan'] = { fourthHitGiant: 0.5, fourthHitCrush: 1.0 };
    const r = runFourthHit({ hp: 50000, armorTotal: 150 }, 0);
    expect(r.hits).toBe(0);
  });

  it('冬眠：键缺省与显式 0 的事件流逐字节一致', () => {
    const plain = new Battle(fourthHitConfig({ hp: 50000, armorTotal: 0 }, 1), null, true);
    plain.run();
    TRAIT_TUNING_KEYS['jiguan'] = { fourthHitGiant: 0, fourthHitCrush: 0 };
    const explicitZero = new Battle(fourthHitConfig({ hp: 50000, armorTotal: 0 }, 1), null, true);
    explicitZero.run();
    expect(JSON.stringify(explicitZero.events)).toBe(JSON.stringify(plain.events));
  });

  it('fourthHitGiant=k：第 4 击追加 dst.maxHp×k（甲 0 目标经结算全额兑现）', () => {
    const K = 0.01;
    const base = runFourthHit({ hp: 50000, armorTotal: 0 }, 1);
    expect(base.hits).toBeGreaterThan(0);
    expect(base.armorEff).toBe(0);
    TRAIT_TUNING_KEYS['jiguan'] = { fourthHitGiant: K };
    const patched = runFourthHit({ hp: 50000, armorTotal: 0 }, 1);
    // 甲 0 → 减免系数 1.0：每跳附加量 = maxHp×k（两轮逐跳 round 误差各 ≤1）
    const expected = base.hits * patched.maxHp * K;
    expect(patched.sum - base.sum).toBeGreaterThan(0);
    expect(Math.abs(patched.sum - base.sum - expected)).toBeLessThanOrEqual(base.hits + 1);
  });

  it('fourthHitGiant 特异性：目标越厚追加越多', () => {
    const K = 0.01;
    // 基线参照先跑（补丁前）
    const baseThin = runFourthHit({ hp: 20000, armorTotal: 0 }, 1);
    const baseFat = runFourthHit({ hp: 100000, armorTotal: 0 }, 1);
    TRAIT_TUNING_KEYS['jiguan'] = { fourthHitGiant: K };
    const thin = runFourthHit({ hp: 20000, armorTotal: 0 }, 1);
    const fat = runFourthHit({ hp: 100000, armorTotal: 0 }, 1);
    expect(fat.sum - baseFat.sum).toBeGreaterThan(thin.sum - baseThin.sum);
  });

  it('fourthHitCrush=k：按 effArmor(dst)×k 追加；甲 0 目标恰为 0（事件流不变）', () => {
    // 甲墙基线先跑（补丁前）—— 参照系必须在打补丁前建立
    const base = runFourthHit({ hp: 50000, armorTotal: 150 }, 1);
    expect(base.armorEff).toBe(150);

    // 甲 0：effArmor=0 → 追加恰 0，事件流与冬眠逐字节一致
    const plainA0 = new Battle(fourthHitConfig({ hp: 50000, armorTotal: 0 }, 1), null, true);
    plainA0.run();
    TRAIT_TUNING_KEYS['jiguan'] = { fourthHitCrush: 1.0 };
    const crushA0 = new Battle(fourthHitConfig({ hp: 50000, armorTotal: 0 }, 1), null, true);
    crushA0.run();
    expect(JSON.stringify(crushA0.events)).toBe(JSON.stringify(plainA0.events));

    // 甲墙：追加量 = hits × effArmor × k × 100/(100+effArmor)（逐跳 round 误差 ≤1）
    const patched = runFourthHit({ hp: 50000, armorTotal: 150 }, 1);
    const expected = base.hits * base.armorEff * (100 / (100 + base.armorEff));
    expect(patched.sum - base.sum).toBeGreaterThan(0);
    expect(Math.abs(patched.sum - base.sum - expected)).toBeLessThanOrEqual(base.hits + 1);
  });

  it('fourthHitCrush 特异性：甲墙目标增量 > 轻甲目标增量', () => {
    const baseLight = runFourthHit({ hp: 50000, armorTotal: 50 }, 1);
    const baseHeavy = runFourthHit({ hp: 50000, armorTotal: 200 }, 1);
    TRAIT_TUNING_KEYS['jiguan'] = { fourthHitCrush: 1.0 };
    const light = runFourthHit({ hp: 50000, armorTotal: 50 }, 1);
    const heavy = runFourthHit({ hp: 50000, armorTotal: 200 }, 1);
    expect(heavy.sum - baseHeavy.sum).toBeGreaterThan(light.sum - baseLight.sum);
  });
});
