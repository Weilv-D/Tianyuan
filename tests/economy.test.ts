import { describe, expect, it } from 'vitest';
import { MAX_LEVEL } from '../src/core/config';
import { computeIncome, gainXp, xpToNext } from '../src/game/economy';
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
});
