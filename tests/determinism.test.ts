import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { PRESET_COMPS, buildTeam } from '../src/game/comp';

function play(seed: number) {
  const a = buildTeam(PRESET_COMPS[0], 0, 1);
  const b = buildTeam(PRESET_COMPS[1], 1, 200);
  const battle = new Battle(
    { seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } },
    null,
    true,
  );
  const result = battle.run();
  return { result, events: JSON.stringify(battle.events) };
}

describe('核心战斗', () => {
  it('真实阵容可收敛、同一局可重演、不同种子会改变过程', () => {
    const first = play(424242);
    const replay = play(424242);
    const other = play(424243);

    expect(first.result.timeout || first.result.winner !== undefined).toBe(true);
    expect(replay).toEqual(first);
    expect(other.events).not.toBe(first.events);
  });
});
