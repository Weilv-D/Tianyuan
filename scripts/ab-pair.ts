/**
 * 定向配对 A/B —— 极端克制边的压缩验证器。
 *
 * 场景：全矩阵扫描告诉你"机关胜快攻 90%"这类极端边，但全矩阵每格的局数
 * 被摊薄（n=60~80），2~4 个百分点的定向移动淹没在噪声带里。这个工具只跑
 * 你关心的那几对配对，把全部局数集中在它们身上，用 CRN 配对相减直接回答
 * "这个改动把这条克制边移动了多少"。
 *
 * 用法：
 *   npx tsx scripts/ab-pair.ts --set trait.jiguan.armor=16 [--set k=v ...] [--n 200] [--pairs 4]
 *   --pairs 只跑与指定下标阵容相关的配对（默认 4 = 机关召唤），逗号分隔多个。
 */
import { runPairSeeded } from './lib/arena';
import { withOverrides, readCurrent, type Overrides } from './lib/patch';
import { PRESET_COMPS } from '../src/game/comp';

const args = process.argv.slice(2);
const overrides: Overrides = {};
let n = 200;
let focus = '4';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--set') {
    const [k, v] = (args[++i] ?? '').split('=');
    overrides[k] = Number(v);
  } else if (a === '--n') n = Number(args[++i]);
  else if (a === '--pairs') focus = args[++i] ?? '4';
}
const focusSet = new Set(focus.split(',').map(Number).filter((x) => Number.isInteger(x)));
if (Object.keys(overrides).length === 0) {
  console.error('用法: npx tsx scripts/ab-pair.ts --set path=value [--n 200] [--pairs 4]');
  process.exit(1);
}

const seedBase = 20260829; // 与全矩阵同种子基 —— CRN 配对
const len = PRESET_COMPS.length;

/** 双向平均胜率（i 的视角）。CRN：A/B 用同一种子表 */
function pairWin(i: number, j: number, nGames: number): number {
  const asTop = 1 - runPairSeeded(i, j, nGames, seedBase).bottomRate;
  const asBottom = runPairSeeded(j, i, nGames, seedBase).bottomRate;
  return (asTop + asBottom) / 2;
}

const pairs: [number, number][] = [];
for (const f of [...focusSet].sort((a, b) => a - b)) {
  for (let j = 0; j < len; j++) {
    if (j !== f) pairs.push([f, j]);
  }
}

const name = (i: number) => PRESET_COMPS[i].name.split(' · ')[0];

console.log(`═════════ 百战天元 · 定向配对 A/B ═════════`);
console.log(`覆盖：${Object.entries(overrides).map(([k, v]) => `${k}=${v}（原 ${(readCurrent(k) ?? '?').toString()}）`).join('，')}`);
console.log(`配对：${[...focusSet].map((f) => name(f)).join('/')} 相关 ${pairs.length} 对 × 双向 × ${n} 局（CRN）\n`);

const t0 = Date.now();
const baseline = withOverrides(null, () => pairs.map(([i, j]) => pairWin(i, j, n)));
const patched = withOverrides(overrides, () => pairs.map(([i, j]) => pairWin(i, j, n)));

console.log(`  ${'配对'.padEnd(24)}${'基准'.padStart(8)}${'改动后'.padStart(8)}${'移动'.padStart(9)}`);
console.log('  ' + '─'.repeat(50));
let moved = 0;
pairs.forEach(([i, j], k) => {
  const d = patched[k] - baseline[k];
  if (Math.abs(d) >= 0.02) moved++;
  console.log(
    `  ${name(i)} 对 ${name(j)}`.padEnd(24) +
      `${(baseline[k] * 100).toFixed(1).padStart(7)}%` +
      `${(patched[k] * 100).toFixed(1).padStart(8)}%` +
      `${(d >= 0 ? '+' : '') + (d * 100).toFixed(1)}p`.padStart(9),
  );
});
const dt = (Date.now() - t0) / 1000;
console.log(`\n  ${moved}/${pairs.length} 对移动 ≥2p（CRN 配对下 ≥2p 已是实质移动）`);
console.log(`共 ${pairs.length * 2 * n * 2} 局，耗时 ${dt.toFixed(1)}s`);
