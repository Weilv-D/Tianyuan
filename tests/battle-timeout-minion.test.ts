/**
 * 超时裁定的召唤物口径回归（B5）。
 *
 * 裁定比例与 finish 记录一致：剔除 isMinion——
 * 召唤物存活 vs 冠军存活 → 冠军胜；双方仅召唤物 → 平局。
 * 旧口径把召唤物血量计入比例：召唤流拖到超时可凭傀儡血量"赢"下冠军全灭的对手。
 */
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import type { BattleUnitInput } from '../src/core/types';

const unit = (uid: number, team: 0 | 1, c: number, r: number, defId = 'pan'): BattleUnitInput => ({
  uid,
  defId,
  team,
  star: 1,
  cell: { c, r },
});

/** 冠军全灭但召唤物尚存：直接改 alive 并留一只召唤物在场 */
function killChampion(b: Battle, team: 0 | 1): void {
  const champ = b.units.find((u) => u.team === team && !u.isMinion);
  if (!champ) return;
  champ.hp = 0;
  champ.alive = false;
}

describe('超时裁定（B5）', () => {
  it('对方冠军全灭仅召唤物存活 → 冠军存活方胜', () => {
    // 双方冠军分居对角，1 tick 内不可能互相够到 → 必然走超时分支
    const b = new Battle(
      { seed: 7, units: [unit(1, 0, 0, 4), unit(101, 1, 7, 3, 'ajiu')], traits: {}, maxTicks: 1 },
      null,
      false,
    );
    const t1champ = b.units.find((u) => u.team === 1 && !u.isMinion)!;
    // 给全灭方补一只召唤物：该队仍有"活口"，超时分支才会被触发
    b.summon(t1champ, { c: 6, r: 3 }, 1, 1, '傀儡');
    killChampion(b, 1);
    b.step();
    expect(b.finished).toBe(true);
    expect(b.result?.timeout).toBe(true);
    expect(b.result?.winner).toBe(0);
  });

  it('双方冠军全灭、各剩召唤物 → 平局', () => {
    const b = new Battle(
      { seed: 7, units: [unit(1, 0, 0, 4), unit(101, 1, 7, 3, 'ajiu')], traits: {}, maxTicks: 1 },
      null,
      false,
    );
    const c0 = b.units.find((u) => u.team === 0 && !u.isMinion)!;
    const c1 = b.units.find((u) => u.team === 1 && !u.isMinion)!;
    b.summon(c0, { c: 1, r: 4 }, 1, 1, '傀儡');
    b.summon(c1, { c: 6, r: 3 }, 1, 1, '傀儡');
    killChampion(b, 0);
    killChampion(b, 1);
    b.step();
    expect(b.finished).toBe(true);
    expect(b.result?.timeout).toBe(true);
    expect(b.result?.winner).toBeNull();
  });

  it('双方冠军存活 → 仍按剩余生命比例裁定（无召唤物时零变化）', () => {
    const b = new Battle(
      { seed: 7, units: [unit(1, 0, 0, 4), unit(101, 1, 7, 3, 'ajiu')], traits: {}, maxTicks: 1 },
      null,
      false,
    );
    b.units.find((u) => u.team === 0)!.hp = 10; // 残血但活着
    b.step();
    expect(b.finished).toBe(true);
    expect(b.result?.timeout).toBe(true);
    // 双方满编血量比例：残血方明显落后 → 对手胜（比例差 > 0.02）
    expect(b.result?.winner).toBe(1);
  });
});
