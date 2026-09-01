import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, SHOP_ODDS } from '../src/core/config';
import { Rng } from '../src/core/rng';
import { CardPool, rollShop } from '../src/game/pool';

/**
 * 概率表的结构不变量。
 *
 * rollShop 按行合计归一抽取 —— 某行合计偏离 100 不会崩，只会静默改变全体
 * 出货速度；档位入场等级与单调性被破坏也不会崩，只会改变各费用的追星成本。
 * 这类"表格手改错误"在运行时无任何症状，只能在结构层锁住。
 */
describe('商店概率表结构', () => {
  it('每级一行（行数 = MAX_LEVEL）、每行 5 列、取值非负且合计 100', () => {
    expect(SHOP_ODDS).toHaveLength(MAX_LEVEL);
    for (const row of SHOP_ODDS) {
      expect(row).toHaveLength(5);
      for (const p of row) expect(p).toBeGreaterThanOrEqual(0);
      expect(row.reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it('档位入场等级：1~2 级纯 1 费，4 费 5 级入场，5 费 7 级入场', () => {
    for (const lv of [1, 2]) {
      expect(SHOP_ODDS[lv - 1].slice(1).every((p) => p === 0)).toBe(true);
    }
    for (let lv = 1; lv <= 4; lv++) expect(SHOP_ODDS[lv - 1][3]).toBe(0);
    expect(SHOP_ODDS[4][3]).toBeGreaterThan(0);
    for (let lv = 1; lv <= 6; lv++) expect(SHOP_ODDS[lv - 1][4]).toBe(0);
    expect(SHOP_ODDS[6][4]).toBeGreaterThan(0);
  });

  it('终局档单调：4/5 费概率随等级不减，1 费随等级不增', () => {
    for (const tier of [3, 4]) {
      for (let lv = 2; lv < MAX_LEVEL; lv++) {
        expect(SHOP_ODDS[lv][tier]).toBeGreaterThanOrEqual(SHOP_ODDS[lv - 1][tier]);
      }
    }
    for (let lv = 1; lv < MAX_LEVEL; lv++) {
      expect(SHOP_ODDS[lv][0]).toBeLessThanOrEqual(SHOP_ODDS[lv - 1][0]);
    }
  });
});

describe('rollShop 行为契约', () => {
  it('满池任意等级刷店五格全为有效棋子 id，不出现空格', () => {
    const pool = new CardPool();
    const rng = new Rng(20260901);
    for (let i = 0; i < 100; i++) {
      const level = (i % MAX_LEVEL) + 1;
      for (const id of rollShop(pool, rng, level)) {
        expect(id).not.toBeNull();
      }
    }
  });
});
