/**
 * 共享卡池与商店。
 *
 * 8 名玩家共享同一个卡池 —— 这是自走棋最核心的经济约束：
 * 别人把某个棋子抓走了，你就抓不到。所有"抢牌""看牌"的博弈都建立在这上面。
 *
 * 卡池状态必须可序列化，否则存档读回来卡池会错乱。
 */

import { POOL_COUNTS, SHOP_ODDS, SHOP_SLOTS } from '../core/config';
import { CHAMPIONS, CHAMPION_IDS_BY_COST } from '../data/champions';
import type { Rng } from '../core/rng';

export class CardPool {
  private counts: Map<string, number>;

  constructor() {
    this.counts = new Map();
    for (const c of CHAMPIONS) {
      this.counts.set(c.id, POOL_COUNTS[c.cost] ?? 0);
    }
  }

  remaining(defId: string): number {
    return this.counts.get(defId) ?? 0;
  }

  /** 取走一张。成功返回 true，池中无货返回 false。 */
  take(defId: string): boolean {
    const n = this.counts.get(defId) ?? 0;
    if (n <= 0) return false;
    this.counts.set(defId, n - 1);
    return true;
  }

  /** 归还一张（卖棋 / 淘汰时回池） */
  give(defId: string): void {
    this.counts.set(defId, (this.counts.get(defId) ?? 0) + 1);
  }

  /** 归还一个棋子（按星级拆成对应张数） */
  giveUnit(defId: string, star: number): void {
    const n = star === 1 ? 1 : star === 2 ? 3 : 9;
    for (let i = 0; i < n; i++) this.give(defId);
  }

  remainingByCost(cost: number): number {
    let n = 0;
    for (const id of CHAMPION_IDS_BY_COST[cost] ?? []) n += this.remaining(id);
    return n;
  }

  totalRemaining(): number {
    let n = 0;
    for (const v of this.counts.values()) n += v;
    return n;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  restore(data: Record<string, number>): void {
    for (const c of CHAMPIONS) {
      this.counts.set(c.id, data[c.id] ?? POOL_COUNTS[c.cost] ?? 0);
    }
  }
}

/**
 * 刷一次商店。
 *
 * 逐格独立抽取：先按等级概率表掷出费用档位，再在该档位**池中仍有货**的棋子里按剩余库存加权取一个。
 * 若该档位全部被抓空，退化为"按剩余库存加权"从所有档位里取，避免高等级玩家开出一排空格。
 */
export function rollShop(pool: CardPool, rng: Rng, level: number): (string | null)[] {
  const li = Math.max(0, Math.min(SHOP_ODDS.length - 1, level - 1));
  const odds = SHOP_ODDS[li];
  const out: (string | null)[] = [];

  for (let s = 0; s < SHOP_SLOTS; s++) {
    // 1) 掷费用档位
    let total = 0;
    for (let i = 0; i < odds.length; i++) total += odds[i];
    let roll = rng.next() * total;
    let costTier = odds.length - 1;
    for (let i = 0; i < odds.length; i++) {
      roll -= odds[i];
      if (roll <= 0) {
        costTier = i;
        break;
      }
    }

    let candidates = (CHAMPION_IDS_BY_COST[costTier + 1] ?? []).filter((id) => pool.remaining(id) > 0);

    // 2) 该档位空了 → 从全部有货的棋子里按剩余库存加权
    if (candidates.length === 0) {
      const all = CHAMPIONS.filter((c) => pool.remaining(c.id) > 0);
      if (all.length === 0) {
        out.push(null);
        continue;
      }
      const weights = all.map((c) => pool.remaining(c.id));
      candidates = [weightedPick(all.map((c) => c.id), weights, rng)];
    }

    // 3) 同档位内按剩余库存加权：剩得多的更容易出现，天然避免"最后一张死活不出"
    const weights = candidates.map((id) => pool.remaining(id));
    const picked = weightedPick(candidates, weights, rng);
    out.push(picked);
  }
  return out;
}

function weightedPick(items: readonly string[], weights: readonly number[], rng: Rng): string {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return items[0];
  let roll = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}
