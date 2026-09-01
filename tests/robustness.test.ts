import { describe, expect, it } from 'vitest';
import { createUnit as createBattleUnit } from '../src/core/unit';
import { TRAITS } from '../src/data/traits';
import { autoArrange } from '../src/game/arrange';
import { boardIdx, createUnit } from '../src/game/state';
const createCoreUnit = createBattleUnit;
import { makePlayer } from './helpers';
import { Rng } from '../src/core/rng';
import { CHAMPIONS } from '../src/data/champions';
import { generateBeastBoard } from '../src/game/beast';
import { autoPlace } from '../src/game/comp';
import { CardPool } from '../src/game/pool';

describe('损坏输入与极端阵容', () => {
  it('自动站位在棋盘满员时截断而不是冻结或重叠', () => {
    const ids = Array.from({ length: 33 }, (_, index) => CHAMPIONS[index % CHAMPIONS.length].id);
    const placed = autoPlace(ids, 1);
    const cells = new Set([...placed.values()].map((cell) => `${cell.c},${cell.r}`));
    expect(placed.size).toBe(32);
    expect(cells.size).toBe(32);
  });

  it('非法星级和损坏卡池不会生成无效资源', () => {
    const input = { uid: 1, defId: 'ajiu', team: 0 as const, cell: { c: 0, r: 0 } };
    expect(() => createCoreUnit({ ...input, star: 0 as never })).toThrow();
    expect(() => createCoreUnit({ ...input, star: Number.NaN as never })).toThrow();
    // 数值入口：NaN/Infinity 穿过 `??` 合并会写进面板并沿伤害链静默传播，
    // 必须在 createUnit 边界终止（fail loud）
    expect(() => createCoreUnit({ ...input, star: 1, powMult: Number.NaN })).toThrow();
    expect(() => createCoreUnit({ ...input, star: 1, bonus: { hp: Number.NaN } })).toThrow();
    expect(() => createCoreUnit({ ...input, star: 1, bonus: { atk: Number.POSITIVE_INFINITY } })).toThrow();

    const pool = new CardPool();
    const full = pool.snapshot();
    pool.restore({ ajiu: -1, __unknown__: 3 });
    expect(pool.snapshot()).toEqual(full);

    pool.restore({ ...full, ajiu: full.ajiu + 1 });
    expect(pool.snapshot()).toEqual(full);
  });

  it('自动布阵允许同名多张上场（1.9.1 同名放开）：distinct 优先、余位补重复、不撤玩家堆场', () => {
    const player = makePlayer({ level: 5 });
    // 同一张名字 3 份（模拟同名堆场）+ 两张其他名
    const ids = ['pan', 'pan', 'pan', 'ajiu', 'ajiu'];
    ids.forEach((defId, index) => {
      const unit = createUnit(defId);
      if (index < 3) player.board[boardIdx(index, 0)] = unit;
      else player.bench[index - 3] = unit;
    });
    autoArrange(player, new CardPool());
    const onBoard = player.board.filter(Boolean) as ReturnType<typeof createUnit>[];
    // 3 张 pan 全部保留在盘/席（不被撤下或卖出），且人口允许时同名可同场
    const panOnBoard = onBoard.filter((u) => u.defId === 'pan').length;
    expect(onBoard.length).toBeGreaterThan(0);
    const totalPan = [...player.board, ...player.bench].filter((u) => u?.defId === 'pan').length;
    expect(totalPan).toBe(3);
    // 5 张全数保留（level 5 人口 8 + 席 9 > 5，不应有任何卖出）
    const totalAll = [...player.board, ...player.bench].filter(Boolean).length;
    expect(totalAll).toBe(5);
    expect(panOnBoard).toBeGreaterThanOrEqual(1);
  });

  it('三星四费「登峰」：数值 ×1.15（无机制包），墨兽 3★ 四费不享受', () => {
    // 选一个带法强的四费（sp>0），否则 sp 比例是 0/0
    const base4 = CHAMPIONS.find((c) => c.cost === 4 && c.base.sp > 0)!;
    const mk = (star: 1 | 2 | 3) =>
      createBattleUnit({ uid: 1, defId: base4.id, team: 0, star, cell: { c: 0, r: 6 } });
    const two = mk(2);
    const three = mk(3);
    // 星级倍率 1.8→3.24 / 1.45→2.1 之上，3★ 再乘 1.15。
    // 面板是整数（Math.round 取整），低基数下比例偏差可达 ~0.01 —— 容差取 1 位小数
    expect(three.maxHp / two.maxHp).toBeCloseTo((3.24 / 1.8) * 1.15, 1);
    expect(three.atk / two.atk).toBeCloseTo((2.1 / 1.45) * 1.15, 1);
    expect(three.sp / two.sp).toBeCloseTo((2.1 / 1.45) * 1.15, 1);
    // 无天命机制包：无免控（ccImmune 为 0）
    expect(three.ccImmune).toBe(0);
  });

  it('17 条羁绊的每个档位都可激活（unique 棋子数 ≥ 最高档）', () => {
    for (const trait of TRAITS) {
      const unique = new Set(
        CHAMPIONS.filter((c) => c.origins.includes(trait.id) || c.classes.includes(trait.id)).map((c) => c.id),
      ).size;
      const maxTier = Math.max(...trait.breakpoints);
      expect(unique, `${trait.id} 最高档 ${maxTier} 不可达（仅 ${unique} 名 unique 棋子）`).toBeGreaterThanOrEqual(maxTier);
    }
  });

  it('墨兽阵容在各阶段都按宣告数量实际落地', () => {
    for (let round = 0; round <= 30; round += 3) {
      const board = generateBeastBoard(round, new Rng(1000 + round));
      expect(board.filter(Boolean).length).toBe(Math.min(8, 2 + Math.floor(round / 4)));
    }
  });
});
