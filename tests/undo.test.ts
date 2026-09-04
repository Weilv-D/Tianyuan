import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match';
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

    restorePlayer(player, pool, before, { adventureOffer: null });
    expect(snapshotPlayer(player, pool)).toEqual(before);

    player.board[boardIdx(3, 0)]!.items.push('duanhun');
    restorePlayer(player, pool, before, { adventureOffer: null });
    expect(snapshotPlayer(player, pool)).toEqual(before);
  });

  it('撤销回滚随机流游标：刷新-撤销-再刷新与被撤销那次结果一致（不可免费探店）', () => {
    // 快照进/出栈的完整语义（快照 + rng 游标）在 GameScene.pushUndo/onUndo：
    // 这里用 Match 在 Node 里复现同一对操作 —— 随机游标不回滚的话，
    // 第二次刷新会落在前进过的随机流上，"刷新-撤销"循环变成零成本探店
    const match = new Match(42);
    const p = match.human;
    p.gold = 50;

    const entry = { snap: snapshotPlayer(p, match.pool), rngState: match.rng.state };
    expect(match.reroll(p)).toBe(true);
    const rolledShop = [...p.shop];
    const goldAfterReroll = p.gold;
    expect(rolledShop.some((id) => id !== null)).toBe(true);

    restorePlayer(p, match.pool, entry.snap, match);
    match.rng.state = entry.rngState;
    expect(p.gold).toBe(50);

    expect(match.reroll(p)).toBe(true);
    expect(p.shop).toEqual(rolledShop);
    expect(p.gold).toBe(goldAfterReroll);
  });

  it('快照携带奇遇恩赐：撤销到领赐前快照可重选同一份选项', () => {
    // 快照 scope = 准备阶段可触碰的一切（含本回合未领取的恩赐）。奇遇轮
    // rollAdventureOffer 的 rng 消费发生在 beginRound 内，撤销回滚只回玩家动作：
    // offer 随快照出入栈，领赐后撤销应把 offer 还原回原对象，重选路径不被切断。
    const match = new Match(7);
    match.beginRound();
    expect(match.round).toBe(1);
    // 人为把人类置于奇遇轮语境：round 4 的 offer 是全体共享的同一份
    while (match.round < 4 && !match.isOver()) match.beginRound();
    const offerBefore = match.adventureOffer;
    // round 4 必然生成恩赐（人类存活）——缺失即 rollAdventureOffer 回归，
    // 必须当场红：防御性 return 会把"恩赐不再生成"的回归静默跳过
    if (!offerBefore) throw new Error('round 4 应生成奇遇恩赐（rollAdventureOffer 回归）');
    const entry = { snap: snapshotPlayer(match.human, match.pool, match.adventureOffer), rngState: match.rng.state };

    // 领取恩赐（走与 UI 相同的 resolveAdventure 入口）
    match.resolveAdventure(0);
    expect(match.adventureOffer).toBeNull();

    // 撤销：offer 还原，玩家可重选
    restorePlayer(match.human, match.pool, entry.snap, match);
    expect(match.adventureOffer).not.toBeNull();
    expect(match.adventureOffer!.options).toEqual(offerBefore.options);
  });
});
