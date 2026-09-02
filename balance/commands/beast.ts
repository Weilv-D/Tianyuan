/**
 * 墨兽轮自检。
 *
 * 验证三件事：
 *  1. 墨兽阵容按回合健康成长（数量与星级）
 *  2. 全体玩家面对的是**同一只**墨兽
 *  3. 掉落与掉血结算正常
 */

import { Match } from '../../src/game/match';
import { addItem, equipItem } from '../../src/game/inventory';
import { createUnit } from '../../src/game/state';

const SEED = 20260829;

function run(round: number): void {
  const m = new Match(SEED);
  // 快进到目标回合
  while (m.round < round - 1) {
    m.beginRound();
    if (m.isBeastRound()) {
      for (const pair of m.makePairings()) {
        m.applyBattleResult(pair, m.runBattleHeadless(pair));
      }
    }
    m.endRound();
    if (m.isOver()) break;
  }
  m.beginRound();

  const pairings = m.makePairings();
  const isBeast = m.isBeastRound();
  console.log(`\n── 回合 ${m.round}　${isBeast ? '墨獸輪' : 'PvP 輪'}　配对 ${pairings.length} 场`);

  if (!isBeast) return;

  const cfgs = pairings.map((p) => m.buildBattleConfig(p, p.swap));
  const beasts = cfgs.map((c) => c.units.filter((u) => u.monster));
  const first = JSON.stringify(beasts[0]);
  const sameForAll = beasts.every((b) => JSON.stringify(b) === first);
  const list = beasts[0].map((b) => `${b.defId}${'★'.repeat(b.star)}`).join(' ');

  console.log(`   墨兽：${beasts[0].length} 只　${list}`);
  console.log(`   全体面对同一只：${sameForAll ? '✓' : '✗ 不一致！'}`);

  // 打一场看结果与掉落
  const before = m.players.map((p) => p.items.length);
  for (const pair of pairings) {
    m.applyBattleResult(pair, m.runBattleHeadless(pair));
  }
  const gains = m.players.map((p, i) => p.items.length - before[i]);
  const dmg = m.players.map((p) => p.lastDamage);
  console.log(`   掉血：${dmg.join(' / ')}`);
  console.log(`   掉落件数：${gains.join(' / ')}　合计 ${gains.reduce((a, b) => a + b, 0)}`);
}

console.log('墨兽轮自检');
for (const r of [3, 7, 11, 15, 19, 23]) run(r);

// ── 装备守恒自检：卖出带装备的棋子，装备必须回到器匣 ──
console.log('\n── 装备守恒自检');
{
  const m = new Match(SEED);
  m.beginRound();
  const p = m.human;
  // 人类玩家在 beginRound 里不会自动行动，手动放一个棋子上去
  const u = createUnit('duanyue', 1);
  p.board[0] = u;
  {
    addItem(p, 'moren');
    addItem(p, 'moren');
    const r1 = equipItem(p, u.iid, 'moren');
    const r2 = equipItem(p, u.iid, 'moren');
    const equipped = u.items.slice();
    m.sell(p, u.iid);
    const back = p.items.slice();
    const ok = r1.ok && r2.combined === 'duanhun' && back.length === 2 && back[0] === 'moren' && back[1] === 'moren';
    console.log(`   装上两把墨刃 → 合成 ${r2.combined ?? '?'}（${equipped.join(',')}）`);
    console.log(`   卖出该棋子 → 器匣回收：${back.join(',')}　${ok ? '✓ 装备守恒' : '✗ 装备丢失！'}`);
  }
}
