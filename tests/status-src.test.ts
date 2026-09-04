import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { Match } from '../src/game/match';
import { mkBattle, unitInput } from './helpers';

/**
 * 叠层来源隔离（StatusEffect.src）契约。
 *
 * 多来源共用同一 StatusKind（多件装备 / 技能 / 羁绊都挂 aspdUp）时，
 * 「至多 N 层」只数本源条目，外来层不挤占上限 —— 但 sumStatus 求和
 * 照常包含全部层（隔离的是上限计数，不是加成数值）。
 * 回归背景：外来层（垂天翼开战 / 羁绊 buff / 其他装备）曾把流星弩、
 * 紫电镰、木机连弩的层数上限整个吃掉，混合构筑下装备间歇性哑火。
 */
function byDef(battle: Battle, defId: string) {
  const u = battle.units.find((x) => x.entry.id === defId);
  if (!u) throw new Error(`找不到单位 ${defId}`);
  return u;
}

describe('叠层按源分计（StatusEffect.src）', () => {
  it('弹幕叠层：外来 aspdUp 全程在场，木机连弩仍能叠满自己的 8 层', () => {
    // 外来层在场时旧口径（按 kind 全量计数）会把本源压到 7 层：
    // 「至多 8 层」的文案承诺必须在混合构筑下照样兑现
    const raw = new Battle(
      {
        seed: 20260903,
        units: [
          { uid: 101, defId: 'muji', team: 0, star: 2, cell: { c: 2, r: 3 } },
          { uid: 201, defId: 'pan', team: 1, star: 1, cell: { c: 3, r: 7 } },
          { uid: 202, defId: 'muyuan', team: 1, star: 1, cell: { c: 4, r: 7 } },
        ],
        traits: { 0: [], 1: [] },
        maxTicks: 30 * 30,
      },
      null,
      true,
    );
    const u = byDef(raw, 'muji');
    const cap = u.entry.skillSpec.params.maxStacks!;
    expect(cap).toBe(8);
    // 模拟任意外来 aspdUp（垂天翼开战 / 妖族化形 / 其他装备同型来源），
    // 时长覆盖全场，保证整个叠窗内外来层都在场
    raw.addStatus(u, u, 'aspdUp', 100, 10);

    let maxTagged = 0;
    let maxTotal = 0;
    for (let i = 0; i < 30 * 30 && !raw.finished; i++) {
      raw.step();
      maxTagged = Math.max(maxTagged, u.statuses.filter((s) => s.kind === 'aspdUp' && s.src === 'skill:muji').length);
      maxTotal = Math.max(maxTotal, u.statuses.filter((s) => s.kind === 'aspdUp').length);
    }
    // 本源打标：技能来源用稳定棋子 id（skill:<id>），不是七名棋子共享的技能类型字面量
    expect(maxTagged).toBe(cap); // 外来层在场仍叠满本源上限（旧口径此处为 cap-1）
    expect(maxTotal).toBeGreaterThan(cap); // 外来层照常存在并参与求和
  });

  it('同一来源刷新不借用别源额度：两件 capped 装备各自计数', () => {
    // 流星弩（击杀触发）与紫电镰（施法触发）同持：killFrenzy 的层数统计
    // 只数 s.src==='killFrenzy'，castAspd 条目不挤占其「至多 2 层」
    const battle = mkBattle([
      unitInput('pan', 0, { c: 0, r: 6 }, { items: ['liuxing', 'zidian'] }),
      unitInput('jingyu', 1, { c: 7, r: 1 }),
      unitInput('jingyu', 1, { c: 7, r: 2 }),
    ]);
    const a = byDef(battle, 'pan');
    const countOf = (tag: string) => a.statuses.filter((s) => s.kind === 'aspdUp' && s.src === tag).length;
    // 直接经 addStatus 走与钩子完全相同的入表路径（tag、dur、value 与 items.ts 一致），
    // 再用钩子的同款过滤断言互不挤占
    battle.addStatus(a, a, 'aspdUp', 5, 50, 'castAspd');
    battle.addStatus(a, a, 'aspdUp', 5, 50, 'castAspd');
    battle.addStatus(a, a, 'aspdUp', 5, 45, 'killFrenzy');
    battle.addStatus(a, a, 'aspdUp', 5, 45, 'killFrenzy');
    expect(countOf('castAspd')).toBe(2);
    expect(countOf('killFrenzy')).toBe(2);
    expect(a.statuses.filter((s) => s.kind === 'aspdUp').length).toBe(4);
  });

  it('addStatus 拒绝非有限数值：NaN/Infinity 在入表前即抛', () => {
    const battle = mkBattle([unitInput('pan', 0, { c: 0, r: 6 }), unitInput('jingyu', 1, { c: 7, r: 1 })]);
    const a = byDef(battle, 'pan');
    expect(() => battle.addStatus(a, a, 'aspdUp', 5, Number.NaN)).toThrow();
    expect(() => battle.addStatus(a, a, 'atkUp', 5, Number.POSITIVE_INFINITY)).toThrow();
    // 数值入表即污染面板：抛错后不得留下半条状态
    expect(a.statuses.length).toBe(0);
  });

  it('护盾自然到期与破盾同口径发 shield 事件（total 归零不缺账）', () => {
    const battle = mkBattle([unitInput('pan', 0, { c: 0, r: 6 }), unitInput('jingyu', 1, { c: 7, r: 1 })]);
    const a = byDef(battle, 'pan');
    battle.addShield(a, a, 100, 0.2); // 0.2 秒后到期
    let shieldTotalZero = false;
    for (let i = 0; i < 30 && !shieldTotalZero; i++) {
      for (const e of battle.drainEvents()) {
        if (e.t === 'shield' && e.total === 0) shieldTotalZero = true;
      }
      battle.step();
    }
    expect(a.shield).toBe(0);
    expect(shieldTotalZero).toBe(true);
  });
});

describe('读档单元清洗（fromJSON 坏档容错）', () => {
  it('未知棋子丢弃、星级钳回、未知装备剥离，单格损坏不清空整档', () => {
    const match = new Match(20260905);
    match.beginRound();
    const json = match.toJSON() as Record<string, unknown>;
    const players = json.players as { board: (Record<string, unknown> | null)[]; bench: (Record<string, unknown> | null)[] }[];
    const board = players[0].board;
    // 找两个空格分别注入：未知棋子 / 星级越界的有效棋子
    const slots = board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
    expect(slots.length).toBeGreaterThanOrEqual(2);
    board[slots[0]] = { iid: 90001, defId: 'nonexistent', star: 1, items: [] };
    board[slots[1]] = { iid: 90002, defId: 'pan', star: 5, items: ['nonexistent_item', 'xuanjia'] };
    const restored = Match.fromJSON(json as never);
    const rb = restored.human.board;
    expect(rb[slots[0]]).toBeNull(); // 未知棋子整格丢弃
    const fixed = rb[slots[1]]!;
    expect(fixed).not.toBeNull();
    expect(fixed.star).toBe(3); // 越界星级钳回上界，装备与站位资产保留
    expect(fixed.items).toEqual(['xuanjia']); // 未知装备剥离，有效装备保留
  });

  it('兜底重掷不重复记账：交手史恰好记一次', () => {
    const match = new Match(11);
    // 走到第一个 PvP 轮（回合 1 是引导墨兽轮，不记交手史）
    match.beginRound();
    while (match.isBeastRound() && !match.isOver()) match.beginRound();
    const histBefore = match.players.flatMap((p) => p.opponents).length;
    expect(histBefore).toBeGreaterThan(0);
    expect(match.pairings.length).toBeGreaterThan(0);
    // 模拟脏档被整表弃用后的开战兜底重掷（GameScene.startBattle 同参）
    match.pairings = [];
    const regenerated = match.makePairings(false);
    expect(regenerated.length).toBe(match.alivePlayers().length / 2);
    const histAfter = match.players.flatMap((p) => p.opponents).length;
    expect(histAfter).toBe(histBefore); // 重掷不再写入 opponents —— 双记即回避窗口失真
  });
});
