/**
 * 战斗执行面 —— 串行路径与进程池子进程共用的唯一执行原语。
 *
 * 与旧 scripts/lib/arena.ts 的口径逐位一致（保证金锁历史工件可比）：
 *  - buildTeam(spec, 0, 1) / buildTeam(spec, 1, 200)：uid 基与站位推导不变
 *    （uid 参与平局裁决，动了它历史对比就全废）；
 *  - 队伍构建在配对循环外做一次（站位确定，与局数无关）；
 *  - 种子 = pairSeed(seedBase, i*len+j, k)，与参数配置无关（CRN）。
 *
 * 在胜负计数之外，同时聚合逐单位统计（伤害/承伤/类型构成/治疗/吸收/施法/
 * 死亡）—— 这是「棋子维度」平衡分析的原始数据，进 SQLite 后可跨版本趋势查询。
 */
import { Battle } from '../../src/core/battle';
import { buildTeam, type CompSpec } from '../../src/game/comp';
import { pairIndex, pairSeed } from './seeds';

/** 召唤物的聚合桶 id（傀儡/守卫等 isMinion 单位统一计入，不与真棋子混淆） */
export const MINION_BUCKET = '(召唤物)';

export interface UnitAgg {
  defId: string;
  star: number;
  battles: number;
  deaths: number;
  dealt: number;
  taken: number;
  healed: number;
  absorbed: number;
  casts: number;
  dealtPhys: number;
  dealtMagic: number;
  dealtTrue: number;
  takenPhys: number;
  takenMagic: number;
  takenTrue: number;
}

export interface PairRun {
  n: number;
  /** 上方（team 0 = comps[i]）胜局 */
  topWins: number;
  /** 下方（team 1 = comps[j]）胜局 */
  bottomWins: number;
  draws: number;
  totalTicks: number;
  timeouts: number;
  /** 上方阵容的逐单位聚合（含召唤物桶） */
  top: UnitAgg[];
  /** 下方阵容的逐单位聚合 */
  bottom: UnitAgg[];
}

function newAgg(defId: string, star: number): UnitAgg {
  return {
    defId, star, battles: 0, deaths: 0, dealt: 0, taken: 0, healed: 0, absorbed: 0, casts: 0,
    dealtPhys: 0, dealtMagic: 0, dealtTrue: 0, takenPhys: 0, takenMagic: 0, takenTrue: 0,
  };
}

/** 单场战斗后把一支队伍的单位统计并入聚合表 */
function absorbTeam(units: readonly { entry: { id: string }; star: number; isMinion: boolean; alive: boolean; dealtDamage: number; takenDamage: number; healed: number; absorbedDamage: number; castCount: number; dealtByType: Record<string, number>; takenByType: Record<string, number> }[], agg: Map<string, UnitAgg>): void {
  for (const u of units) {
    const key = u.isMinion ? MINION_BUCKET : u.entry.id;
    let row = agg.get(key);
    if (!row) {
      row = newAgg(key, u.isMinion ? 0 : u.star);
      agg.set(key, row);
    }
    row.battles += 1;
    if (!u.alive) row.deaths += 1;
    row.dealt += u.dealtDamage;
    row.taken += u.takenDamage;
    row.healed += u.healed;
    row.absorbed += u.absorbedDamage;
    row.casts += u.castCount;
    row.dealtPhys += u.dealtByType.physical;
    row.dealtMagic += u.dealtByType.magic;
    row.dealtTrue += u.dealtByType.true;
    row.takenPhys += u.takenByType.physical;
    row.takenMagic += u.takenByType.magic;
    row.takenTrue += u.takenByType.true;
  }
}

/**
 * 跑一个配对方向（i 上方 / j 下方）n 局，返回双侧胜负与逐单位聚合。
 * 补丁（overrides）由调用方负责：串行走 withOverrides，池子由子进程自行管理。
 */
export function runPair(i: number, j: number, n: number, seedBase: number, comps: readonly CompSpec[]): PairRun {
  const a = buildTeam(comps[i], 0, 1);
  const b = buildTeam(comps[j], 1, 200);
  const pairIdx = pairIndex(i, j, comps.length);
  const out: PairRun = { n, topWins: 0, bottomWins: 0, draws: 0, totalTicks: 0, timeouts: 0, top: [], bottom: [] };
  const aggTop = new Map<string, UnitAgg>();
  const aggBottom = new Map<string, UnitAgg>();
  for (let k = 0; k < n; k++) {
    const seed = pairSeed(seedBase, pairIdx, k);
    const bt = new Battle(
      { seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } },
      null,
      false,
    );
    const res = bt.run();
    out.totalTicks += res.ticks;
    if (res.timeout) out.timeouts += 1;
    if (res.winner === 1) out.bottomWins += 1;
    else if (res.winner === 0) out.topWins += 1;
    else out.draws += 1;
    absorbTeam(bt.units.filter((u) => u.team === 0), aggTop);
    absorbTeam(bt.units.filter((u) => u.team === 1), aggBottom);
  }
  out.top = [...aggTop.values()];
  out.bottom = [...aggBottom.values()];
  return out;
}

/** 双向平均胜率（i 的视角）—— ab 命令与旧 ab-pair.ts 同口径 */
export function pairWinBothWays(i: number, j: number, n: number, seedBase: number, comps: readonly CompSpec[]): number {
  const ij = runPair(i, j, n, seedBase, comps);
  const ji = runPair(j, i, n, seedBase, comps);
  const asTop = ij.topWins + ij.draws * 0.5;
  const asBottom = ji.bottomWins + ji.draws * 0.5;
  return (asTop + asBottom) / (2 * n);
}

export interface ItemsPairDelta {
  /** 带装 - 裸装 的胜率差（CRN 配对相减） */
  diff: number;
  /** 带装方平均胜率（0~1） */
  withRate: number;
  /** 裸装方平均胜率（0~1） */
  withoutRate: number;
}

/**
 * 装备边际配对（装备维分析原语，口径与旧 sim-items.ts 逐位一致）：
 * 同一批种子下，A 阵容带 items vs 不带，正位 + 镜像共 2n 局对 2n 局。
 * 种子方案：正位 seedBase + i*7919，镜像再 +104729（uid 基与站位方案不变）。
 */
export function pairedItemsDelta(i: number, j: number, items: readonly string[], n: number, seedBase: number, comps: readonly CompSpec[]): ItemsPairDelta {
  let withSum = 0;
  let withoutSum = 0;
  const specA = comps[i];
  const specB = comps[j];
  for (let k = 0; k < n; k++) {
    const seed = seedBase + k * 7919;
    const mirror = seed + 104729;
    const a1 = buildTeam(specA, 0, 1, items);
    const b1 = buildTeam(specB, 1, 200, []);
    const r1 = new Battle({ seed, units: [...a1.inputs, ...b1.inputs], traits: { 0: a1.traits, 1: b1.traits } }, null, false).run();
    withSum += r1.winner === 0 ? 1 : r1.winner === null ? 0.5 : 0;
    const a2 = buildTeam(specA, 0, 1, []);
    const b2 = buildTeam(specB, 1, 200, []);
    const r2 = new Battle({ seed, units: [...a2.inputs, ...b2.inputs], traits: { 0: a2.traits, 1: b2.traits } }, null, false).run();
    withoutSum += r2.winner === 0 ? 1 : r2.winner === null ? 0.5 : 0;
    const a3 = buildTeam(specA, 1, 1, items);
    const b3 = buildTeam(specB, 0, 200, []);
    const r3 = new Battle({ seed: mirror, units: [...a3.inputs, ...b3.inputs], traits: { 0: b3.traits, 1: a3.traits } }, null, false).run();
    withSum += r3.winner === 1 ? 1 : r3.winner === null ? 0.5 : 0;
    const a4 = buildTeam(specA, 1, 1, []);
    const b4 = buildTeam(specB, 0, 200, []);
    const r4 = new Battle({ seed: mirror, units: [...a4.inputs, ...b4.inputs], traits: { 0: b4.traits, 1: a4.traits } }, null, false).run();
    withoutSum += r4.winner === 1 ? 1 : r4.winner === null ? 0.5 : 0;
  }
  return { diff: (withSum - withoutSum) / (n * 2), withRate: withSum / (n * 2), withoutRate: withoutSum / (n * 2) };
}
