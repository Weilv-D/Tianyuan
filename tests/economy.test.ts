import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, XP_TO_NEXT } from '../src/core/config';
import { computeIncome, gainXp, interestOf, xpToNext } from '../src/game/economy';
import { makePlayer } from './helpers';

describe('对局经济', () => {
  it('收入包含基础、利息、胜负与连胜，轮空只取消连胜奖励', () => {
    const player = makePlayer({ gold: 23, streak: 5 });
    const normal = computeIncome(player, true, false);
    const bye = computeIncome(player, true, true);

    expect(normal.interest).toBe(2);
    expect(normal.streak).toBeGreaterThan(0);
    expect(normal.total).toBe(normal.base + normal.interest + normal.streak + normal.win);
    expect(bye.interest).toBe(normal.interest);
    expect(bye.win).toBe(normal.win);
    expect(bye.streak).toBe(0);
  });

  it('经验能跨级结算并在满级停止累积', () => {
    const player = makePlayer({ level: 3, xp: 0 });
    gainXp(player, xpToNext(3));
    expect(player.level).toBe(4);
    expect(player.xp).toBe(0);

    gainXp(player, 999);
    expect(player.level).toBe(MAX_LEVEL);
    expect(player.xp).toBe(0);
  });

  it('损坏状态中的负金币不会产生负利息', () => {
    expect(interestOf(-1)).toBe(0);
    expect(computeIncome(makePlayer({ gold: -20 }), false).interest).toBe(0);
  });

  it('非有限经验值立即失败，不得把玩家顶到满级', () => {
    // NaN 参与 `< need` 恒为 false：不守边界时循环会一路升级到 MAX_LEVEL
    // 并把经验清零（静默、无痕），比"读档坏形状"更直接
    const player = makePlayer({ level: 3, xp: 0 });
    expect(() => gainXp(player, Number.NaN)).toThrow(/经验/);
    expect(() => gainXp(player, Number.POSITIVE_INFINITY)).toThrow(/经验/);
    expect(player.level).toBe(3);
  });

  it('升级表只覆盖有效档位：长度 = MAX_LEVEL − 1，末档即 8→9', () => {
    expect(XP_TO_NEXT).toHaveLength(MAX_LEVEL - 1);
    expect(xpToNext(MAX_LEVEL - 1)).toBe(XP_TO_NEXT[XP_TO_NEXT.length - 1]);
    expect(xpToNext(MAX_LEVEL)).toBe(0);
    for (const need of XP_TO_NEXT) expect(need).toBeGreaterThan(0);
  });
});
