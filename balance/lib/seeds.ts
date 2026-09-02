/**
 * CRN 种子表 —— 全框架唯一的种子推导真源。
 *
 * 「共随机数」（Common Random Numbers）纪律：种子只由 (种子基, 配对序号, 局序)
 * 决定、与参数配置无关。于是任意两组配置之间的胜率差只剩参数效应，采样噪声
 * 被配对消掉 —— 这是「量化每个数值调整的边际影响」的前提。
 *
 * ⚠ 公式已金锁（tests/balance-tools.test.ts）：历史上所有入库工件都按本公式
 * 生成种子，改动公式 = 与全部历史数据失去可比性。要换种子表必须换 seedBase
 * 并在新 run 里显式记录口径变更。
 */

/** 历史默认种子基（2026-08-29 扫描框架建立时定下，沿用至今） */
export const DEFAULT_SEED_BASE = 20260829;

/** (种子基, 配对序号, 局序) → 战斗种子。与旧 scripts/lib/arena.ts 逐位一致。 */
export function pairSeed(seedBase: number, pairIdx: number, k: number): number {
  return (seedBase + pairIdx * 104729 + k * 7919) >>> 0;
}

/** 与旧口径一致的配对序号：i 上方、j 下方，由阵容表长度折算 */
export function pairIndex(i: number, j: number, compCount: number): number {
  return i * compCount + j;
}
