/**
 * 商店层量化工具 —— 概率表与卡池调参的证据来源。
 *
 * 三层输出：
 *  1. 期望表：各等级各费用下"每商店（5 格）期望看到某具体棋子的张数"（满池口径，
 *     = 5 × 档位概率 / 该档棋子数，与卡池张数无关）；
 *  2. 刷店成本：用真实 CardPool/rollShop（库存加权取子）Monte Carlo "刷到目标
 *     星级"的商店数分布 —— 库存加权与档位耗空回退都会被如实模拟；
 *  3. 可选整局配对臂（--match=N）：与 sim:match 同种子调度，跑概率表 A/B ——
 *     用 --t<等级>=a,b,c,d,e 在运行时覆盖概率表行，源码不动，同种子逐局配对。
 *
 * 用法：
 *   npm run sim:shop                          # 期望表 + 刷店成本（当前表）
 *   npm run sim:shop -- --t9=5,10,25,40,20    # 覆盖 9 级行后重算
 *   npm run sim:shop -- --match=500 --t9=...  # 追加 500 局整局配对臂
 */
import { SHOP_ODDS } from '../../src/core/config';
import { CardPool, rollShop } from '../../src/game/pool';
import { CHAMPION_IDS_BY_COST, CHAMPIONS } from '../../src/data/champions';
import { Rng } from '../../src/core/rng';

// ── 参数解析 ──────────────────────────────────────────
const args = process.argv.slice(2);
const nTrials = Number(args.find((a) => a.startsWith('--n='))?.slice(4) ?? 8000);
if (!Number.isInteger(nTrials) || nTrials <= 0) throw new Error(`--n 必须是正整数，收到 ${nTrials}`);
let table: readonly (readonly number[])[] = SHOP_ODDS;
for (const a of args) {
  const m = /^--t(\d)=(.+)$/.exec(a);
  if (m) {
    const lv = Number(m[1]);
    const row = m[2].split(',').map(Number);
    if (row.length !== 5 || row.some((x) => !Number.isFinite(x) || x < 0) || row.reduce((sum, x) => sum + x, 0) !== 100) {
      throw new Error(`行格式错误（需要 5 个非负数且合计 100）：${a}`);
    }
    table = table.map((r, i) => (i === lv - 1 ? row : r));
  }
}
// 覆盖只落在本地 table（SHOP_ODDS 元组只读，绝不原地改写 —— 同一进程里后跑的
// 整局配对臂 / 其他命令还要读真源表，原地覆盖会让共享配置漂移且无法还原）。
console.log(`试验 ${nTrials} 次/场景`);
console.log(`概率表：L3 ${table[2].join('/')} · L4 ${table[3].join('/')} · L7 ${table[6].join('/')} · L8 ${table[7].join('/')} · L9 ${table[8].join('/')}\n`);

// ── 1. 期望表（满池）──────────────────────────────────
console.log('每商店期望看到某具体棋子张数（×1000，满池）：');
console.log('  等级 |   1费    2费    3费    4费    5费');
for (let lv = 1; lv <= 9; lv++) {
  const cells = [1, 2, 3, 4, 5].map((c) => {
    const n = CHAMPION_IDS_BY_COST[c].length;
    return ((5 * (table[lv - 1][c - 1] / 100)) / n * 1000).toFixed(1).padStart(6);
  });
  console.log(`  L${lv}   | ${cells.join(' ')}`);
}

// ── 2. 刷店成本 Monte Carlo ───────────────────────────
interface Goal { name: string; cost: number; star: number; level: number }
const GOALS: Goal[] = [
  { name: '1费 2★ @L3（开局成型线）', cost: 1, star: 2, level: 3 },
  { name: '2费 2★ @L3', cost: 2, star: 2, level: 3 },
  { name: '2费 2★ @L4', cost: 2, star: 2, level: 4 },
  { name: '3费 2★ @L4（3费入场档）', cost: 3, star: 2, level: 4 },
  { name: '3费 2★ @L6', cost: 3, star: 2, level: 6 },
  { name: '2费 3★ @L6（hyperroll 主线）', cost: 2, star: 3, level: 6 },
  { name: '3费 3★ @L7（中期追星）', cost: 3, star: 3, level: 7 },
  { name: '3费 3★ @L8（孤注终局线）', cost: 3, star: 3, level: 8 },
  { name: '4费 2★ @L8（终局主力成型）', cost: 4, star: 2, level: 8 },
  { name: '4费 3★ @L9（理论天花板）', cost: 4, star: 3, level: 9 },
  { name: '5费 2★ @L8', cost: 5, star: 2, level: 8 },
  { name: '5费 2★ @L9', cost: 5, star: 2, level: 9 },
  { name: '5费 3★ @L9（天命）', cost: 5, star: 3, level: 9 },
];

/**
 * 单人满池模拟：只捡目标棋子，每商店 5 格，统计达成目标所需商店数。
 * 返回 null 表示 maxShops 内未达成。
 */
function shopsToGoal(cost: number, star: number, level: number, seed: number, maxShops = 4000): number | null {
  const need = star === 2 ? 3 : 9;
  const pool = new CardPool();
  const rng = new Rng(seed);
  const candidates = CHAMPION_IDS_BY_COST[cost];
  const target = candidates[Math.floor(rng.next() * candidates.length)];
  let have = 0;
  for (let s = 1; s <= maxShops; s++) {
    for (const id of rollShop(pool, rng, level, table)) {
      if (id === target && have < need) {
        pool.take(id);
        have++;
        if (have >= need) return s;
      }
    }
  }
  return null;
}

console.log('\n刷到目标所需商店数（中位 / p75 / p90 / 未达成率，1 商店 = 2 金刷费）：');
for (const g of GOALS) {
  const results: number[] = [];
  let fail = 0;
  for (let i = 0; i < nTrials; i++) {
    const r = shopsToGoal(g.cost, g.star, g.level, (i * 2654435761 + 1) >>> 0);
    if (r === null) fail++;
    else results.push(r);
  }
  results.sort((a, b) => a - b);
  const pick = (q: number) => results[Math.floor(q * (results.length - 1))];
  const failPct = ((fail / nTrials) * 100).toFixed(1);
  // 全员未达成时 results 为空，分位数无定义 —— 打印占位而不是让
  // results[-1].toString() 把整条命令崩掉（高难目标改表后的常态路径）
  const row = results.length === 0
    ? `  ${g.name.padEnd(24)} 中位    —  p75    —  p90    —  未达成 ${failPct}%`
    : `  ${g.name.padEnd(24)} 中位 ${pick(0.5).toString().padStart(4)}  p75 ${pick(0.75).toString().padStart(4)}  p90 ${pick(0.9).toString().padStart(4)}  未达成 ${failPct}%`;
  console.log(row);
}

// ── 3. 可选：整局配对臂（与 sim:match 同种子调度）──────
if (args.some((a) => a.startsWith('--match'))) {
  const { Match } = await import('../../src/game/match');
  const { aiTakeTurn, chooseAdventureIndex, makeProfile } = await import('../../src/game/ai');
  const N = Number(args.find((a) => a.startsWith('--match='))?.slice(8) ?? 200);
  // AI 档位在线覆盖：--prof=hyperroll:rollFloor=12,mergeBias=3.2（可多次出现）。
  // 只允许数字档位键 —— 名单/偏好是数组，不属于 A/B 通道。
  const PROF_KEYS = new Set(['rollFloor', 'aggression', 'levelPace', 'levelCap', 'mergeBias', 'noise']);
  const profPatches = new Map<string, Record<string, number>>();
  for (const a of args.filter((x) => x.startsWith('--prof='))) {
    const [arch, kvs] = a.slice(7).split(':');
    for (const kv of kvs.split(',')) {
      const [k, v] = kv.split('=');
      if (!PROF_KEYS.has(k)) throw new Error(`--prof 不支持键 ${k}（仅数字档位：${[...PROF_KEYS].join('/')}）`);
      const bucket = profPatches.get(arch) ?? {};
      bucket[k] = Number(v);
      profPatches.set(arch, bucket);
    }
  }
  if (profPatches.size > 0) {
    console.log('档位覆盖：' + [...profPatches].map(([a, kv]) => `${a} { ${Object.entries(kv).map(([k, v]) => `${k}=${v}`).join(', ')} }`).join('；'));
  }
  const archs = ['aggro', 'econ', 'balanced', 'hyperroll', 'greedy'] as const;
  const rounds: number[] = [];
  const winArch = new Map<string, number>();
  const entriesByArch = new Map<string, number>();
  const rankBy = new Map<string, number[]>();
  const star3 = new Map<string, number[]>();
  const levelBy = new Map<string, number[]>();
  const goldBy = new Map<string, number[]>();
  let fiveStar2OnChamp = 0; // 冠军场上 ≥2★ 五费件数
  let totalStar3 = 0;
  const champLevels: number[] = [];
  const star3ByCost = [0, 0, 0, 0, 0, 0]; // [费用1..5] 终局 3★ 件数
  for (let i = 0; i < N; i++) {
    const m = new Match((i * 2654435761) >>> 0);
    // 整局臂也吃 --t 覆盖：Match.shopTable 让本局全部 rollShop 走覆盖表。
    // 覆盖只作用在新建的 Match 实例上，真源 SHOP_ODDS 不被触碰。
    if (table !== SHOP_ODDS) m.shopTable = table;
    const humanArch = archs[i % archs.length];
    m.human.ai = makeProfile(humanArch);
    m.human.name = `[模拟]${humanArch}`;
    if (profPatches.size > 0) {
      for (const p of m.players) {
        const patch = p.ai && profPatches.get(p.ai.arch);
        if (p.ai && patch) Object.assign(p.ai, patch);
      }
    }
    let guard = 0;
    while (!m.isOver() && guard < 60) {
      m.beginRound();
      if (m.isOver()) break;
      if (m.human.alive) {
        if (m.human.ai && m.adventureOffer) {
          m.resolveAdventure(chooseAdventureIndex(m.human.ai, m.adventureOffer));
        }
        aiTakeTurn(m, m.human);
      }
      // beginRound 已生成配对（makePairings 会重复记对手历史与 rng 消费）
      // m.pairings 保持 beginRound 产物
      for (const pair of m.pairings) m.applyBattleResult(pair, m.runBattleHeadless(pair));
      m.endRound();
      guard++;
    }
    if (!m.isOver()) continue;
    rounds.push(m.round);
    const champ = m.players.find((p) => p.rank === 1);
    if (champ) {
      champLevels.push(champ.level);
      const arch = champ.isHuman ? humanArch : (champ.ai?.arch ?? '?');
      winArch.set(arch, (winArch.get(arch) ?? 0) + 1);
      const five = [...champ.board.filter(Boolean)].filter((u) => u && u.star >= 2 &&
        (CHAMPIONS.find((c) => c.id === u!.defId)?.cost ?? 0) >= 5).length;
      fiveStar2OnChamp += five;
    }
    for (const p of m.players) {
      const arch = p.isHuman ? humanArch : (p.ai?.arch ?? '?');
      entriesByArch.set(arch, (entriesByArch.get(arch) ?? 0) + 1);
      (rankBy.get(arch) ?? rankBy.set(arch, []).get(arch)!).push(p.rank || 8);
      const units = [...p.board.filter(Boolean), ...p.bench.filter(Boolean)];
      const s3 = units.filter((u) => u && u.star >= 3).length;
      for (const u of units) {
        if (u && u.star >= 3) {
          const c = CHAMPIONS.find((ch) => ch.id === u!.defId)?.cost ?? 0;
          star3ByCost[c]++;
        }
      }
      (star3.get(arch) ?? star3.set(arch, []).get(arch)!).push(s3);
      (levelBy.get(arch) ?? levelBy.set(arch, []).get(arch)!).push(p.level);
      (goldBy.get(arch) ?? goldBy.set(arch, []).get(arch)!).push(p.gold);
      totalStar3 += s3;
    }
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`\n━━ 整局 ${N} 局（配对种子）━━`);
  console.log(`回合均值 ${avg(rounds).toFixed(1)}   冠军等级 ${avg(champLevels).toFixed(2)}`);
  console.log('原型：平均名次 / 终局三星 / 终局等级 / 终局金币 / 夺冠%');
  for (const [arch, ranks] of [...rankBy.entries()].sort((a, b) => avg(a[1]) - avg(b[1]))) {
    const lv = levelBy.get(arch) ?? [];
    const s3 = star3.get(arch) ?? [];
    const gd = goldBy.get(arch) ?? [];
    const entryCount = entriesByArch.get(arch) ?? 0;
    const winRate = entryCount > 0 ? (winArch.get(arch) ?? 0) / entryCount : 0;
    console.log(`  ${arch.padEnd(10)} ${avg(ranks).toFixed(2)}  ${avg(s3).toFixed(3)}  ${avg(lv).toFixed(2)}  ${avg(gd).toFixed(1)}  ${(winRate * 100).toFixed(1)}%`);
  }
  console.log(`全局面 3★ 总数/局 ${(totalStar3 / N).toFixed(3)}   冠军场上 ≥2★ 五费均值 ${(fiveStar2OnChamp / N).toFixed(3)}`);
  console.log(`3★ 分解（件/${N}局，按费用 1→5）：${star3ByCost.slice(1).join(' / ')}`);
  // 密度探针：末局终局库存密度 = 共享池余量（按费用档汇总）= 稀缺度的直接读数
}
