/**
 * 读档推进回归（A2：回合二次结算）。
 *
 * 场景：战斗结算已落盘（phase='result'）后刷新页面。旧代码直接 enterPrep，
 * 同一回合被 makePairings + applyBattleResult 再结算一遍 → 双倍掉血、重复快照。
 * 契约：needsAdvanceOnLoad 判定 phase='result'；beginRound 后回合 +1 且无人再掉血。
 */
import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match';
import { createUnit } from '../src/game/state';

/** 构造一个推进到指定回合、双方有阵容、可稳定分出胜负的对局 */
function playedMatch(seed = 20260831): Match {
  const m = new Match(seed);
  m.beginRound(); // 第 1 回合备战
  return m;
}

describe('needsAdvanceOnLoad', () => {
  it('phase=result 为真；prep/battle/over 为假', () => {
    const m = new Match(1);
    expect(m.needsAdvanceOnLoad()).toBe(false); // 初始 prep（round=0 特殊，由 round===0 分支处理）
    m.beginRound();
    expect(m.phase).toBe('prep');
    expect(m.needsAdvanceOnLoad()).toBe(false);

    m.pairings = m.makePairings();
    m.settleRound();
    m.endRound();
    expect(m.phase).toBe('result');
    expect(m.needsAdvanceOnLoad()).toBe(true);
  });

  it('终局（over）不需要推进', () => {
    const m = new Match(7);
    m.beginRound();
    // 直接杀死 7 人到只剩 1 人
    for (const p of m.players.slice(1)) {
      p.hp = 0;
      p.alive = false;
      p.rank = 0;
    }
    m.pairings = m.makePairings();
    m.settleRound();
    m.endRound();
    expect(m.phase).toBe('over');
    expect(m.isOver()).toBe(true);
    expect(m.needsAdvanceOnLoad()).toBe(false);
  });
});

describe('结算→保存→恢复→推进（防二次结算）', () => {
  it('result 档恢复后 beginRound：回合 +1，全场血量与快照数不再变化', () => {
    const m = playedMatch(20260831);
    // 给人类与一名 AI 各放一个 1 费棋子，保证第 2 回合起有战斗
    m.human.board[0] = createUnit('duanyue', 1);
    m.players[1].board[0] = createUnit('duanyue', 1);
    m.beginRound(); // 第 2 回合
    m.pairings = m.makePairings();
    m.settleRound();
    m.endRound();
    expect(m.phase).toBe('result');

    const hpAfterSettle = m.players.map((p) => p.hp);
    const snapsAfterSettle = m.battleSnapshots.length;
    const roundAfterSettle = m.round;

    // 刷新：读档（toJSON/fromJSON 往返）后按新路由推进
    const restored = Match.fromJSON(m.toJSON());
    expect(restored.needsAdvanceOnLoad()).toBe(true);
    restored.beginRound();

    expect(restored.round).toBe(roundAfterSettle + 1);
    expect(restored.phase).toBe('prep');
    // 恢复推进本身不产生新战斗：血量不动、快照不增（beginRound 只发钱发经验刷商店）
    expect(restored.players.map((p) => p.hp)).toEqual(hpAfterSettle);
    expect(restored.battleSnapshots.length).toBe(snapsAfterSettle);
  });

  it('旧路径复现的二次结算病灶被 needsAdvance 拦截：推进后一回合只多一回合的快照', () => {
    const m = playedMatch(20260831);
    m.human.board[0] = createUnit('duanyue', 1);
    m.players[1].board[0] = createUnit('duanyue', 1);
    m.beginRound();
    m.pairings = m.makePairings();
    m.settleRound();
    m.endRound();

    // 旧代码：读档后不推进 → 开战 → 同一回合再结算一遍 → 旧快照数翻倍。
    // 新契约：needsAdvanceOnLoad() 为真时先 beginRound，settleRound 只结算
    // 新一回合的配对 —— 快照增量恰等于本回合配对数，且 pairings 清空。
    const restored = Match.fromJSON(m.toJSON());
    expect(restored.needsAdvanceOnLoad()).toBe(true);
    restored.beginRound();
    const before = restored.battleSnapshots.length;
    restored.pairings = restored.makePairings();
    const pairsN = restored.pairings.length;
    restored.settleRound();
    expect(restored.battleSnapshots.length).toBe(before + pairsN);
    expect(restored.pairings).toEqual([]);
  });

  it('prep 档恢复不推进：回合与商店保持原样', () => {
    const m = playedMatch(20260831);
    const shop = [...m.human.shop];
    const restored = Match.fromJSON(m.toJSON());
    expect(restored.needsAdvanceOnLoad()).toBe(false);
    // 路由分支：不调 beginRound，回合不变
    expect(restored.round).toBe(m.round);
    expect(restored.human.shop).toEqual(shop);
  });
});
