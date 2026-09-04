import { describe, expect, it } from 'vitest';
import { BENCH_SLOTS, MAX_LEVEL } from '../src/core/config';
import { CHAMPIONS } from '../src/data/champions';
import { COMPONENT_IDS } from '../src/data/items';
import { adventureXp, type AdventureOffer } from '../src/game/adventure';
import { chooseAdventureIndex, makeProfile } from '../src/game/ai';
import { Match } from '../src/game/match';

function enterRound(match: Match, round: number): void {
  while (match.round < round) match.beginRound();
}

describe('奇遇回合', () => {
  it('同一局种子产生相同选择；未点选的恩赐在开战时由系统代选一个（与手动点选同入口发放）', () => {
    const first = new Match(20260830);
    const replay = new Match(20260830);
    enterRound(first, 4);
    enterRound(replay, 4);

    expect(first.adventureOffer).not.toBeNull();
    expect(replay.adventureOffer).toEqual(first.adventureOffer);

    const itemsBefore = first.human.items.length;
    const goldBefore = first.human.gold;
    const benchBefore = first.human.bench.filter(Boolean).length;
    const boardBefore = first.human.board.filter(Boolean).length;
    const xpBefore = first.human.xp;
    const levelBefore = first.human.level;
    expect(first.resolveHumanAdventure()).toBe(true);
    // 代选后 offer 清空，且玩家实际拿到了某一种恩赐（金/件/经验/援军/等级五选一）
    expect(first.adventureOffer).toBeNull();
    const gained =
      first.human.gold > goldBefore ||
      first.human.xp > xpBefore ||
      first.human.level > levelBefore ||
      first.human.bench.filter(Boolean).length > benchBefore ||
      first.human.board.filter(Boolean).length > boardBefore ||
      first.human.items.length > itemsBefore;
    expect(gained).toBe(true);
    // 二次代选不可重复领取
    expect(first.resolveHumanAdventure()).toBe(false);
    // 代选走纯函数选型：同种子同局面必同选择（对局层确定性契约）。
    // 只断"成功"不够 —— 若选型漂到不同 index，两边各自成功而恩赐不同，
    // 这半段契约就静默失守；六路增量逐位对齐才把"选了同一个"钉死
    const rp = replay.human;
    expect(replay.resolveHumanAdventure()).toBe(true);
    expect(replay.adventureOffer).toBeNull();
    expect(rp.gold - goldBefore).toBe(first.human.gold - goldBefore);
    expect(rp.xp - xpBefore).toBe(first.human.xp - xpBefore);
    expect(rp.level).toBe(first.human.level);
    expect(rp.items.length - itemsBefore).toBe(first.human.items.length - itemsBefore);
    expect(rp.bench.filter(Boolean).length - benchBefore).toBe(first.human.bench.filter(Boolean).length - benchBefore);
    expect(rp.board.filter(Boolean).length - boardBefore).toBe(first.human.board.filter(Boolean).length - boardBefore);
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

describe('奇遇类型扩充（组件 / 顿悟）', () => {
  it('组件恩赐按档位入装备栏，全部来自组件池', () => {
    for (const [round, n] of [[4, 2], [10, 3], [16, 3]] as const) {
      const match = new Match(round);
      match.adventureOffer = { round, options: [{ kind: 'components', title: '', desc: '' }] };
      match.resolveAdventure(0);
      expect(match.human.items).toHaveLength(n);
      for (const id of match.human.items) expect(COMPONENT_IDS).toContain(id);
    }
  });

  it('顿悟按升级表恰好 +1 级；满级时折当档经验', () => {
    const match = new Match(11);
    match.human.level = 5;
    match.human.xp = 0;
    match.adventureOffer = { round: 10, options: [{ kind: 'level', title: '', desc: '' }] };
    match.resolveAdventure(0);
    expect(match.human.level).toBe(6);
    expect(match.human.xp).toBe(0);

    const maxed = new Match(12);
    maxed.human.level = MAX_LEVEL;
    const goldBefore = maxed.human.gold;
    maxed.adventureOffer = { round: 16, options: [{ kind: 'level', title: '', desc: '' }] };
    maxed.resolveAdventure(0);
    expect(maxed.human.level).toBe(MAX_LEVEL);
    expect(maxed.human.gold).toBe(goldBefore + adventureXp(16));
  });

  it('六类恩赐都在轮换池里：多种子扫描全部出现', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const match = new Match(seed);
      match.beginRound();
      enterRound(match, 4);
      if (match.adventureOffer) for (const opt of match.adventureOffer.options) seen.add(opt.kind);
    }
    expect([...seen].sort()).toEqual(['components', 'gold', 'item', 'level', 'reinforce', 'xp']);
  });

  it('AI 偏好序覆盖新类型：纯新类 offer 也能落到有效选项', () => {
    const prof = makeProfile('aggro');
    const offer: AdventureOffer = {
      round: 4,
      options: [
        { kind: 'components', title: '', desc: '' },
        { kind: 'level', title: '', desc: '' },
      ],
    };
    const index = chooseAdventureIndex(prof, offer);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(offer.options.length);
  });
});
