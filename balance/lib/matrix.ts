/**
 * 配置矩阵聚合层 —— 把 (配置 × 配对) 的执行结果组装成与旧框架同口径的断面。
 *
 * 口径与旧 scripts/lib/arena.ts 逐位一致：
 *  - matrix[i][j] = i 上方、j 下方时 j 的胜率（平局记 0.5）；
 *  - winRate[i] = 双向平均（i 的真实胜率，消除站位影响）；
 *  - spread = max - min（极差）；meanBottom = 下方阵营均值（位置公平代理）。
 *
 * 两条执行路径：
 *  - workers = 0：串行，本进程 withOverrides 打补丁逐配对跑（调试/对照口径）；
 *  - workers ≥ 1：fork 进程池（默认）。
 * 两条路径产出逐位一致（selftest 断言），因为种子是纯函数、局与局独立。
 */
import { runPair, type UnitAgg } from './engine';
import { withOverrides, type Overrides } from './patch';
import { runPool, type PairResult } from './pool';
import type { CompSpec } from '../../src/game/comp';

export interface MatrixConfig {
  label: string;
  overrides: Overrides;
}

export interface UnitRow extends UnitAgg {
  compIdx: number;
}

export interface PairRow {
  i: number;
  j: number;
  n: number;
  topWins: number;
  bottomWins: number;
  draws: number;
  totalTicks: number;
  timeouts: number;
}

export interface ConfigOutcome {
  label: string;
  overrides: Overrides;
  winRate: number[];
  spread: number;
  meanBottom: number;
  /** matrix[i][j] = i 上方、j 下方时 j 的胜率（平局 0.5） */
  matrix: number[][];
  battles: number;
  avgTicks: number;
  timeouts: number;
  /** 配对级原始行（DB 落库与事后复算用） */
  pairRows: PairRow[];
  /** key = `${compIdx}:${defId}`，阵容维 + 棋子维的逐单位聚合 */
  units: Map<string, UnitRow>;
}

export interface RunConfigsOpts {
  comps: readonly CompSpec[];
  n: number;
  seedBase: number;
  /** 0 = 本进程串行；≥1 = fork 池并行 */
  workers: number;
  onConfigDone?: (label: string, outcome: ConfigOutcome) => void;
}

/** 配对行 → 断面结果（matrix/sweep/traits 共用的聚合出口） */
export function assemble(label: string, overrides: Overrides, comps: readonly CompSpec[], pairRuns: (PairRow & { top: UnitAgg[]; bottom: UnitAgg[] })[]): ConfigOutcome {
  const len = comps.length;
  const matrix: number[][] = [];
  for (let i = 0; i < len; i++) {
    matrix[i] = [];
    for (let j = 0; j < len; j++) matrix[i][j] = i === j ? 0.5 : 0;
  }
  let battles = 0;
  let ticks = 0;
  let timeouts = 0;
  const units = new Map<string, UnitRow>();
  const rollIn = (compIdx: number, rows: UnitAgg[]): void => {
    for (const r of rows) {
      const key = `${compIdx}:${r.defId}`;
      const cur = units.get(key);
      if (!cur) units.set(key, { ...r, compIdx });
      else {
        cur.battles += r.battles; cur.deaths += r.deaths; cur.dealt += r.dealt; cur.taken += r.taken;
        cur.healed += r.healed; cur.absorbed += r.absorbed; cur.casts += r.casts;
        cur.dealtPhys += r.dealtPhys; cur.dealtMagic += r.dealtMagic; cur.dealtTrue += r.dealtTrue;
        cur.takenPhys += r.takenPhys; cur.takenMagic += r.takenMagic; cur.takenTrue += r.takenTrue;
      }
    }
  };
  for (const pr of pairRuns) {
    matrix[pr.i][pr.j] = (pr.bottomWins + pr.draws * 0.5) / pr.n;
    battles += pr.n;
    ticks += pr.totalTicks;
    timeouts += pr.timeouts;
    rollIn(pr.i, pr.top);
    rollIn(pr.j, pr.bottom);
  }
  // 双向平均：i 的真实胜率 = (i 在上方时 i 的胜率 + i 在下方时 i 的胜率) / 2
  const winRate = Array.from({ length: len }, (_, i) => {
    let sum = 0;
    for (let j = 0; j < len; j++) {
      if (i === j) continue;
      sum += 1 - matrix[i][j];
      sum += matrix[j][i];
    }
    return sum / (2 * (len - 1));
  });
  const spread = Math.max(...winRate) - Math.min(...winRate);
  let bottomSum = 0;
  let bottomCnt = 0;
  for (let i = 0; i < len; i++) {
    for (let j = 0; j < len; j++) {
      if (i === j) continue;
      bottomSum += matrix[i][j];
      bottomCnt += 1;
    }
  }
  return {
    label, overrides, winRate, spread, matrix, battles,
    avgTicks: battles > 0 ? ticks / battles : 0, timeouts,
    meanBottom: bottomCnt > 0 ? bottomSum / bottomCnt : 0.5,
    pairRows: pairRuns.map(({ top: _t, bottom: _b, ...row }) => row),
    units,
  };
}

/** 跑一组配置（基线 + 各参数组），返回每个配置的断面结果 */
export async function runConfigs(configs: readonly MatrixConfig[], opts: RunConfigsOpts): Promise<ConfigOutcome[]> {
  const { comps, n, seedBase, workers } = opts;
  const len = comps.length;
  const outcomes: ConfigOutcome[] = [];

  if (workers <= 0) {
    // 串行：本进程打补丁 → 逐配对 → 还原（旧框架的执行形态，留作对照口径）
    for (const cfg of configs) {
      const pairRuns = withOverrides(Object.keys(cfg.overrides).length > 0 ? cfg.overrides : null, () => {
        const out: (PairRow & { top: UnitAgg[]; bottom: UnitAgg[] })[] = [];
        for (let i = 0; i < len; i++) {
          for (let j = 0; j < len; j++) {
            if (i === j) continue;
            out.push({ i, j, ...runPair(i, j, n, seedBase, comps) });
          }
        }
        return out;
      });
      const oc = assemble(cfg.label, cfg.overrides, comps, pairRuns);
      outcomes.push(oc);
      opts.onConfigDone?.(cfg.label, oc);
    }
    return outcomes;
  }

  const jobs = [];
  for (let c = 0; c < configs.length; c++) {
    for (let i = 0; i < len; i++) {
      for (let j = 0; j < len; j++) {
        if (i === j) continue;
        jobs.push({ kind: 'pair' as const, configIdx: c, i, j, n, seedBase, overrides: configs[c].overrides });
      }
    }
  }
  const results = await runPool(jobs, { comps, workers });
  for (let c = 0; c < configs.length; c++) {
    const idx = c;
    const pairRuns = results
      .filter((r): r is PairResult => r.kind === 'pair' && r.configIdx === idx)
      .map((r) => ({
        i: r.i, j: r.j, n: r.n, topWins: r.topWins, bottomWins: r.bottomWins,
        draws: r.draws, totalTicks: r.totalTicks, timeouts: r.timeouts,
        top: r.top, bottom: r.bottom,
      }));
    const oc = assemble(configs[c].label, configs[c].overrides, comps, pairRuns);
    outcomes.push(oc);
    opts.onConfigDone?.(configs[c].label, oc);
  }
  return outcomes;
}

/** 配对二项噪声带（每流派有效样本 = 2×(len-1)×n 局）。CRN 配对下的真实噪声更小，这里是保守上界 */
export function noiseBand(n: number, comps = 9, z = 2): number {
  const eff = 2 * (comps - 1) * n;
  return z * Math.sqrt(0.25 / eff);
}
