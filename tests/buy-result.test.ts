/**
 * 买入结果回归（B2/B3）。
 *
 * B3：buy 返回 {ok, reason}，失败原因四类；卡池不足保留商店格。
 * B2：满席 + 席上同名 1★×1 与全场同名×2 → 溢出位落子合成 2★，
 * 席位净腾 ≥1、卡池金币守恒；席上无 victim 维持拒绝。
 */
import { describe, expect, it } from 'vitest';
import { Match, type BuyResult } from '../src/game/match';
import { BENCH_SLOTS } from '../src/core/config';
import { createUnit, emptyBench, emptyBoard, type PlayerState } from '../src/game/state';

/** 备战席填充用：互不相同的一费名（避免 resolveMerges 对填充牌发生无关级联合并） */
const FILLERS = ['ajiu', 'qinghe', 'jingyu', 'yeyou', 'kutong', 'lingxiao', 'duanyue', 'canghao'];

function freshMatch(): { m: Match; p: PlayerState } {
  const m = new Match(2031);
  const p = m.players[0];
  p.gold = 50;
  p.board = emptyBoard();
  p.bench = emptyBench();
  return { m, p };
}

describe('BuyResult 类型（B3）', () => {
  it('空格购买 → reason none', () => {
    const { m, p } = freshMatch();
    expect(m.buy(p, 0)).toEqual({ ok: false, reason: 'none' });
  });

  it('金币不足 → reason gold，不吞商店格', () => {
    const { m, p } = freshMatch();
    p.gold = 0;
    p.shop[0] = 'pan';
    expect(m.buy(p, 0)).toEqual({ ok: false, reason: 'gold' });
    expect(p.shop[0]).toBe('pan');
  });

  it('卡池不足 → reason pool，商店格保留（缺货卡不消失）', () => {
    const { m, p } = freshMatch();
    p.shop[0] = 'pan';
    // 把池里的 pan 全部抽干（含玩家手里的）
    const remaining = m.pool.remaining('pan');
    for (let i = 0; i < remaining; i++) m.pool.take('pan');
    const r: BuyResult = m.buy(p, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('pool');
    // 旧代码这里会 p.shop[slot] = null —— 卡凭空消失
    expect(p.shop[0]).toBe('pan');
    expect(p.gold).toBe(50);
  });
});

describe('满席买入即合（B2）', () => {
  it('满席 1★×2（席上）买入 → 合成成功且席位/卡池/金币守恒', () => {
    const { m, p } = freshMatch();
    for (let i = 0; i < BENCH_SLOTS; i++) {
      p.bench[i] = i < 2 ? createUnit('pan', 1) : createUnit(FILLERS[i - 2], 1);
    }
    p.shop[0] = 'pan';
    const poolBefore = m.pool.remaining('pan');

    const r = m.buy(p, 0);
    expect(r.ok).toBe(true);

    // 合成出的 2★ 在席（autoDeploy 时可能已上场，一并找）
    const merged = [...p.board, ...p.bench].find((u) => u !== null && u.defId === 'pan' && u.star === 2);
    expect(merged).toBeTruthy();
    // 席位净腾：9 → 8（合成吃掉 3 张占位、产出 1 张；2★ 若自动上场则 7）
    const benchN = p.bench.filter(Boolean).length;
    expect(benchN).toBeLessThanOrEqual(BENCH_SLOTS - 1);
    expect(p.bench.length).toBe(BENCH_SLOTS); // 溢出位已裁回
    // 守恒：金币 -1、卡池 -1、商店格清空
    expect(p.gold).toBe(49);
    expect(m.pool.remaining('pan')).toBe(poolBefore - 1);
    expect(p.shop[0]).toBeNull();
    // 全场 pan 张数守恒（3×1★ = 1×2★，折卡池口径 3 张）
    const pans = [...p.board, ...p.bench].filter((u) => u !== null && u.defId === 'pan');
    expect(pans.length).toBe(1);
    expect(pans[0]!.star).toBe(2);
  });

  it('autoDeploy 关闭时新 2★ 留在备战席', () => {
    const { m, p } = freshMatch();
    m.settings.autoDeploy = false;
    for (let i = 0; i < BENCH_SLOTS; i++) {
      p.bench[i] = i < 2 ? createUnit('pan', 1) : createUnit(FILLERS[i - 2], 1);
    }
    p.shop[0] = 'pan';
    expect(m.buy(p, 0).ok).toBe(true);
    expect(p.board.every((u) => u === null)).toBe(true);
    expect(p.bench.some((u) => u !== null && u.defId === 'pan' && u.star === 2)).toBe(true);
  });

  it('同名两张一在席一在场：合成落在场上（resolveMerges 既有口径）', () => {
    const { m, p } = freshMatch();
    m.settings.autoDeploy = false;
    p.board[0] = createUnit('pan', 1);
    p.bench[0] = createUnit('pan', 1);
    for (let i = 1; i < BENCH_SLOTS; i++) p.bench[i] = createUnit(FILLERS[i - 1], 1);
    p.shop[0] = 'pan';
    expect(m.buy(p, 0).ok).toBe(true);
    expect(p.board[0]?.defId).toBe('pan');
    expect(p.board[0]?.star).toBe(2);
    // 席上 pan 与溢出位被吃：9 → 8（填充牌互不相同，无级联合并）
    expect(p.bench.filter(Boolean).length).toBe(BENCH_SLOTS - 1);
  });
});
