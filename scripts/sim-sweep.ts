/**
 * 数值灵敏度扫描器 —— "迭代式调参 + 统计反馈"工作流的执行入口。
 *
 * 用法：
 *   npm run sim:sweep -- scripts/sweeps/sensitivity.json          # 按 spec 文件跑 OAT 扫描
 *   npm run sim:sweep -- --set champ.pan.base.atk=60,champ.pan.base.hp=1000   # 快速 A/B：一组覆盖 vs 基线
 *   选项： --n 80（每对局数） --seed 20260829 --compare <旧工件.json>（对比上一轮基线）
 *
 * 工作流（这正是它存在的意义）：
 *   1. 猜一个方向 → 写成 axis 或 --set
 *   2. 跑扫描 → 看 Δ 与边际斜率（CRN 配对，差值里没有采样噪声）
 *   3. 把有效的值写回源码 → 重跑确认 → 存档工件供下一轮对比
 * 每次运行都会把结果落盘 sweep-out/<name>-<时间戳>.json。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRESET_COMPS } from '../src/game/comp';
import { noiseBand, runMatrix, type MatrixResult } from './lib/arena';
import { readCurrent, withOverrides, type Overrides } from './lib/patch';

interface Axis {
  path: string;
  values: number[];
}
interface SweepSpec {
  name: string;
  note?: string;
  axes: Axis[];
}

// ── CLI 解析 ──────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const nPerPair = Number(flag('n') ?? 80);
const seedBase = Number(flag('seed') ?? 20260829);
const comparePath = flag('compare');
// 位置感知：--flag 会吃掉紧跟的一个词，剩下的不含 = 的才是位置参数（spec 路径）
const flagValuePos = new Set<number>();
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flagValuePos.add(i + 1);
}
const specPath = argv.find((a, i) => !a.startsWith('--') && !flagValuePos.has(i) && !a.includes('='));
const setArg = flag('set');

let spec: SweepSpec;
if (specPath) {
  spec = JSON.parse(readFileSync(resolve(specPath), 'utf8')) as SweepSpec;
  if (!spec.name || !Array.isArray(spec.axes)) throw new Error('sweep spec 需要 name 与 axes');
} else if (setArg) {
  const ov: Overrides = {};
  for (const kv of setArg.split(',')) {
    const [k, v] = kv.split('=');
    ov[k.trim()] = Number(v);
  }
  spec = { name: 'quick-ab', axes: [{ path: Object.keys(ov).join('+'), values: [NaN] }], note: `--set ${setArg}` };
  // quick-ab 只跑一组：把 overrides 挂在 axis 之外单独处理
  (spec as SweepSpec & { single?: Overrides }).single = ov;
  spec.axes = [];
} else {
  console.error('用法：npm run sim:sweep -- <spec.json> | --set path=value[,path=value]');
  process.exit(1);
}
const singleOverrides = (spec as SweepSpec & { single?: Overrides }).single;

// ── 执行 ──────────────────────────────────────────────
interface ConfigResult {
  label: string;
  overrides: Overrides;
  res: MatrixResult;
}

console.log(`═════════ 百战天元 · 数值灵敏度扫描 ═════════`);
console.log(`spec ${spec.name}   每对 ${nPerPair} 局 × ${PRESET_COMPS.length}×${PRESET_COMPS.length - 1} 配对   种子 ${seedBase}（全配置共用 = CRN）`);
if (spec.note) console.log(`note  ${spec.note}`);
const band = noiseBand(nPerPair);
console.log(`噪声带 ±${(band * 100).toFixed(1)}%（配对二项 2σ 上界；CRN 配对下实际更小）\n`);

const t0 = Date.now();
const results: ConfigResult[] = [];

const run = (label: string, ov: Overrides): void => {
  const res = withOverrides(Object.keys(ov).length > 0 ? ov : null, () => runMatrix(nPerPair, seedBase));
  results.push({ label, overrides: ov, res });
  process.stdout.write(`  ✓ ${label}   极差 ${(res.spread * 100).toFixed(1)}%   下方均值 ${(res.meanBottom * 100).toFixed(1)}%\n`);
};

run('基准（无覆盖）', {});

for (const axis of spec.axes) {
  const base = readCurrent(axis.path);
  const baseNote = base === undefined ? '（默认值在代码字面量里）' : `基准 ${base}`;
  console.log(`\n【轴 ${axis.path}】${baseNote}`);
  for (const v of axis.values) {
    run(`${axis.path}=${v}`, { [axis.path]: v });
  }
}
if (singleOverrides) {
  console.log(`\n【单组覆盖】${spec.note ?? ''}`);
  run(Object.entries(singleOverrides).map(([k, v]) => `${k}=${v}`).join(' '), singleOverrides);
}

// ── 报告：Δ 基线 + 边际斜率 ──────────────────────────
const base = results[0].res;
const shortName = (i: number): string => PRESET_COMPS[i].name.split(' · ')[0];

const fmtDelta = (d: number): string => {
  const s = `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}`;
  return Math.abs(d) >= band ? `${s}%*` : `${s}%`;
};

console.log('\n═══════════ 结果（* = 超噪声带） ═══════════');
for (let r = 1; r < results.length; r++) {
  const { label, res } = results[r];
  const deltas = res.winRate.map((w, i) => w - base.winRate[i]);
  const movers = deltas
    .map((d, i) => ({ d, i }))
    .filter((x) => Math.abs(x.d) >= band * 0.6)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 4);
  console.log(`\n${label}`);
  console.log(`  极差 ${(res.spread * 100).toFixed(1)}%（Δ${fmtDelta(res.spread - base.spread)}）  下方均值 ${(res.meanBottom * 100).toFixed(1)}%（Δ${fmtDelta(res.meanBottom - base.meanBottom)}）`);
  if (movers.length === 0) {
    console.log('  各流派胜率移动均在噪声带内 —— 该参数在此值下无显著影响');
  } else {
    for (const m of movers) {
      console.log(`  ${shortName(m.i).padEnd(6)} ${(res.winRate[m.i] * 100).toFixed(1)}%   Δ${fmtDelta(m.d)}`);
    }
  }
}

// 边际斜率（每个轴首末值）
console.log('\n═══════════ 边际敏感度（首值 → 末值，胜率点/单位参数） ═══════════');
for (const axis of spec.axes) {
  const rows = results.filter((r) => Object.prototype.hasOwnProperty.call(r.overrides, axis.path));
  if (rows.length < 2) continue;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const dv = last.overrides[axis.path] - first.overrides[axis.path];
  if (dv === 0) continue;
  const slopes = PRESET_COMPS.map((_, i) => ({
    i,
    slope: ((last.res.winRate[i] - first.res.winRate[i]) * 100) / dv,
  }))
    .filter((x) => Math.abs(x.slope) > 0.5)
    .sort((a, b) => Math.abs(b.slope) - Math.abs(a.slope))
    .slice(0, 4);
  console.log(`\n${axis.path}（${first.overrides[axis.path]} → ${last.overrides[axis.path]}，步长 ${dv.toFixed(2)}）`);
  if (slopes.length === 0) console.log('  全流派斜率 ≈ 0：该参数在区间内不敏感');
  for (const s of slopes) {
    console.log(`  ${shortName(s.i).padEnd(6)} ${s.slope >= 0 ? '+' : ''}${s.slope.toFixed(1)} 胜率点/单位`);
  }
}

// ── 与上一轮工件对比（迭代工作流的"反馈"环节） ──────────
if (comparePath) {
  const prev = JSON.parse(readFileSync(resolve(comparePath), 'utf8')) as {
    results: { label: string; res: { winRate: number[] } }[];
  };
  const prevBase = prev.results[0];
  console.log(`\n═══════════ 对比上一轮（${comparePath} 的基线 → 本轮基线） ═══════════`);
  for (let i = 0; i < PRESET_COMPS.length; i++) {
    const d = base.winRate[i] - prevBase.res.winRate[i];
    console.log(`  ${shortName(i).padEnd(6)} ${(prevBase.res.winRate[i] * 100).toFixed(1)}% → ${(base.winRate[i] * 100).toFixed(1)}%   Δ${fmtDelta(d)}`);
  }
}

// ── 落盘工件 ──────────────────────────────────────────
const outDir = resolve(process.cwd(), 'sweep-out');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const artifact = {
  name: spec.name,
  note: spec.note,
  n: nPerPair,
  seed: seedBase,
  comps: PRESET_COMPS.map((c) => c.name),
  band,
  date: new Date().toISOString(),
  results: results.map((r) => ({ label: r.label, overrides: r.overrides, winRate: r.res.winRate, spread: r.res.spread, meanBottom: r.res.meanBottom })),
};
const outFile = resolve(outDir, `${spec.name}-${stamp}.json`);
writeFileSync(outFile, JSON.stringify(artifact, null, 2));

const dt = (Date.now() - t0) / 1000;
const totalBattles = results.reduce((s, r) => s + r.res.battles, 0);
console.log(`\n共 ${results.length} 组配置 × ${totalBattles / results.length | 0} 局，总 ${totalBattles} 局，耗时 ${dt.toFixed(1)}s（${Math.round(totalBattles / dt)} 局/秒）`);
console.log(`工件已写入 ${outFile}（下轮 --compare 用它对比）`);
