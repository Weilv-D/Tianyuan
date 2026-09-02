import { describe, expect, it } from 'vitest';
import { BENCH_SLOTS } from '../src/core/config';
import { CHAMPIONS } from '../src/data/champions';
import { autoArrange } from '../src/game/arrange';
import { unequipItem } from '../src/game/inventory';
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

  it('满席买入遇四张同名：失败回滚是完整回滚（不留下白嫖的 2★）', () => {
    const match = new Match(20260901, '测试', 'normal');
    const p = match.human;
    p.gold = 50;
    const id = 'duanyue'; // 1 费
    // 场上 2 张同名 1★ + 席上 1 张同名 victim —— 满席买入把同名凑到 4 张：
    // 溢出位成为合成幸存者，合成消费的是两张旧子；失败路径必须把这场
    // "没有付出的合成"一并还原，否则玩家白得一个 2★（单边守恒破坏）
    p.board[boardIdx(0, 0)] = createUnit(id);
    p.board[boardIdx(1, 0)] = createUnit(id);
    p.bench[0] = createUnit(id);
    for (let i = 1; i < BENCH_SLOTS; i++) p.bench[i] = createUnit('ajiu');
    p.shop[0] = id;
    const goldBefore = p.gold;
    const poolBefore = match.pool.snapshot();
    const boardIids = p.board.map((u) => u?.iid ?? null);
    const benchIids = p.bench.map((u) => u?.iid ?? null);

    const result = match.buy(p, 0);

    expect(result).toMatchObject({ ok: false, reason: 'bench' });
    expect(p.gold).toBe(goldBefore);
    expect(match.pool.snapshot()).toEqual(poolBefore);
    expect(p.shop[0]).toBe(id);
    expect(p.board.map((u) => u?.iid ?? null)).toEqual(boardIids);
    expect(p.bench.map((u) => u?.iid ?? null)).toEqual(benchIids);
    // 全场仍是 3 张同名 1★：没有 2★ 产生，也没有旧子被吞
    const copies = [...p.board, ...p.bench].filter((u) => u?.defId === id && u.star === 1).length;
    expect(copies).toBe(3);
    expect([...p.board, ...p.bench].some((u) => u?.defId === id && u.star === 2)).toBe(false);
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

  it('卖出带装备的棋子：成品拆回组件、卡回池、金币照返（装备不蒸发）', () => {
    const match = new Match(20260903, '测试', 'normal');
    const player = match.human;
    player.gold = 50;
    player.board = emptyBoard();
    player.bench = emptyBench();
    player.items = [];
    const poolBefore = match.pool.snapshot();
    // 组件 moren + 成品 guanri（recipe [moren, lingzhu]，拆回两组件）
    player.bench[0] = createUnit('pan');
    const unit = player.bench[0]!;
    unit.items = ['moren', 'guanri'];
    const goldBefore = player.gold;
    const id = unit.defId;
    const star = unit.star;

    expect(match.sell(player, unit.iid)).toBe(true);

    // 装备守恒：1 件成品（拆 2）+ 1 组件 → 器匣多了 3 件
    expect(player.items).toHaveLength(3);
    // 卡回池：pan 1★ 回到池（池计数对称）
    expect(match.pool.snapshot()).toEqual({ ...poolBefore, [id]: poolBefore[id] + 1 });
    // 金币按卖价返还（与星级匹配）
    const refunded = sellValue({ defId: id, star, items: [] } as unknown as UnitInstance);
    expect(player.gold).toBe(goldBefore + refunded);
    // 棋子确实离场
    expect(player.bench.every((u) => u === null || u.defId !== 'pan')).toBe(true);
  });

  it('满席合成 + 自动上场路径：溢出位被搬走后席位裁回 9 格（length 不变式）', () => {
    const match = new Match(20260904, '测试', 'normal');
    match.settings.autoDeploy = true;
    const player = match.human;
    player.gold = 50;
    player.level = 3; // 人口 3 → 有空格可自动上场
    player.board = emptyBoard();
    player.bench = emptyBench();
    // 备战席占满 9 格：7 张 ajiu 占位 + 2 张同名 1★ pan（合成材料）
    for (let i = 0; i < BENCH_SLOTS; i++) player.bench[i] = createUnit('ajiu');
    player.bench[0] = createUnit('pan');
    player.bench[1] = createUnit('pan');
    player.board[boardIdx(0, 0)] = createUnit('ajiu'); // 场上也有一张，3 人口占 1
    player.shop[0] = 'pan';

    expect(match.buy(player, 0).ok).toBe(true);

    // 满席买 pan → 溢出位第 10 格 → 三张 1★ 合 2★ → 自动上场搬走 → 席位 9
    expect(player.bench).toHaveLength(BENCH_SLOTS);
    expect(player.board.some((u) => u?.defId === 'pan' && u.star === 2)).toBe(true);
    expect(player.bench.every((u) => u === null || u.defId !== 'pan')).toBe(true);
  });

  it('满席买入即合后升级件留备战席（自动上场关闭/人口满）：席位仍收敛 9 格', () => {
    // autoDeploy=false（或同名已在场 / 人口已满）时，合成出的 2★ 不搬上场而留席。
    // 此前只有"溢出位恰好是合成被吃对象（尾部变空）"才裁尾，其余任何幸存者
    // 滞留第 10 格的路径都会让 p.bench.length 永久停在 10（第 10 格恒 null，
    // 视觉多一格、遍历多一空位）。修复后成功路径无条件把长度收敛回 BENCH_SLOTS。
    const match = new Match(20260906, '测试', 'normal');
    match.settings.autoDeploy = false; // 关闭自动上场 → 升级件留备战席
    const player = match.human;
    player.gold = 50;
    player.level = 1; // 人口 1 已满（场上 1 张）→ 即便开自动上场也无处放
    player.board = emptyBoard();
    player.bench = emptyBench();
    // 用互不相同的杂牌占位（同名会触发级联合成，污染席位断言）
    const fillers = ['lingxiao', 'moyu', 'kutong', 'yuansu', 'wujiu', 'pan', 'guicheng'].filter((id) => id !== 'pan');
    player.bench[0] = createUnit('pan');
    player.bench[1] = createUnit('pan');
    for (let i = 2; i < BENCH_SLOTS; i++) player.bench[i] = createUnit(fillers[i - 2]!);
    player.board[boardIdx(0, 0)] = createUnit('ajiu');
    player.shop[0] = 'pan';

    expect(match.buy(player, 0).ok).toBe(true);

    // 三张 pan 1★ 合出 2★，幸存者留在备战席；长度收敛回 9
    expect(player.bench).toHaveLength(BENCH_SLOTS);
    const pans = player.bench.filter((u) => u?.defId === 'pan');
    expect(pans).toHaveLength(1);
    expect(pans[0]?.star).toBe(2);
    // 合成净腾一格：9 席 = 7 杂牌 + 1 pan2★ + 1 空
    expect(player.bench.filter((u) => u !== null)).toHaveLength(BENCH_SLOTS - 1);
    expect(player.board.some((u) => u?.defId === 'pan')).toBe(false);
  });

  it('单件卸装严守器匣容量：放不下时整体拒绝（与批量卸载同口径）', () => {
    const match = new Match(20260905, '测试', 'normal');
    const player = match.human;
    player.board = emptyBoard();
    player.bench = emptyBench();
    const u = createUnit('pan');
    u.items = ['guanri']; // 成品 → 拆两组件
    player.bench[0] = u;
    // 器匣已满（10 格）：成品卸下要占 2 格，放不下
    player.items = Array.from({ length: 10 }, (_, i) => `comp${i}`);

    const r = unequipItem(player, u.iid, 'guanri');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/器匣/);
    expect(player.items).toHaveLength(10);
    expect(player.bench[0]?.items).toEqual(['guanri']); // 装回原样，无部分卸下

    // 腾出 1 格仍不够（要 2 格）：继续拒绝
    player.items.pop();
    const r2 = unequipItem(player, u.iid, 'guanri');
    expect(r2.ok).toBe(false);

    // 腾出 2 格才放行，且拆回两个组件（10 − 2 次 pop + 2 = 10）
    player.items.pop();
    const r3 = unequipItem(player, u.iid, 'guanri');
    expect(r3.ok).toBe(true);
    expect(player.items).toHaveLength(10);
    expect(player.bench[0]?.items).toEqual([]);
  });
});
