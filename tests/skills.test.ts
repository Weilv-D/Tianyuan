import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { CHAMPIONS } from '../src/data/champions';

describe('技能系统', () => {
  it('每类真实技能都能在完整战斗中施放并收敛', () => {
    const representatives = new Map<string, string>();
    for (const champion of CHAMPIONS) {
      if (!representatives.has(champion.skillSpec.kind)) representatives.set(champion.skillSpec.kind, champion.id);
    }

    expect(representatives.size).toBeGreaterThanOrEqual(11);
    for (const [kind, defId] of representatives) {
      const battle = new Battle({
        seed: 2026,
        units: [
          { uid: 1, defId, team: 0, star: 2, cell: { c: 2, r: 3 } },
          { uid: 8, defId: 'ajiu', team: 1, star: 1, cell: { c: 2, r: 7 } },
          { uid: 9, defId: 'duanyue', team: 1, star: 1, cell: { c: 3, r: 6 } },
        ],
        traits: { 0: [], 1: [] },
        maxTicks: 30 * 40,
      }, null, true);

      const result = battle.run();
      expect(result.ticks, kind).toBeLessThanOrEqual(30 * 40);
      expect(battle.events.some((event) => event.t === 'castStart'), kind).toBe(true);
    }
  });
});
