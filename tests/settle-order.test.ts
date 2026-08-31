/**
 * 结算顺序确定性回归（A3）。
 *
 * 契约：同一 seed 下，渲染层统一入口 settleRound() 与无头模拟的
 * 「逐配对 runBattleHeadless + applyBattleResult」循环产生逐字段一致的
 * 对局状态；快照顺序 = 配对顺序；墨兽轮掉落的 rng 消费两侧同序。
 */
import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match';
import { createUnit } from '../src/game/state';

/** 双方各摆一个同名 1 费，确保战斗真实发生且能分出胜负 */
function setupBoards(m: Match): void {
  m.human.board[0] = createUnit('duanyue', 1);
  m.players[1].board[0] = createUnit('duanyue', 1);
  m.players[2].board[0] = createUnit('pan', 1);
  m.players[3].board[0] = createUnit('pan', 1);
}

describe('settleRound 与逐对手动循环逐字段一致', () => {
  it('完整 toJSON 状态一致（含 rng 状态与墨兽轮掉落）', () => {
    // 跑 8 个回合覆盖 PvP 轮（偶数）与墨兽轮（3/7）两种 rng 消费形态
    const runRound = (m: Match, manual: boolean) => {
      m.beginRound();
      if (m.isOver()) return;
      m.pairings = m.makePairings();
      if (manual) {
        for (const pair of m.pairings) {
          m.applyBattleResult(pair, m.runBattleHeadless(pair));
        }
        m.pairings = [];
      } else {
        m.settleRound();
      }
      m.endRound();
    };

    const a = new Match(20260831);
    const b = new Match(20260831);
    setupBoards(a);
    setupBoards(b);
    for (let r = 0; r < 8; r++) {
      runRound(a, false);
      runRound(b, true);
    }
    // iid 是全局递增计数器（跨 Match 实例共享），归一化后比较其余全部字段
    const norm = (j: string) => j.replace(/"iid":\d+/g, '"iid":N');
    expect(norm(JSON.stringify(a.toJSON()))).toBe(norm(JSON.stringify(b.toJSON())));
  });
});

describe('快照顺序 = 配对顺序', () => {
  it('settleRound 产出的快照与 pairings 一一对应（round/config 同源）', () => {
    const m = new Match(99);
    m.beginRound();
    m.human.board[0] = createUnit('duanyue', 1);
    m.pairings = m.makePairings();
    const before = m.battleSnapshots.length;
    m.settleRound();
    const added = m.battleSnapshots.slice(before);
    expect(added.length).toBeGreaterThan(0);
    // 每场快照都记录了当前回合
    for (const s of added) expect(s.round).toBe(m.round);
    expect(m.pairings).toEqual([]); // 结算后清空，防二次消费
  });
});

describe('墨兽轮掉落确定性（rng 消费顺序）', () => {
  it('同一 seed 的墨兽轮（3/7/11）物品掉落序列两侧完全一致', () => {
    const dropsOf = (seed: number): string[][] => {
      const m = new Match(seed);
      m.beginRound(); // r1
      m.beginRound(); // r2
      const out: string[][] = [];
      for (let r = 3; r <= 11; r++) {
        m.beginRound();
        if (m.isOver()) break;
        if (!m.isBeastRound()) {
          m.endRound();
          continue;
        }
        m.pairings = m.makePairings();
        m.settleRound();
        m.endRound();
        out.push(m.players.map((p) => p.items.join(',')).slice(0, 4));
      }
      return out;
    };
    expect(dropsOf(20260831)).toEqual(dropsOf(20260831));
    expect(dropsOf(12345)).toEqual(dropsOf(12345));
  });
});
