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

  it('备战期存档保留本回合配对：读档不重掷、交手史不双记', () => {
    const match = new Match(20260904);
    // 推进到第 2 回合（PvP 轮）：makePairings 消费洗牌 rng 并写入交手史，
    // 是配对持久化真正有风险的面 —— 第 1 回合为墨兽轮（全员打同一只，无洗牌）。
    match.beginRound();
    match.beginRound();
    // beginRound 末尾已生成本回合配对。配对不入档的话，开战时 startBattlePhase
    // 的兜底会重新 makePairings —— rng 流分叉、交手史双记、侦查对手改变。
    const saved = match.toJSON();
    expect(saved.pairings.length).toBeGreaterThan(0);
    const opponents = match.players.map((p) => [...p.opponents]);
    const rngState = match.rng.state;

    const restored = Match.fromJSON(saved);
    expect(restored.pairings).toEqual(match.pairings);
    // 读档本身不得推进随机流、不得补写交手史
    expect(restored.rng.state).toBe(rngState);
    expect(restored.players.map((p) => [...p.opponents])).toEqual(opponents);

    // settleRound 消费恢复出的配对且不再重掷（渲染层 startBattlePhase 只在
    // 空表时兜底重掷 —— 兜底在渲染层，Match 层空表就是空表）
    restored.settleRound();
    expect(restored.players.map((p) => [...p.opponents])).toEqual(opponents);
  });

  it('备战期存读档后开战：战局与不存档路径逐位一致', () => {
    const fresh = () => {
      const m = new Match(20260904);
      m.beginRound();
      m.beginRound();
      return m;
    };
    const a = fresh();
    const b = Match.fromJSON(fresh().toJSON());
    const oa = a.settleRound();
    const ob = b.settleRound();
    expect(ob).toEqual(oa);
    expect(b.battleSnapshots).toEqual(a.battleSnapshots);
    // 交手史：读档路径与连续路径一致（重掷即双记，此处必然暴露）
    expect(b.players.map((p) => [...p.opponents])).toEqual(a.players.map((p) => [...p.opponents]));
  });

  it('坏档中的非法配对整体弃用，回落开战时重掷（不抛半可用配对表）', () => {
    const match = new Match(20260904);
    match.beginRound();
    const saved = match.toJSON() as unknown as Record<string, unknown>;
    saved.pairings = [
      { a: 99, b: -1, ghost: -1, swap: false, beast: false }, // a 越界
      { a: 0, b: 1, ghost: -1, swap: 'yes', beast: false }, // swap 非布尔
    ];
    const restored = Match.fromJSON(saved as unknown as Parameters<typeof Match.fromJSON>[0]);
    expect(restored.pairings).toEqual([]);
    // 空表的回落语义钉死：settleRound 对空表静默无结算、交手史不动 ——
    // 重掷兜底在渲染层 startBattlePhase（「空表回落开战时重掷」的确切位置）
    expect(restored.settleRound()).toEqual([]);
    expect(restored.players.flatMap((p) => [...p.opponents])).toEqual([]);
  });
});
