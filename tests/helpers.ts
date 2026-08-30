/**
 * 回归测试共用构造器。
 *
 * 这些 helper 只做"搭台"——构造最小可用的玩家 / 战斗，
 * 断言本身必须落在被测模块的公开契约上，避免测试与实现细节共谋。
 */
import { Battle } from '../src/core/battle';
import type { BattleUnitInput, Cell } from '../src/core/types';
import { emptyBench, emptyBoard, type PlayerState } from '../src/game/state';

export function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    idx: 0,
    name: '测试玩家',
    isHuman: true,
    hp: 100,
    gold: 0,
    level: 5,
    xp: 0,
    streak: 0,
    bestStreak: 0,
    board: emptyBoard(),
    bench: emptyBench(),
    items: [],
    shop: [null, null, null, null, null],
    shopLocked: false,
    alive: true,
    rank: 0,
    opponents: [],
    wins: 0,
    losses: 0,
    ai: null,
    lastOutcome: null,
    lastDamage: 0,
    totalDamage: 0,
    ...overrides,
  };
}

let uidSeq = 1;

/** 构造一个入场单位描述（默认 1 星、无装备） */
export function unitInput(
  defId: string,
  team: 0 | 1,
  cell: Cell,
  extra: Partial<BattleUnitInput> = {},
): BattleUnitInput {
  return { uid: uidSeq++, defId, team, star: 1, cell, ...extra };
}

/**
 * 构造一场无羁绊的微型战斗。
 * 默认摆在对角（切比雪夫距离 7），保证不 run() 时单位互不干扰。
 */
export function mkBattle(units: BattleUnitInput[], seed = 12345, maxTicks?: number): Battle {
  return new Battle(
    { seed, units, traits: { 0: [], 1: [] }, maxTicks },
    null,
    true,
  );
}

/** 一对互不相邻的 1 费单位（磐 · 近战 / 惊羽 · 远程） */
export function cornerPair(extraB: Partial<BattleUnitInput> = {}): BattleUnitInput[] {
  return [
    unitInput('pan', 0, { c: 0, r: 6 }),
    unitInput('jingyu', 1, { c: 7, r: 1 }, extraB),
  ];
}
