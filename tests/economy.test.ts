/**
 * 经济系统回归。
 *
 * 覆盖：利息分档与封顶、连胜/连败表、轮空回合不结算连胜金（ Bye 不是胜利，
 * 也不能被当成"领钱回合"）、经验升级（单级 / 连升 / 满级）。
 */
import { describe, expect, it } from 'vitest';
import { computeIncome, gainXp, interestOf, streakGold, xpToNext } from '../src/game/economy';
import { MAX_LEVEL } from '../src/core/config';
import { makePlayer } from './helpers';

describe('利息', () => {
  it('每 10 金 1 利息，上限 5', () => {
    expect(interestOf(0)).toBe(0);
    expect(interestOf(9)).toBe(0);
    expect(interestOf(10)).toBe(1);
    expect(interestOf(19)).toBe(1);
    expect(interestOf(50)).toBe(5);
    expect(interestOf(999)).toBe(5); // 封顶
  });

  it('利息按结算前余额计算（先发利息再动余额）', () => {
    const p = makePlayer({ gold: 23, streak: 0 });
    const inc = computeIncome(p, false);
    expect(inc.interest).toBe(2);
    expect(inc.total).toBe(5 + 2); // 无连胜、未取胜
  });
});

describe('连胜 / 连败', () => {
  it('连胜第 2 档开始给钱，封顶 4', () => {
    expect(streakGold(1)).toBe(0);
    expect(streakGold(2)).toBe(1);
    expect(streakGold(4)).toBe(2);
    expect(streakGold(6)).toBe(4);
    expect(streakGold(12)).toBe(4); // 超出表长取末档
  });

  it('连败比连胜晚一档起钱，但同样封顶', () => {
    expect(streakGold(-2)).toBe(0);
    expect(streakGold(-3)).toBe(1);
    expect(streakGold(-5)).toBe(3);
    expect(streakGold(-9)).toBe(4);
  });
});

describe('轮空回合（bye）', () => {
  it('skipStreak 只清连胜金，不清利息与胜利金', () => {
    const p = makePlayer({ gold: 20, streak: 5 }); // 利息 2、连胜金 3
    const normal = computeIncome(p, true, false);
    expect(normal.total).toBe(5 + 2 + 3 + 1);

    const bye = computeIncome(p, true, true);
    expect(bye.streak).toBe(0);
    expect(bye.interest).toBe(2);
    expect(bye.total).toBe(5 + 2 + 0 + 1);
  });
});

describe('经验与升级', () => {
  it('恰好够经验则升一级', () => {
    const p = makePlayer({ level: 3, xp: 0 });
    const need = xpToNext(3);
    const lv = gainXp(p, need);
    expect(lv).toBe(4);
    expect(p.xp).toBe(0);
  });

  it('一次大额经验可连升多级', () => {
    const p = makePlayer({ level: 2, xp: 0 });
    const lv = gainXp(p, 999);
    expect(lv).toBe(MAX_LEVEL);
    expect(p.xp).toBe(0); // 满级清空经验
    expect(xpToNext(MAX_LEVEL)).toBe(0);
  });

  it('经验不足时不升级、结余保留', () => {
    const p = makePlayer({ level: 3, xp: 0 });
    gainXp(p, 1);
    expect(p.level).toBe(3);
    expect(p.xp).toBe(1);
  });
});
