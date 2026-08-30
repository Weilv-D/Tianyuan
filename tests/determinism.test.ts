/**
 * 确定性回归：同一 seed 必须产生逐字节一致的事件流。
 *
 * 这是"战斗回放 / 断线重演 / 平衡模拟"的地基 —— 内核里只允许存在
 * 一个随机源（Battle.rng），任何偷偷混进来的 Math.random 都会在这里现形。
 */
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { PRESET_COMPS, buildTeam } from '../src/game/comp';

function runOnce(seed: number): string {
  const a = buildTeam(PRESET_COMPS[0], 0, 1);
  const b = buildTeam(PRESET_COMPS[1], 1, 200);
  const battle = new Battle(
    { seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } },
    null,
    true,
  );
  battle.run();
  return JSON.stringify(battle.events);
}

describe('战斗确定性', () => {
  it('同一种子跑两遍，事件流逐字节一致', () => {
    expect(runOnce(424242)).toBe(runOnce(424242));
  });

  it('不同种子必须产生分歧（随机源真的在工作）', () => {
    expect(runOnce(424242)).not.toBe(runOnce(424243));
  });
});
