/**
 * 撤销 = 全状态快照回归。
 *
 * 契约：snapshotPlayer 覆盖玩家在准备阶段能触碰的一切（棋盘 / 备战席 /
 * 金币 / 等级 / 经验 / 商店 / 器匣 / 共享卡池计数），restorePlayer 完整回写，
 * 且快照本身与玩家状态互不共享可变引用 —— 同一份快照可以安全复用多次。
 */
import { describe, expect, it } from 'vitest';
import { CardPool } from '../src/game/pool';
import { boardIdx, createUnit, type UnitInstance } from '../src/game/state';
import { restorePlayer, snapshotPlayer } from '../src/game/undo';
import { makePlayer } from './helpers';

/** 经函数读取打断 TS 对字面量下标的流 narrowing */
const at = (arr: readonly (UnitInstance | null)[], i: number): UnitInstance | null => arr[i];

describe('撤销快照往返', () => {
  it('动作后撤销：所有字段完整回到动作前', () => {
    const p = makePlayer({ gold: 42, level: 6, xp: 3 });
    const pool = new CardPool();
    const pan = createUnit('pan');
    pan.items.push('i1');
    p.board[boardIdx(3, 0)] = pan;
    p.bench[0] = createUnit('ajiu');
    p.items.push('i0');
    p.shop[2] = 'jingyu';
    p.shopLocked = true;
    const before = snapshotPlayer(p, pool);

    // ── 做一串会触碰所有字段的"动作" ──
    pool.take('pan'); // 卡池被抽走一张
    pool.take('jingyu');
    p.gold = 7;
    p.level = 8;
    p.xp = 10;
    p.board[boardIdx(3, 0)] = null;
    p.bench[0] = null;
    p.bench[1] = createUnit('pan', 2);
    p.items.length = 0;
    p.shop[2] = null;
    p.shopLocked = false;

    restorePlayer(p, pool, before);

    expect(p.gold).toBe(42);
    expect(p.level).toBe(6);
    expect(p.xp).toBe(3);
    expect(p.shop[2]).toBe('jingyu');
    expect(p.shopLocked).toBe(true);
    expect(p.items).toEqual(['i0']);
    expect(p.board[boardIdx(3, 0)]?.defId).toBe('pan');
    expect(p.board[boardIdx(3, 0)]?.items).toEqual(['i1']);
    expect(at(p.bench, 0)?.defId).toBe('ajiu');
    expect(p.bench[1]).toBeNull();
    expect(pool.snapshot()).toEqual(before.pool);
  });

  it('快照是深拷贝：回写后再改状态不污染快照，可重复撤销', () => {
    const p = makePlayer();
    const pool = new CardPool();
    const u = createUnit('pan');
    p.board[boardIdx(0, 0)] = u;
    const snap = snapshotPlayer(p, pool);

    restorePlayer(p, pool, snap);
    // 回写后继续破坏
    p.board[boardIdx(0, 0)]!.items.push('i2');
    p.gold = 99;
    expect(snap.gold).toBe(0);
    expect(snap.board[boardIdx(0, 0)]?.items).toEqual([]);

    // 第二次撤销仍然干净
    restorePlayer(p, pool, snap);
    expect(p.gold).toBe(0);
    expect(p.board[boardIdx(0, 0)]?.items).toEqual([]);
  });

  it('卡池计数随快照对称还原（撤销买入不能白嫖卡池）', () => {
    const p = makePlayer();
    const pool = new CardPool();
    const n0 = pool.remaining('pan');
    const snap = snapshotPlayer(p, pool);

    pool.take('pan');
    pool.take('pan');
    expect(pool.remaining('pan')).toBe(n0 - 2);

    restorePlayer(p, pool, snap);
    expect(pool.remaining('pan')).toBe(n0);
  });
});
