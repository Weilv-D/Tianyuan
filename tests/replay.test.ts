/**
 * 回放校验回归（M4）。
 *
 * 快照组装走"真实 Battle + recordEvents=true"独立链路（不依赖 Match 的
 * battleSnapshots 记录 —— 该逻辑由 match.ts 并行实现），verifyReplay 用同一
 * config 重跑并比对。三场战斗覆盖：微型无羁绊 / 四人羁绊档 / 星使瑶光多羁绊。
 */
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import type { BattleConfig } from '../src/core/types';
import { computeTraits } from '../src/game/comp';
import { fnv1aHex, verifyReplay, type BattleSnapshot } from '../src/game/replay';
import { Match } from '../src/game/match';

/** 跑一场真实战斗并组装快照；record=false 时不记事件流（digest 为 ''） */
function runAndSnapshot(round: number, config: BattleConfig, record: boolean): BattleSnapshot {
  const battle = new Battle(config, null, record);
  const result = battle.run();
  return {
    round,
    config,
    winner: result.winner as 0 | 1 | null,
    ticks: result.ticks,
    eventsDigest: record ? fnv1aHex(JSON.stringify(battle.events)) : '',
  };
}

const battleA: BattleConfig = {
  seed: 20260801,
  units: [
    { uid: 1, defId: 'pan', team: 0, star: 1, cell: { c: 2, r: 3 } },
    { uid: 101, defId: 'jingyu', team: 1, star: 1, cell: { c: 5, r: 7 } },
  ],
  traits: { 0: [], 1: [] },
  maxTicks: 90,
};

const battleB: BattleConfig = {
  seed: 20260802,
  units: [
    { uid: 1, defId: 'duanyue', team: 0, star: 1, cell: { c: 0, r: 3 } },
    { uid: 2, defId: 'yingsha', team: 0, star: 1, cell: { c: 1, r: 3 } },
    { uid: 3, defId: 'wujiu', team: 0, star: 1, cell: { c: 2, r: 3 } },
    { uid: 4, defId: 'qingming', team: 0, star: 1, cell: { c: 3, r: 3 } },
    { uid: 101, defId: 'ajiu', team: 1, star: 1, cell: { c: 0, r: 7 } },
    { uid: 102, defId: 'jingyu', team: 1, star: 1, cell: { c: 7, r: 7 } },
  ],
  traits: { 0: computeTraits(['duanyue', 'yingsha', 'wujiu', 'qingming']), 1: computeTraits(['ajiu', 'jingyu']) },
  maxTicks: 120,
};

// 星使瑶光（天庭/方士）领衔：天庭 2 + 龙渊 2 + 方士 3，多羁绊同场
const battleC: BattleConfig = {
  seed: 20260803,
  units: [
    { uid: 1, defId: 'yaoguang', team: 0, star: 1, cell: { c: 1, r: 3 } },
    { uid: 2, defId: 'lingxiao', team: 0, star: 1, cell: { c: 0, r: 3 } },
    { uid: 3, defId: 'hanxing', team: 0, star: 1, cell: { c: 2, r: 3 } },
    { uid: 4, defId: 'aoyin', team: 0, star: 1, cell: { c: 3, r: 3 } },
    { uid: 101, defId: 'jiaohan', team: 1, star: 1, cell: { c: 0, r: 7 } },
    { uid: 102, defId: 'chaoji', team: 1, star: 1, cell: { c: 7, r: 7 } },
  ],
  traits: {
    0: computeTraits(['yaoguang', 'lingxiao', 'hanxing', 'aoyin']),
    1: computeTraits(['jiaohan', 'chaoji']),
  },
  maxTicks: 150,
};

describe('verifyReplay', () => {
  it('三场真实战斗的快照全部通过校验', () => {
    const snapshots = [
      runAndSnapshot(1, battleA, true),
      runAndSnapshot(2, battleB, true),
      runAndSnapshot(3, battleC, true),
    ];
    const report = verifyReplay(snapshots);
    expect(report.checked).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.failures).toEqual([]);
  });

  it('battleC 确实带多羁绊（天庭/龙渊/方士激活），瑶光在列', () => {
    const active = battleC.traits[0]!.filter((t) => t.tier >= 0).map((t) => t.id).sort();
    expect(active).toEqual(['longyuan', 'mage', 'tian']);
    expect(battleC.units.some((u) => u.defId === 'yaoguang')).toBe(true);
  });

  it('篡改 ticks → failures 捕获，其余位不受牵连', () => {
    const snapshots = [
      runAndSnapshot(1, battleA, true),
      runAndSnapshot(2, battleB, true),
      runAndSnapshot(3, battleC, true),
    ];
    const tampered: BattleSnapshot[] = [...snapshots];
    tampered[1] = { ...tampered[1]!, ticks: tampered[1]!.ticks + 1 };
    const report = verifyReplay(tampered);
    expect(report.checked).toBe(3);
    expect(report.failed).toBe(1);
    expect(report.failures).toEqual([{ round: 2, field: 'ticks' }]);
  });

  it('篡改 eventsDigest → failures 捕获摘要位', () => {
    const snapshots = [
      runAndSnapshot(1, battleA, true),
      runAndSnapshot(2, battleB, true),
    ];
    const tampered: BattleSnapshot[] = [...snapshots];
    tampered[0] = { ...tampered[0]!, eventsDigest: 'deadbeef' };
    const report = verifyReplay(tampered);
    expect(report.failed).toBe(1);
    expect(report.failures).toEqual([{ round: 1, field: 'eventsDigest' }]);
  });

  it("recordEvents=false 的快照（digest ''）跳过摘要位、仍按 winner/ticks 校验通过", () => {
    const config: BattleConfig = {
      seed: 20260804,
      units: [
        { uid: 1, defId: 'qinghe', team: 0, star: 1, cell: { c: 1, r: 3 } },
        { uid: 2, defId: 'kutong', team: 0, star: 1, cell: { c: 2, r: 3 } },
        { uid: 101, defId: 'yeyou', team: 1, star: 1, cell: { c: 5, r: 7 } },
      ],
      traits: { 0: computeTraits(['qinghe', 'kutong']), 1: [] },
      maxTicks: 90,
    };
    const snapshot = runAndSnapshot(4, config, false);
    expect(snapshot.eventsDigest).toBe('');
    const report = verifyReplay([snapshot]);
    expect(report.checked).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.failures).toEqual([]);
  });

  it('同 config 重跑的摘要与首跑逐字节一致（确定性口径自证）', () => {
    const first = runAndSnapshot(1, battleB, true);
    const second = runAndSnapshot(1, battleB, true);
    expect(second.eventsDigest).toBe(first.eventsDigest);
    expect(second.winner).toBe(first.winner);
    expect(second.ticks).toBe(first.ticks);
  });
});

// ───────────────── 与对局层的合流校验（A 线记录 → B 线校验） ─────────────────

/**
 * 跨线契约测试：真实对局（含奇遇轮）由 match.ts 的 runBattleHeadless 记录
 * battleSnapshots，这里整批交给 verifyReplay 重跑校验 —— 快照格式、种子传递、
 * 配置同源性任何一环口径不符都会在此暴露。
 */
describe('与对局层快照的合流校验', () => {
  it('真实对局 8 回合的全部 battleSnapshots 通过 verifyReplay', () => {
    const m = new Match(20260830);
    let guard = 0;
    while (!m.isOver() && m.round < 8 && guard < 20) {
      m.beginRound();
      if (m.isOver()) break;
      m.pairings = m.makePairings();
      for (const pair of m.pairings) {
        m.applyBattleResult(pair, m.runBattleHeadless(pair));
      }
      m.endRound();
      guard++;
    }
    const snaps = m.battleSnapshots;
    expect(snaps.length).toBeGreaterThan(20); // 8 回合 × 每回合多场对局
    const report = verifyReplay(snaps);
    expect(report.checked).toBe(snaps.length);
    expect(report.failed).toBe(0);
  });
});
