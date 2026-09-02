/**
 * 平衡工具链（balance/）框架回归 —— 口径与可信度的地基。
 *
 * 覆盖七类不变量：
 *  1. 补丁层往返：apply → 可读 → reset 逆序还原（含羁绊调参表）
 *  2. tune() 优先级：单点覆盖 > 整条缩放 > 代码默认
 *  3. CRN 种子金锁：pairSeed 公式与历史工件可比性绑定，改动即红
 *  4. CRN 稳定：同配对同种子重复执行结果逐位一致
 *  5. 进程池一致：并行结果与串行逐位一致（fork 出的子进程用独立模块实例，
 *     隔离由构造保证 —— 这条测试是「并行 === 串行」的实证看守）
 *  6. 工件库往返：:memory: SQLite 的 run/config/pair/unit/item/trait 行写读一致
 *  7. 分离保证：src/ 下任何文件不得 import balance/（工具链永不进游戏）
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Patcher, readCurrent, withOverrides } from '../balance/lib/patch';
import { TRAIT_TUNING, TRAIT_TUNING_KEYS, resetTuning, tune } from '../src/data/tuning';
import { pairSeed, DEFAULT_SEED_BASE, pairIndex } from '../balance/lib/seeds';
import { runPair, pairedItemsDelta } from '../balance/lib/engine';
import { runConfigs } from '../balance/lib/matrix';
import { PRESET_COMPS } from '../src/game/comp';
import { Store } from '../balance/lib/store';

describe('补丁层（patch.ts）', () => {
  it('apply → 读数可见 → reset 逆序还原（面板/技能/羁绊/机制四类路径）', () => {
    const before = readCurrent('champ.pan.base.atk');
    const beforeSkill = readCurrent('champ.duanyue.skill.atk');
    const beforeCfg = readCurrent('cfg.MANNA_PER_ATTACK');
    expect(before).toBeTypeOf('number');
    withOverrides(
      {
        'champ.pan.base.atk': 999,
        'champ.duanyue.skill.atk': 12.5,
        'trait.jianzong.scale': 0.5,
        'trait.jianzong.crit': 0.99,
        ...(beforeCfg !== undefined ? { 'cfg.MANNA_PER_ATTACK': 77 } : {}),
      },
      () => {
        expect(readCurrent('champ.pan.base.atk')).toBe(999);
        expect(readCurrent('champ.duanyue.skill.atk')).toBe(12.5);
        expect(readCurrent('trait.jianzong.scale')).toBe(0.5);
        expect(readCurrent('trait.jianzong.crit')).toBe(0.99);
        if (beforeCfg !== undefined) expect(readCurrent('cfg.MANNA_PER_ATTACK')).toBe(77);
      },
    );
    expect(readCurrent('champ.pan.base.atk')).toBe(before);
    expect(readCurrent('champ.duanyue.skill.atk')).toBe(beforeSkill);
    expect(readCurrent('trait.jianzong.scale')).toBe(1);
    expect(readCurrent('trait.jianzong.crit')).toBeUndefined();
    if (beforeCfg !== undefined) expect(readCurrent('cfg.MANNA_PER_ATTACK')).toBe(beforeCfg);
  });

  it('拒绝不存在/非数字的补丁目标，且失败后现场干净', () => {
    const p = new Patcher();
    expect(() => p.apply({ 'champ.pan.base.nope': 1 })).toThrow();
    expect(() => p.apply({ 'champ.ghost.base.atk': 1 })).toThrow();
    expect(() => p.apply({ 'champ.pan.base.atk': Number.NaN })).toThrow();
    p.reset();
    expect(readCurrent('champ.pan.base.atk')).toBeTypeOf('number');
  });
});

describe('羁绊调参表（tuning.ts）', () => {
  it('优先级：单点覆盖 > 整条缩放 > 代码默认', () => {
    expect(tune('jianzong', 'crit', 0.18)).toBe(0.18); // 默认
    TRAIT_TUNING.jianzong = 0.5;
    expect(tune('jianzong', 'crit', 0.18)).toBeCloseTo(0.09);
    TRAIT_TUNING_KEYS.jianzong = { crit: 0.4 };
    expect(tune('jianzong', 'crit', 0.18)).toBe(0.4); // 单点不吃缩放
    resetTuning();
    expect(tune('jianzong', 'crit', 0.18)).toBe(0.18);
  });
});

describe('CRN 种子表（seeds.ts）', () => {
  it('公式金锁：与历史全部入库工件的种子推导逐位一致', () => {
    expect(DEFAULT_SEED_BASE).toBe(20260829);
    expect(pairSeed(20260829, 0, 0)).toBe(20260829);
    expect(pairSeed(20260829, 1, 0)).toBe(20260829 + 104729);
    expect(pairSeed(20260829, 0, 1)).toBe(20260829 + 7919);
    // 溢出按 >>> 0 折返（历史行为）
    expect(pairSeed(4294967295, 2, 0)).toBe(((4294967295 + 2 * 104729) >>> 0));
    expect(pairIndex(2, 5, 9)).toBe(23);
  });

  it('同配对同种子重复执行逐位一致（配对消噪前提）', () => {
    const a = runPair(0, 1, 16, DEFAULT_SEED_BASE, PRESET_COMPS);
    const b = runPair(0, 1, 16, DEFAULT_SEED_BASE, PRESET_COMPS);
    expect(a.topWins).toBe(b.topWins);
    expect(a.bottomWins).toBe(b.bottomWins);
    expect(a.draws).toBe(b.draws);
    expect(a.totalTicks).toBe(b.totalTicks);
    expect(a.timeouts).toBe(b.timeouts);
  });
});

describe('进程池（pool.ts）', () => {
  it('并行结果与串行逐位一致（n=3 小矩阵，2 进程）', async () => {
    const seedBase = 20260902;
    const configs = [{ label: '基准', overrides: {} }];
    const serial = await runConfigs(configs, { comps: PRESET_COMPS, n: 3, seedBase, workers: 0 });
    const pooled = await runConfigs(configs, { comps: PRESET_COMPS, n: 3, seedBase, workers: 2 });
    expect(pooled[0].winRate).toEqual(serial[0].winRate);
    expect(pooled[0].matrix).toEqual(serial[0].matrix);
    expect(pooled[0].timeouts).toBe(serial[0].timeouts);
    expect(pooled[0].pairRows).toEqual(serial[0].pairRows);
  }, 30_000);

  it('装备配对原语确定且值域合法', () => {
    const a = pairedItemsDelta(0, 1, ['duanhun'], 4, 500000, PRESET_COMPS);
    const b = pairedItemsDelta(0, 1, ['duanhun'], 4, 500000, PRESET_COMPS);
    expect(a).toEqual(b);
    expect(a.diff).toBeGreaterThanOrEqual(-1);
    expect(a.diff).toBeLessThanOrEqual(1);
    expect(a.withRate - a.withoutRate).toBeCloseTo(a.diff, 10);
  });
});

describe('工件库（store.ts，:memory:）', () => {
  it('run/config/pair/unit/item/trait 全链写读一致', () => {
    const store = new Store(':memory:');
    try {
      const runId = store.beginRun({ command: 'matrix', label: '测试', nPerPair: 8, seedBase: 1, workers: 2, params: { comps: ['甲', '乙'] } });
      const configId = store.addConfig(runId, 0, '基准（无覆盖）', {});
      store.addPairs(runId, configId, [{ i: 0, j: 1, n: 8, topWins: 5, bottomWins: 3, draws: 0, totalTicks: 1600, timeouts: 1 }]);
      store.addUnits(runId, configId, [{
        compIdx: 0, defId: 'pan', star: 2, battles: 8, deaths: 3, dealt: 8000, taken: 4000, healed: 0, absorbed: 500, casts: 10,
        dealtPhys: 6000, dealtMagic: 2000, dealtTrue: 0, takenPhys: 3000, takenMagic: 1000, takenTrue: 0,
      }]);
      store.addItemResults(runId, [{ itemId: 'duanhun', n: 100, baselineRate: 0.5, itemRate: 0.58 }]);
      store.addTraitResults(runId, [{ compIdx: 0, traitId: 'guardian', n: 8, baseRate: 0.55, suppressedRate: 0.4 }]);
      store.finishRun(runId, { comps: ['甲', '乙'], winRate: [0.6, 0.4], spread: 0.2 });

      const runs = store.recentRuns('matrix', 5);
      expect(runs).toHaveLength(1);
      expect(JSON.parse(runs[0].summary_json ?? '{}')).toMatchObject({ spread: 0.2 });
      const units = store.unitRows(runId, '基准（无覆盖）');
      expect(units).toHaveLength(1);
      expect(units[0].dealt).toBe(8000);
      expect(units[0].defId).toBe('pan');
      const items = store.itemRows(runId);
      expect(items[0].delta).toBeCloseTo(0.08, 10);
      const traits = store.traitRows(runId);
      expect(traits[0].delta).toBeCloseTo(-0.15, 10);
    } finally {
      store.close();
    }
  });
});

describe('分离保证（工具链与游戏主体）', () => {
  it('src/ 下没有任何文件 import balance/（数据库与工具永不进游戏）', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
        } else if (name.endsWith('.ts')) {
          const src = readFileSync(p, 'utf8');
          if (/['"][^'"]*balance\//.test(src)) offenders.push(p);
        }
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});
