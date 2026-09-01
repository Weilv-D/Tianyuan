import { describe, expect, it } from 'vitest';
import { createUnit as createBattleUnit } from '../src/core/unit';
import type { Star } from '../src/core/types';
import { unequipAll } from '../src/game/inventory';
import { canPlace } from '../src/game/state';
import { makePlayer, mkBattle, unitInput } from './helpers';

describe('1.7 核心玩法', () => {
  it('五费三星获得天命强化并在实战中免疫控制', () => {
    const cell = { c: 0, r: 0 };
    const legend = createBattleUnit({ uid: 1, defId: 'haotian', team: 0, cell, star: 3 });
    const normal = createBattleUnit({ uid: 2, defId: 'zhenyue', team: 0, cell, star: 3 });
    expect(legend.shield).toBeGreaterThan(0);
    expect(legend.omnivamp).toBeGreaterThan(0);
    expect(normal.shield).toBe(0);

    const battle = mkBattle([
      unitInput('haotian', 0, cell, { star: 3 }),
      unitInput('ajiu', 1, { c: 7, r: 7 }),
    ]);
    const target = battle.units.find((unit) => unit.entry.id === 'haotian')!;
    battle.addStatus(battle.units[1], target, 'stun', 2, 0);
    expect(target.statuses.some((status) => status.kind === 'stun')).toBe(false);
  });

  it('同名棋子可以同时上场，但人口上限仍然生效', () => {
    const player = makePlayer({ level: 2 });
    player.board[0] = { iid: 1, defId: 'ajiu', star: 1 as Star, items: [] };
    player.bench[0] = { iid: 2, defId: 'ajiu', star: 1 as Star, items: [] };
    expect(canPlace(player, 2, 'board', 20).ok).toBe(true);

    player.level = 1;
    expect(canPlace(player, 2, 'board', 20).ok).toBe(false);
  });

  it('卸载会返还组件，器匣空间不足时整体回滚', () => {
    const player = makePlayer();
    const unit = { iid: 1, defId: 'ajiu', star: 1 as Star, items: ['duanhun', 'xuanjia'] };
    player.bench[0] = unit;
    expect(unequipAll(player, 1).ok).toBe(true);
    expect(unit.items).toEqual([]);
    expect(player.items).toHaveLength(3);

    const blocked = makePlayer({ items: Array.from({ length: 9 }, () => 'xuanjia') });
    const blockedUnit = { iid: 2, defId: 'ajiu', star: 1 as Star, items: ['duanhun', 'xuanjia'] };
    blocked.bench[0] = blockedUnit;
    expect(unequipAll(blocked, 2).ok).toBe(false);
    expect(blockedUnit.items).toEqual(['duanhun', 'xuanjia']);
    expect(blocked.items).toHaveLength(9);
  });
});

describe('1.7 边界口径', () => {
  it('3★ 五费墨兽不获得天命（数值层与渲染层的体量口径同源排除）', () => {
    // 若排除失效：墨兽轮 16 回合起 12%~30% 出 3★ 五费，PvE 会静默拿到
    // hp×1.6 + 免控 + 25% 盾，难度尖峰绕过平衡前提 —— 玩家可见的难度突变。
    const cell = { c: 0, r: 0 };
    const beast = createBattleUnit({ uid: 1, defId: 'haotian', team: 1, cell, star: 3, monster: true });
    expect(beast.shield).toBe(0);
    expect(beast.omnivamp).toBe(0);
    expect(beast.ccImmune).toBe(0);
    const hp = beast.maxHp;
    const plain = createBattleUnit({ uid: 2, defId: 'haotian', team: 1, cell, star: 3 });
    // 无天命倍率（3823）显著低于玩家侧天命（6117）——排除真实生效
    expect(hp).toBeLessThan(plain.maxHp);
  });
});
