import { describe, expect, it } from 'vitest';
import { CHAMPIONS, formatSkillDesc, type SkillParams } from '../src/data/champions';

/**
 * 技能描述模板回归：文案占位符与 params 的键必须一一对应。
 *
 * 起因（2026-08-30）：鼓震等 9 名棋子的 desc 引用了不存在的顶层参数
 * （{value}/{dur} 的真值藏在 status 里），渲染成「提升 0%」「眩晕 0 秒」
 * 而战斗实现读 status 一切正常 —— 纯显示层脱节，且逐个肉眼难发现。
 * formatSkillDesc 已改为惰性按键渲染（文案里出现才取值），因此可以用
 * Proxy 包住 params：被读取却不存在的键会被逐个记录，结构性锁死本类缺陷。
 */

/**
 * 用 Proxy 记录「模板渲染时试图读取但不存在的参数路径」。
 * desc 键表中唯一的合法回退是 {dur} ← p.dur ?? p.status?.dur（控制类时长
 * 只存 status.dur），因此顶层 dur 缺失但 status.dur 读取成功时不判缺失。
 */
function missingTokens(tpl: string, p: SkillParams): string[] {
  const missing: string[] = [];
  const read: string[] = [];
  const wrap = (obj: Record<string, unknown>, path: string): Record<string, unknown> =>
    new Proxy(obj, {
      get(target, key) {
        const k = String(key);
        if (!(k in target)) {
          missing.push(path + k);
          return undefined;
        }
        const v = target[k];
        if (v !== null && typeof v === 'object') return wrap(v as Record<string, unknown>, `${path}${k}.`);
        read.push(path + k);
        return v;
      },
    });
  formatSkillDesc(tpl, wrap(p as unknown as Record<string, unknown>, ''));
  return missing.filter((m) => !(m === 'dur' && read.includes('status.dur')));
}

describe('技能描述模板与参数永不脱节', () => {
  it('每名棋子的每个占位符都能在 params 中取到值', () => {
    for (const c of CHAMPIONS) {
      const missing = missingTokens(c.skillSpec.desc, c.skillSpec.params);
      expect(missing, `${c.id} ${c.name} 占位符缺参数: ${missing.join(', ')} | ${c.skillSpec.desc}`).toEqual([]);
    }
  });

  it('渲染结果不含未替换的占位符', () => {
    for (const c of CHAMPIONS) {
      const out = formatSkillDesc(c.skillSpec.desc, c.skillSpec.params);
      expect(out, `${c.id} ${c.name} 残留占位符: ${out}`).not.toMatch(/[{}]/);
    }
  });

  it('鼓震：攻速增益走 status.value 单一真源（修复前渲染「提升 0%」）', () => {
    const gz = CHAMPIONS.find((c) => c.id === 'guzhen')!;
    expect(formatSkillDesc(gz.skillSpec.desc, gz.skillSpec.params)).toBe('擂鼓进军：攻速 +45%，持续 7 秒。');
  });

  it('巫火：灼烧时长与每秒伤害走 status 单一真源（修复前渲染「每秒 0% 伤害」）', () => {
    const wh = CHAMPIONS.find((c) => c.id === 'wuhuo')!;
    const out = formatSkillDesc(wh.skillSpec.desc, wh.skillSpec.params);
    expect(out).toContain('附加 3 秒灼烧');
    expect(out).toContain('每秒 40 伤害');
  });

  it('控制类时长回落 status.dur（修复前渲染「眩晕 0 秒」）', () => {
    const cases: Array<[string, string]> = [
      ['yeyou', '沉默目标 1.8 秒'],
      ['kutong', '持续 4 秒'],
      ['lingxiao', '眩晕 1 秒'],
      ['yuansu', '眩晕 1.2 秒'],
      ['xinhuan', '眩晕 1.5 秒'],
      ['xuanji', '眩晕 1.2 秒'],
      ['zhechong', '眩晕 1 秒'],
    ];
    for (const [id, expectText] of cases) {
      const c = CHAMPIONS.find((x) => x.id === id)!;
      expect(formatSkillDesc(c.skillSpec.desc, c.skillSpec.params), id).toContain(expectText);
    }
  });
});
