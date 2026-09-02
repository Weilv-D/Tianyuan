/**
 * 羁绊边际贡献 —— 「羁绊维」的标定测量（本框架新增能力）。
 *
 * 对每套阵容的每条激活羁绊做一次「压制 vs 基线」的 CRN 配对：
 *   压制 = trait.<id>.scale=0（该羁绊全部量级数字归零，档位计数保留），
 *   只跑该阵容参与的双向配对，与基线同种子表相减 →
 *   Δ = 这条羁绊的数值给这套阵容贡献的胜率点数（负得多 = 贡献大）。
 *
 * 读数须知：scale=0 压制的是 tune() 读取的全部量级数字（含各档）；
 * 若某羁绊存在非数值的结构性效果（如化形换形），该部分不会被压制 ——
 * 结果应读作「数值档贡献下界」，跨羁绊横向对比时口径一致。
 *
 * 用法：balance traits [n] [--seed S] [--workers W] [--serial] [--comps f.json] [--no-save]
 */
import { computeTraits, type CompSpec } from '../../src/game/comp';
import { TRAIT_BY_ID } from '../../src/data/traits';
import { assemble, runConfigs, type ConfigOutcome, type MatrixConfig } from '../lib/matrix';
import { withOverrides } from '../lib/patch';
import { runPair } from '../lib/engine';
import { runPool } from '../lib/pool';
import { runCtx } from '../lib/runctx';
import { shortName } from '../lib/report';
import { Store } from '../lib/store';

interface SelectiveMeta {
  comp: number;
  traitId: string;
  configIdx: number;
}

export async function run(argv: string[]): Promise<void> {
  const ctx = runCtx(argv, 60);
  const len = ctx.comps.length;
  const t0 = Date.now();

  // 每套阵容的激活羁绊（tier ≥ 0）
  const activeByComp = ctx.comps.map((c) => computeTraits(Object.keys(c.units)).filter((t) => t.tier >= 0));
  const traitJobs = activeByComp.flatMap((ts, i) => ts.map((t) => ({ comp: i, trait: t })));
  console.log(`═════════ 百战天元 · 羁绊边际贡献 ═════════`);
  console.log(`阵容 ${len} 套  激活羁绊 ${traitJobs.length} 条  每对 ${ctx.n} 局（CRN 配对）  ${ctx.workers > 0 ? `${ctx.workers} 进程` : '串行'}\n`);

  // 配置表：idx 0 = 基线全矩阵；idx 1..N = 各 (阵容,羁绊) 的 scale=0 压制
  const configs: MatrixConfig[] = [{ label: '基准（无覆盖）', overrides: {} }];
  const meta: SelectiveMeta[] = [];
  traitJobs.forEach((tj, k) => {
    const configIdx = 1 + k;
    configs.push({
      label: `${shortName(ctx.comps, tj.comp)} · ${TRAIT_BY_ID[tj.trait.id]?.name ?? tj.trait.id} 归零`,
      overrides: { [`trait.${tj.trait.id}.scale`]: 0 },
    });
    meta.push({ comp: tj.comp, traitId: tj.trait.id, configIdx });
  });

  const outcomes = await runSelective(configs, meta, ctx.comps, ctx.n, ctx.seedBase, ctx.workers);
  const base = outcomes[0];

  const rows = meta.map((m) => {
    const oc = outcomes[m.configIdx];
    const suppressed = oc.winRate[m.comp];
    const baseRate = base.winRate[m.comp];
    return {
      comp: m.comp,
      traitId: m.traitId,
      traitName: TRAIT_BY_ID[m.traitId]?.name ?? m.traitId,
      tier: activeByComp[m.comp].find((t) => t.id === m.traitId)?.tier ?? -1,
      baseRate,
      suppressed,
      delta: suppressed - baseRate,
      battles: oc.battles,
    };
  });

  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log('【明细】Δ = 压制后该阵容胜率 - 基线（负得多 = 羁绊贡献大）');
  console.log('  ' + '羁绊'.padEnd(6) + '档  阵容'.padEnd(8) + '基线    压制    Δ');
  for (const r of rows) {
    console.log(
      `  ${r.traitName.padEnd(6)}${String(r.tier).padStart(2)}  ${shortName(ctx.comps, r.comp).padEnd(8)}` +
        `${(r.baseRate * 100).toFixed(1).padStart(5)}%  ${(r.suppressed * 100).toFixed(1).padStart(5)}%  ${r.delta >= 0 ? '+' : ''}${(r.delta * 100).toFixed(1)}p`,
    );
  }

  const byTrait = new Map<string, { name: string; sum: number; cnt: number }>();
  for (const r of rows) {
    const cur = byTrait.get(r.traitId) ?? { name: r.traitName, sum: 0, cnt: 0 };
    cur.sum += r.delta;
    cur.cnt += 1;
    byTrait.set(r.traitId, cur);
  }
  console.log('\n【跨阵容均值】（按贡献排序；仅在少数阵容激活的羁绊读数需结合明细）');
  const agg = [...byTrait.entries()].map(([id, v]) => ({ id, name: v.name, mean: v.sum / v.cnt, cnt: v.cnt })).sort((a, b) => a.mean - b.mean);
  for (const a of agg) {
    console.log(`  ${a.name.padEnd(6)} 贡献 ${a.mean >= 0 ? '+' : ''}${(a.mean * 100).toFixed(1)}p（${a.cnt} 套阵容激活）`);
  }

  const dt = (Date.now() - t0) / 1000;
  const total = rows.reduce((s, r) => s + r.battles, 0) + base.battles;
  console.log(`\n共 ${total} 局，耗时 ${dt.toFixed(1)}s（${Math.round(total / dt)} 局/秒）`);

  if (ctx.save) {
    const store = new Store();
    try {
      const runId = store.beginRun({
        command: 'traits', label: `羁绊贡献 ${len} 套`,
        nPerPair: ctx.n, seedBase: ctx.seedBase, workers: ctx.workers,
        params: { compsSource: ctx.compsSource, comps: ctx.comps.map((c) => c.name) },
      });
      const baseConfigId = store.addConfig(runId, 0, base.label, base.overrides);
      store.addPairs(runId, baseConfigId, base.pairRows);
      store.addTraitResults(runId, rows.map((r) => ({
        compIdx: r.comp, traitId: r.traitId, n: ctx.n, baseRate: r.baseRate, suppressedRate: r.suppressed,
      })));
      store.finishRun(runId, { comps: ctx.comps.map((c) => c.name), winRate: base.winRate, spread: base.spread });
      console.log(`已入库 run #${runId}`);
    } finally {
      store.close();
    }
  }
}

/**
 * 基线跑全矩阵（runConfigs）；压制配置只跑涉及自己阵容的双向配对 ——
 * 该阵容的双向平均胜率是唯一观测量，省下的局数就是压制配置数 × (len-1) × n × 2。
 */
async function runSelective(
  configs: readonly MatrixConfig[],
  meta: readonly SelectiveMeta[],
  comps: readonly CompSpec[],
  n: number,
  seedBase: number,
  workers: number,
): Promise<ConfigOutcome[]> {
  const len = comps.length;
  const [baseline] = await runConfigs([configs[0]], { comps, n, seedBase, workers });
  const outcomes: ConfigOutcome[] = new Array(configs.length);
  outcomes[0] = baseline;

  const selective: { i: number; j: number; configIdx: number }[] = [];
  for (const m of meta) {
    for (let j = 0; j < len; j++) {
      if (j === m.comp) continue;
      selective.push({ i: m.comp, j, configIdx: m.configIdx });
      selective.push({ i: j, j: m.comp, configIdx: m.configIdx });
    }
  }

  if (workers > 0) {
    const jobs = selective.map((p) => ({
      kind: 'pair' as const, configIdx: p.configIdx, i: p.i, j: p.j, n, seedBase,
      overrides: configs[p.configIdx].overrides,
    }));
    const results = await runPool(jobs, { comps, workers });
    for (const m of meta) {
      const rows = results
        .filter((r): r is import('../lib/pool').PairResult => r.kind === 'pair' && r.configIdx === m.configIdx)
        .map((r) => ({
          i: r.i, j: r.j, n: r.n, topWins: r.topWins, bottomWins: r.bottomWins, draws: r.draws,
          totalTicks: r.totalTicks, timeouts: r.timeouts, top: r.top, bottom: r.bottom,
        }));
      outcomes[m.configIdx] = assemble(configs[m.configIdx].label, configs[m.configIdx].overrides, comps, rows);
    }
    return outcomes;
  }

  for (const m of meta) {
    const rows = withOverrides(configs[m.configIdx].overrides, () =>
      selective
        .filter((p) => p.configIdx === m.configIdx)
        .map((p) => ({ i: p.i, j: p.j, ...runPair(p.i, p.j, n, seedBase, comps) })),
    );
    outcomes[m.configIdx] = assemble(configs[m.configIdx].label, configs[m.configIdx].overrides, comps, rows);
  }
  return outcomes;
}
