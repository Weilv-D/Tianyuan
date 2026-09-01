import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match';
import { createUnit } from '../src/game/state';

describe('结算后恢复', () => {
  it('刷新后进入下一回合，不重复掉血或重复记录战斗', () => {
    const match = new Match(20260831);
    match.beginRound();
    match.human.board[0] = createUnit('duanyue');
    match.players[1].board[0] = createUnit('duanyue');
    match.beginRound();
    match.pairings = match.makePairings();
    match.settleRound();
    match.endRound();

    const hp = match.players.map((player) => player.hp);
    const snapshots = match.battleSnapshots.length;
    const round = match.round;
    const restored = Match.fromJSON(match.toJSON());
    expect(restored.needsAdvanceOnLoad()).toBe(true);

    restored.beginRound();

    expect(restored.round).toBe(round + 1);
    expect(restored.phase).toBe('prep');
    expect(restored.players.map((player) => player.hp)).toEqual(hp);
    expect(restored.battleSnapshots).toHaveLength(snapshots);
  });
});
