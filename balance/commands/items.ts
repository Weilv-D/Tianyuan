/**
 * 装备强度专项 —— 「装备维」的标定测量（原 scripts/sim-items.ts，进程池化 + 入库）。
 *
 * 为什么要单独跑而不是混在流派对拍里：装备是乘在阵容之上的增量，不参与
 * 羁绊档位取舍，强度必须用「同一阵容装与不装的胜率差」来量。
 *
 * 三个检验（口径与旧脚本逐位一致，种子方案不变）：
 *  1. 单件边际价值 —— 每件装备值多少胜率，是否都落在同一区间
 *  2. 组件 → 成品 —— 合成必须是正收益
 *  3. 边际递减 —— 同件堆叠（3a，机制不叠加仅属性线性）与异件协同（3b，logit 口径）
 *
 * 用法：balance items [n] [--ids=id1,id2] [--workers W] [--serial] [--no-save]
 *   --ids 定向复测：只测指定件（可加大 n），跳过合成/曲线段
 */
import { noiseBand } from '../lib/matrix';
import { ITEMS } from '../../src/data/items';
import { PRESET_COMPS } from '../../src/game/comp';
import { pairedItemsDelta } from '../lib/engine';
import { runPool, defaultWorkers, WORKERS_CAP } from '../lib/pool';
import { requirePositiveInt } from '../lib/args';
import { Store } from '../lib/store';

const CURVE_ITEMS = ['duanhun', 'pojia', 'xueyin'];
const STACK_ITEM = 'duanhun';

export async function run(argv: string[]): Promise<void> {
  const idsArg = argv.find((a) => a.startsWith('--ids='));
  const ONLY: readonly string[] | null = idsArg ? idsArg.slice('--ids='.length).split(',').filter((s) => s.length > 0) : null;
  if (ONLY) {
    // 与 loadComps 的"引用不存在即抛"同口径：静默过滤会空跑一轮后空入库
    if (ONLY.length === 0) throw new Error('--ids 值为空：至少给一个装备 id');
    const unknown = ONLY.filter((id) => !ITEMS.some((it) => it.id === id));
    if (unknown.length > 0) throw new Error(`--ids 引用不存在的装备：${unknown.join('、')}`);
  }
  const posN = argv.find((a) => !a.startsWith('--') && /^\d+$/.test(a));
  const n = requirePositiveInt(posN, '每格种子数', 16);
  const workersIdx = argv.indexOf('--workers');
  const workers = argv.includes('--serial') ? 0 : Math.min(requirePositiveInt(workersIdx >= 0 ? argv[workersIdx + 1] : undefined, '并行度', defaultWorkers()), WORKERS_CAP);
  const save = !argv.includes('--no-save');

  const COMPS = PRESET_COMPS.length;
  const PAIRS = COMPS * (COMPS - 1);
  const GAMES_PER_ITEM = PAIRS * n * 4;

  console.log('═════════ 百战天元 · 装备强度专项 ═════════\n');
  console.log(`配对设计：${COMPS} 套预设 × ${COMPS - 1} 个对手（有序配对）× ${n} 种子 × 4（带装/裸装 × 正位/镜像）= ${GAMES_PER_ITEM} 局/件${ONLY ? `（定向复测：${ONLY.join('、')}，跳过合成/曲线段）` : ''}  ${workers > 0 ? `${workers} 进程` : '串行'}\n`);

  const t0 = Date.now();

  // 度量键集合：全部装备（或 --ids 定向）+ 堆叠/协同曲线档
  const keys: { key: string; items: string[] }[] = ITEMS
    .filter((it) => !ONLY || ONLY.includes(it.id))
    .map((it) => ({ key: it.id, items: [it.id] }));
  if (!ONLY) {
    for (let k = 1; k <= 3; k++) keys.push({ key: `stack:${k}`, items: Array<string>(k).fill(STACK_ITEM) });
    for (let k = 1; k <= 3; k++) keys.push({ key: `mix:${k}`, items: CURVE_ITEMS.slice(0, k) });
  }

  // 池化执行：每 (键, 有序配对) 一个作业；种子基沿用旧口径 ——
  // 单件 = 500000 + i*131 + j*17，堆叠/协同 = 700000 + i*31 + j*7
  const seedOfPair = (i: number, j: number, key: string): number => {
    const base = key.startsWith('stack:') || key.startsWith('mix:') ? 700000 + i * 31 + j * 7 : 500000 + i * 131 + j * 17;
    return base;
  };
  const delta = new Map<string, { sum: number; cnt: number; withSum: number; withoutSum: number }>();
  const record = (key: string, d: number, withRate: number, withoutRate: number): void => {
    const cur = delta.get(key) ?? { sum: 0, cnt: 0, withSum: 0, withoutSum: 0 };
    cur.sum += d;
    cur.withSum += withRate;
    cur.withoutSum += withoutRate;
    cur.cnt += 1;
    delta.set(key, cur);
  };
  if (workers > 0) {
    const jobs = keys.flatMap((k) => {
      const out: { kind: 'item'; itemKey: string; items: string[]; i: number; j: number; n: number; seedBase: number }[] = [];
      for (let i = 0; i < COMPS; i++) for (let j = 0; j < COMPS; j++) {
        if (i === j) continue;
        out.push({ kind: 'item', itemKey: k.key, items: k.items, i, j, n, seedBase: seedOfPair(i, j, k.key) });
      }
      return out;
    });
    const results = await runPool(jobs, { comps: PRESET_COMPS, workers });
    for (const r of results) {
      if (r.kind !== 'item') continue;
      record(r.itemKey, r.diff, r.withRate, r.withoutRate);
    }
  } else {
    for (const k of keys) {
      for (let i = 0; i < COMPS; i++) for (let j = 0; j < COMPS; j++) {
        if (i === j) continue;
        const d = pairedItemsDelta(i, j, k.items, n, seedOfPair(i, j, k.key), PRESET_COMPS);
        record(k.key, d.diff, d.withRate, d.withoutRate);
      }
    }
  }
  const meanOf = (key: string): number => {
    const v = delta.get(key);
    return v && v.cnt > 0 ? v.sum / v.cnt : 0;
  };
  // 噪声带（与 matrix 同 z 口径）：每键有效样本 = 有序配对数 × n（每作业 n 局
  // 配对差），带内读数不构成强弱结论 —— 此前全程点估计，小样本 Δ 无法与噪声区分
  const bandOf = (key: string): number => noiseBand(Math.max(1, delta.get(key)?.cnt ?? 1) * n, 2, 2.64);

  // ── 1. 单件边际价值 ────────────────────────────────────
  console.log('【单件边际价值】同一阵容装 1 件 vs 不装，胜率增量\n');
  const rows = ITEMS.filter((it) => !ONLY || ONLY.includes(it.id)).map((it) => ({
    id: it.id, name: it.name,
    tier: it.tier === 'component' ? '组件' : '成品',
    recipe: it.recipe,
    d: meanOf(it.id),
    withRate: delta.get(it.id)?.withSum ?? 0,
    withoutRate: delta.get(it.id)?.withoutSum ?? 0,
    cnt: delta.get(it.id)?.cnt ?? 0,
  })).sort((a, b) => b.d - a.d);

  const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  for (const r of rows) {
    const cells = Math.min(26, Math.abs(Math.round(r.d * 300)));
    const bar = r.d >= 0 ? ' '.repeat(11) + '▇'.repeat(cells) : ' '.repeat(Math.max(0, 11 - cells)) + '▇'.repeat(cells);
    const inBand = Math.abs(r.d) <= bandOf(r.id) ? '≈' : '  ';
    console.log(`  ${r.name.padEnd(5)} ${r.tier}  ${pct(r.d).padStart(7)} ${inBand} ${bar}`);
  }
  console.log(`  （≈ = 带内读数，±2.64σ 噪声带约 ±${(bandOf(rows[0]?.id ?? ITEMS[0].id) * 100).toFixed(1)}p，带内不构成强弱结论）`);

  if (ONLY) {
    const dt = (Date.now() - t0) / 1000;
    console.log(`\n定向复测共约 ${ONLY.length * GAMES_PER_ITEM} 局，耗时 ${dt.toFixed(1)}s（合成/曲线段已跳过）`);
    await saveItems(rows, n, workers, save);
    return;
  }

  const comp = rows.filter((r) => r.tier === '组件');
  const comb = rows.filter((r) => r.tier === '成品');
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const avgComp = avg(comp.map((r) => r.d));
  const avgComb = avg(comb.map((r) => r.d));
  console.log(`\n  组件均值 ${pct(avgComp)}　成品均值 ${pct(avgComb)}　成品/组件 = ${(avgComb / (avgComp || 1)).toFixed(2)}×`);

  const cd = comb.map((r) => r.d);
  const spread = Math.max(...cd) - Math.min(...cd);
  console.log(`  成品极差 ${(spread * 100).toFixed(1)}%  ${spread < 0.16 ? '✓ 无超模装备' : '⚠ 需要调平'}`);
  console.log(`  合成倍率 ${(avgComb / (avgComp || 1)).toFixed(2)}×  ${avgComb > avgComp * 1.5 ? '✓ 合成有明确动机' : '⚠ 合成收益不足'}`);

  const warn: string[] = [];
  for (const r of comb) {
    const band = bandOf(r.id);
    // 带内读数只标注不定罪：±2.64σ 内的偏离无法与抽样噪声区分
    if (r.d > avgComb * 1.9 && r.d > 0.05) warn.push(`${r.name} 过强 ${pct(r.d)}`);
    if (r.d < avgComb * 0.45 && r.d < -band) warn.push(`${r.name} 过弱 ${pct(r.d)}`);
    else if (r.d < avgComb * 0.45) console.log(`  ≈ ${r.name} 低于均值 ${pct(r.d)}（噪声带内，不下结论）`);
    if (r.d < 0 && r.d < -band) warn.push(`${r.name} 负收益 ${pct(r.d)}`);
  }

  // ── 2. 合成正收益（复用检验 1 的结果，零额外对局）──────
  console.log('\n【合成正收益】成品 对比 它的两个组件分别装在不同人身上\n');
  console.log('  ' + '成品'.padEnd(7) + '成品增量   组件增量    合成增益');
  console.log('  ' + '─'.repeat(44));
  let recipeOk = 0;
  let recipeTotal = 0;
  for (const r of rows) {
    if (r.tier !== '成品' || !r.recipe) continue;
    const [a, b] = r.recipe;
    const da = meanOf(a);
    const db = meanOf(b);
    const gain = r.d - (da + db);
    recipeTotal += 1;
    if (gain > 0) recipeOk += 1;
    else warn.push(`${r.name} 合成负收益 ${pct(gain)}`);
    console.log(`  ${gain > 0 ? '✓' : '✗'} ${r.name.padEnd(5)} ${pct(r.d).padStart(8)}  ${pct(da + db).padStart(8)}  ${pct(gain).padStart(9)}`);
  }
  console.log(`\n  ${recipeOk}/${recipeTotal} 件成品强于拆开装`);

  // ── 3a 同件堆叠 ────────────────────────────────────────
  console.log(`\n【3a 同件堆叠】${STACK_ITEM} ×0/1/2/3（机制不叠加，仅属性线性）`);
  const stackWin: number[] = [0];
  for (let k = 1; k <= 3; k++) stackWin[k] = meanOf(`stack:${k}`);
  let prevD = 0;
  const stackMarg: number[] = [];
  for (let k = 0; k <= 3; k++) {
    const d = stackWin[k];
    if (k > 0) stackMarg.push(d - prevD);
    console.log(`  ${k} 件　胜率增量 ${pct(d).padStart(7)}　${k === 0 ? '（基准）' : `本件边际 ${pct(d - prevD)}`}`);
    prevD = d;
  }
  const stackDim = stackMarg.length >= 2 && stackMarg[1] < stackMarg[0] && (stackMarg.length < 3 || stackMarg[2] < stackMarg[0]);
  console.log(`  ${stackDim ? '✓ 同件堆叠边际递减成立' : '⚠ 同件堆叠未递减 —— 检查机制参数是否被错误叠加'}`);

  // ── 3b 异件协同（logit 口径防逻辑斯蒂陡段虚高）────────
  console.log(`\n【3b 异件协同】（${CURVE_ITEMS.map((i) => ITEMS.find((x) => x.id === i)?.name).join('、')}）以 logit 边际度量`);
  const logit = (p: number): number => {
    const q = Math.min(0.98, Math.max(0.02, p));
    return Math.log(q / (1 - q));
  };
  const mixWin: number[] = [0];
  for (let k = 1; k <= 3; k++) mixWin[k] = meanOf(`mix:${k}`);
  const logitMarg: number[] = [];
  for (let k = 1; k <= 3; k++) {
    const m = logit(0.5 + mixWin[k]) - logit(0.5 + mixWin[k - 1]);
    logitMarg.push(m);
    console.log(`  ${k} 件　胜率 ${pct(0.5 + mixWin[k])}　logit 边际 ${m.toFixed(3)}`);
  }
  const explode = logitMarg.some((m) => m > logitMarg[0] * 1.5);
  console.log(`  ${explode ? '⚠ logit 边际超首件 1.5 倍 —— 存在指数型协同，需要抑制' : '✓ 协同有界（logit 边际 ≤ 首件 ×1.5）'}`);

  if (warn.length) {
    console.log('\n【待调平】');
    warn.forEach((w) => console.log(`  ⚠ ${w}`));
  } else {
    console.log('\n【待调平】\n  ✓ 无越界项');
  }

  const dt = (Date.now() - t0) / 1000;
  const total = (ITEMS.length + 6) * GAMES_PER_ITEM;
  console.log(`\n共约 ${total} 局，耗时 ${dt.toFixed(1)}s（${Math.round(total / dt)} 局/秒）`);
  console.log(`装备总数 ${ITEMS.length}（组件 ${comp.length} / 成品 ${comb.length}）`);

  await saveItems(rows, n, workers, save);
}

async function saveItems(rows: { id: string; withRate: number; withoutRate: number; cnt: number }[], n: number, workers: number, save: boolean): Promise<void> {
  if (!save) return;
  const store = new Store();
  try {
    const runId = store.beginRun({
      command: 'items', label: '装备边际全表',
      nPerPair: n, seedBase: 500000, workers,
      params: { mode: 'full' },
    });
    store.addItemResults(runId, rows.map((r) => ({
      itemId: r.id, n: r.cnt * n,
      baselineRate: r.cnt > 0 ? r.withoutRate / r.cnt : 0,
      itemRate: r.cnt > 0 ? r.withRate / r.cnt : 0,
    })));
    store.finishRun(runId, { items: rows.length });
    console.log(`已入库 run #${runId}`);
  } finally {
    store.close();
  }
}
