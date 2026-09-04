/**
 * 全局撤销栈 —— 纯逻辑，不引用 Phaser / DOM，可在 Node 里单测。
 *
 * 设计取舍见 DESIGN §十：快照整个玩家状态，而不是为每个动作写反向操作。
 * 反向操作需要为每种动作各写一份撤销逻辑，漏一个就是 bug；快照是"一处正确，处处正确"。
 *
 * 快照 scope = 玩家在准备阶段能触碰的一切：
 * 棋盘 / 备战席（深拷贝，装备随棋子走）、等级 / 经验、金币、商店、器匣、共享卡池计数、
 * 本回合未领取的奇遇恩赐（adventureOffer，领取后置空 —— 撤销须一并还原），
 * 以及对局随机流游标（UndoEntry.rngState，在 GameScene 入/出栈时随快照一起定格/回写）。
 * 漏任何一个字段，"撤销"就退化成"半个动作"——买经验可以白嫖等级、
 * 装备会凭空消失、卡池会单边漂移、随机游标不回滚则"刷新-撤销"循环可零成本
 * 预览后续商店（游标已前进），全部是真实发生过或审查确立过的问题。
 * hp / streak / rank 刻意不在快照内：它们只在战斗结算变化，撤销永远不跨结算
 * （GameScene.pushUndo/onUndo 双侧都有 phase==='prep' 守卫）；scope 扩到结算
 * 之前必须先把这三个字段纳入快照，否则就是半回滚。
 */

import type { CardPool } from './pool';
import type { AdventureOffer } from './adventure';
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
  /** 本回合奇遇恩赐（准备阶段可撤销的全局物，领取后置空 —— 撤销须一并还原，
   *  否则退回领赐前快照后恩赐永久蒸发，与「撤销到更早快照可重选」的设计契约相悖） */
  adventureOffer: AdventureOffer | null;
}

const cloneSlots = (slots: readonly (UnitInstance | null)[]): (UnitInstance | null)[] =>
  slots.map((u) => (u ? { ...u, items: [...u.items] } : null));

/** 恩赐浅克隆：options 数组拷贝一份，选项对象本身是发放时新建的只读规格
 *  （optionFor 产物，无人原地改写）。不克隆的话快照与 Match 持同一引用，
 *  "回写时再拷贝、同一快照可安全复用"的承诺对它是空的。 */
const cloneOffer = (offer: AdventureOffer | null): AdventureOffer | null =>
  offer ? { ...offer, options: [...offer.options] } : null;

/** 在动作发生前调用：把玩家可变状态连同卡池一起定格 */
export function snapshotPlayer(p: PlayerState, pool: CardPool, adventureOffer: AdventureOffer | null = null): PlayerSnapshot {
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
    adventureOffer: cloneOffer(adventureOffer),
  };
}

/** 撤销：把快照回写进玩家状态。回写时再拷贝一次，保证同一份快照可安全复用。
 *  offer 目标必传（恩赐挂在 Match 上而非 PlayerState 上，快照才把它作为参数带入）：
 *  恢复职责与快照职责对称收口在这一处 —— 若靠调用方各自记得补写 adventureOffer，
 *  新增快照消费方时极易漏掉，出现"撤销把已领恩赐留在已领状态"的半回滚。 */
export function restorePlayer(
  p: PlayerState,
  pool: CardPool,
  s: PlayerSnapshot,
  offer: { adventureOffer: AdventureOffer | null },
): void {
  p.board = cloneBoard(s.board);
  p.bench = cloneSlots(s.bench);
  p.gold = s.gold;
  p.level = s.level;
  p.xp = s.xp;
  p.shop = [...s.shop];
  p.shopLocked = s.shopLocked;
  p.items = [...s.items];
  pool.restore(s.pool);
  offer.adventureOffer = cloneOffer(s.adventureOffer);
}
