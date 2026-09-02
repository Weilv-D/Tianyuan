/**
 * 阵容断面基线 —— 「阵容维」的标定测量（取代旧 npm run sim 的对拍核心）。
 *
 * 跑全部配对方向的双向矩阵，输出综合胜率/极差/位置公平/超时率，
 * 连同逐单位统计（棋子维数据源）一并入库；--units 顺带打印单位榜。
 *
 * 用法：balance matrix [n] [--seed S] [--workers W] [--serial] [--comps f.json] [--units] [--no-save]
 */
import { runConfigs, noiseBand, type ConfigOutcome } from '../lib/matrix';
import { runCtx } from '../lib/runctx';
import { edgeStats, printMatrixTable, printUnitBoard } from '../lib/report';
import { Store } from '../lib/store';

export async function run(argv: string[]): Promise<void> {
  const ctx = runCtx(argv, 120);
  const showUnits = argv.includes('--units');
  const t0 = Date.now();
  console.log('═════════ 百战天元 · 阵容断面基线 ═════════');
  console.log(`阵容 ${ctx.comps.length} 套（${ctx.compsSource}）  每对 ${ctx.n} 局  种子 ${ctx.seedBase}  ${ctx.workers > 0 ? `${ctx.workers} 进程并行` : '串行'}\n`);

  let outcome: ConfigOutcome | undefined;
  const outcomes = await runConfigs(
    [{ label: '基准（无覆盖）', overrides: {} }],
    {
      comps: ctx.comps, n: ctx.n, seedBase: ctx.seedBase, workers: ctx.workers,
      onConfigDone: (_label, oc) => {
        outcome = oc;
      },
    },
  );
  const oc = outcomes[0];
  if (!outcome) throw new Error('矩阵执行未返回结果');

  printMatrixTable(ctx.comps, oc, noiseBand(ctx.n, ctx.comps.length, 2.64));
  if (showUnits) printUnitBoard(ctx.comps, [...oc.units.values()], 'dealt');

  const dt = (Date.now() - t0) / 1000;
  console.log(`\n共 ${oc.battles} 局，耗时 ${dt.toFixed(1)}s（${ctx.workers > 0 ? `${Math.round(oc.battles / dt)} 局/秒` : `串行 ${Math.round(oc.battles / dt)} 局/秒`}）`);

  if (ctx.save) {
    const store = new Store();
    try {
      const runId = store.beginRun({
        command: 'matrix', label: `矩阵基线 ${ctx.comps.length} 套`,
        nPerPair: ctx.n, seedBase: ctx.seedBase, workers: ctx.workers,
        params: { compsSource: ctx.compsSource, comps: ctx.comps.map((c) => c.name) },
      });
      const configId = store.addConfig(runId, 0, oc.label, oc.overrides);
      store.addPairs(runId, configId, oc.pairRows);
      store.addUnits(runId, configId, [...oc.units.values()]);
      const es = edgeStats(oc.matrix);
      store.finishRun(runId, {
        comps: ctx.comps.map((c) => c.name), winRate: oc.winRate,
        spread: oc.spread, meanBottom: oc.meanBottom, avgTicks: oc.avgTicks,
        timeoutRate: oc.battles > 0 ? oc.timeouts / oc.battles : 0,
        edgeFloor: es.minEdge, edgeViolations: es.violations.length,
      });
      console.log(`已入库 run #${runId}（units 命令与 trend 命令的数据源）`);
    } finally {
      store.close();
    }
  }
}
