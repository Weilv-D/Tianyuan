import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { CHAMPIONS } from '../src/data/champions';

/**
 * 技能行为冒烟：SKILL_IMPL 的每一类 kind 至少由一名真实棋子
 * 在完整战斗管线里施放过一次。此前 core/skills.ts 零直接覆盖 ——
 * 某类技能若在重构中静默失效（onCast 不再触发 / 目标解析抛错），
 * 只有靠长链路模拟才能间接发现。
 */
const byKind = new Map<string, string>();
for (const c of CHAMPIONS) if (!byKind.has(c.skillSpec.kind)) byKind.set(c.skillSpec.kind, c.id);

describe('技能行为冒烟（每类 kind 一局）', () => {
  it('全部技能 kind 都有代表棋子（数据完备性）', () => {
    expect(byKind.size).toBeGreaterThanOrEqual(11);
  });

  for (const [kind, defId] of byKind) {
    it(`${kind}（${defId}）：施放正常且战斗有限步内收敛`, () => {
      const units = [
        { uid: 1, defId, team: 0 as const, star: 2 as const, cell: { c: 2, r: 3 } },
        { uid: 8, defId: 'ajiu', team: 1 as const, star: 1 as const, cell: { c: 2, r: 7 } },
        { uid: 9, defId: 'duanyue', team: 1 as const, star: 1 as const, cell: { c: 3, r: 6 } },
      ];
      const battle = new Battle(
        { seed: 2026, units, traits: { 0: [], 1: [] }, maxTicks: 30 * 40 },
        null,
        true,
      );
      const result = battle.run();
      // 战斗收敛：有限步内分出胜负或超时裁定
      expect(result).toBeTruthy();
      expect(Number.isFinite(result.ticks)).toBe(true);
      expect(result.ticks).toBeLessThanOrEqual(30 * 40);
      // 施法确实发生（2★ 起始法力足以在 40 秒内出手）
      const casts = battle.events.filter((e) => e.t === 'castStart').length;
      expect(casts).toBeGreaterThan(0);
    });
  }
});
