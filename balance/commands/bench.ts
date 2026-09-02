/**
 * 吞吐基准 —— 判断平衡模拟该开多大规模 + 验证进程池扩展性。
 *
 * 用法：balance bench [n] [--scaling]
 *   基线段：单进程 n 局（旧 bench 口径：机关 vs 法爆、含一件装备）；
 *   --scaling：同一 144 局作业集分别在 1/4/16 进程上跑，报告加速比 ——
 *   进程池的实际收益随机器核数变化，这个数是「深度利用硬件」的实测证据。
 */
import { Battle } from '../../src/core/battle';
import { PRESET_COMPS, buildTeam } from '../../src/game/comp';
import { runPool } from '../lib/pool';
import { requirePositiveInt } from '../lib/args';

export async function run(argv: string[]): Promise<void> {
  const posN = argv.find((a) => !a.startsWith('--') && /^\d+$/.test(a));
  const N = requirePositiveInt(posN, '基准局数', 300);

  // ── 基线：单进程（与旧 bench.ts 同口径）────────────────
  const t0 = Date.now();
  let ticks = 0;
  let timeouts = 0;
  for (let i = 0; i < N; i++) {
    const a = buildTeam(PRESET_COMPS[0], 0, 1, ['duanhun']);
    const b = buildTeam(PRESET_COMPS[1], 1, 200, []);
    const r = new Battle(
      { seed: 1000 + i * 7919, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } },
      null,
      false,
    ).run();
    ticks += r.ticks;
    if (r.timeout) timeouts += 1;
  }
  const dt = (Date.now() - t0) / 1000;
  console.log(`battles ${N}  time ${dt.toFixed(2)}s  = ${Math.round(N / dt)} battles/s（单进程）`);
  console.log(`avg ticks ${(ticks / N).toFixed(0)}  = ${(ticks / N / 30).toFixed(1)}s per battle  timeouts ${timeouts}`);

  if (!argv.includes('--scaling')) return;

  // ── 扩展性：同一作业集在不同并行度下的实测 ──────────────
  console.log('\n【进程池扩展性】同一 144 配对作业（9×8 矩阵 × n=2，无覆盖）');
  console.log('  进程   耗时(s)   加速比');
  let base1 = 0;
  for (const w of [1, 4, 16]) {
    const jobs = [];
    for (let i = 0; i < PRESET_COMPS.length; i++) {
      for (let j = 0; j < PRESET_COMPS.length; j++) {
        if (i === j) continue;
        jobs.push({ kind: 'pair' as const, configIdx: 0, i, j, n: 2, seedBase: 20260902, overrides: {} });
      }
    }
    const t1 = Date.now();
    await runPool(jobs, { comps: PRESET_COMPS, workers: w });
    const el = (Date.now() - t1) / 1000;
    if (w === 1) base1 = el;
    console.log(`  ${String(w).padStart(4)}   ${el.toFixed(2).padStart(6)}   ×${(base1 / el).toFixed(1)}`);
  }
  console.log('  （含 fork 启动开销；作业越大、加速比越接近物理核数上限）');
}
