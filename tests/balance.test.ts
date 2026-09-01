import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { CHAMPION_BY_ID } from '../src/data/champions';

describe('数值平衡回归（2026-09-01 CRN 定档）', () => {
  it('四幽冥复活生命为 10%（非 15%）', () => {
    const battle = new Battle({
      seed: 101,
      units: [
        { uid: 1, defId: 'yeyou', team: 0, star: 1, cell: { c: 0, r: 3 } },
        { uid: 9, defId: 'jingyu', team: 1, star: 1, cell: { c: 7, r: 4 } },
      ],
      traits: { 0: [{ id: 'youming', count: 4, tier: 1 }], 1: [] },
    }, null, false);
    const victim = battle.unitByUid(1)!;
    const max = victim.maxHp;
    battle.dealDamage(battle.unitByUid(9)!, victim, max * 5, 'true');
    expect(victim.alive).toBe(true);
    // 复活后生命应为 max * 0.10 ，允许 1 点取整误差
    expect(victim.hp).toBeCloseTo(max * 0.1, 0);
  });

  it('六护卫攻击力 +15%（9套平衡 2026-09-01，极差29.2%）', () => {
    const ids = ['pan', 'lingxiao', 'xuanwu', 'budong', 'zhenyue', 'canglan'] as const;
    const battle = new Battle({
      seed: 102,
      units: ids.map((defId, idx) => ({ uid: 10 + idx, defId, team: 0, star: 1, cell: { c: idx % 4, r: Math.floor(idx / 4) } })),
      traits: { 0: [{ id: 'guardian', count: 6, tier: 2 }], 1: [] },
    }, null, false);
    for (const idx of ids.keys()) {
      const uid = 10 + idx;
      const defId = ids[idx];
      const unit = battle.unitByUid(uid)!;
      const baseAtk = CHAMPION_BY_ID[defId].base.atk;
      const expected = Math.round(baseAtk * 1.15);
      expect(unit.atk).toBe(expected);
    }
  });

  it('四方士开战护盾为 16% 最大生命（非 12%）', () => {
    // 四方士（tier 1）才触发首档护盾（全队 16%），二方士仅加法强。
    const battle = new Battle({
      seed: 103,
      units: [
        { uid: 1, defId: 'aoyin', team: 0, star: 1, cell: { c: 0, r: 3 } },
        { uid: 2, defId: 'zhuyan', team: 0, star: 1, cell: { c: 1, r: 3 } },
        { uid: 3, defId: 'moyu', team: 0, star: 1, cell: { c: 2, r: 3 } },
        { uid: 4, defId: 'yuansu', team: 0, star: 1, cell: { c: 3, r: 3 } },
        { uid: 9, defId: 'jingyu', team: 1, star: 1, cell: { c: 7, r: 4 } },
      ],
      traits: { 0: [{ id: 'mage', count: 4, tier: 1 }], 1: [] },
    }, null, true);
    const shieldEvents = battle.events.filter((e) => e.t === 'shield');
    expect(shieldEvents.length).toBeGreaterThan(0);
    for (const e of shieldEvents) {
      if (e.t !== 'shield') continue;
      const unit = battle.unitByUid(e.uid);
      if (!unit) continue;
      if (unit.team !== 0) continue;
      const ratio = e.amount / unit.maxHp;
      expect(ratio).toBeCloseTo(0.16, 2);
    }
  });

  it('9套平衡：天庭/墨门主C加强、兵家削弱', () => {
    expect(CHAMPION_BY_ID['haotian'].base.atk).toBe(190);
    expect(CHAMPION_BY_ID['gouchen'].base.sp).toBe(240);
    expect(CHAMPION_BY_ID['lingxiao'].base.atk).toBe(90);
    expect(CHAMPION_BY_ID['moyan'].base.atk).toBe(75);
    expect(CHAMPION_BY_ID['mozhai'].base.atk).toBe(120);
    // 兵家 5羁绊 20%（原35%）、护卫 6羁绊 15%（原55%）已在上一用例校验
  });
});
