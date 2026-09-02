/**
 * 定向配对 A/B —— 极端克制边的压缩验证器（原 scripts/ab-pair.ts，进程池化）。
 *
 * 场景：全矩阵告诉你"机关胜快攻 90%"这类极端边，但全矩阵每格局数被摊薄，
 * 2~4 个百分点的定向移动淹没在噪声带里。本命令只跑关心的配对，把全部局数
 * 集中在它们身上，用 CRN 配对相减直接回答"这个改动把这条边移动了多少"。
 *
 * 用法：balance ab --set trait.jiguan.armor=16 [--set k=v ...] [--n 200] [--pairs 4]
 *   --pairs 聚焦下标（逗号分隔，默认 4）；--serial 走本进程串行。
 */
import { DEFAULT_SEED_BASE } from '../lib/seeds';
import { Patcher, readCurrent, withOverrides, type Overrides } from '../lib/patch';
import { runPair, type PairRun } from '../lib/engine';
import { runPool, defaultWorkers, type PoolJob, type PoolResult } from '../lib/pool';
import { loadComps } from '../lib/comps';
import { shortName } from '../lib/report';
import { requirePositiveInt } from '../lib/args';
import { Store } from '../lib/store';

export async function run(argv: string[]): Promise<void> {
  const overrides: Overrides = {};
  let n = 200;
  let focus = '4';
  let seedBase = DEFAULT_SEED_BASE;
  let workers = defaultWorkers();
  const save = !argv.includes('--no-save');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') {
      const kv = argv[++i] ?? '';
      const eq = kv.indexOf('=');
      if (eq === -1) throw new Error("--set 需要 key=value 形式，收到：" + kv);
      const k = kv.slice(0, eq).trim();
      if (!k) throw new Error('--set 键不能为空，收到：' + kv);
      const v = Number(kv.slice(eq + 1).trim());
      if (!Number.isFinite(v)) throw new Error('--set 值须为有限数字，收到：' + kv);
      overrides[k] = v;
    } else if (a === '--n') n = requirePositiveInt(argv[++i], '--n', 200);
    else if (a === '--pairs') focus = argv[++i] ?? '4';
    else if (a === '--seed') seedBase = requirePositiveInt(argv[++i], '--seed', DEFAULT_SEED_BASE);
    else if (a === '--workers') workers = requirePositiveInt(argv[++i], '--workers', defaultWorkers());
    else if (a === '--serial') workers = 0;
  }
  if (Object.keys(overrides).length === 0) {
    throw new Error('用法：balance ab --set path=value [--n 200] [--pairs 4] [--seed S] [--serial]');
  }
  // 覆盖路径预检：非法路径（未知棋子/字段/非有限值）在 fork 子进程前一次性暴露，
  // 与 sweep 同口径 —— 否则坏路径要等子进程作业里才抛，白费算力且报错上下文更差
  {
    const probe = new Patcher();
    try {
      probe.apply(overrides);
    } finally {
      probe.reset();
    }
  }
  const { comps } = loadComps();
  const focusSet = new Set(focus.split(',').map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x < comps.length));
  if (focusSet.size === 0) throw new Error(`--pairs 下标全部非法：${focus}`);

  const len = comps.length;
  const pairs: [number, number][] = [];
  for (const f of [...focusSet].sort((a, b) => a - b)) {
    for (let j = 0; j < len; j++) if (j !== f) pairs.push([f, j]);
  }
  const name = (i: number): string => shortName(comps, i);

  console.log(`═════════ 百战天元 · 定向配对 A/B ═════════`);
  console.log(`覆盖：${Object.entries(overrides).map(([k, v]) => `${k}=${v}（原 ${(readCurrent(k) ?? '?').toString()}）`).join('，')}`);
  console.log(`配对：${[...focusSet].map((f) => name(f)).join('/')} 相关 ${pairs.length} 对 × 双向 × ${n} 局（CRN）${workers > 0 ? `  ${workers} 进程` : '  串行'}\n`);

  const t0 = Date.now();
  /** 每 arm：pair → 双向平均胜率（i 的视角） */
  const runArm = async (armIdx: number, ov: Overrides): Promise<{ wins: Map<string, number>; rows: (PairRun & { i: number; j: number })[] }> => {
    if (workers > 0) {
      const jobs: PoolJob[] = [];
      for (const [i, j] of pairs) {
        jobs.push({ kind: 'pair', configIdx: armIdx, i, j, n, seedBase, overrides: ov });
        jobs.push({ kind: 'pair', configIdx: armIdx, i: j, j: i, n, seedBase, overrides: ov });
      }
      const results = await runPool(jobs, { comps, workers });
      const rows = results.filter((r): r is Extract<PoolResult, { kind: 'pair' }> => r.kind === 'pair')
        .map((r) => ({ i: r.i, j: r.j, n: r.n, topWins: r.topWins, bottomWins: r.bottomWins, draws: r.draws, totalTicks: r.totalTicks, timeouts: r.timeouts, top: r.top, bottom: r.bottom }));
      return { wins: rollPairWins(rows, pairs), rows };
    }
    const rows = withOverrides(Object.keys(ov).length > 0 ? ov : null, () =>
      pairs.flatMap(([i, j]) => [
        { i, j, ...runPair(i, j, n, seedBase, comps) },
        { i: j, j: i, ...runPair(j, i, n, seedBase, comps) },
      ]),
    );
    return { wins: rollPairWins(rows, pairs), rows };
  };

  const baseline = await runArm(0, {});
  const patched = await runArm(1, overrides);

  console.log(`  ${'配对'.padEnd(24)}${'基准'.padStart(8)}${'改动后'.padStart(8)}${'移动'.padStart(9)}`);
  console.log('  ' + '─'.repeat(50));
  let moved = 0;
  pairs.forEach(([i, j]) => {
    const key = `${i}:${j}`;
    const b = baseline.wins.get(key) ?? 0;
    const p = patched.wins.get(key) ?? 0;
    const d = p - b;
    if (Math.abs(d) >= 0.02) moved += 1;
    console.log(
      `  ${name(i)} 对 ${name(j)}`.padEnd(24) +
        `${(b * 100).toFixed(1).padStart(7)}%` +
        `${(p * 100).toFixed(1).padStart(8)}%` +
        `${(d >= 0 ? '+' : '') + (d * 100).toFixed(1)}p`.padStart(9),
    );
  });
  const dt = (Date.now() - t0) / 1000;
  console.log(`\n  ${moved}/${pairs.length} 对移动 ≥2p（CRN 配对下 ≥2p 已是实质移动）`);
  console.log(`共 ${pairs.length * 2 * n * 2} 局，耗时 ${dt.toFixed(1)}s`);

  if (save) {
    const store = new Store();
    try {
      const runId = store.beginRun({
        command: 'ab', label: Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(','),
        nPerPair: n, seedBase, workers,
        params: { focus: [...focusSet], overrides, pairs: pairs.length },
      });
      const cfgB = store.addConfig(runId, 0, '基准', {});
      const cfgP = store.addConfig(runId, 1, '覆盖', overrides);
      store.addPairs(runId, cfgB, baseline.rows);
      store.addPairs(runId, cfgP, patched.rows);
      store.finishRun(runId, { focus: [...focusSet], moved, pairs: pairs.length });
      console.log(`已入库 run #${runId}`);
    } finally {
      store.close();
    }
  }
}

/** pair 行 → Map<"i:j", i 视角双向平均胜率> */
function rollPairWins(rows: { i: number; j: number; n: number; topWins: number; bottomWins: number; draws: number }[], pairs: readonly [number, number][]): Map<string, number> {
  const asTop = new Map<string, number>();
  const asBottom = new Map<string, number>();
  for (const r of rows) {
    if (r.i === r.j) continue;
    asTop.set(`${r.i}:${r.j}`, (r.topWins + r.draws * 0.5) / r.n);
    asBottom.set(`${r.i}:${r.j}`, (r.bottomWins + r.draws * 0.5) / r.n);
  }
  const out = new Map<string, number>();
  for (const [i, j] of pairs) {
    const top = asTop.get(`${i}:${j}`) ?? 0;
    const bottom = asBottom.get(`${j}:${i}`) ?? 0;
    out.set(`${i}:${j}`, (top + bottom) / 2);
  }
  return out;
}
