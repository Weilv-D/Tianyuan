/**
 * 整局无头模拟。
 *
 * 目的不是"看谁赢"，而是回答三个工程问题：
 *  1. 一局能不能稳定跑完（不卡死、不超时、不抛异常）？
 *  2. 一局有多长（回合数）？—— 这直接决定单局时长是否落在 25~40 分钟的目标区间。
 *  3. 五个 AI 性格原型是否真的打出了差异？如果五个性格胜率完全一样，
 *     那"AI 有人味"就是自说自话。
 *
 * 运行： npm run sim:match
 */

import { Match } from '../src/game/match';
import { aiTakeTurn, chooseAdventureIndex, makeProfile, type AiArchetype } from '../src/game/ai';
import { boardCount } from '../src/game/state';
import { withOverrides, type Overrides } from './lib/patch';

// 支持 --set k=v 覆盖（cfg.* / champ.* / trait.*），M5 局长实验等用；首个非旗标参数仍是局数
const overrides: Overrides = {};
const rest: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--set') {
    const [k, v] = (process.argv[++i] ?? '').split('=');
    overrides[k] = Number(v);
  } else {
    rest.push(process.argv[i]);
  }
}
const N = Number(rest[0] ?? 200);
const MAX_ROUNDS = 60;

interface Stat {
  rounds: number[];
  winnerArch: Map<string, number>;
  /** 各原型累计参赛席位数，夺冠率必须以它为分母。 */
  entriesByArch: Map<string, number>;
  winnerLevel: number[];
  winnerBoardSize: number[];
  eliminations: number[];
  crashes: string[];
  /** 每个原型在每局里的最终名次 */
  rankByArch: Map<string, number[]>;
  /** 每个原型的终局三星数 —— 验证"三星猎人"这类人设是否真的落地 */
  star3ByArch: Map<string, number[]>;
  /** 每个原型的终局等级 */
  levelByArch: Map<string, number[]>;
}

function assignRotatingProfiles(m: Match, gameIndex: number): void {
  for (const p of m.players) {
    const arch = archs[(gameIndex * m.players.length + p.idx) % archs.length];
    p.ai = makeProfile(arch);
  }
}

function runOne(seed: number, gameIndex: number, stat: Stat): void {
  try {
    const m = new Match(seed);
    assignRotatingProfiles(m, gameIndex);
    m.human.name = `[模拟]${m.human.ai?.arch ?? 'balanced'}`;

    let guard = 0;
    while (!m.isOver() && guard < MAX_ROUNDS) {
      m.beginRound();
      if (m.isOver()) break;
      // 人类席位交给 AI 托管，这样整局能自动跑完
      if (m.human.alive) {
        if (m.human.ai && m.adventureOffer) {
          m.resolveAdventure(chooseAdventureIndex(m.human.ai, m.adventureOffer));
        }
        aiTakeTurn(m, m.human);
      }
      m.pairings = m.makePairings();
      for (const pair of m.pairings) {
        const res = m.runBattleHeadless(pair);
        m.applyBattleResult(pair, res);
      }
      m.endRound();
      guard++;
    }

    if (!m.isOver()) {
      stat.crashes.push(`seed ${seed}: ${MAX_ROUNDS} 回合未分出胜负（可能存在僵局）`);
      return;
    }

    stat.rounds.push(m.round);
    const champ = m.players.find((p) => p.rank === 1);
    if (champ) {
      const arch = champ.ai?.arch ?? '?';
      stat.winnerArch.set(arch, (stat.winnerArch.get(arch) ?? 0) + 1);
      stat.winnerLevel.push(champ.level);
      stat.winnerBoardSize.push(boardCount(champ));
    }
    stat.eliminations.push(m.players.filter((p) => !p.alive).length);
    for (const p of m.players) {
      const arch = p.ai?.arch ?? '?';
      stat.entriesByArch.set(arch, (stat.entriesByArch.get(arch) ?? 0) + 1);
      const arr = stat.rankByArch.get(arch) ?? [];
      arr.push(p.rank || 8);
      stat.rankByArch.set(arch, arr);

      const units = [...p.board.filter(Boolean), ...p.bench.filter(Boolean)];
      const s3 = units.filter((u) => u && u.star >= 3).length;
      const sa = stat.star3ByArch.get(arch) ?? [];
      sa.push(s3);
      stat.star3ByArch.set(arch, sa);

      const la = stat.levelByArch.get(arch) ?? [];
      la.push(p.level);
      stat.levelByArch.set(arch, la);
    }
  } catch (e) {
    stat.crashes.push(`seed ${seed}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function avg(a: readonly number[]): number {
  return a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length;
}
function med(a: readonly number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

const stat: Stat = {
  rounds: [],
  winnerArch: new Map(),
  entriesByArch: new Map(),
  winnerLevel: [],
  winnerBoardSize: [],
  eliminations: [],
  crashes: [],
  rankByArch: new Map(),
  star3ByArch: new Map(),
  levelByArch: new Map(),
};

const archs: AiArchetype[] = ['aggro', 'econ', 'balanced', 'hyperroll', 'greedy'];
if (!Number.isInteger(N) || N <= 0) {
  console.error(`✗ 对局数必须是正整数，收到：${rest[0] ?? '(缺省)'}`);
  process.exit(1);
}
console.log(`模拟 ${N} 局完整对局（8 人）…`);
if (Object.keys(overrides).length > 0) {
  console.log(`覆盖：${Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join('，')}\n`);
} else {
  console.log('');
}
const t0 = Date.now();
withOverrides(overrides, () => {
  for (let i = 0; i < N; i++) {
    runOne((i * 2654435761) >>> 0, i, stat);
  }
});
const ms = Date.now() - t0;

console.log(`耗时 ${ms}ms（${(ms / N).toFixed(1)}ms/局）\n`);

if (stat.crashes.length > 0) {
  console.log(`✗ 异常 ${stat.crashes.length} 次：`);
  for (const c of stat.crashes.slice(0, 5)) console.log(`   ${c}`);
  console.log('');
} else {
  console.log(`✓ ${N} 局全部正常结束\n`);
}

let rAvg = 0;
const ok = stat.rounds.length;
if (ok > 0) {
  // 单局时长估算：准备阶段 + 战斗 + 结算
  const perRound = 26 + 20 + 4.5;
  rAvg = avg(stat.rounds);
  console.log(`回合数    平均 ${rAvg.toFixed(1)}  中位 ${med(stat.rounds)}  最短 ${Math.min(...stat.rounds)}  最长 ${Math.max(...stat.rounds)}`);
  console.log(`单局时长  估算 ${(rAvg * perRound / 60).toFixed(1)} 分钟（准备 26s + 战斗 20s + 结算 4.5s）`);
  console.log(`冠军等级  平均 ${avg(stat.winnerLevel).toFixed(1)}`);
  console.log(`冠军场上人数 平均 ${avg(stat.winnerBoardSize).toFixed(1)}\n`);
}

console.log('原型席位夺冠率（夺冠数 / 该原型参赛席位数）：');
const winRows = [...stat.entriesByArch.entries()]
  .map(([arch, entries]) => ({ arch, entries, wins: stat.winnerArch.get(arch) ?? 0 }))
  .sort((a, b) => b.wins / b.entries - a.wins / a.entries);
for (const { arch, entries, wins } of winRows) {
  const rate = wins / entries;
  const bar = '█'.repeat(Math.round(rate * 80));
  console.log(`  ${arch.padEnd(10)} ${String(wins).padStart(4)}/${String(entries).padEnd(5)} ${(rate * 100).toFixed(1).padStart(5)}%  ${bar}`);
}

console.log('\n原型平均名次（越小越好，理论均值为 4.5）：');
for (const [arch, ranks] of [...stat.rankByArch.entries()].sort((a, b) => avg(a[1]) - avg(b[1]))) {
  const a = avg(ranks);
  const spread = Math.max(...ranks) - Math.min(...ranks);
  console.log(`  ${arch.padEnd(10)} 平均 ${a.toFixed(2)}   样本 ${ranks.length}   名次跨度 ${spread}`);
}

// 八人局的座位分布是否公平（不应有位置优势）
console.log('\n原型特征（终局三星数 / 终局等级）—— 验证人设是否真的打出来了：');
for (const [arch, ranks] of [...stat.rankByArch.entries()].sort((a, b) => avg(a[1]) - avg(b[1]))) {
  const s3 = stat.star3ByArch.get(arch) ?? [];
  const lv = stat.levelByArch.get(arch) ?? [];
  console.log(
    `  ${arch.padEnd(10)} 平均名次 ${avg(ranks).toFixed(2)}   三星 ${avg(s3).toFixed(2)} 个   终局等级 ${avg(lv).toFixed(1)}`
  );
}

console.log('\n座位公平性（各座位平均名次，理想值 4.5）：');
const seatRanks: number[][] = Array.from({ length: 8 }, () => []);
// 重新跑一次，专门统计座位（避免污染上面的统计）。
// 必须套同一份 --set 补丁：否则读数是基线座位分布，冒充不了补丁态的结论
withOverrides(overrides, () => {
  for (let i = 0; i < Math.min(N, 120); i++) {
    const m = new Match((i * 40503) >>> 0);
    assignRotatingProfiles(m, i);
    let guard = 0;
    while (!m.isOver() && guard < MAX_ROUNDS) {
      m.beginRound();
      if (m.isOver()) break;
      if (m.human.alive) {
        if (m.human.ai && m.adventureOffer) {
          m.resolveAdventure(chooseAdventureIndex(m.human.ai, m.adventureOffer));
        }
        aiTakeTurn(m, m.human);
      }
      m.pairings = m.makePairings();
      for (const pair of m.pairings) {
        m.applyBattleResult(pair, m.runBattleHeadless(pair));
      }
      m.endRound();
      guard++;
    }
    for (const pl of m.players) seatRanks[pl.idx].push(pl.rank || 8);
  }
});
let seatLine = '  ';
for (let i = 0; i < 8; i++) {
  seatLine += `${i === 0 ? '人类' : `座${i}`}:${avg(seatRanks[i]).toFixed(2)}  `;
}
console.log(seatLine);

console.log('\n配置自检：');
const roundsOk = rAvg >= 20 && rAvg <= 45;
console.log(`  ${roundsOk ? '✓' : '⚠'} 平均回合数 ${rAvg.toFixed(1)} ${roundsOk ? '落在 20~45 目标区间' : '偏离 20~45 目标区间'}`);
console.log(`  ${stat.crashes.length === 0 ? '✓' : '✗'} 无异常`);
const archSpread = (() => {
  const avgs = [...stat.rankByArch.values()].map(avg);
  return avgs.length ? Math.max(...avgs) - Math.min(...avgs) : 0;
})();
console.log(`  ${archSpread > 0.15 ? '✓' : '⚠'} AI 原型平均名次极差 ${archSpread.toFixed(2)}（>0.15 表示性格确实影响了打法）`);
