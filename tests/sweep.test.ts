/**
 * 平衡扫描框架回归 —— 锁死三条框架契约：
 * 1. 补丁层：改得了、必还原（champ 与 trait 两类路径）。
 * 2. tune()：默认值穿透 / 单点覆盖 / 整条缩放 / 重置。
 * 3. CRN 确定性：同种子同配置 → 逐数字一致；参数覆盖确实改变战斗结果。
 */
import { describe, expect, it } from 'vitest';
import { CHAMPION_BY_ID } from '../src/data/champions';
import { resetTuning, TRAIT_TUNING_KEYS, tune } from '../src/data/tuning';
import { runMatrix } from '../scripts/lib/arena';
import { Patcher, readCurrent, withOverrides } from '../scripts/lib/patch';

describe('补丁层', () => {
  it('champ.base / champ.skill 改动后由 reset 完整还原', () => {
    const p = new Patcher();
    const atk0 = CHAMPION_BY_ID.pan.base.atk;
    const ratio0 = CHAMPION_BY_ID.duanyue.skillSpec.params.atk as number;
    p.apply({ 'champ.pan.base.atk': 123, 'champ.duanyue.skill.atk': 9.9 });
    expect(CHAMPION_BY_ID.pan.base.atk).toBe(123);
    expect(CHAMPION_BY_ID.duanyue.skillSpec.params.atk).toBeCloseTo(9.9, 6);
    p.reset();
    expect(CHAMPION_BY_ID.pan.base.atk).toBe(atk0);
    expect(CHAMPION_BY_ID.duanyue.skillSpec.params.atk).toBe(ratio0);
  });

  it('拒绝不存在的字段与非数字目标（防止拼错路径悄悄变成空跑）', () => {
    const p = new Patcher();
    expect(() => p.apply({ 'champ.pan.base.nope': 1 })).toThrow();
    expect(() => p.apply({ 'champ.pan.skill.status': 1 })).toThrow(); // 对象字段不可覆盖
    expect(() => p.apply({ 'champ.ghost.base.atk': 1 })).toThrow();
    p.reset();
  });

  it('withOverrides 异常时也保证还原', () => {
    const atk0 = CHAMPION_BY_ID.pan.base.atk;
    expect(() =>
      withOverrides({ 'champ.pan.base.atk': 777 }, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(CHAMPION_BY_ID.pan.base.atk).toBe(atk0);
  });

  it('readCurrent 能读回当前值（报告基准值的数据源）', () => {
    withOverrides({ 'champ.pan.base.armor': 88 }, () => {
      expect(readCurrent('champ.pan.base.armor')).toBe(88);
    });
    expect(readCurrent('champ.pan.base.armor')).not.toBe(88);
    expect(readCurrent('trait.jianzong.scale')).toBe(1); // 未覆盖时 scale 恒为 1
  });
});

describe('羁绊调参表', () => {
  it('默认穿透：空表返回代码字面量', () => {
    resetTuning();
    expect(tune('assassin', 'crit', 0.2)).toBeCloseTo(0.2, 6);
  });

  it('单点覆盖优先于整条缩放，reset 清空一切', () => {
    resetTuning();
    withOverrides({ 'trait.assassin.crit': 0.5, 'trait.assassin.scale': 2 }, () => {
      expect(tune('assassin', 'crit', 0.2)).toBeCloseTo(0.5, 6); // 单点赢
      expect(tune('assassin', 'critMult', 0.35)).toBeCloseTo(0.7, 6); // 其余走缩放
      expect(TRAIT_TUNING_KEYS.assassin.crit).toBeCloseTo(0.5, 6);
    });
    expect(tune('assassin', 'crit', 0.2)).toBeCloseTo(0.2, 6);
    expect(TRAIT_TUNING_KEYS.assassin).toBeUndefined();
  });
});

describe('CRN 竞技场', () => {
  it('同种子同配置：结果逐数字一致（扫描器差分的地基）', () => {
    const a = runMatrix(6, 424242);
    const b = runMatrix(6, 424242);
    expect(b.winRate).toEqual(a.winRate);
    expect(b.spread).toBe(a.spread);
    expect(b.matrix).toEqual(a.matrix);
  });

  it('参数覆盖确实改变战斗结果（补丁 → 战斗链路贯通）', () => {
    // 青冥是快攻压制的核心 carry：攻击×5 必须显著抬高该流派胜率
    const base = runMatrix(6, 20260829);
    const buffed = withOverrides({ 'champ.qingming.base.atk': CHAMPION_BY_ID.qingming.base.atk * 5 }, () =>
      runMatrix(6, 20260829),
    );
    // 快攻压制是 PRESET_COMPS[0]（名字里含"快攻"），断言它单调上涨
    const idx = buffed.winRate.indexOf(Math.max(...buffed.winRate));
    expect(buffed.winRate[0]).toBeGreaterThan(base.winRate[0] + 0.05);
    expect(idx).toBe(0);
  });
});
