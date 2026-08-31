/**
 * 装备强度专项平衡模拟。
 *
 * 为什么要单独跑一遍，而不是混在流派对拍里：
 * 装备是**乘在阵容之上的增量**，它不参与羁绊档位的取舍，
 * 所以它的强度必须用「同一套阵容，装与不装的胜率差」来量 ——
 * 混在流派对拍里，装备的效应会被阵容差异整个淹没。
 *
 * 三个检验：
 *  1. 单件边际价值  —— 每件装备值多少胜率，是否都落在同一区间
 *  2. 组件 → 成品   —— 合成必须是正收益，否则玩家没有合成动机
 *  3. 边际递减      —— 第 2、第 3 件的收益应低于第 1 件，否则后期变纯数值堆砌
 *
 * 两个效率上的关键设计（第一版脚本因此跑了 10 分钟还没完）：
 *
 *  · **配对设计**：基线（无装备）对所有装备都是同一份，只算一次缓存起来。
 *    第一版给每件装备都重算了一遍基线，一半算力花在重复计算上。
 *  · **同种子对照**：装与不装用**同一组种子**，逐种子相减。
 *    装备的效应量只有几个百分点，独立抽样的方差足以把它盖住；
 *    配对后方差大幅下降，因此 N 可以开得比独立设计小得多。
 *    这也让检验 2 变成零成本 —— 组件的边际值已在检验 1 里算过。
 *
 * 用法： npm run sim:items -- [每格种子数] [--ids=id1,id2]
 *
 * --ids：只测指定件（复测定向件时加大种子数用，如 16 → 48），
 * 输出收敛为单件边际表（合成增益 / 边际曲线依赖全表数据，该模式下跳过）。
 * 不传 --ids 时行为与全表模式完全一致。
 */
import { Battle } from '../src/core/battle';
import { PRESET_COMPS, buildTeam, type CompSpec } from '../src/game/comp';
import { ITEMS } from '../src/data/items';

const RAW_ARGS = process.argv.slice(2);
const N = Number(RAW_ARGS.find((a) => !a.startsWith('--')) ?? 16);
const IDS_ARG = RAW_ARGS.find((a) => a.startsWith('--ids='));
/** 只测指定件；null = 全表 */
const ONLY: readonly string[] | null = IDS_ARG ? IDS_ARG.slice('--ids='.length).split(',').filter((s) => s.length > 0) : null;

/** 一次对照：同一批种子下，A 带装备 vs A 不带装备的胜率差 */
function pairedDelta(
  specA: CompSpec,
  specB: CompSpec,
  itemsA: readonly string[],
  seedBase: number,
): number {
  let diff = 0;
  for (let i = 0; i < N; i++) {
    const seed = seedBase + i * 7919;
    // 正向：A 在上方
    const a1 = buildTeam(specA, 0, 1, itemsA);
    const b1 = buildTeam(specB, 1, 200, []);
    const r1 = new Battle(
      { seed, units: [...a1.inputs, ...b1.inputs], traits: { 0: a1.traits, 1: b1.traits } },
      null,
      false,
    ).run();
    const w1 = r1.winner === 0 ? 1 : r1.winner === null ? 0.5 : 0;

    const a2 = buildTeam(specA, 0, 1, []);
    const b2 = buildTeam(specB, 1, 200, []);
    const r2 = new Battle(
      { seed, units: [...a2.inputs, ...b2.inputs], traits: { 0: a2.traits, 1: b2.traits } },
      null,
      false,
    ).run();
    const w2 = r2.winner === 0 ? 1 : r2.winner === null ? 0.5 : 0;
    diff += w1 - w2;

    // 镜像：A 在下方，抵消站位偏差
    const s3 = seed + 104729;
    const a3 = buildTeam(specA, 1, 1, itemsA);
    const b3 = buildTeam(specB, 0, 200, []);
    const r3 = new Battle(
      { seed: s3, units: [...a3.inputs, ...b3.inputs], traits: { 0: b3.traits, 1: a3.traits } },
      null,
      false,
    ).run();
    const w3 = r3.winner === 1 ? 1 : r3.winner === null ? 0.5 : 0;

    const a4 = buildTeam(specA, 1, 1, []);
    const b4 = buildTeam(specB, 0, 200, []);
    const r4 = new Battle(
      { seed: s3, units: [...a4.inputs, ...b4.inputs], traits: { 0: b4.traits, 1: a4.traits } },
      null,
      false,
    ).run();
    const w4 = r4.winner === 1 ? 1 : r4.winner === null ? 0.5 : 0;
    diff += w3 - w4;
  }
  return diff / (N * 2);
}

/** 一件装备在「6 套预设 × 5 个对手」上的平均边际胜率 */
function measureItem(itemId: string): number {
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < PRESET_COMPS.length; i++) {
    for (let j = 0; j < PRESET_COMPS.length; j++) {
      if (i === j) continue;
      sum += pairedDelta(PRESET_COMPS[i], PRESET_COMPS[j], [itemId], 500000 + i * 131 + j * 17);
      cnt++;
    }
  }
  return sum / cnt;
}

const COMPS = PRESET_COMPS.length;
const PAIRS = COMPS * (COMPS - 1);
// 每个有序对每种子实际 4 场（带件/裸装 × 原位/镜像），总量按 4 计——此前按 2 计，吞吐与总量都与实测差一倍
const GAMES_PER_ITEM = PAIRS * N * 4;

console.log('═════════ 百战天元 · 装备强度专项模拟 ═════════\n');
console.log(`配对设计：${COMPS} 套预设 × ${COMPS - 1} 个对手 × 双向 × ${N} 种子 = ${GAMES_PER_ITEM} 局/件${ONLY ? `（定向复测：${ONLY.join('、')}，跳过合成/曲线段）` : ''}\n`);

const t0 = Date.now();

// ── 1. 单件边际价值 ────────────────────────────────────
console.log('【单件边际价值】同一阵容装 1 件 vs 不装，胜率增量\n');
const delta = new Map<string, number>();
for (const item of ITEMS) {
  if (ONLY && !ONLY.includes(item.id)) continue;
  delta.set(item.id, measureItem(item.id));
}

const rows = ITEMS.filter((it) => !ONLY || ONLY.includes(it.id)).map((it) => ({
  id: it.id,
  name: it.name,
  tier: it.tier === 'component' ? '组件' : '成品',
  recipe: it.recipe,
  d: delta.get(it.id) ?? 0,
})).sort((a, b) => b.d - a.d);

const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
for (const r of rows) {
  // 条形图以 0 为原点居中，越界的一眼可见
  const cells = Math.min(26, Math.abs(Math.round(r.d * 300)));
  const bar = r.d >= 0 ? ' '.repeat(11) + '▇'.repeat(cells) : ' '.repeat(Math.max(0, 11 - cells)) + '▇'.repeat(cells);
  console.log(`  ${r.name.padEnd(5)} ${r.tier}  ${pct(r.d).padStart(7)}  ${bar}`);
}

// 定向复测到此为止：合成增益 / 边际曲线依赖全表数据， ONLY 模式下不输出（避免缺数据误判）
if (ONLY) {
  const dtOnly = (Date.now() - t0) / 1000;
  console.log(`\n定向复测共约 ${ONLY.length * GAMES_PER_ITEM} 局，耗时 ${dtOnly.toFixed(1)}s（合成/曲线段已跳过）`);
  process.exit(0);
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
  if (r.d > avgComb * 1.9 && r.d > 0.05) warn.push(`${r.name} 过强 ${pct(r.d)}`);
  if (r.d < avgComb * 0.45) warn.push(`${r.name} 过弱 ${pct(r.d)}`);
  if (r.d < 0) warn.push(`${r.name} 负收益 ${pct(r.d)}`);
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
  const da = delta.get(a) ?? 0;
  const db = delta.get(b) ?? 0;
  const gain = r.d - (da + db);
  recipeTotal++;
  if (gain > 0) recipeOk++;
  else warn.push(`${r.name} 合成负收益 ${pct(gain)}`);
  console.log(`  ${gain > 0 ? '✓' : '✗'} ${r.name.padEnd(5)} ${pct(r.d).padStart(8)}  ${pct(da + db).padStart(8)}  ${pct(gain).padStart(9)}`);
}
console.log(`\n  ${recipeOk}/${recipeTotal} 件成品强于拆开装`);

// ── 3. 边际收益曲线 ─────────────────────────────────────
// 两个口径必须分开，混在一个数字里会互相污染：
//  3a 同件堆叠（0/1/2/3 件同名装备）：机制类参数（回复比例、反弹比例）按
//     "取最大不叠加"结算，只有面板属性线性叠 —— 第 2、3 件的边际应当明显低于第 1 件。
//  3b 异件协同（三件定位不同的成品）：跨词条乘区叠加，协同是被允许的构筑奖励，
//     但用 logit（对数赔率）度量防止"胜率口径在逻辑斯蒂曲线陡段虚高"误判。
//     logit 边际若超过首件的 1.5 倍，才算指数爆炸。
const logit = (p: number): number => {
  const q = Math.min(0.98, Math.max(0.02, p));
  return Math.log(q / (1 - q));
};
const stackWin: number[] = [];
for (let k = 0; k <= 3; k++) {
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < COMPS; i++) {
    for (let j = 0; j < COMPS; j++) {
      if (i === j) continue;
      sum += pairedDelta(PRESET_COMPS[i], PRESET_COMPS[j], Array<string>(k).fill('duanhun'), 700000 + i * 31 + j * 7);
      cnt++;
    }
  }
  stackWin.push(sum / cnt);
}
console.log('\n【3a 同件堆叠】断魂刃 ×0/1/2/3（机制不叠加，仅属性线性）');
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

const CURVE_ITEMS = ['duanhun', 'pojia', 'xueyin'];
console.log(`\n【3b 异件协同】（${CURVE_ITEMS.map((i) => ITEMS.find((x) => x.id === i)?.name).join('、')}）以 logit 边际度量`);
const mixWin: number[] = [];
for (let k = 0; k <= 3; k++) {
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < COMPS; i++) {
    for (let j = 0; j < COMPS; j++) {
      if (i === j) continue;
      sum += pairedDelta(PRESET_COMPS[i], PRESET_COMPS[j], CURVE_ITEMS.slice(0, k), 700000 + i * 31 + j * 7);
      cnt++;
    }
  }
  mixWin.push(sum / cnt);
}
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
const total = (ITEMS.length + 3) * GAMES_PER_ITEM;
console.log(`\n共约 ${total} 局，耗时 ${dt.toFixed(1)}s（${Math.round(total / dt)} 局/秒）`);
console.log(`装备总数 ${ITEMS.length}（组件 ${comp.length} / 成品 ${comb.length}）`);
