import { describe, expect, it } from 'vitest';
import { CardPool } from '../src/game/pool';
import { boardIdx, createUnit } from '../src/game/state';
import { restorePlayer, snapshotPlayer } from '../src/game/undo';
import { makePlayer } from './helpers';

describe('准备阶段撤销', () => {
  it('一次撤销完整恢复玩家资产和共享卡池，快照可安全复用', () => {
    const player = makePlayer({ gold: 42, level: 6, xp: 3 });
    const pool = new CardPool();
    player.board[boardIdx(3, 0)] = createUnit('pan');
    player.board[boardIdx(3, 0)]!.items.push('xuanjia');
    player.bench[0] = createUnit('ajiu');
    player.items.push('lingyu');
    player.shop[2] = 'jingyu';
    const before = snapshotPlayer(player, pool);

    pool.take('pan');
    player.gold = 0;
    player.board.fill(null);
    player.bench.fill(null);
    player.items.length = 0;
    player.shop.fill(null);

    restorePlayer(player, pool, before);
    expect(snapshotPlayer(player, pool)).toEqual(before);

    player.board[boardIdx(3, 0)]!.items.push('duanhun');
    restorePlayer(player, pool, before);
    expect(snapshotPlayer(player, pool)).toEqual(before);
  });
});
