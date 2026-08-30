/**
 * 无头批量模拟器。
 *
 * 用途：
 *  1. 验证战斗内核可无头运行、不死锁、不超时异常
 *  2. 输出各流派的胜率分布，作为数值平衡的客观依据
 *  3. 检查先手/站位优势是否在可接受范围
 *
 * 用法： npm run sim -- [每对对局数]
 */
import { Battle } from '../src/core/battle';
import { hashNumbers } from '../src/core/rng';
import { PRESET_COMPS, buildTeam, randomComp, type CompSpec } from '../src/game/comp';
import { BATTLE_TIMEOUT_TICKS, TICK_RATE } from '../src/core/config';
import { CHAMPIONS, CHAMPION_BY_ID } from '../src/data/champions';
import { TRAITS, TRAIT_BY_ID } from '../src/data/traits';

const N = Number(process.argv[2] ?? 200);

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

interface RunStats {
  wins: number;
  losses: number;
  draws: number;
  totalTicks: number;
  timeouts: number;
  /** 事件流指纹，用于确定性校验 */
  fingerprint: number;
}

function runPair(specA: CompSpec, specB: CompSpec, n: number): RunStats {
  const st: RunStats = { wins: 0, losses: 0, draws: 0, totalTicks: 0, timeouts: 0, fingerprint: 0 };
  for (let i = 0; i < n; i++) {
    const seed = 1000 + i * 7919;
    const a = buildTeam(specA, 0, 1);
    const b = buildTeam(specB, 1, 200);
    const battle = new Battle(
      { seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } },
      null,
      false,
    );
    const res = battle.run();
    st.totalTicks += res.ticks;
    if (res.timeout) st.timeouts++;
    if (res.winner === 1) st.wins++;
    else if (res.winner === 0) st.losses++;
    else st.draws++;
    st.fingerprint ^= hashNumbers([res.ticks, res.winner ?? -1, Math.round((res.remainingHpRatio[1] ?? 0) * 1000)]);
  }
  return st;
}

// ── 0. 数据完整性自检 ────────────────────────────────
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
    if (t.breakpoints.length !== t.effectText.length) {
      issues.push(`羁绊「${t.name}」档位数与描述数不一致`);
    }
  }
  // 每个棋子的羁绊必须存在
  for (const c of CHAMPIONS) {
    for (const t of [...c.origins, ...c.classes]) {
      if (!TRAIT_BY_ID[t]) issues.push(`棋子「${c.name}」引用了不存在的羁绊 ${t}`);
    }
    if (c.origins.length === 0 || c.classes.length === 0) issues.push(`棋子「${c.name}」缺少羁绊`);
  }
  // id 唯一
  const ids = new Set(CHAMPIONS.map((c) => c.id));
  if (ids.size !== CHAMPIONS.length) issues.push('存在重复的棋子 id');
  // 同费用内组合唯一 —— 玩家在同一档位里不该看到两张"同羁绊同职业"的卡
  const combos = new Set(CHAMPIONS.map((c) => `${c.cost}|${c.origins.join()}|${c.classes.join()}`));
  const byCost = new Set(CHAMPIONS.map((c) => `${c.cost}`));
  if (combos.size !== CHAMPIONS.length) issues.push('同费用内存在重复的职业/种族组合');
  void byCost;
  return issues;
}

// ── 1. 确定性校验 ────────────────────────────────────
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
  // 同一 seed 跑两遍，事件流必须逐字节一致
  const e1 = mk(424242);
  const e2 = mk(424242);
  if (e1.length !== e2.length) return false;
  for (let i = 0; i < e1.length; i++) {
    if (JSON.stringify(e1[i]) !== JSON.stringify(e2[i])) return false;
  }
  // 不同 seed 必须产生不同结果（证明随机源真的在起作用）
  const e3 = mk(424243);
  return JSON.stringify(e3) !== JSON.stringify(e1);
}

// ── 主流程 ────────────────────────────────────────────
console.log('═════════ 百战天元 · 无头平衡模拟 ═════════\n');

const issues = auditData();
console.log('【配置自检】');
if (issues.length === 0) console.log('  ✓ 全部羁绊档位可达，棋子数据自洽');
else issues.forEach((i) => console.log(`  ✗ ${i}`));

console.log('\n【确定性】');
const det = determinismCheck();
console.log(det ? '  ✓ 同种子事件流逐字节一致，不同种子产生分歧' : '  ✗ 战斗不可复现！');

console.log(`\n【流派对拍】每对 ${N} 局\n`);
const header = '对阵（上方 VS 下方）'.padEnd(30) + '下方胜率  平均时长  超时率';
console.log(header);
console.log('─'.repeat(62));

const t0 = Date.now();
let totalBattles = 0;
const winMatrix: number[][] = [];

for (let i = 0; i < PRESET_COMPS.length; i++) {
  winMatrix[i] = [];
  for (let j = 0; j < PRESET_COMPS.length; j++) {
    if (i === j) {
      winMatrix[i][j] = 0.5;
      continue;
    }
    const st = runPair(PRESET_COMPS[i], PRESET_COMPS[j], N);
    totalBattles += N;
    const winRate = (st.wins + st.draws * 0.5) / N;
    winMatrix[i][j] = winRate;
    const avgSec = (st.totalTicks / N / TICK_RATE).toFixed(1);
    const toRate = ((st.timeouts / N) * 100).toFixed(0);
    console.log(
      `${PRESET_COMPS[i].name.padEnd(12)} vs ${PRESET_COMPS[j].name.split(' · ')[0].padEnd(10)}` +
        `${(winRate * 100).toFixed(1).padStart(7)}%` +
        `${(avgSec + 's').padStart(10)}` +
        `${(toRate + '%').padStart(8)}`,
    );
  }
}

/**
 * 综合胜率。
 * 注意口径：winMatrix[i][j] 记录的是「j 作为下方阵营时的胜率」。
 * 因此 i 的真实胜率必须双向取平均 —— 只取一个方向会把强弱完全颠倒，
 * 并且会掩盖真实存在的站位偏差。
 */
console.log('\n【综合胜率】（双向取平均，消除站位影响）');
const overall = PRESET_COMPS.map((c, i) => {
  let sum = 0;
  let cnt = 0;
  let asTop = 0;
  let asBottom = 0;
  for (let j = 0; j < PRESET_COMPS.length; j++) {
    if (i === j) continue;
    const iOnTop = 1 - winMatrix[i][j]; // i 在上方、j 在下方时 i 的胜率
    const iOnBottom = winMatrix[j][i]; // i 在下方、j 在上方时 i 的胜率
    sum += iOnTop + iOnBottom;
    asTop += iOnTop;
    asBottom += iOnBottom;
    cnt += 2;
  }
  return { name: c.name, wr: sum / cnt, top: asTop / (cnt / 2), bottom: asBottom / (cnt / 2) };
}).sort((a, b) => b.wr - a.wr);

for (const o of overall) {
  const bar = '█'.repeat(Math.round(o.wr * 40));
  console.log(
    `  ${o.name.padEnd(22)} ${(o.wr * 100).toFixed(1).padStart(5)}%  ` +
      `上方 ${(o.top * 100).toFixed(0).padStart(3)}% / 下方 ${(o.bottom * 100).toFixed(0).padStart(3)}%  ${bar}`,
  );
}
const spread = overall[0].wr - overall[overall.length - 1].wr;
console.log(`\n  极差 ${(spread * 100).toFixed(1)}%  ${spread < 0.22 ? '✓ 无统治级套路' : '⚠ 需要调平'}`);

// 随机阵容镜像对局：检查先手优势
console.log('\n【先手优势检验】随机阵容镜像对局');
const rnd = mulberry(20260829);
let firstWin = 0;
let mirrorBattles = 0;
for (let i = 0; i < 300; i++) {
  const spec = randomComp(rnd, 7);
  const st = runPair(spec, spec, 2);
  firstWin += st.wins;
  mirrorBattles += 2;
}
const firstRate = firstWin / mirrorBattles;
console.log(`  下方阵营（team 1）胜率 ${(firstRate * 100).toFixed(1)}%  ${Math.abs(firstRate - 0.5) < 0.08 ? '✓ 无明显先后手偏差' : '⚠ 存在站位偏差'}`);

const dt = (Date.now() - t0) / 1000;
console.log(`\n共 ${totalBattles + mirrorBattles} 局，耗时 ${dt.toFixed(2)}s（${Math.round((totalBattles + mirrorBattles) / dt)} 局/秒）`);
console.log(`超时上限 ${(BATTLE_TIMEOUT_TICKS / TICK_RATE).toFixed(0)}s`);
console.log(`棋子总数 ${CHAMPIONS.length}，羁绊总数 ${TRAITS.length}`);
void CHAMPION_BY_ID;
