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

  /** 归还一张（卖棋 / 淘汰时回池）。不设上钳：调用方（买卖/淘汰/回滚）与 take
   *  严格对称，钳制反而会把守恒破坏静默成吞牌 —— 溢出应当在调用侧暴露。 */
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
    // 跨版本/脏档守卫：逐键清洗，而不是整池重置。整池重置会让一张坏键把
    // 其余**未损坏**的键也膨胀回满池 —— 凭空造卡（守恒反向破坏）。
    // 逐键裁决口径（全部朝守恒保守方向收）：
    //   未知棋子 id（旧版名单残留）→ 丢弃该键（卡作废，不回池）；
    //   非整数 / 负数 → 0；
    //   超出本版池容（旧档池容不同）→ 钳到满池；
    //   本版缺项（新版本新增棋子）→ 按满池计入（下面初始化天然覆盖）。
    const next = new Map<string, number>();
    for (const c of CHAMPIONS) next.set(c.id, POOL_COUNTS[c.cost] ?? 0);
    let dirt = 0;
    for (const [k, v] of Object.entries(data)) {
      const champion = CHAMPIONS.find((c) => c.id === k);
      if (!champion) {
        dirt++;
        continue;
      }
      const max = POOL_COUNTS[champion.cost] ?? 0;
      if (!Number.isInteger(v) || (v as number) < 0) {
        next.set(k, 0);
        dirt++;
      } else if ((v as number) > max) {
        next.set(k, max);
        dirt++;
      } else {
        next.set(k, v as number);
      }
    }
    // 告警合并为一次：便于坏档定位；若反复出现，说明存档版本与代码名单长期错位，
    // 不能靠静默自愈掩盖
    if (dirt > 0) {
      console.warn(`[pool] 存档卡池与本版名单不一致，已清洗 ${dirt} 个键（丢弃/钳制），其余按档保留`);
    }
    this.counts = next;
  }
}

/**
 * 刷一次商店。
 *
 * 逐格独立抽取：先按等级概率表掷出费用档位，再在该档位**池中仍有货**的棋子里按剩余库存加权取一个。
 * 若该档位全部被抓空，退化为"按剩余库存加权"从所有档位里取，避免高等级玩家开出一排空格。
 *
 * @param table 等级概率表（9 行 × 5 档）。缺省读全局 SHOP_ODDS —— 对局路径恒走
 *  全局（确定性契约）；平衡工具链 shop 命令可注入本地覆盖表，绝不原地改写真源。
 */
export function rollShop(
  pool: CardPool,
  rng: Rng,
  level: number,
  table: readonly (readonly number[])[] = SHOP_ODDS,
): (string | null)[] {
  const li = Math.max(0, Math.min(table.length - 1, level - 1));
  const odds = table[li];
  const out: (string | null)[] = [];

  for (let s = 0; s < SHOP_SLOTS; s++) {
    // 1) 掷费用档位（与 weightedPick 同口径：严格小于 + 跳过零概率档，
    // 否则 roll 恰为 0 时会命中首个 0% 档， shop-odds 分布尾端漂移）
    let total = 0;
    for (let i = 0; i < odds.length; i++) total += Math.max(0, odds[i]);
    let roll = rng.next() * total;
    let costTier = odds.length - 1;
    for (let i = 0; i < odds.length; i++) {
      if (odds[i] <= 0) continue;
      roll -= odds[i];
      if (roll < 0) {
        costTier = i;
        break;
      }
    }
    if (odds[costTier] <= 0) {
      for (let i = odds.length - 1; i >= 0; i--) {
        if (odds[i] > 0) {
          costTier = i;
          break;
        }
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
  // 与 core/rng.sampleWeighted 同口径：严格小于判定 + 跳过零权重。
  // 此前用 <=0 且不跳零权重：roll 恰为 0 时会命中首个零权重项（理论概率 2^-32，
  // CRN 逐位一致的尾端漂移源），此处闭合。
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return items[0];
  let roll = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    if (weights[i] <= 0) continue;
    roll -= weights[i];
    if (roll < 0) return items[i];
  }
  for (let i = items.length - 1; i >= 0; i--) {
    if (weights[i] > 0) return items[i];
  }
  return items[items.length - 1];
}
