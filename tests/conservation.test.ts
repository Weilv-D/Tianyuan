/**
 * 资源守恒回归 —— 自走棋的物理定律。
 *
 * 卡与装备是玩家资产：买入 / 卖出 / 合成 / 自动布阵溢出 / 买入回滚，
 * 任何路径都不允许卡或装备凭空消失或凭空出现。
 */
import { describe, expect, it } from 'vitest';
import { CHAMPIONS } from '../src/data/champions';
import { BENCH_SLOTS } from '../src/core/config';
import { autoArrange } from '../src/game/arrange';
import { Match } from '../src/game/match';
import { CardPool } from '../src/game/pool';
import {
  boardIdx,
  createUnit,
  emptyBench,
  emptyBoard,
  resolveMerges,
  sellValue,
  type UnitInstance,
} from '../src/game/state';
import { makePlayer } from './helpers';

const countItems = (units: readonly (UnitInstance | null)[], loose: readonly string[]): number =>
  units.reduce((s, u) => s + (u ? u.items.length : 0), 0) + loose.length;

describe('共享卡池', () => {
  it('初始总量 = Σ(各费用池量 × 该费用棋子数)，取空返回 false，归还递增', () => {
    const pool = new CardPool();
    // 交叉验证：每张卡的初始计数都能读到，且 Map 总量与逐卡求和一致
    const expected = CHAMPIONS.reduce((s, c) => s + pool.remaining(c.id), 0);
    expect(pool.totalRemaining()).toBe(expected);

    const id = CHAMPIONS[0].id;
    const n = pool.remaining(id);
    for (let i = 0; i < n; i++) expect(pool.take(id)).toBe(true);
    expect(pool.take(id)).toBe(false); // 池空
    pool.give(id);
    expect(pool.take(id)).toBe(true);
  });

  it('giveUnit 按星级归还 1/3/9 张', () => {
    const pool = new CardPool();
    const id = CHAMPIONS[0].id;
    const n = pool.remaining(id);
    for (let i = 0; i < n; i++) pool.take(id);
    expect(pool.remaining(id)).toBe(0);

    pool.giveUnit(id, 2);
    expect(pool.remaining(id)).toBe(3);
    pool.giveUnit(id, 3);
    expect(pool.remaining(id)).toBe(12);
  });
});

describe('三合成', () => {
  it('场上那张保留位置与自身装备，被吃掉的装备退回器匣', () => {
    const p = makePlayer();
    const boardOne = createUnit('pan');
    boardOne.items.push('A');
    p.board[boardIdx(2, 1)] = boardOne;
    const benchA = createUnit('pan');
    benchA.items.push('B');
    const benchB = createUnit('pan');
    benchB.items.push('C');
    p.bench[0] = benchA;
    p.bench[1] = benchB;

    const events = resolveMerges(p);

    expect(events).toEqual([{ defId: 'pan', star: 2, onBoard: true }]);
    const merged = p.board[boardIdx(2, 1)];
    expect(merged?.star).toBe(2);
    expect(merged?.items).toEqual(['A']); // 场上那张装备原样保留
    expect(p.items.sort()).toEqual(['B', 'C'].sort()); // 被吃的退回器匣
    expect(countItems([...p.board, ...p.bench], p.items)).toBe(3); // 装备总量不变
  });

  it('九张一星级联成一张三星，装备一件不少', () => {
    const p = makePlayer();
    for (let i = 0; i < 9; i++) {
      const u = createUnit('pan');
      u.items.push(`i${i}`);
      p.bench[i] = u;
    }
    const events = resolveMerges(p);

    expect(events.length).toBeGreaterThan(0);
    const final = p.bench.filter((u) => u !== null);
    expect(final.length).toBe(1);
    expect(final[0]!.star).toBe(3);
    expect(countItems(p.bench, p.items)).toBe(9); // 9 件装备：1 件在幸存者身上 + 8 件在器匣
    expect(p.items.length).toBe(8);
  });
});

describe('自动布阵溢出', () => {
  it('人口与备战席都装不下的棋子被卖出：卡回池、钱入账、装备回器匣', () => {
    const level = 2;
    const need = level + BENCH_SLOTS + 1; // 保证至少 1 张被溢出
    const ids = CHAMPIONS.filter((c) => c.cost <= 2).slice(0, need).map((c) => c.id);
    expect(ids.length).toBe(need); // 池子不够大就让测试大声失败，而不是悄悄通过

    const p = makePlayer({ level, gold: 0 });
    ids.forEach((id, i) => {
      const u = createUnit(id);
      u.items.push(`i${i}`); // 每人一件：谁被卖都必须把装备留下
      if (i < 4) p.board[boardIdx(i % 8, Math.floor(i / 8))] = u;
      else p.bench[i - 4] = u;
    });
    const pool = new CardPool();
    const poolBefore = pool.snapshot();
    const itemsBefore = countItems([...p.board, ...p.bench], p.items);

    const refund = autoArrange(p, pool);

    expect(refund).toBeGreaterThan(0);
    expect(p.board.filter(Boolean).length).toBeLessThanOrEqual(level);
    expect(p.bench.filter(Boolean).length).toBeLessThanOrEqual(BENCH_SLOTS);
    // 没有任何卡凭空消失：场上 + 备战 + 卖回池的数量守恒
    const soldCount = ids.length - p.board.filter(Boolean).length - p.bench.filter(Boolean).length;
    expect(soldCount).toBeGreaterThan(0);
    for (let i = 0; i < ids.length; i++) {
      const stillHeld =
        p.board.some((u) => u?.defId === ids[i]) || p.bench.some((u) => u?.defId === ids[i]);
      if (!stillHeld) expect(pool.remaining(ids[i])).toBe((poolBefore[ids[i]] ?? 0) + 1);
    }
    // 装备守恒：被卖棋子身上的装备回到器匣（每个被卖者恰好带着 1 件）
    expect(countItems([...p.board, ...p.bench], p.items)).toBe(itemsBefore);
    expect(p.items.length).toBe(soldCount);
    expect(p.gold).toBe(refund);
  });
});

describe('Match 买入 / 卖出', () => {
  it('满席且无法即时合成时买入整体回滚：钱、商店格、卡池一项不吞', () => {
    const m = new Match(2026);
    const p = m.players[0];
    p.gold = 50;
    p.board = emptyBoard();
    p.bench = emptyBench();
    // 备战席 9 格全满，其中 2 张磐一星 → 通过"即将合成"预检，但新子实际落不下
    for (let i = 0; i < BENCH_SLOTS; i++) {
      p.bench[i] = i < 2 ? createUnit('pan') : createUnit('ajiu');
    }
    p.shop[0] = 'pan';
    const goldBefore = p.gold;
    const poolBefore = m.pool.snapshot();

    expect(m.buy(p, 0)).toBe(false);

    expect(p.gold).toBe(goldBefore);
    expect(p.shop[0]).toBe('pan');
    expect(m.pool.snapshot()).toEqual(poolBefore);
    expect(p.bench.filter(Boolean).length).toBe(BENCH_SLOTS);
  });

  it('正常买入扣钱扣池，卖出按星级回卡回钱', () => {
    const m = new Match(2027);
    const p = m.players[0];
    p.gold = 50;
    p.board = emptyBoard();
    p.bench = emptyBench();
    p.shop[0] = 'pan';
    const poolBefore = m.pool.snapshot();

    expect(m.buy(p, 0)).toBe(true);
    expect(p.gold).toBe(50 - 1);
    expect(p.shop[0]).toBeNull();
    expect(m.pool.remaining('pan')).toBe((poolBefore.pan ?? 0) - 1);

    // autoDeploy 开着时买入即上场，棋子可能在棋盘也可能在备战席
    const bought = [...p.board, ...p.bench].find((u) => u?.defId === 'pan')!;
    const goldAfterBuy = p.gold;
    expect(m.sell(p, bought.iid)).toBe(true);
    expect(p.gold).toBe(goldAfterBuy + sellValue(bought));
    expect(m.pool.remaining('pan')).toBe(poolBefore.pan ?? 0);
  });
});
