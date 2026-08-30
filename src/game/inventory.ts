/**
 * 装备栏与装配。
 *
 * 两条规则值得说明：
 *
 * 1. **一个棋子最多 3 件。** 这是自走棋的通行上限，它的意义是"装满一件装备"
 *    是一个明确的、可完成的决策目标 —— 没有上限，装备就只是一坨可以无限堆的数值。
 *
 * 2. **成品可以卸下，且拆回两个组件。** 很多同类产品里成品一旦装上就拿不下来了，
 *    理由是"防止玩家把装备当流通货币"。但本作的设计目标是**误操作可挽回**，
 *    一条不可逆的操作会逼玩家在每次拖拽前犹豫，这比允许拆装的代价大得多。
 */

import { ITEM_BY_ID, combine } from '../data/items';
import { CHAMPION_BY_ID } from '../data/champions';
import { findUnit, powerScore, type PlayerState, type UnitInstance } from './state';

export const MAX_ITEMS_PER_UNIT = 3;

/** 把一件装备放进装备栏 */
export function addItem(p: PlayerState, itemId: string): void {
  if (!ITEM_BY_ID[itemId]) return;
  p.items.push(itemId);
}

/** 从装备栏移除一件 */
export function removeItem(p: PlayerState, itemId: string): boolean {
  const i = p.items.indexOf(itemId);
  if (i < 0) return false;
  p.items.splice(i, 1);
  return true;
}

export interface EquipResult {
  ok: boolean;
  reason?: string;
  /** 本次操作合成出了什么（用于播放高光演出） */
  combined?: string;
}

/**
 * 把装备栏里的一件装备装到某个棋子上。
 *
 * 若棋子身上已有能与之合成的组件，则**自动合成** —— 玩家不需要记住配方表，
 * 拖上去就对了。合成路径的提示在 UI 上给出，但不构成操作门槛。
 */
export function equipItem(p: PlayerState, iid: number, itemId: string): EquipResult {
  if (!ITEM_BY_ID[itemId]) return { ok: false, reason: '未知装备' };
  if (!p.items.includes(itemId)) return { ok: false, reason: '装备栏里没有这件' };
  const u = findUnit(p, iid);
  if (!u) return { ok: false, reason: '找不到这个棋子' };
  if (u.isBeast) return { ok: false, reason: '不能给墨兽装装备' };

  // 先看能否与身上的装备合成
  if (ITEM_BY_ID[itemId]?.tier === 'component') {
    for (let i = 0; i < u.items.length; i++) {
      const other = u.items[i];
      if (ITEM_BY_ID[other]?.tier !== 'component') continue;
      const out = combine(itemId, other);
      if (!out) continue;
      // 合成：两件变一件，不额外占位
      u.items.splice(i, 1);
      u.items.push(out);
      removeItem(p, itemId);
      return { ok: true, combined: out };
    }
  }

  if (u.items.length >= MAX_ITEMS_PER_UNIT) {
    return { ok: false, reason: `这个棋子已经装满 ${MAX_ITEMS_PER_UNIT} 件` };
  }
  u.items.push(itemId);
  removeItem(p, itemId);
  return { ok: true };
}

/**
 * 卸下一件装备回到装备栏。
 * 成品会拆回它原本的两个组件 —— 见文件头的取舍说明。
 */
export function unequipItem(p: PlayerState, iid: number, itemId: string): boolean {
  const u = findUnit(p, iid);
  if (!u) return false;
  const i = u.items.indexOf(itemId);
  if (i < 0) return false;
  u.items.splice(i, 1);

  const def = ITEM_BY_ID[itemId];
  if (def?.tier === 'combined' && def.recipe) {
    p.items.push(def.recipe[0], def.recipe[1]);
  } else {
    p.items.push(itemId);
  }
  return true;
}

/**
 * 把一个棋子的装备全部剥下来放回器匣（卖出 / 淘汰时用）。
 *
 * 成品拆回两个组件，与 unequipItem 保持一致。
 * 没有这一步，卖掉一个带装备的棋子会连装备一起蒸发 —— 这是最恶劣的一类 bug：
 * 玩家不会立刻发现，只会在十几回合后感觉"我装备怎么这么少"。
 */
export function stripItems(p: PlayerState, u: UnitInstance): void {
  for (const id of [...u.items]) {
    const def = ITEM_BY_ID[id];
    if (def?.tier === 'combined' && def.recipe) p.items.push(def.recipe[0], def.recipe[1]);
    else p.items.push(id);
  }
  u.items = [];
}

/** 一个棋子身上的装备合成路径提示：还差什么能凑成成品 */
export function recipeHint(u: UnitInstance): string[] {
  const out: string[] = [];
  const comps = u.items.filter((id) => ITEM_BY_ID[id]?.tier === 'component');
  if (comps.length < 1) return out;
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      const c = combine(comps[i], comps[j]);
      if (c) out.push(`${ITEM_BY_ID[comps[i]].name}+${ITEM_BY_ID[comps[j]].name}→${ITEM_BY_ID[c].name}`);
    }
  }
  return out;
}

/**
 * 这件装备装在这个棋子身上值不值。
 *
 * 判据只有一条：**装备应该放大这个棋子本来就在做的事**，而不是补它的短板。
 * 给前排塞攻击力、给法师塞护甲，都是典型的"看起来有道理实则浪费"。
 * 所以算法是把棋子和装备都投影到「普攻 / 法术 / 承伤」三条轴上，取点积 ——
 * 同向则相乘变大，错配则互相抵消。
 */
/**
 * 棋子与装备的三轴投影。
 *
 * 抽出来是为了让**模拟器和 AI 共用同一套配装判断** ——
 * 如果平衡模拟里装备发给别人，实机里发给另一个人，那模拟数据就是假的。
 * 三轴用"战斗中实际产出的量级"衡量，不是裸数值：
 * 法强按"一场能放两三次技能"折算，血量按星级成长后再打折。
 */
export function unitAxes(defId: string, star: number): [number, number, number] {
  const champ = CHAMPION_BY_ID[defId];
  if (!champ) return [0, 0, 0];
  const s = star >= 3 ? 2.1 : star === 2 ? 1.45 : 1;
  const b = champ.base;
  const atk = b.atk * s * b.aspd * (1 + b.critChance * (b.critMult - 1));
  const sp = b.sp * s * (100 / 60) * 2.5;
  const tank = b.hp * (star >= 3 ? 3.24 : star === 2 ? 1.8 : 1) * 0.02 + b.armor * 0.6 + b.mr * 0.6;
  return [atk, sp, tank];
}

export function itemAxes(itemId: string, defId: string, star: number): [number, number, number] {
  const def = ITEM_BY_ID[itemId];
  const champ = CHAMPION_BY_ID[defId];
  if (!def || !champ) return [0, 0, 0];
  const s = star >= 3 ? 2.1 : star === 2 ? 1.45 : 1;
  const b = champ.base;
  const ib = def.bonus;
  const im = def.mods ?? {};
  const atk =
    (ib.atk ?? 0) * b.aspd +
    b.atk * s * (ib.aspd ?? 0) +
    (ib.critChance ?? 0) * 40 +
    (ib.critMult ?? 0) * 25 +
    (ib.omnivamp ?? 0) * 30 +
    (ib.lifesteal ?? 0) * 20;
  const sp = (ib.sp ?? 0) * 1.6 + (im.skillAmp ?? 0) * 120 + (im.manaPerSec ?? 0) * 12 + (ib.startMp ?? 0) * 1.2;
  const tank =
    (ib.hp ?? 0) * 0.02 +
    (ib.armor ?? 0) * 0.6 +
    (ib.mr ?? 0) * 0.6 +
    (im.physicalDr ?? 0) * 160 +
    (im.magicDr ?? 0) * 160 +
    (im.hpRegenPctPerSec ?? 0) * 900;
  return [atk, sp, tank];
}

export function itemFitScore(u: UnitInstance, itemId: string): number {
  const [ua, us, ut] = unitAxes(u.defId, u.star);
  const [ia, is, it] = itemAxes(itemId, u.defId, u.star);
  // 归一化后取点积，避免"数值大的装备永远赢"
  const nu = Math.hypot(ua, us, ut) || 1;
  const ni = Math.hypot(ia, is, it) || 1;
  return (ua * ia + us * is + ut * it) / (nu * ni);
}

/**
 * 给一串装备挑持有者（模拟器与"一键装备"共用）。
 *
 * 与 `itemFitScore` 的唯一差别是输入形态：这里只拿到 defId + 星级，
 * 因为战斗内核的入场配置里还没有 UnitInstance。
 * `powerOf` 一项让装备倾向于**核心棋子**而不是最缺它的那个 ——
 * 一件攻击装放在 carry 身上的收益，远大于放在一个前期肉盾身上。
 */
export function assignItems(
  units: Record<string, number>,
  itemIds: readonly string[],
  maxPerUnit = MAX_ITEMS_PER_UNIT,
): Record<string, string[]> {
  const carried: Record<string, string[]> = {};
  const powerOf = (defId: string, star: number) => {
    const [a, s, t] = unitAxes(defId, star);
    return a + s + t;
  };
  const fitOf = (defId: string, star: number, itemId: string) => {
    const [ua, us, ut] = unitAxes(defId, star);
    const [ia, is, it] = itemAxes(itemId, defId, star);
    const nu = Math.hypot(ua, us, ut) || 1;
    const ni = Math.hypot(ia, is, it) || 1;
    return (ua * ia + us * is + ut * it) / (nu * ni);
  };
  for (const itemId of itemIds) {
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const [defId, star] of Object.entries(units)) {
      if ((carried[defId]?.length ?? 0) >= maxPerUnit) continue;
      const sc = fitOf(defId, star, itemId) * Math.pow(powerOf(defId, star), 0.35);
      if (sc > bestScore) {
        bestScore = sc;
        best = defId;
      }
    }
    if (best) (carried[best] ??= []).push(itemId);
  }
  return carried;
}

/**
 * 自动分配装备（AI 与"一键装备"共用）。
 *
 * 分配原则：装备给**核心棋子**，而不是给最缺它的那个。
 * 一件攻击装放在 carry 身上的收益，远大于放在一个前期肉盾身上 ——
 * 这也是真人玩家的直觉，AI 应该和玩家想的一样。
 */
export function autoEquip(p: PlayerState): void {
  for (const itemId of [...p.items]) {
    let bestIid = -1;
    let bestScore = -Infinity;
    for (const u of p.board) {
      if (!u || u.isBeast) continue;
      if (u.items.length >= MAX_ITEMS_PER_UNIT) continue;
      // 适配度 × 棋子权重。权重用 0.35 次幂压平量级，
      // 否则三星棋子会因为 powerScore 太大而吃掉所有装备。
      const sc = itemFitScore(u, itemId) * Math.pow(powerScore(u), 0.35);
      if (sc > bestScore) {
        bestScore = sc;
        bestIid = u.iid;
      }
    }
    if (bestIid >= 0) equipItem(p, bestIid, itemId);
  }
}
