import { describe, expect, it } from 'vitest';
import { PLAYER_START_HP } from '../src/core/config';
import { COMPONENT_IDS } from '../src/data/items';
import { COMBINED_ITEM_IDS, adventureGold, adventureReinforceCost, adventureStage, adventureXp } from '../src/game/adventure';
import { ADVENTURE_ROUND_SCHEDULE, BEAST_DROP_SCHEDULE, BEAST_ROUND_SCHEDULE, Match } from '../src/game/match';
import { createUnit } from '../src/game/state';
import { makeProfile } from '../src/game/ai';

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
  it('首回合即是墨兽轮：1 只 1★ 引导兽，攻击力 ×0.08 且生命正常', () => {
    const match = new Match(42);
    match.beginRound();
    expect(match.round).toBe(1);
    expect(match.isBeastRound()).toBe(true);

    const beasts = match.boardOfOpponent({ a: 0, b: -1, ghost: -1, swap: true, beast: true }).filter(Boolean);
    expect(beasts).toHaveLength(1);
    for (const beast of beasts) {
      expect(beast!.star).toBe(1);
      expect(beast!.powMult).toBe(0.08);
      const plain = createUnit(beast!.defId, 1);
      expect(plain.powMult).toBeUndefined();
    }
  });

  it('教学轮零掉血：空场败给墨兽不扣生命，必掉 2 组件 + 8 金', () => {
    const match = new Match(42);
    match.beginRound();
    match.pairings = match.makePairings();
    expect(match.pairings.every((pair) => pair.beast)).toBe(true);

    match.settleRound();

    expect(match.human.lastOutcome).toBe('loss');
    expect(match.human.lastDamage).toBe(0);
    expect(match.human.hp).toBe(PLAYER_START_HP);
    expect(match.human.items).toHaveLength(2);
    for (const id of match.human.items) expect(COMPONENT_IDS).toContain(id);
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

  /** 结算并返回人类本场的掉落（组件/成品 ids 与金币） */
  function settleDrop(match: Match, win: boolean): { items: string[]; gold: number } {
    if (win) forceWin(match);
    match.pairings = match.makePairings();
    const goldBefore = match.human.gold;
    match.settleRound();
    return {
      items: match.human.items,
      gold: match.human.gold - goldBefore,
    };
  }

  it('下限口径：五轮全败 = 19 组件（9.5 成装当量）+ 70 金，双双过 9 件/60 金验收线', () => {
    // 1 成品 = 2 组件（items.ts recipe 均为两两合成），9 件成装 = 18 组件当量
    const compSum = BEAST_DROP_SCHEDULE.reduce((sum, tier) => sum + tier.comp, 0);
    const goldSum = BEAST_DROP_SCHEDULE.reduce((sum, tier) => sum + tier.gold, 0);
    expect(compSum).toBe(19);
    expect(goldSum).toBe(70);
    expect(compSum).toBeGreaterThanOrEqual(18);
    expect(goldSum).toBeGreaterThanOrEqual(60);
    // 胜场追加只多不少：逐轮胜侧总量（含成品按 2 组件当量计）高于败侧
    for (const tier of BEAST_DROP_SCHEDULE) {
      const winValue = tier.comp + tier.winComp + tier.winCompleted * 2;
      expect(winValue).toBeGreaterThanOrEqual(tier.comp);
    }
  });

  it('第 7 轮：保底 3 组件 + 12 金，胜场追加至 4 组件 + 16 金', () => {
    const lost = new Match(7);
    enterRound(lost, 7);
    const lossDrop = settleDrop(lost, false);
    expect(lost.human.lastOutcome).toBe('loss');
    expect(lossDrop.items).toHaveLength(3);
    for (const id of lossDrop.items) expect(COMPONENT_IDS).toContain(id);
    expect(lossDrop.gold).toBe(12);

    const won = new Match(7);
    enterRound(won, 7);
    const winDrop = settleDrop(won, true);
    expect(won.human.lastOutcome).toBe('win');
    expect(winDrop.items).toHaveLength(4);
    for (const id of winDrop.items) expect(COMPONENT_IDS).toContain(id);
    expect(winDrop.gold).toBe(16);
  });

  it('第 13 轮：保底 4 组件 + 14 金，胜场追加至 6 组件 + 20 金', () => {
    const won = new Match(13);
    enterRound(won, 13);
    const winDrop = settleDrop(won, true);
    expect(winDrop.items).toHaveLength(6);
    expect(winDrop.gold).toBe(20);
  });

  it('第 19/25 轮：胜场各含 1 件成品，金币随表递增', () => {
    const COMBINED = new Set(COMBINED_ITEM_IDS);

    const r19 = new Match(19);
    enterRound(r19, 19);
    const drop19 = settleDrop(r19, true);
    expect(drop19.items).toHaveLength(8); // 5 保底 + 2 追加组件 + 1 成品
    expect(drop19.items.filter((id) => COMBINED.has(id))).toHaveLength(1);
    expect(drop19.gold).toBe(24);

    const r25 = new Match(25);
    enterRound(r25, 25);
    const drop25 = settleDrop(r25, true);
    expect(drop25.items).toHaveLength(9); // 5 保底 + 3 追加组件 + 1 成品
    expect(drop25.items.filter((id) => COMBINED.has(id))).toHaveLength(1);
    expect(drop25.gold).toBe(30);

    const lost = new Match(9);
    enterRound(lost, 25);
    const lossDrop = settleDrop(lost, false);
    expect(lossDrop.items).toHaveLength(5);
    for (const id of lossDrop.items) expect(COMPONENT_IDS).toContain(id);
    expect(lossDrop.gold).toBe(20);
  });

  it('超时平局：墨兽轮平局照样发保底（掉落真源表是全员无条件口径）', () => {
    const match = new Match(7);
    enterRound(match, 7);
    match.pairings = match.makePairings();
    const pair = match.pairings.find((p) => p.beast)!;
    const goldBefore = match.human.gold;

    const outcomes = match.applyBattleResult(pair, {
      winner: null,
      ticks: 1,
      survivors: { 0: [], 1: [] },
      remainingHpRatio: { 0: 0, 1: 0 },
      timeout: true,
    });

    expect(match.human.lastOutcome).toBe('draw');
    expect(outcomes[0].outcome).toBe('draw');
    expect(outcomes[0].drops).toHaveLength(3); // 第 7 轮保底档
    expect(outcomes[0].gold).toBe(12);
    expect(match.human.gold - goldBefore).toBe(12);
    expect(match.human.hp).toBe(PLAYER_START_HP); // 平局不掉血
  });
});

describe('AI 开局阵容下限（2026-09-02 空阵修复回归）', () => {
  it('任何原型任何种子，第 1 回合结束后至少持有 1 张棋子 —— 不存在零上阵开局', () => {
    // 回归背景：孤注(mergeBias 3.6) 曾把"开新线惩罚"放大到 21.6 分，
    // 开局整店评不过阈值，52% 对局以空阵开局 —— 玩家侧表现为
    // "对手未上阵 · 直接胜利"的零对抗局。空手急救 + 惩罚封顶后必须绝迹。
    for (let seed = 1; seed <= 40; seed++) {
      const match = new Match(seed);
      match.beginRound();
      for (const p of match.alivePlayers()) {
        if (p.isHuman) continue; // 测试里人类不行动，只约束 AI
        const total = match.players[p.idx].board.filter(Boolean).length + match.players[p.idx].bench.filter(Boolean).length;
        expect(total, `seed=${seed} ${p.name}（${p.ai?.arch}）开局 ${total} 张棋子`).toBeGreaterThan(0);
      }
    }
  });

  it('整局无头快进：任何回合任何存活 AI 都不上空阵棋盘', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const match = new Match(seed);
      match.human.ai = makeProfile('balanced');
      let guard = 0;
      while (!match.isOver() && guard++ < 60) {
        match.beginRound();
        if (match.isOver()) break;
        for (const p of match.alivePlayers()) {
          if (p.isHuman) continue;
          expect(
            p.board.filter(Boolean).length,
            `seed=${seed} r=${match.round} ${p.name} 空阵`,
          ).toBeGreaterThan(0);
        }
        for (const pair of match.pairings) {
          match.applyBattleResult(pair, match.runBattleHeadless(pair));
        }
        match.endRound();
      }
    }
  });
});
