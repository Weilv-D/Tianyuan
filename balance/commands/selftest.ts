/**
 * 工具链门禁 —— 深度平衡战役开跑前的自检（取代旧 npm run sim 的自检部分并扩容）。
 *
 * 五道关：
 *  1. 数据完整性：羁绊档位可达、棋子数据自洽、预设造价同带
 *  2. 确定性：同种子事件流逐字节一致，不同种子产生分歧
 *  3. CRN 稳定：同配对同种子重复执行结果逐位一致（配对消噪的前提）
 *  4. 进程池一致：n=4 小矩阵「串行 vs 2 进程池」winRate/矩阵逐位相同
 *     （并行 === 串行是整个框架的可信度地基，每次改池子/引擎都要过这道关）
 *  5. 先手公平：随机阵容镜像对局，下方阵营胜率应在 50% 噪声带内
 *
 * 用法：balance selftest [--workers W]
 */
import { Battle } from '../../src/core/battle';
import { PRESET_COMPS, buildTeam, type CompSpec } from '../../src/game/comp';
import { randomComp } from '../lib/comp-random';
import { runPair } from '../lib/engine';
import { runConfigs } from '../lib/matrix';
import { defaultWorkers } from '../lib/pool';
import { TICK_RATE } from '../../src/core/config';
import { CHAMPIONS, CHAMPION_BY_ID } from '../../src/data/champions';
import { TRAITS, TRAIT_BY_ID } from '../../src/data/traits';

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function auditData(): string[] {
  const issues: string[] = [];
  const memberCount = new Map<string, number>();
  for (const c of CHAMPIONS) {
    for (const t of [...c.origins, ...c.classes]) {
      memberCount.set(t, (memberCount.get(t) ?? 0) + 1);
    }
  }
  for (const t of TRAITS) {
    const max = t.breakpoints[t.breakpoints.length - 1];
    const have = memberCount.get(t.id) ?? 0;
    if (have < max) issues.push(`羁绊「${t.name}」最高档需 ${max} 人，但全池只有 ${have} 人`);
    if (t.breakpoints.length !== t.effectText.length) issues.push(`羁绊「${t.name}」档位数与描述数不一致`);
  }
  for (const c of CHAMPIONS) {
    for (const t of [...c.origins, ...c.classes]) {
      if (!TRAIT_BY_ID[t]) issues.push(`棋子「${c.name}」引用了不存在的羁绊 ${t}`);
    }
    if (c.origins.length === 0 || c.classes.length === 0) issues.push(`棋子「${c.name}」缺少羁绊`);
  }
  const ids = new Set(CHAMPIONS.map((c) => c.id));
  if (ids.size !== CHAMPIONS.length) issues.push('存在重复的棋子 id');
  const combos = new Set(CHAMPIONS.map((c) => `${c.cost}|${c.origins.join()}|${c.classes.join()}`));
  if (combos.size !== CHAMPIONS.length) issues.push('同费用内存在重复的职业/种族组合');
  const copies = [0, 1, 3, 9];
  for (const comp of PRESET_COMPS) {
    const gold = Object.entries(comp.units).reduce(
      (sum, [id, star]) => sum + (CHAMPION_BY_ID[id]?.cost ?? 0) * copies[star],
      0,
    );
    if (gold < 52 || gold > 58) issues.push(`预设「${comp.name}」造价 ${gold} 金，超出 52~58 金基线`);
  }
  return issues;
}

function determinismCheck(): boolean {
  const mk = (seed: number) => {
    const a = buildTeam(PRESET_COMPS[0], 0, 1);
    const b = buildTeam(PRESET_COMPS[1], 1, 200);
    const bt = new Battle(
      { seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } },
      null,
      true,
    );
    bt.run();
    return bt.events;
  };
  const e1 = mk(424242);
  const e2 = mk(424242);
  if (e1.length !== e2.length) return false;
  for (let i = 0; i < e1.length; i++) {
    if (JSON.stringify(e1[i]) !== JSON.stringify(e2[i])) return false;
  }
  const e3 = mk(424243);
  return JSON.stringify(e3) !== JSON.stringify(e1);
}

export async function run(argv: string[]): Promise<void> {
  const wIdx = argv.indexOf('--workers');
  const workers = wIdx >= 0 ? Math.max(2, Number(argv[wIdx + 1]) || 2) : Math.max(2, Math.min(4, defaultWorkers()));
  let failed = false;
  console.log('═════════ 百战天元 · 平衡工具链门禁 ═════════\n');

  console.log('【1/5 数据完整性】');
  const issues = auditData();
  if (issues.length === 0) console.log('  ✓ 全部羁绊档位可达，棋子数据自洽，预设造价同带');
  else {
    failed = true;
    issues.forEach((i) => console.log(`  ✗ ${i}`));
  }

  console.log('\n【2/5 战斗确定性】');
  const det = determinismCheck();
  console.log(det ? '  ✓ 同种子事件流逐字节一致，不同种子产生分歧' : '  ✗ 战斗不可复现！');
  failed ||= !det;

  console.log('\n【3/5 CRN 稳定】');
  const r1 = runPair(0, 1, 24, 20260829, PRESET_COMPS);
  const r2 = runPair(0, 1, 24, 20260829, PRESET_COMPS);
  // 逐位一致抽查全字段（含 bottom/casts/承伤）：单比 top.dealt 漏检一半的分歧面
  const crnOk = JSON.stringify(r1) === JSON.stringify(r2);
  console.log(crnOk ? '  ✓ 同配对同种子重复执行逐位一致（配对消噪前提成立）' : '  ✗ 同种子两次执行出现分歧！');
  failed ||= !crnOk;

  console.log(`\n【4/5 进程池一致】n=4 小矩阵：串行 vs ${workers} 进程池`);
  const seedBase = 20260902;
  const configs = [{ label: '基准', overrides: {} }];
  const serial = await runConfigs(configs, { comps: PRESET_COMPS, n: 4, seedBase, workers: 0 });
  const pooled = await runConfigs(configs, { comps: PRESET_COMPS, n: 4, seedBase, workers });
  const poolOk = serial[0].winRate.every((w, i) => w === pooled[0].winRate[i])
    && serial[0].matrix.every((row, i) => row.every((v, j) => v === pooled[0].matrix[i][j]))
    && serial[0].timeouts === pooled[0].timeouts;
  console.log(poolOk ? '  ✓ 并行结果与串行逐位一致（并行 === 串行可信度地基）' : '  ✗ 并行与串行出现分歧！');
  failed ||= !poolOk;

  console.log('\n【5/5 先手公平】随机阵容镜像对局（300 组 × 2 局）');
  const rnd = mulberry(20260829);
  let firstWin = 0;
  let mirrorBattles = 0;
  for (let i = 0; i < 300; i++) {
    const spec: CompSpec = randomComp(rnd, 7);
    // 每个随机阵容独立战斗种子（避免两个种子主导全部样本的老缺陷）
    const st = runPair(0, 0, 2, 2_000_000 + i * 2 * 7919, [spec, spec]);
    // 平局双方各计半胜：把平局当失败会稀释分母、让公平率随超时增多而虚低
    firstWin += st.bottomWins + st.draws * 0.5;
    mirrorBattles += 2;
  }
  const firstRate = firstWin / mirrorBattles;
  const firstBand = 2 * Math.sqrt(0.25 / mirrorBattles);
  const fairOk = Math.abs(firstRate - 0.5) < firstBand;
  console.log(`  下方阵营（team 1）胜率 ${(firstRate * 100).toFixed(1)}%  95% 噪声带 ±${(firstBand * 100).toFixed(1)}p  ${fairOk ? '✓ 无明显先后手偏差' : '⚠ 存在站位偏差'}`);
  failed ||= !fairOk;

  console.log(`\n${failed ? '✗ 门禁未通过' : '✓ 门禁全部通过'}   时长口径：tick=${TICK_RATE}/s`);
  if (failed) process.exit(1);
}
