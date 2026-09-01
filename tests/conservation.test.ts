import { describe, expect, it } from 'vitest';
import { BENCH_SLOTS } from '../src/core/config';
import { CHAMPIONS } from '../src/data/champions';
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

function itemCount(units: readonly (UnitInstance | null)[], loose: readonly string[]): number {
  return units.reduce((total, unit) => total + (unit?.items.length ?? 0), 0) + loose.length;
}

describe('玩家资产守恒', () => {
  it('九张棋子合成三星后，棋子与装备都不丢失', () => {
    const player = makePlayer();
    for (let index = 0; index < 9; index++) {
      const unit = createUnit('pan');
      unit.items.push(`item-${index}`);
      player.bench[index] = unit;
    }

    resolveMerges(player);

    const survivors = player.bench.filter((unit): unit is UnitInstance => unit !== null);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].star).toBe(3);
    expect(itemCount(player.bench, player.items)).toBe(9);
  });

  it('正常买入再卖出后，卡池回到原值且金币按售价返还', () => {
    const match = new Match(2027);
    const player = match.human;
    player.gold = 50;
    player.board = emptyBoard();
    player.bench = emptyBench();
    player.shop[0] = 'pan';
    const poolBefore = match.pool.snapshot();

    expect(match.buy(player, 0).ok).toBe(true);
    const bought = [...player.board, ...player.bench].find((unit) => unit?.defId === 'pan')!;
    const goldBeforeSale = player.gold;
    expect(match.sell(player, bought.iid)).toBe(true);

    expect(player.gold).toBe(goldBeforeSale + sellValue(bought));
    expect(match.pool.snapshot()).toEqual(poolBefore);
  });

  it('买入第三张触发合成后会把合成产物自动上场', () => {
    const match = new Match(2028);
    const player = match.human;
    player.gold = 50;
    player.level = 3;
    player.board = emptyBoard();
    player.bench = emptyBench();
    player.bench[0] = createUnit('pan');
    player.bench[1] = createUnit('pan');
    player.shop[0] = 'pan';

    expect(match.buy(player, 0).ok).toBe(true);

    const deployed = player.board.filter((unit) => unit?.defId === 'pan');
    expect(deployed).toHaveLength(1);
    expect(deployed[0]?.star).toBe(2);
    expect(player.bench.every((unit) => unit?.defId !== 'pan')).toBe(true);
  });

  it('备战席满且无法合成时，购买整体回滚', () => {
    const match = new Match(2026);
    const player = match.human;
    player.gold = 50;
    player.board = emptyBoard();
    player.bench = emptyBench();
    for (let index = 0; index < BENCH_SLOTS; index++) player.bench[index] = createUnit('ajiu');
    player.shop[0] = 'pan';
    const before = { gold: player.gold, shop: [...player.shop], pool: match.pool.snapshot() };

    expect(match.buy(player, 0)).toMatchObject({ ok: false, reason: 'bench' });
    expect(player.gold).toBe(before.gold);
    expect(player.shop).toEqual(before.shop);
    expect(match.pool.snapshot()).toEqual(before.pool);
  });

  it('自动布阵溢出的棋子会卖回卡池，装备留在玩家器匣', () => {
    const level = 2;
    const ids = CHAMPIONS.filter((champion) => champion.cost <= 2)
      .slice(0, level + BENCH_SLOTS + 1)
      .map((champion) => champion.id);
    const player = makePlayer({ level, gold: 0 });
    const pool = new CardPool();
    const fullPool = pool.snapshot();

    ids.forEach((defId, index) => {
      expect(pool.take(defId)).toBe(true);
      const unit = createUnit(defId);
      unit.items.push(`item-${index}`);
      if (index < 4) player.board[boardIdx(index, 0)] = unit;
      else player.bench[index - 4] = unit;
    });

    const refund = autoArrange(player, pool);
    const held = [...player.board, ...player.bench];
    for (const defId of ids) {
      const heldCount = held.filter((unit) => unit?.defId === defId).length;
      expect(pool.remaining(defId) + heldCount).toBe(fullPool[defId]);
    }
    expect(itemCount(held, player.items)).toBe(ids.length);
    expect(refund).toBeGreaterThan(0);
    expect(player.gold).toBe(refund);
  });
});
