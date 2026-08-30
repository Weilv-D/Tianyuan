/**
 * CRN 竞技场 —— 扫描框架的执行面。
 *
 * 核心是"共随机数"（Common Random Numbers）：同一批配置（基线 + 各参数组）
 * 使用**完全相同**的种子表，种子只由 (配对, 局数) 决定、与参数无关。
 * 于是配置间的胜率差只剩参数本身的影响，采样噪声被配对消掉 ——
 * 这正是"量化每个数值调整的边际影响"需要的性质。
 */
import { Battle } from '../../src/core/battle';
import { PRESET_COMPS, buildTeam, type CompSpec } from '../../src/game/comp';

export interface MatrixResult {
  /** 各流派综合胜率（双向平均，同 sim.ts 口径） */
  winRate: number[];
  /** 极差（最高 - 最低） */
  spread: number;
  /** 下方阵营平均胜率（位置公平代理，理想 0.5） */
  meanBottom: number;
  /** matrix[i][j] = i 在上方、j 在下方时 j 的胜率（平局记 0.5） */
  matrix: number[][];
  battles: number;
}

/** 单场配对（i 上方 / j 下方）的胜率。种子表 = f(pairIdx, k)，与参数无关 —— CRN 关键 */
export function runPairSeeded(i: number, j: number, n: number, seedBase: number, comps: readonly CompSpec[] = PRESET_COMPS): { bottomRate: number } {
  const a = buildTeam(comps[i], 0, 1);
  const b = buildTeam(comps[j], 1, 200);
  const pairIdx = i * comps.length + j;
  let bottomWins = 0;
  for (let k = 0; k < n; k++) {
    const seed = (seedBase + pairIdx * 104729 + k * 7919) >>> 0;
    const res = new Battle(
      { seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } },
      null,
      false,
    ).run();
    if (res.winner === 1) bottomWins += 1;
    else if (res.winner === null) bottomWins += 0.5;
  }
  return { bottomRate: bottomWins / n };
}

/** 跑完整对拍矩阵。n = 每对局数（默认 80：6 流派共 2400 局，CRN 下已足够分辨 ≥2% 的移动） */
export function runMatrix(n = 80, seedBase = 20260829): MatrixResult {
  const len = PRESET_COMPS.length;
  const matrix: number[][] = [];
  let battles = 0;
  for (let i = 0; i < len; i++) {
    matrix[i] = [];
    for (let j = 0; j < len; j++) {
      if (i === j) {
        matrix[i][j] = 0.5;
        continue;
      }
      matrix[i][j] = runPairSeeded(i, j, n, seedBase).bottomRate;
      battles += n;
    }
  }

  // 双向平均：i 的真实胜率 = (i 在上方时 i 的胜率 + i 在下方时 i 的胜率) / 2
  const winRate = PRESET_COMPS.map((_, i) => {
    let sum = 0;
    let cnt = 0;
    for (let j = 0; j < len; j++) {
      if (i === j) continue;
      sum += 1 - matrix[i][j]; // i 上方、j 下方：i 的胜率
      sum += matrix[j][i]; // j 上方、i 下方：i 的胜率
      cnt += 2;
    }
    return sum / cnt;
  });

  const spread = Math.max(...winRate) - Math.min(...winRate);
  let bottomSum = 0;
  let bottomCnt = 0;
  for (let i = 0; i < len; i++) {
    for (let j = 0; j < len; j++) {
      if (i === j) continue;
      bottomSum += matrix[i][j];
      bottomCnt++;
    }
  }
  return { winRate, spread, meanBottom: bottomSum / bottomCnt, matrix, battles };
}

/** 配对二项噪声带（每流派有效样本 = 2×(len-1)×n 局）。CRN 配对下的真实噪声更小，这里是保守上界 */
export function noiseBand(n: number, comps = PRESET_COMPS.length): number {
  const eff = 2 * (comps - 1) * n;
  return 2 * Math.sqrt(0.25 / eff); // ≈ ±2σ
}
