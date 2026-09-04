/**
 * 三星五费 · 天命专项配对模拟。
 *
 * 为什么要单独跑：流派配对（sim.ts）的预设全是 1~2★，天命的效应完全不可见；
 * 而天命是"终局存在感"的定档问题 —— 一颗三星五费落地，应该多大程度改写战局？
 *
 * 口径（配对 + CRN 同种子 + 双向镜像，与 sim:items 同一套纪律）：
 *  1. 【升级价值】同阵容把目标棋子从 2★ 拉到 3★ 的镜像胜率。
 *     目标棋子默认取阵容内费用最高者；五费目标即"天命"，非五费目标是
 *     天然对照（普通三星的升级价值）—— 天命组应显著高于对照组。
 *  2. 【天命包贡献】同为 3★ 的五费镜像下，LEGEND_T3 生效 vs 归零的胜率差
 *     —— 强度主体必须由天命包承载，而不是靠常规星级倍率暴涨。
 *
 * 镜像纪律：每种子两局，第二局**同时翻转**队号与 uid 高低 —— 完全对称的
 * 镜像会触发"低 uid 必胜"的确定性结算伪影（同构阵容互相湮灭时，
 * uid 平局裁决决定全部胜负），不翻转会把测量整体抬高几十个百分点。
 *
 * 用法：npm run sim:legend -- [每格种子数，默认 48] [--unit=defId]
 */
import { Battle } from '../../src/core/battle';
import { PRESET_COMPS, buildTeam } from '../../src/game/comp';
import { CHAMPION_BY_ID } from '../../src/data/champions';
import { LEGEND_T3 } from '../../src/core/config';
import { Patcher } from '../lib/patch';

const RAW_ARGS = process.argv.slice(2);
const N = Number(RAW_ARGS.find((a) => !a.startsWith('--')) ?? 48);
const UNIT_ARG = RAW_ARGS.find((a) => a.startsWith('--unit='));

if (!Number.isInteger(N) || N <= 0) {
  console.error(`✗ 种子数必须是正整数，收到：${RAW_ARGS.find((a) => !a.startsWith('--')) ?? '(缺省)'}`);
  process.exit(1);
}

/** 预设阵容里被升星的对象：--unit 优先（须在名单内），否则取费用最高者（平局取名字序，稳定） */
function legendTargetOf(compIdx: number): string {
  if (UNIT_ARG) {
    const id = UNIT_ARG.slice('--unit='.length);
    if (!CHAMPION_BY_ID[id]) throw new Error(`--unit 指定不存在的棋子：${id}`);
    return id;
  }
  const ids = Object.keys(PRESET_COMPS[compIdx].units);
  ids.sort((a, b) => {
    const d = CHAMPION_BY_ID[b].cost - CHAMPION_BY_ID[a].cost;
    return d !== 0 ? d : a.localeCompare(b);
  });
  return ids[0];
}

/**
 * 一组镜像配对：A 版（starA）vs B 版（starB），返回 A 的胜率。
 * legendOff = true 时把天命包归零（口径 2）；两侧同为 3★ 五费时差值才是包贡献。
 */
function pairedWinRate(compIdx: number, starA: 2 | 3, starB: 2 | 3, legendOff = false): number {
  const spec = PRESET_COMPS[compIdx];
  const target = legendTargetOf(compIdx);
  const unitsOf = (star: 2 | 3) => {
    const u = { ...spec.units };
    u[target] = star;
    return u as typeof spec.units;
  };
  const patch = new Patcher();
  if (legendOff) {
    patch.apply({
      'legend.hpMult': 1,
      'legend.powerMult': 1,
      'legend.skillMult': 1,
      'legend.omnivamp': 0,
      'legend.startShieldPct': 0,
    });
  }

  let wins = 0;
  try {
    for (let i = 0; i < N; i++) {
      const seed = 900000 + compIdx * 1009 + i * 7919;
      // 正向：A = team 0 / 低 uid
      const a1 = buildTeam({ ...spec, units: unitsOf(starA) }, 0, 1);
      const b1 = buildTeam({ ...spec, units: unitsOf(starB) }, 1, 200);
      const r1 = new Battle({ seed, units: [...a1.inputs, ...b1.inputs], traits: { 0: a1.traits, 1: b1.traits } }, null, false).run();
      wins += r1.winner === 0 ? 1 : r1.winner === null ? 0.5 : 0;
      // 镜像：队号与 uid 同时翻转（A = team 1 / 高 uid）
      const s2 = seed + 104729;
      const a2 = buildTeam({ ...spec, units: unitsOf(starA) }, 1, 200);
      const b2 = buildTeam({ ...spec, units: unitsOf(starB) }, 0, 1);
      const r2 = new Battle({ seed: s2, units: [...a2.inputs, ...b2.inputs], traits: { 0: b2.traits, 1: a2.traits } }, null, false).run();
      wins += r2.winner === 1 ? 1 : r2.winner === null ? 0.5 : 0;
    }
  } finally {
    // 任何异常（含循环内 Battle 抛错）都必须还原天命包补丁：
    // 不还原则全局 LEGEND_T3 保持归零，污染后续口径 1/2 的测量
    patch.reset();
  }
  return wins / (N * 2);
}

console.log('═════════ 百战天元 · 天命（三星五费）专项模拟 ═════════\n');
console.log(`配对设计：${PRESET_COMPS.length} 预设 × ${N} 种子 × 2 局镜像（队号与 uid 同时翻转）\n`);

const t0 = Date.now();
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// ── 口径 1：2★ → 3★ 镜像升级胜率 ──
console.log('【升级价值】同阵容目标件 2★ → 3★ 后的镜像胜率（50% = 无差别）\n');
const legendRows: number[] = [];
const controlRows: number[] = [];
for (let i = 0; i < PRESET_COMPS.length; i++) {
  const target = legendTargetOf(i);
  const cost = CHAMPION_BY_ID[target].cost;
  const wr = pairedWinRate(i, 3, 2);
  (cost === 5 ? legendRows : controlRows).push(wr);
  const tag = cost === 5 ? '天命' : '对照';
  console.log(`  ${PRESET_COMPS[i].name.padEnd(14)} ${tag} ${CHAMPION_BY_ID[target].name}(${cost}费)　${pct(wr).padStart(6)}`);
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
console.log(`\n  天命组均值 ${pct(avg(legendRows))}（${legendRows.length} 项）　对照组均值 ${pct(avg(controlRows))}（${controlRows.length} 项）`);
console.log('  设计口径（v1.9 定档）：天命组镜像 ≈98% 近乎接管终局，对照组（3★四费/三费）应显著低于天命组');

// ── 口径 2：天命包贡献 = 升级价值(包开) − 升级价值(包关) ──
// Patcher 是全局的，包关时 A 的 3★ 也失去天命 —— 于是「包关下的 2★→3★ 升级价值」
// 就是纯星级缩放的贡献。注意：归零表只覆盖 LEGEND_T3 的数值键，布尔键 ccImmune（控制免疫）
// 不在补丁面上、包关时依旧生效 —— 本口径输出的是数值包净贡献，不含控制免疫的贡献
// （traits.ts「数值档贡献下界」同类声明口径）。
console.log('\n【天命包贡献】升级价值（包开）对比 升级价值（包关，数值键归零；不含控制免疫）\n');
const pkgRows: number[] = [];
for (let i = 0; i < PRESET_COMPS.length; i++) {
  if (CHAMPION_BY_ID[legendTargetOf(i)].cost !== 5) continue;
  const patch = new Patcher();
  patch.apply({
    'legend.hpMult': 1,
    'legend.powerMult': 1,
    'legend.skillMult': 1,
    'legend.omnivamp': 0,
    'legend.startShieldPct': 0,
  });
  let off: number;
  try {
    off = pairedWinRate(i, 3, 2);
  } finally {
    // 与 pairedWinRate 内层 finally 同一纪律：测量异常也必须还原补丁
    patch.reset();
  }
  const on = pairedWinRate(i, 3, 2);
  pkgRows.push(on - off);
  console.log(`  ${PRESET_COMPS[i].name.padEnd(14)} 包贡献 ${(100 * (on - off)).toFixed(1)}p（${pct(on)} − ${pct(off)}）`);
}
console.log(`\n  包贡献均值 ${(avg(pkgRows) * 100).toFixed(1)}p（>0 = 天命包在纯星级之上仍有净增益）`);
console.log(`  当前包：hp ×${LEGEND_T3.hpMult} · power ×${LEGEND_T3.powerMult} · skill ×${LEGEND_T3.skillMult} · 盾 ${(LEGEND_T3.startShieldPct * 100).toFixed(0)}% · 吸血 ${(LEGEND_T3.omnivamp * 100).toFixed(0)}%`);

const dt = (Date.now() - t0) / 1000;
const games = (PRESET_COMPS.length * 2 + pkgRows.length * 2) * N * 2;
console.log(`\n共约 ${games} 局，耗时 ${dt.toFixed(1)}s（${Math.round(games / dt)} 局/秒）`);
