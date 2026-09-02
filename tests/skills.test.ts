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
    // 1.16.3 审查回归：status 类数值/时长、盾时长、易伤全走模板键
    //（此前"5 秒 20% 攻速""持续 8 秒""40% 重伤"等是 desc 里的字面量，改参即漂移）
    expect(fmt('qinghe')).toContain('5 秒 20% 攻速'); // {statusDur} 秒 {statusValue}
    expect(fmt('canghao')).toContain('50%');
    expect(fmt('canghao')).toContain('45%');
    expect(fmt('xuanwu')).toContain('8 秒');
    expect(fmt('guicheng')).toContain('6 秒');
    expect(fmt('mozhai')).toContain('8 秒');
    expect(fmt('kutong')).toContain('50%');
    expect(fmt('taozhu')).toContain('40%');
    expect(fmt('gouchen')).toContain('30%');
    expect(fmt('yinglong')).toContain('35%');
    expect(fmt('muji')).toContain('至多 8 层');
    expect(fmt('qingqiu')).toContain('40% 攻速');
    expect(fmt('qingqiu')).toContain('20%');
  });

  it('木机连弩的攻速叠层封顶：生效层数不越过 params.maxStacks（文案承诺兑现）', () => {
    // 文案"至多 8 层"此前无实现（aspdUp 在 STACKABLE_KINDS 内按条无限叠加），
    // 长战斗可把攻速叠到 8×6%=48% 之上。maxStacks 封顶后，同时生效层数 ≤8。
    const battle = mkBattleForSkill('muji');
    const u = battle.units.find((x) => x.entry.id === 'muji')!;
    const cap = battle.units.find((x) => x.entry.id === 'muji')!.entry.skillSpec.params.maxStacks!;
    const layers = u.statuses.filter((s) => s.kind === 'aspdUp').length;
    expect(cap).toBe(8);
    expect(layers).toBeLessThanOrEqual(cap);
  });
});

/** 单棋子技能施放的最小战斗（skills.test 内用）：跑完后返回 Battle，供读单位状态 */
function mkBattleForSkill(defId: string, star: 1 | 2 | 3 = 2, ticks = 30 * 30): Battle {
  const battle = new Battle(
    {
      seed: 20260903,
      units: [
        { uid: 101, defId, team: 0, star, cell: { c: 2, r: 3 } },
        { uid: 201, defId: 'pan', team: 1, star: 1, cell: { c: 3, r: 7 } },
        { uid: 202, defId: 'muyuan', team: 1, star: 1, cell: { c: 4, r: 7 } },
      ],
      traits: { 0: [], 1: [] },
      maxTicks: ticks,
    },
    null,
    true,
  );
  battle.run();
  return battle;
}
