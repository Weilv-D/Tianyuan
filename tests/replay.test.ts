import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match';
import { verifyReplay } from '../src/game/replay';

function playRounds(rounds: number, manual = false): Match {
  const match = new Match(20260830);
  while (!match.isOver() && match.round < rounds) {
    match.beginRound();
    match.pairings = match.makePairings();
    if (manual) {
      for (const pairing of match.pairings) {
        match.applyBattleResult(pairing, match.runBattleHeadless(pairing));
      }
      match.pairings = [];
    } else {
      match.settleRound();
    }
    match.endRound();
  }
  return match;
}

describe('战斗回放', () => {
  it('统一结算与无头结算得到同一局状态，快照可以全部重演', () => {
    const settled = playRounds(5);
    const manual = playRounds(5, true);
    const normalize = (value: unknown) => JSON.stringify(value).replace(/"iid":\d+/g, '"iid":N');
    expect(normalize(settled.toJSON())).toBe(normalize(manual.toJSON()));

    const snapshots = settled.battleSnapshots;
    expect(snapshots.length).toBeGreaterThan(0);
    expect(verifyReplay(snapshots)).toMatchObject({ checked: snapshots.length, failed: 0, failures: [] });
  });

  it('被篡改的结果会被回放校验发现', () => {
    const snapshots = playRounds(2).battleSnapshots;
    const tampered = snapshots.map((snapshot, index) =>
      index === 0 ? { ...snapshot, ticks: snapshot.ticks + 1 } : snapshot,
    );
    const report = verifyReplay(tampered);
    expect(report.failed).toBe(1);
    expect(report.failures[0]).toEqual({ round: snapshots[0].round, field: 'ticks' });
  });
});
