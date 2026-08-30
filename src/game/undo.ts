/**
 * 全局撤销栈 —— 纯逻辑，不引用 Phaser / DOM，可在 Node 里单测。
 *
 * 设计取舍见 DESIGN §十：快照整个玩家状态，而不是为每个动作写反向操作。
 * 反向操作需要为每种动作各写一份撤销逻辑，漏一个就是 bug；快照是"一处正确，处处正确"。
 *
 * 快照必须覆盖玩家在准备阶段能触碰的一切：
 * 棋盘 / 备战席（深拷贝，装备随棋子走）、等级 / 经验、金币、商店、器匣、共享卡池计数。
 * 漏任何一个字段，"撤销"就退化成"半个动作"——买经验可以白嫖等级、
 * 装备会凭空消失、卡池会单边漂移，全部是真实发生过的问题。
 */

import type { CardPool } from './pool';
import { cloneBoard, type PlayerState, type UnitInstance } from './state';

export interface PlayerSnapshot {
  board: (UnitInstance | null)[];
  bench: (UnitInstance | null)[];
  gold: number;
  level: number;
  xp: number;
  shop: (string | null)[];
  shopLocked: boolean;
  /** 器匣（未装配的装备） */
  items: string[];
  /** 共享卡池计数 —— 买入/卖出/布阵溢出的回滚都要靠它对称还原 */
  pool: Record<string, number>;
}

const cloneSlots = (slots: readonly (UnitInstance | null)[]): (UnitInstance | null)[] =>
  slots.map((u) => (u ? { ...u, items: [...u.items] } : null));

/** 在动作发生前调用：把玩家可变状态连同卡池一起定格 */
export function snapshotPlayer(p: PlayerState, pool: CardPool): PlayerSnapshot {
  return {
    board: cloneBoard(p.board),
    bench: cloneSlots(p.bench),
    gold: p.gold,
    level: p.level,
    xp: p.xp,
    shop: [...p.shop],
    shopLocked: p.shopLocked,
    items: [...p.items],
    pool: pool.snapshot(),
  };
}

/** 撤销：把快照回写进玩家状态。回写时再拷贝一次，保证同一份快照可安全复用 */
export function restorePlayer(p: PlayerState, pool: CardPool, s: PlayerSnapshot): void {
  p.board = cloneBoard(s.board);
  p.bench = cloneSlots(s.bench);
  p.gold = s.gold;
  p.level = s.level;
  p.xp = s.xp;
  p.shop = [...s.shop];
  p.shopLocked = s.shopLocked;
  p.items = [...s.items];
  pool.restore(s.pool);
}
