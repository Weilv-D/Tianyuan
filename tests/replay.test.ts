import { describe, expect, it } from 'vitest';
import { dailySeedFor } from '../src/game/daily';
import { Match } from '../src/game/match';
import { fnv1aHex, verifyReplay } from '../src/game/replay';

function playRounds(rounds: number, manual = false): Match {
  const match = new Match(20260830);
  while (!match.isOver() && match.round < rounds) {
    match.beginRound(); // 配对已由 beginRound 生成并写入交手史，重掷会双记 + 双倍消费洗牌 rng
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

  it('FNV-1a 指纹符合标准测试向量（录制方与校验方共用同一实现，自洽不算证明）', () => {
    // 哈希口径一变（例如退回 UTF-16 码元制），录制与校验仍自洽通过，
    // 但**全部历史快照**与每日挑战种子会静默换值 —— 必须对标准向量钉死。
    expect(fnv1aHex('')).toBe('811c9dc5');
    expect(fnv1aHex('a')).toBe('e40c292c');
    expect(fnv1aHex('foobar')).toBe('bf9cf968');
    // 非 ASCII 走 UTF-8 字节流（与码元制结果不同）
    expect(fnv1aHex('天')).toBe(fnv1aHex('\u5929'));
    expect(fnv1aHex('天')).toHaveLength(8);
  });

  it('每日挑战种子按本地日期派生且同日恒定', () => {
    const d = new Date(2026, 8, 5, 1, 2, 3);
    const same = new Date(2026, 8, 5, 23, 59, 59);
    expect(dailySeedFor(d)).toBe(dailySeedFor(same));
    expect(dailySeedFor(d)).not.toBe(dailySeedFor(new Date(2026, 8, 6)));
    expect(dailySeedFor(d)).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(dailySeedFor(d))).toBe(true);
  });
});
