import { describe, expect, it } from 'vitest';
import { BENCH_SLOTS } from '../src/core/config';
import { CHAMPIONS } from '../src/data/champions';
import { Match } from '../src/game/match';

function enterRound(match: Match, round: number): void {
  while (match.round < round) match.beginRound();
}

describe('奇遇回合', () => {
  it('同一局种子产生相同选择，未选择的恩赐在开战时过期', () => {
    const first = new Match(20260830);
    const replay = new Match(20260830);
    enterRound(first, 5);
    enterRound(replay, 5);

    expect(first.adventureOffer).not.toBeNull();
    expect(replay.adventureOffer).toEqual(first.adventureOffer);

    first.makePairings();
    expect(first.adventureOffer).toBeNull();
  });

  it('金币和援军恩赐通过现有经济与卡池发放', () => {
    const goldMatch = new Match(1);
    goldMatch.adventureOffer = { round: 5, options: [{ kind: 'gold', title: '', desc: '' }] };
    const goldBefore = goldMatch.human.gold;
    goldMatch.resolveAdventure(0);
    expect(goldMatch.human.gold).toBeGreaterThan(goldBefore);
    expect(goldMatch.adventureOffer).toBeNull();

    const reinforceMatch = new Match(2);
    reinforceMatch.adventureOffer = { round: 5, options: [{ kind: 'reinforce', title: '', desc: '' }] };
    const poolBefore = reinforceMatch.pool.snapshot();
    reinforceMatch.resolveAdventure(0);
    const newcomer = reinforceMatch.human.bench.find(Boolean);
    expect(newcomer?.star).toBe(2);
    expect(poolBefore[newcomer!.defId] - reinforceMatch.pool.remaining(newcomer!.defId)).toBe(3);
  });

  it('备战席已满时援军折成金币且不消耗卡池', () => {
    const match = new Match(3);
    const ids = CHAMPIONS.slice(0, BENCH_SLOTS).map((champion) => champion.id);
    ids.forEach((defId, index) => {
      match.human.bench[index] = { iid: 9000 + index, defId, star: 1, items: [] };
    });
    match.adventureOffer = { round: 5, options: [{ kind: 'reinforce', title: '', desc: '' }] };
    const poolBefore = match.pool.snapshot();
    const goldBefore = match.human.gold;

    match.resolveAdventure(0);

    expect(match.human.gold).toBeGreaterThan(goldBefore);
    expect(match.pool.snapshot()).toEqual(poolBefore);
    expect(match.human.bench.filter(Boolean)).toHaveLength(BENCH_SLOTS);
  });
});
