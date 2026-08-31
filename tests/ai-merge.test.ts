/**
 * AI 合并估值回归（B1）。
 *
 * 旧口径 two>=2 即给 60 分（"买进来立刻 3★"）—— 但持有两张 2★、
 * 零张 1★ 时，买一张 1★ 只到 7/9 张，离 3★ 还差两张。
 * 过度溢价会让搜牌型 AI 在决赛圈为"伪高光"掏空金币。
 */
import { describe, expect, it } from 'vitest';
import { mergeValue, scoreCard, makeProfile } from '../src/game/ai';
import { emptyBench, emptyBoard, type PlayerState } from '../src/game/state';
import { createUnit } from '../src/game/state';
import { makePlayer } from './helpers';

function playerWith(units: { defId: string; star: 1 | 2 }[]): PlayerState {
  const p = makePlayer({ board: emptyBoard(), bench: emptyBench() });
  units.forEach((u, i) => {
    p.board[i] = createUnit(u.defId, u.star);
  });
  return p;
}

describe('mergeValue（B1：3★ 溢价只在真能立刻凑出时给）', () => {
  it('two=2, one=0 → 不给 60（差两张 1★，不是高光）', () => {
    const p = playerWith([
      { defId: 'pan', star: 2 },
      { defId: 'pan', star: 2 },
    ]);
    expect(mergeValue(p, 'pan')).toBe(18);
  });

  it('two=2, one=2 → 60（买一张立刻凑出第三张 2★ → 3★）', () => {
    const p = playerWith([
      { defId: 'pan', star: 2 },
      { defId: 'pan', star: 2 },
      { defId: 'pan', star: 1 },
      { defId: 'pan', star: 1 },
    ]);
    expect(mergeValue(p, 'pan')).toBe(60);
  });

  it('two=1, one=2 → 18（判序自上而下：通往第二个 2★ 的进度优先，与旧口径一致）', () => {
    const p = playerWith([
      { defId: 'pan', star: 2 },
      { defId: 'pan', star: 1 },
      { defId: 'pan', star: 1 },
    ]);
    expect(mergeValue(p, 'pan')).toBe(18);
  });

  it('two=0, one=2 → 26（买一张立刻 2★）', () => {
    const p = playerWith([
      { defId: 'pan', star: 1 },
      { defId: 'pan', star: 1 },
    ]);
    expect(mergeValue(p, 'pan')).toBe(26);
  });
});

describe('scoreCard 口径传导', () => {
  it('two=2,one=0 的买分显著低于 two=2,one=2（差值 = 42×mergeBias）', () => {
    const prof = makeProfile('hyperroll'); // mergeBias 2.6：放大两口价的差
    const near = playerWith([
      { defId: 'pan', star: 2 },
      { defId: 'pan', star: 2 },
      { defId: 'pan', star: 1 },
      { defId: 'pan', star: 1 },
    ]);
    const far = playerWith([
      { defId: 'pan', star: 2 },
      { defId: 'pan', star: 2 },
    ]);
    const sNear = scoreCard(near, 'pan', 5, prof);
    const sFar = scoreCard(far, 'pan', 5, prof);
    // owned 惩罚项也随持有数变化，故只断言核心差值存在且量级正确
    expect(sNear - sFar).toBeGreaterThan(42 * 2.6 - 30);
    expect(sNear - sFar).toBeLessThan(42 * 2.6 + 35);
  });
});
