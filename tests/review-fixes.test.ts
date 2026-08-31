import { describe, expect, it } from 'vitest';
import { autoPlace } from '../src/game/comp';
import { createUnit } from '../src/core/unit';
import { CardPool } from '../src/game/pool';
import { CHAMPIONS } from '../src/data/champions';

/** 2026-08-31 复核修复的回归锁：满纵深站位、星级入口、卡池守恒守卫 */

describe('autoPlace 满纵深不死循环', () => {
  it('9 名同纵深（法师）队伍全部落位且无重叠格', () => {
    // 旧实现：第 4 行满后在满行原地踏步 + 列搜索死循环，页面冻结
    const mages = CHAMPIONS.filter((c) => c.cls === 'mage').map((c) => c.id);
    const nine = Array.from({ length: 9 }, (_, i) => mages[i % mages.length]);
    const out = autoPlace(nine, 0);
    expect(out.size).toBe(9);
    const cells = new Set([...out.values()].map((c) => `${c.c},${c.r}`));
    expect(cells.size).toBe(9);
  });

  it('超容量（33 人）抛错而非冻结', () => {
    const ids = CHAMPIONS.map((c) => c.id);
    const many = Array.from({ length: 33 }, (_, i) => ids[i % ids.length]);
    expect(() => autoPlace(many, 1)).toThrow();
  });
});

describe('createUnit 星级入口校验', () => {
  const base = { uid: 1, defId: 'ajiu', team: 0 as const, cell: { c: 0, r: 0 } };
  it('星级 0/4/NaN 直接抛错，不产出 NaN 属性单位', () => {
    expect(() => createUnit({ ...base, star: 0 as never })).toThrow();
    expect(() => createUnit({ ...base, star: 4 as never })).toThrow();
    expect(() => createUnit({ ...base, star: Number.NaN as never })).toThrow();
  });
  it('合法星级 1~3 正常构建且属性有限', () => {
    for (const star of [1, 2, 3] as const) {
      const u = createUnit({ ...base, star });
      expect(Number.isFinite(u.maxHp)).toBe(true);
      expect(Number.isFinite(u.atk)).toBe(true);
    }
  });
});

describe('CardPool.restore 跨版本守卫', () => {
  it('含未知棋子 id 的存档：整池重置，不凭空造卡', () => {
    const pool = new CardPool();
    const full = pool.snapshot();
    pool.take('ajiu');
    pool.restore({ ajiu: 5, __ghost__: 3 });
    expect(pool.snapshot()).toEqual(full);
  });

  it('负数/非整数计数视为脏档，同样整池重置', () => {
    const pool = new CardPool();
    const full = pool.snapshot();
    pool.restore({ ajiu: -1 });
    expect(pool.snapshot()).toEqual(full);
    pool.restore({ ajiu: 1.5 });
    expect(pool.snapshot()).toEqual(full);
  });

  it('干净存档原样恢复', () => {
    const pool = new CardPool();
    pool.take('ajiu');
    pool.take('ajiu');
    pool.restore({ ajiu: 1 });
    expect(pool.remaining('ajiu')).toBe(1);
  });
});
