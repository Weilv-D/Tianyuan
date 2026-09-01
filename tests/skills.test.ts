import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { CHAMPIONS, formatSkillDesc } from '../src/data/champions';

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

describe('技能文案与参数同源', () => {
  it('全部技能描述经 formatSkillDesc 回填后不残留占位符', () => {
    for (const champion of CHAMPIONS) {
      const out = formatSkillDesc(champion.skillSpec.desc, champion.skillSpec.params);
      expect(out, `${champion.id}: ${out}`).not.toMatch(/\{/);
      expect(out, `${champion.id}: ${out}`).not.toMatch(/\}/);
    }
  });

  it('关键数值由参数回填而非字面量（审查修复回归）', () => {
    const byId = new Map(CHAMPIONS.map((c) => [c.id, c] as const));
    const fmt = (id: string) => formatSkillDesc(byId.get(id)!.skillSpec.desc, byId.get(id)!.skillSpec.params);
    // 断岳的处决阈值、太卜的处决治疗、照夜的再施放次数此前为字面量，
    // 调参即脱节；现在必须随 params 走
    expect(fmt('duanyue')).toContain('35%');
    expect(fmt('zhenfeng')).toContain('30%');
    expect(fmt('taibu')).toContain('10%');
    expect(fmt('wujiu')).toContain('+6% 攻击力');
    expect(fmt('zhaoye')).toContain('至多 2 次');
    expect(fmt('qingming')).toContain('至多 2 次');
  });
});
