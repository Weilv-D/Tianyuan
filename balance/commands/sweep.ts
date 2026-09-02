/**
 * OAT 灵敏度扫描器 —— 「猜方向 → 快扫 → 有效则精扫 → 写回源码」工作流的主入口。
 *
 * 用法：
 *   balance sweep <spec.json>                      # 按 spec 跑轴扫描（balance/specs/ 有示例）
 *   balance sweep --set champ.pan.base.atk=60,...  # 快速 A/B：一组覆盖 vs 基线
 *   旗标：--n 80 --seed S --workers W --serial --comps f.json --compare <runId|旧工件.json>
 *
 * 与旧 sim:sweep 的输出形态一致（Δ 基线/极差/边际斜率），结果全部入库 ——
 * 上一轮对比从「指认一个 JSON 文件」升级为「--compare <runId> 读库」，旧 JSON 路径仍兼容。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { noiseBand, runConfigs, type MatrixConfig } from '../lib/matrix';
import { readCurrent, type Overrides } from '../lib/patch';
import { defaultWorkers } from '../lib/pool';
import { edgeStats, printDeltaReport, printSlopes, shortName } from '../lib/report';
import { DEFAULT_SEED_BASE } from '../lib/seeds';
import { loadComps } from '../lib/comps';
import { requirePositiveInt } from '../lib/args';
import { Store } from '../lib/store';

interface Axis {
  path: string;
  values: number[];
}
interface SweepSpec {
  name: string;
  note?: string;
  axes: Axis[];
  /** 单组覆盖（--set 生成；spec 文件一般不用） */
  single?: Overrides;
}

const VALUED = ['n', 'seed', 'workers', 'comps', 'compare', 'set'];

export async function run(argv: string[]): Promise<void> {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z][a-z0-9-]*)$/i.exec(argv[i]);
    if (m && VALUED.includes(m[1])) flags.set(m[1], argv[++i] ?? '');
    else if (m) flags.set(m[1], '');
    else rest.push(argv[i]);
  }

  const { comps, source: compsSource, warnings } = loadComps(flags.get('comps'));
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  const n = requirePositiveInt(flags.get('n'), '每对局数', 80);
  const seedBase = requirePositiveInt(flags.get('seed'), '种子基', DEFAULT_SEED_BASE);
  const workers = flags.has('serial') ? 0 : requirePositiveInt(flags.get('workers'), '并行度', defaultWorkers());
  const setArg = flags.get('set');
  const compareArg = flags.get('compare');

  let spec: SweepSpec;
  if (rest[0]) {
    spec = JSON.parse(readFileSync(resolve(rest[0]), 'utf8')) as SweepSpec;
    if (!spec.name || !Array.isArray(spec.axes)) throw new Error('sweep spec 需要 name 与 axes');
  } else if (setArg) {
    const ov: Overrides = {};
    for (const kv of setArg.split(',')) {
      const [k, v] = kv.split('=');
      ov[k.trim()] = Number(v);
    }
    spec = { name: 'quick-ab', axes: [], note: `--set ${setArg}`, single: ov };
  } else {
    throw new Error('用法：balance sweep <spec.json> | --set path=value[,path=value] [--n 80] [--compare <runId|file>]');
  }

  // 配置表：基线 + 各轴各值 + 单组覆盖
  const configs: MatrixConfig[] = [{ label: '基准（无覆盖）', overrides: {} }];
  for (const axis of spec.axes) {
    const base = readCurrent(axis.path);
    console.log(`【轴 ${axis.path}】${base === undefined ? '（默认值在代码字面量里）' : `基准 ${base}`}`);
    for (const v of axis.values) configs.push({ label: `${axis.path}=${v}`, overrides: { [axis.path]: v } });
  }
  if (spec.single && Object.keys(spec.single).length > 0) {
    configs.push({ label: Object.entries(spec.single).map(([k, v]) => `${k}=${v}`).join(' '), overrides: spec.single });
  }

  console.log(`═════════ 百战天元 · 数值灵敏度扫描 ═════════`);
  console.log(`spec ${spec.name}   每对 ${n} 局 × ${comps.length}×${comps.length - 1} 配对 × ${configs.length} 配置   种子 ${seedBase}（全配置共用 = CRN）`);
  if (spec.note) console.log(`note  ${spec.note}`);
  const band = noiseBand(n, comps.length, 2.64);
  console.log(`同步噪声带 ±${(band * 100).toFixed(1)}%（${comps.length} 阵容 Bonferroni 95%；CRN 配对下实际更小）\n`);

  const t0 = Date.now();
  const outcomes = await runConfigs(configs, {
    comps, n, seedBase, workers,
    onConfigDone: (label, oc) => {
      const es = edgeStats(oc.matrix);
      const oob = oc.winRate.filter((w) => w < 0.44 || w > 0.58).length;
      console.log(`  ✓ ${label}   极差 ${(oc.spread * 100).toFixed(1)}%   阵容带外 ${oob}   绝对边 ${es.violations.length}（最弱 ${(es.minEdge * 100).toFixed(1)}%）   下方均值 ${(oc.meanBottom * 100).toFixed(1)}%`);
    },
  });
  const base = outcomes[0];

  printDeltaReport(comps, base, outcomes, band);
  printSlopes(comps, spec.axes, outcomes);

  // 与上一轮对比：--compare 接受 runId（读库）或旧 JSON 工件路径
  if (compareArg) {
    const prev = loadPrevBaseline(compareArg);
    console.log(`\n═══════════ 对比上一轮（${prev.source} 的基线 → 本轮基线） ═══════════`);
    const len = Math.min(prev.winRate.length, base.winRate.length);
    for (let i = 0; i < len; i++) {
      const d = base.winRate[i] - prev.winRate[i];
      const mark = Math.abs(d) >= band ? '*' : '';
      console.log(`  ${shortName(comps, i).padEnd(6)} ${(prev.winRate[i] * 100).toFixed(1)}% → ${(base.winRate[i] * 100).toFixed(1)}%   Δ${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%${mark}`);
    }
  }

  if (!flags.has('no-save')) {
    const store = new Store();
    try {
      const runId = store.beginRun({
        command: 'sweep', label: spec.name,
        nPerPair: n, seedBase, workers,
        params: { note: spec.note ?? null, axes: spec.axes, compsSource, comps: comps.map((c) => c.name) },
      });
      outcomes.forEach((oc, idx) => {
        const configId = store.addConfig(runId, idx, oc.label, oc.overrides);
        store.addPairs(runId, configId, oc.pairRows);
        store.addUnits(runId, configId, [...oc.units.values()]);
      });
      const es = edgeStats(base.matrix);
      const last = outcomes[outcomes.length - 1];
      const esLast = edgeStats(last.matrix);
      store.finishRun(runId, {
        comps: comps.map((c) => c.name), winRate: base.winRate, spread: base.spread, meanBottom: base.meanBottom,
        edgeFloor: es.minEdge, edgeViolations: es.violations.length,
        patchedWinRate: last.winRate, patchedSpread: last.spread,
        patchedEdgeFloor: esLast.minEdge, patchedEdgeViolations: esLast.violations.length,
      });
      console.log(`\n已入库 run #${runId}（下轮 --compare ${runId} 即可对比）`);
    } finally {
      store.close();
    }
  }

  const dt = (Date.now() - t0) / 1000;
  const total = outcomes.reduce((s, o) => s + o.battles, 0);
  console.log(`共 ${configs.length} 组配置，总 ${total} 局，耗时 ${dt.toFixed(1)}s（${Math.round(total / dt)} 局/秒）`);
}

function loadPrevBaseline(ref: string): { source: string; winRate: number[] } {
  if (/^\d+$/.test(ref)) {
    const store = new Store();
    try {
      const row = store.runById(Number(ref));
      if (!row?.summary_json) throw new Error(`run #${ref} 不存在或无 summary`);
      const summary = JSON.parse(row.summary_json) as { winRate?: number[] };
      if (!summary.winRate) throw new Error(`run #${ref} 的 summary 缺 winRate`);
      return { source: `run #${ref}（${row.game_version}）`, winRate: summary.winRate };
    } finally {
      store.close();
    }
  }
  const legacy = JSON.parse(readFileSync(resolve(ref), 'utf8')) as { results?: { label: string; winRate: number[] }[] };
  const b = legacy.results?.[0]?.winRate;
  if (!b) throw new Error(`旧工件 ${ref} 里没有基线 winRate`);
  return { source: ref, winRate: b };
}
