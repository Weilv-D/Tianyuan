import { describe, expect, it } from 'vitest';
import { PLAYER_START_HP } from '../src/core/config';
import { COMPONENT_IDS } from '../src/data/items';
import { COMBINED_ITEM_IDS, adventureGold, adventureReinforceCost, adventureStage, adventureXp } from '../src/game/adventure';
import { ADVENTURE_ROUND_SCHEDULE, BEAST_ROUND_SCHEDULE, Match } from '../src/game/match';
import { createUnit } from '../src/game/state';

/** 逐轮推进到目标回合（不结算战斗 —— 调度与掉落断言不依赖 AI 战局） */
function enterRound(match: Match, round: number): void {
  while (match.round < round) match.beginRound();
}

describe('对局节奏表', () => {
  it('调度真源与字面量互为镜像：墨兽 1/7/13/19/25，奇遇 4/10/16，逐轮判定一致且互斥', () => {
    expect(BEAST_ROUND_SCHEDULE).toEqual([1, 7, 13, 19, 25]);
    expect(ADVENTURE_ROUND_SCHEDULE).toEqual([4, 10, 16]);

    const match = new Match(7);
    const beast: number[] = [];
    const adventure: number[] = [];
    for (let round = 1; round <= 60; round++) {
      if (match.isBeastRound(round)) beast.push(round);
      if (match.isAdventureRound(round)) adventure.push(round);
    }
    expect(beast).toEqual([...BEAST_ROUND_SCHEDULE]);
    expect(adventure).toEqual([...ADVENTURE_ROUND_SCHEDULE]);
    for (const round of ADVENTURE_ROUND_SCHEDULE) {
      expect(match.isBeastRound(round)).toBe(false);
    }
  });

  it('三次奇遇各落一档：4=前期 10=中期 16=后期（档位绝对数值）', () => {
    expect([4, 10, 16].map(adventureGold)).toEqual([10, 16, 24]);
    expect([4, 10, 16].map(adventureXp)).toEqual([8, 14, 20]);
    expect([4, 10, 16].map(adventureReinforceCost)).toEqual([1, 2, 3]);
    expect(adventureStage(4)).toBe('early');
    expect(adventureStage(10)).toBe('mid');
    expect(adventureStage(16)).toBe('late');
  });
});

describe('首战引导轮（第 1 回合墨兽）', () => {
  it('首回合即是墨兽轮：2 只 1★ 引导兽，攻击力 ×0.15 且生命正常', () => {
    const match = new Match(42);
    match.beginRound();
    expect(match.round).toBe(1);
    expect(match.isBeastRound()).toBe(true);

    const beasts = match.boardOfOpponent({ a: 0, b: -1, ghost: -1, swap: true, beast: true }).filter(Boolean);
    expect(beasts).toHaveLength(2);
    for (const beast of beasts) {
      expect(beast!.star).toBe(1);
      expect(beast!.powMult).toBe(0.15);
      const plain = createUnit(beast!.defId, 1);
      expect(plain.powMult).toBeUndefined();
    }
  });

  it('教学轮零掉血：空场败给墨兽不扣生命，且必掉 1 件组件', () => {
    const match = new Match(42);
    match.beginRound();
    match.pairings = match.makePairings();
    expect(match.pairings.every((pair) => pair.beast)).toBe(true);

    match.settleRound();

    expect(match.human.lastOutcome).toBe('loss');
    expect(match.human.lastDamage).toBe(0);
    expect(match.human.hp).toBe(PLAYER_START_HP);
    expect(match.human.items).toHaveLength(1);
    expect(COMPONENT_IDS).toContain(match.human.items[0]);
  });
});

describe('墨兽掉落表', () => {
  /** 给人类铺满三星五费，构造对任意墨兽的必胜局 */
  function forceWin(match: Match): void {
    const legends = ['haotian', 'yinglong', 'canglan', 'qingqiu', 'shidian', 'zhenyue', 'xuanwu', 'gongshu'];
    legends.forEach((defId, index) => {
      match.human.board[index] = createUnit(defId, 3);
    });
  }

  it('第 7 轮：胜局 1~2 件全组件，败局保底恰 1 件', () => {
    const winCounts = new Set<number>();
    for (let seed = 1; seed <= 16; seed++) {
      const match = new Match(seed);
      enterRound(match, 7);
      forceWin(match);
      match.pairings = match.makePairings();
      match.settleRound();
      expect(match.human.lastOutcome).toBe('win');
      const drops = match.human.items;
      expect(drops.length).toBeGreaterThanOrEqual(1);
      expect(drops.length).toBeLessThanOrEqual(2);
      for (const id of drops) expect(COMPONENT_IDS).toContain(id);
      winCounts.add(drops.length);
    }
    // 55% 第二件分支必须真实存在：16 个种子不该全是单掉
    expect(winCounts.has(2)).toBe(true);

    const lost = new Match(7);
    enterRound(lost, 7);
    lost.pairings = lost.makePairings();
    lost.settleRound();
    expect(lost.human.lastOutcome).toBe('loss');
    expect(lost.human.items).toHaveLength(1);
    expect(COMPONENT_IDS).toContain(lost.human.items[0]);
  });

  it('第 25 轮：胜局至多 4 件、可含成品装备；败局仍保底 1 件组件', () => {
    const COMBINED = new Set(COMBINED_ITEM_IDS);
    let sawCombined = false;
    for (let seed = 1; seed <= 16; seed++) {
      const match = new Match(seed);
      enterRound(match, 25);
      forceWin(match);
      match.pairings = match.makePairings();
      match.settleRound();
      expect(match.human.lastOutcome).toBe('win');
      const drops = match.human.items;
      expect(drops.length).toBeLessThanOrEqual(4);
      for (const id of drops) {
        expect(COMPONENT_IDS.includes(id) || COMBINED.has(id)).toBe(true);
        if (COMBINED.has(id)) sawCombined = true;
      }
    }
    expect(sawCombined).toBe(true);

    const lost = new Match(9);
    enterRound(lost, 25);
    lost.pairings = lost.makePairings();
    lost.settleRound();
    expect(lost.human.lastOutcome).toBe('loss');
    expect(lost.human.items).toHaveLength(1);
    expect(COMPONENT_IDS).toContain(lost.human.items[0]);
  });
});
