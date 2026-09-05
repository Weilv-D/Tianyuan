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
import { TRAIT_TUNING, TRAIT_TUNING_KEYS, TRAIT_TUNE_KEYS, resetTuning, tune } from '../src/data/tuning';
import { pairSeed, DEFAULT_SEED_BASE, pairIndex } from '../balance/lib/seeds';
import { runPair, pairedItemsDelta } from '../balance/lib/engine';
import { runPool } from '../balance/lib/pool';
import { runConfigs } from '../balance/lib/matrix';
import { PRESET_COMPS } from '../src/game/comp';
import { OUT_DIR, Store } from '../balance/lib/store';

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

  it('嵌套补丁：内层 reset 只回退自己的写入，外层补丁仍生效（键级回退）', () => {
    // 历史实现 reset() 无条件 resetTuning() 清空整张调参表 —— 内层 withOverrides
    // 收尾时会把外层已打、仍该生效的补丁一并清掉，而外层 journal 却仍以为有效，
    // 造成"嵌套执行期外层补丁短暂失效"。修复后 reset 只回退本实例写过的键。
    withOverrides({ 'champ.pan.base.atk': 200, 'trait.jianzong.scale': 0.7 }, () => {
      expect(readCurrent('champ.pan.base.atk')).toBe(200);
      withOverrides({ 'trait.jianzong.crit': 0.55, 'cfg.trueHitCapRatio': 0.2 }, () => {
        expect(readCurrent('trait.jianzong.crit')).toBe(0.55);
        expect(readCurrent('trait.jianzong.scale')).toBe(0.7); // 外层缩放仍可见
        expect(readCurrent('cfg.trueHitCapRatio')).toBe(0.2);
      });
      // 内层还原后：外层补丁完整保留
      expect(readCurrent('trait.jianzong.crit')).toBeUndefined();
      expect(readCurrent('champ.pan.base.atk')).toBe(200);
      expect(readCurrent('trait.jianzong.scale')).toBe(0.7);
    });
    // 外层还原后：全部回到代码默认
    expect(readCurrent('champ.pan.base.atk')).toBeTypeOf('number');
    expect(readCurrent('trait.jianzong.scale')).toBe(1);
    expect(tune('jianzong', 'crit', 0.18)).toBe(0.18);
  });

  it('嵌套建桶：内层给无桶羁绊建档后还原，不残留空桶也不误删外层', () => {
    // trait.<id>.<key> 在 TRAIT_TUNING_KEYS[id] 不存在时会现场建桶 —— 键级回退
    // 必须只删本键，不能整桶 delete（否则嵌套时误删外层在同一羁绊上的补丁）
    withOverrides({ 'trait.shanhai.bleed0': 0.1 }, () => {
      expect(tune('shanhai', 'bleed0', 0.25)).toBe(0.1);
      withOverrides({ 'trait.shanhai.wound': 0.6 }, () => {
        expect(tune('shanhai', 'wound', 0.5)).toBe(0.6);
      });
      // 内层只还原 wound；bleed0 与桶都保留
      expect(tune('shanhai', 'wound', 0.5)).toBe(0.5);
      expect(tune('shanhai', 'bleed0', 0.25)).toBe(0.1);
    });
    expect(tune('shanhai', 'bleed0', 0.25)).toBe(0.25); // 全部还原
    expect(TRAIT_TUNING_KEYS.shanhai).toBeUndefined();
  });
});

describe('羁绊调参表（tuning.ts）', () => {
  it('优先级：单点覆盖 > 整条缩放 > 代码默认', () => {
    // 全局调参表的污染必须用 try/finally 兜底：中间断言抛错而跳过 resetTuning
    // 的话，脏表会沿文件内后续用例级联失败（失败点与病根隔了几个文件）
    try {
      expect(tune('jianzong', 'crit', 0.18)).toBe(0.18); // 默认
      TRAIT_TUNING.jianzong = 0.5;
      expect(tune('jianzong', 'crit', 0.18)).toBeCloseTo(0.09, 10);
      TRAIT_TUNING_KEYS.jianzong = { crit: 0.4 };
      expect(tune('jianzong', 'crit', 0.18)).toBe(0.4); // 单点不吃缩放
    } finally {
      resetTuning();
    }
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
    // 逐单位聚合同在看守面：聚合分发若漂移而胜负恰好相同，只比胜率/矩阵
    // 会漏检 —— units 命令与 trend 的 unit_stats 数据源就建立在这份聚合上
    expect(pooled[0].units).toEqual(serial[0].units);
  }, 30_000);

  it('装备配对原语确定且值域合法', () => {
    const a = pairedItemsDelta(0, 1, ['duanhun'], 4, 500000, PRESET_COMPS);
    const b = pairedItemsDelta(0, 1, ['duanhun'], 4, 500000, PRESET_COMPS);
    expect(a).toEqual(b);
    expect(a.diff).toBeGreaterThanOrEqual(-1);
    expect(a.diff).toBeLessThanOrEqual(1);
    expect(a.withRate - a.withoutRate).toBeCloseTo(a.diff, 10);
  });

  it('item 作业经进程池分发与串行逐位一致（池子 item 分发看守）', async () => {
    // 与 pair 池一致守卫互补：item 作业（带装/裸装 CRN 配对）走 runPool 的
    // fork 分发路径，若子进程的装备装载/配对顺序与串行 diverged，门禁须拦下
    const jobs = [
      { kind: 'item' as const, itemKey: 'duanhun', items: ['duanhun'], i: 0, j: 1, n: 4, seedBase: 20260902 },
      { kind: 'item' as const, itemKey: 'stack:2', items: ['duanhun', 'duanhun'], i: 0, j: 2, n: 4, seedBase: 20260902 },
      { kind: 'item' as const, itemKey: 'mix', items: ['xueyin', 'zidian'], i: 1, j: 3, n: 4, seedBase: 20260902 },
    ];
    const pooled = await runPool(jobs, { comps: PRESET_COMPS, workers: 2 });
    for (const job of jobs) {
      const serial = pairedItemsDelta(job.i, job.j, job.items, job.n, job.seedBase, PRESET_COMPS);
      const got = pooled.find((r) => r.kind === 'item' && r.itemKey === job.itemKey);
      expect(got?.kind).toBe('item');
      if (got?.kind !== 'item') continue;
      expect(got.diff).toBeCloseTo(serial.diff, 10);
      expect(got.withRate).toBeCloseTo(serial.withRate, 10);
      expect(got.withoutRate).toBeCloseTo(serial.withoutRate, 10);
    }
  }, 30_000);
});

describe('工件库（store.ts，:memory:）', () => {
  it('工件目录钉在 gitignored 的 balance/out/（曾落到库内 out/ 被整体提交）', async () => {
    // 期望值用独立真源推导（tests/ 的上级 = 仓库根），不镜像 store.ts 的
    // dirname 推导 —— 镜像式断言在实现与期望同错时依然全绿，发现力为零
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const expected = resolve(repoRoot, 'balance', 'out');
    expect(resolve(OUT_DIR)).toBe(expected);
    // 尾段必须是 balance/out 两级，而不是根层 out/（曾被入库的那个）
    const tail = OUT_DIR.split(/[\\/]/).slice(-2);
    expect(tail).toEqual(['balance', 'out']);
  });

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

  it('羁绊调参键白名单（TRAIT_TUNE_KEYS）与 traits.ts 的 t() 读取严格同源', () => {
    // 白名单是手写常量，traits.ts 新增一个 t('newFx') 或 t(`atk${tier}`) 档位键而
    // 漏登记，会让补丁层误拦合法覆盖（--set trait.x.newFx=… 当场抛错）或让扫描
    // 静默失真 —— 白名单漏键/多键都是病。这里直接扫 traits.ts 的全部 t('…') 直键
    // 与 t(`…${tier}`) 模板键，与 TRAIT_TUNE_KEYS 双向比对，失配即红。
    const traitSrc = readFileSync(join(process.cwd(), 'src/core/traits.ts'), 'utf8');
    const used = new Map<string, Set<string>>();
    const addKey = (traitId: string, key: string): void => {
      if (!used.has(traitId)) used.set(traitId, new Set());
      used.get(traitId)!.add(key);
    };
    let cur = '';
    for (const line of traitSrc.split('\n')) {
      const tunerId = line.match(/tuner\('([^']+)'\)/);
      if (tunerId) cur = tunerId[1];
      // 模板键：t(`atk${tier}`) —— 展开成 0/1/2 三档与白名单比对
      const templated = /t\(`?([A-Za-z0-9]+)\$\{tier\}`?/g;
      let tm: RegExpExecArray | null;
      while ((tm = templated.exec(line)) !== null) addKey(cur, `${tm[1]}0`), addKey(cur, `${tm[1]}1`), addKey(cur, `${tm[1]}2`);
      // 直键：t('key')（跳过 t(`…`) 与函数名里的 t，前缀要求非字母）
      const direct = /[^A-Za-z]t\('([^']+)'/g;
      let dm: RegExpExecArray | null;
      while ((dm = direct.exec(line)) !== null) addKey(cur, dm[1]);
    }
    for (const [idv, ks] of used) {
      const wl = TRAIT_TUNE_KEYS[idv] ?? [];
      for (const k of ks) {
        expect(wl, `traits.ts 读取 t('${k}')（羁绊 ${idv}）但白名单未登记`).toContain(k);
      }
    }
    for (const [idv, ks] of Object.entries(TRAIT_TUNE_KEYS)) {
      const actual = used.get(idv);
      for (const k of ks) {
        expect(actual, `白名单含 ${idv}.${k} 但 traits.ts 没有对应 t() 读取（死键）`).toBeDefined();
        expect(actual!.has(k)).toBe(true);
      }
    }
  });
});
