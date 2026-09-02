/**
 * 控制台报告层 —— 矩阵断面 / Δ 基线 / 边际斜率 / 单位排行 / 趋势的统一渲染。
 * 输出形态沿用旧 sim.ts / sim-sweep.ts 的既有惯例（历史读数习惯不断层）。
 */
import type { ConfigOutcome } from './matrix';
import type { UnitRow } from './matrix';
import { CHAMPION_BY_ID } from '../../src/data/champions';

export const shortName = (comps: readonly { name: string }[], i: number): string => comps[i].name.split(' · ')[0];

export interface EdgeStats {
  /** 最弱边（双向平均口径，i 对 j 的折半视角）：0% = 绝对边 = 病灶 */
  minEdge: number;
  /** 超出 [lo, hi] 边带的克制边列表（按极端度升序） */
  violations: { i: number; j: number; rate: number }[];
}

/**
 * 边带统计 —— 「相对平衡」的度量面（决策记录 D4）。
 * 平衡目标不是把胜率压平（绝对平均），而是：阵容带内（身份保留）+ 边带内
 * （硬克制 70/30 而非 100/0）。绝对边抹掉玩家能动性，是首要修治对象。
 */
export function edgeStats(matrix: number[][], lo = 0.2, hi = 0.8): EdgeStats {
  const len = matrix.length;
  const edges: { i: number; j: number; rate: number }[] = [];
  for (let i = 0; i < len; i++) {
    for (let j = i + 1; j < len; j++) {
      edges.push({ i, j, rate: ((1 - matrix[i][j]) + matrix[j][i]) / 2 }); // i 的视角
    }
  }
  const minEdge = Math.min(...edges.map((e) => Math.min(e.rate, 1 - e.rate)));
  const violations = edges
    .filter((e) => e.rate < lo || e.rate > hi)
    .sort((a, b) => Math.min(a.rate, 1 - a.rate) - Math.min(b.rate, 1 - b.rate));
  return { minEdge, violations };
}


export function printMatrixTable(comps: readonly { name: string }[], oc: ConfigOutcome, band: number): void {
  console.log('\n【综合胜率】（双向平均，消除站位影响）');
  const rows = oc.winRate
    .map((wr, i) => ({ i, wr }))
    .sort((a, b) => b.wr - a.wr);
  for (const r of rows) {
    const bar = '█'.repeat(Math.round(r.wr * 40));
    console.log(
      `  ${comps[r.i].name.padEnd(22)} ${(r.wr * 100).toFixed(1).padStart(5)}%  ${bar}`,
    );
  }
  const top = Math.max(...oc.winRate);
  const bot = Math.min(...oc.winRate);
  console.log(`\n  极差 ${((top - bot) * 100).toFixed(1)}%  ${oc.spread < 0.12 ? '✓' : oc.spread < 0.18 ? '△' : '⚠ 需要调平'}  下方均值 ${(oc.meanBottom * 100).toFixed(1)}%  同步噪声带 ±${(band * 100).toFixed(1)}%`);
  console.log(`  平均时长 ${(oc.avgTicks / 30).toFixed(1)}s  超时 ${((oc.timeouts / oc.battles) * 100).toFixed(1)}%`);

  // 阵容带 + 边带（百花齐放口径：带内 = 合格，绝对边 = 病灶；极差只是诊断量）
  const outOfBand = oc.winRate.map((wr, i) => ({ wr, i })).filter((x) => x.wr < 0.44 || x.wr > 0.58);
  console.log(`  阵容带 [44,58]：${outOfBand.length === 0 ? '✓ 全部带内' : outOfBand.map((x) => `${shortName(comps, x.i)} ${(x.wr * 100).toFixed(1)}%`).join('、') + ' 越带'}`);
  const es = edgeStats(oc.matrix);
  if (es.violations.length === 0) {
    console.log('  边带 [20,80]：✓ 无绝对边');
  } else {
    const worst = es.violations.slice(0, 4).map((v) => {
      const win = v.rate >= 0.5 ? v.i : v.j;
      const lose = v.rate >= 0.5 ? v.j : v.i;
      return `${shortName(comps, win)}→${shortName(comps, lose)} ${(Math.max(v.rate, 1 - v.rate) * 100).toFixed(0)}%`;
    }).join('、');
    console.log(`  边带 [20,80]：${es.violations.length} 条越带，最弱边 ${(es.minEdge * 100).toFixed(1)}%（${worst}…）`);
  }
}

/** sweep 报告：Δ 基线 + 显著移动者（* = 超噪声带） */
export function printDeltaReport(comps: readonly { name: string }[], base: ConfigOutcome, results: ConfigOutcome[], band: number): void {
  const fmtDelta = (d: number): string => {
    const s = `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}`;
    return Math.abs(d) >= band ? `${s}%*` : `${s}%`;
  };
  console.log('\n═══════════ 结果（* = 超噪声带） ═══════════');
  for (let r = 1; r < results.length; r++) {
    const { label, res } = { label: results[r].label, res: results[r] };
    const deltas = res.winRate.map((w, i) => w - base.winRate[i]);
    const movers = deltas
      .map((d, i) => ({ d, i }))
      .filter((x) => Math.abs(x.d) >= band)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
      .slice(0, 4);
    console.log(`\n${label}`);
    console.log(`  极差 ${(res.spread * 100).toFixed(1)}%（Δ${fmtDelta(res.spread - base.spread)}）  下方均值 ${(res.meanBottom * 100).toFixed(1)}%（Δ${fmtDelta(res.meanBottom - base.meanBottom)}）`);
    if (movers.length === 0) {
      console.log('  各阵容胜率移动均在噪声带内 —— 该参数在此值下无显著影响');
    } else {
      for (const m of movers) {
        console.log(`  ${shortName(comps, m.i).padEnd(6)} ${(res.winRate[m.i] * 100).toFixed(1)}%   Δ${fmtDelta(m.d)}`);
      }
    }
  }
}

/** 边际敏感度：每条轴首末值的胜率点/单位参数 */
export function printSlopes(comps: readonly { name: string }[], axes: { path: string; values: number[] }[], results: ConfigOutcome[]): void {
  console.log('\n═══════════ 边际敏感度（首值 → 末值，胜率点/单位参数） ═══════════');
  for (const axis of axes) {
    const rows = results.filter((r) => Object.prototype.hasOwnProperty.call(r.overrides, axis.path));
    if (rows.length < 2) continue;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const dv = last.overrides[axis.path] - first.overrides[axis.path];
    if (dv === 0) continue;
    const slopes = comps.map((_, i) => ({ i, slope: ((last.winRate[i] - first.winRate[i]) * 100) / dv }))
      .filter((x) => Math.abs(x.slope) > 0.5)
      .sort((a, b) => Math.abs(b.slope) - Math.abs(a.slope))
      .slice(0, 4);
    console.log(`\n${axis.path}（${first.overrides[axis.path]} → ${last.overrides[axis.path]}，步长 ${dv.toFixed(2)}）`);
    if (slopes.length === 0) console.log('  全阵容斜率 ≈ 0：该参数在区间内不敏感');
    for (const s of slopes) {
      console.log(`  ${shortName(comps, s.i).padEnd(6)} ${s.slope >= 0 ? '+' : ''}${s.slope.toFixed(1)} 胜率点/单位`);
    }
  }
}

/** 单位排行（棋子维）：默认按场均伤害降序；type=1 按承伤 */
export function printUnitBoard(comps: readonly { name: string }[], rows: UnitRow[], sort: 'dealt' | 'taken' | 'dpm' = 'dealt'): void {
  const key = (r: UnitRow): number => {
    const perBattle = r.battles > 0 ? r.battles : 1;
    if (sort === 'taken') return r.taken / perBattle;
    return r.dealt / perBattle;
  };
  const sorted = [...rows].sort((a, b) => key(b) - key(a));
  console.log(`\n【单位榜】（按场均${sort === 'taken' ? '承伤' : '伤害'}降序；·盾 = 场均吸收）`);
  console.log('  单位       阵容         星  场均伤   构成物/法/真   场均承  ·盾   场均疗  施法  生存率');
  for (const r of sorted) {
    const pb = r.battles > 0 ? r.battles : 1;
    const dealt = r.dealt / pb;
    const sum = r.dealtPhys + r.dealtMagic + r.dealtTrue;
    const mix = sum > 0
      ? `${Math.round((r.dealtPhys / sum) * 100)}/${Math.round((r.dealtMagic / sum) * 100)}/${Math.round((r.dealtTrue / sum) * 100)}`
      : '—';
    const name = r.defId === '(召唤物)' ? '(召唤物)' : `${CHAMPION_BY_ID[r.defId]?.name ?? r.defId}`;
    console.log(
      `  ${name.padEnd(9)} ${shortName(comps, r.compIdx).padEnd(8)} ${'★'.repeat(r.star).padEnd(3)} ${dealt.toFixed(0).padStart(6)}  ${mix.padStart(12)}  ${(r.taken / pb).toFixed(0).padStart(5)} ${(r.absorbed / pb).toFixed(0).padStart(5)} ${(r.healed / pb).toFixed(0).padStart(6)} ${(r.casts / pb).toFixed(1).padStart(5)} ${(((r.battles - r.deaths) / pb) * 100).toFixed(0).padStart(4)}%`,
    );
  }
}
