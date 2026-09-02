/**
 * AI 对手。
 *
 * 目标不是"下出最优解"，而是"像一个有性格的人在打"。
 * 一个每次都打出最优解的对手，玩家感受到的不是挑战，是一堵墙。
 *
 * 三条让 AI 有"人味"的设计：
 * 1. **性格原型** —— 五个原型各有不同的等级节奏、搜牌阈值、羁绊偏好。
 *    你会感觉"那个守财的又在那攒钱"，而不是"七个一样的机器人在打我"。
 * 2. **局势感知** —— 血少了会搏，名次靠前会稳。同一个守财 AI 在 20 血时的行为
 *    和 90 血时完全不同，这是"他在挣扎"的观感来源。
 * 3. **决策噪声** —— 每个原型有 noise 系数，会偶尔做出次优选择（买一张不太需要
 *    的牌、少刷一次商店）。完全理性的对手看起来最假。
 */

import { BENCH_SLOTS, PLAYER_START_HP, REROLL_COST, SHOP_SLOTS, XP_BUY_COST } from '../core/config';
import { CHAMPION_BY_ID } from '../data/champions';
import { computeTraits } from './comp';
import { autoArrange } from './arrange';
import { autoEquip } from './inventory';
import {
  allUnits,
  benchCount,
  powerScore,
  type AiProfile,
  type PlayerState,
  type UnitInstance,
} from './state';
import type { AiArchetype } from './state';

export type { AiArchetype };
import type { AdventureOffer } from './adventure';
import type { CardPool } from './pool';
import type { Rng } from '../core/rng';

/** AI 能感知到的世界。由 Match 实现，避免 ai.ts 与 match.ts 循环依赖。 */
export interface AiWorld {
  round: number;
  pool: CardPool;
  rng: Rng;
  /** 买入商店第 slot 张牌（返回结构含 ok，Match 实现另带失败原因） */
  buy(p: PlayerState, slot: number): { ok: boolean };
  /** 刷新商店 */
  reroll(p: PlayerState): boolean;
  /** 花 4 金买 4 经验 */
  buyExp(p: PlayerState): boolean;
  /** 卖出棋子 */
  sell(p: PlayerState, iid: number): boolean;
  /** 当前存活人数（用于名次焦虑） */
  aliveCount(): number;
}

// ── 性格原型 ────────────────────────────────────────────

const ARCHETYPE: Record<AiArchetype, Omit<AiProfile, 'arch' | 'label'>> = {
  // 血勇：早早提战力，靠连胜滚雪球
  // 奇遇偏好 reinforce/components：连胜窗口期要的是"这一回合就能多打出一口血"的即战力 ——
  // 援军 2★ 直接落场形成战力，组件当场就能合成装上；等级即人口即战力；
  // 金币/经验是慢变量，等不起。
  aggro: { rollFloor: 10, aggression: 0.7, preferred: ['jianzong', 'assassin', 'warrior'], levelPace: 1.15, levelCap: 9, mergeBias: 1.0, noise: 0.22, adventurePref: ['reinforce', 'components', 'item', 'level', 'gold', 'xp'] },
  // 守财：死守 50 金吃满利息，中期突然发力
  // 奇遇偏好 gold/xp：金币直接进存款吃利息、经验推进升级曲线，全是"明天更值钱"的
  // 复利项；顿悟 +1 级等同免买的经验，同属复利；组件与援军是即时消耗，
  // 援军占备战席还会打乱它攒三合成的节奏，与 mergeBias 标准的攒牌打法相克。
  econ: { rollFloor: 22, aggression: 0.3, preferred: ['danding', 'tian', 'guardian'], levelPace: 0.95, levelCap: 9, mergeBias: 1.0, noise: 0.1, adventurePref: ['gold', 'xp', 'level', 'item', 'components', 'reinforce'] },
  // 老谋：什么都沾一点，跟着发牌走
  // 奇遇偏好 item：不押单一维度，而成品装备是全游戏唯一不能从商店买到的资源
  // （只能墨兽轮掉落）——拿装备补"钱买不到"的那块短板，期望收益最稳。
  balanced: { rollFloor: 12, aggression: 0.55, preferred: ['shanhai', 'youming', 'mage'], levelPace: 1.0, levelCap: 9, mergeBias: 1.0, noise: 0.16, adventurePref: ['item', 'level', 'gold', 'components', 'reinforce', 'xp'] },
  /**
   * 孤注：血线赌徒。
   *
   * 它最初被定义成"永远梭哈"—— 存钱底线压到 2，每回合把钱全刷掉追三星。
   * 跑下来平均名次长期在 5.1 左右垫底：因为它从开局第一回合就在梭哈，
   * 永远吃不到利息，等级也被卡在 8 级，三星还没凑出来人就没了。
   * 那不是"激进的性格"，是"不会玩"。
   *
   * 重新定义成**顺风稳健、逆风梭哈**：血线健康时按标准打法攒钱吃利息，
   * 一旦掉血就大幅下调存钱底线（下面的 urgency 项会自动把它压到 4 以下）开始搏命。
   * 这样它既激进又不送，而且玩家能明显感觉到"那个孤注在拼命了"。
   *
   * 奇遇偏好 xp/reinforce：把人口推到等级上限（9）搜三星 —— 经验让它更快到位
   * （人口 = 等级，多一人口就多一格摆三星），顿悟 +1 级与经验同轴且更即时，
   * 援军 2★ 低费棋子直接是三星进度或即时战力；装备对它节奏最慢（还得等合适的持有者）。
   */
  hyperroll: { rollFloor: 12, aggression: 0.6, preferred: ['yaozu', 'jiguan', 'warrior'], levelPace: 1.0, levelCap: 9, mergeBias: 3.6, noise: 0.3, adventurePref: ['xp', 'level', 'reinforce', 'gold', 'components', 'item'] },
  // 钓叟：疯狂冲人口，靠高费卡翻盘；不屑于凑低费三星
  // 奇遇偏好 gold：金币是最通用的燃料（刷牌找 4/5 费 + 买经验冲 9 级）；
  // 顿悟 +1 级直接等于它最稀缺的人口；低费援军对它几乎无用 ——
  // levelPace 1.25 的高人口阵容里上不了场。
  greedy: { rollFloor: 20, aggression: 0.4, preferred: ['longyuan', 'tian', 'mage'], levelPace: 1.25, levelCap: 9, mergeBias: 1.0, noise: 0.1, adventurePref: ['gold', 'level', 'item', 'xp', 'components', 'reinforce'] },
};

/** 8 名参与者的名字。称号直接暴露性格 —— 玩家应该能一眼看出"这局谁危险"。 */
export const AI_ROSTER: readonly { name: string; arch: AiArchetype }[] = [
  { name: '「铁算子」神机', arch: 'balanced' },
  { name: '「血勇」重明', arch: 'aggro' },
  { name: '「守财」聚宝', arch: 'econ' },
  { name: '「孤注」燃犀', arch: 'hyperroll' },
  { name: '「老谋」玄鸢', arch: 'balanced' },
  { name: '「钓叟」渭滨', arch: 'greedy' },
  { name: '「莽夫」开山', arch: 'aggro' },
];

export function makeProfile(arch: AiArchetype): AiProfile {
  const base = ARCHETYPE[arch];
  return { arch, label: archLabel(arch), ...base };
}

export function archLabel(arch: AiArchetype): string {
  switch (arch) {
    case 'aggro':
      return '血勇';
    case 'econ':
      return '守财';
    case 'balanced':
      return '老谋';
    case 'hyperroll':
      return '孤注';
    case 'greedy':
      return '钓叟';
  }
}

/**
 * 奇遇恩赐选择（M3）：按偏好序取第一个 offer 里存在的 kind；
 * 选项里一个偏好项都没有时取第一个选项。
 * 纯函数、不消耗 rng —— 同种子同局面必同选择，对局层确定性契约的一部分。
 */
export function chooseAdventureIndex(prof: AiProfile, offer: AdventureOffer): number {
  for (const kind of prof.adventurePref) {
    const i = offer.options.findIndex((o) => o.kind === kind);
    if (i >= 0) return i;
  }
  return 0;
}

// ── 求值 ────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 这张牌买进来，能让已有羁绊前进多少 */
function traitGain(p: PlayerState, defId: string): number {
  const def = CHAMPION_BY_ID[defId];
  if (!def) return 0;
  const owned = allUnits(p).map((u) => u.defId);
  const before = computeTraits(owned);
  const after = computeTraits([...owned, defId]);
  let s = 0;
  for (const a of after) {
    const b = before.find((x) => x.id === a.id);
    const bt = b ? b.tier : -1;
    if (a.tier > bt) {
      // 跨档 = 机制层面的质变，权重最高
      s += 16 * (a.tier + 1);
    } else if (b) {
      // 已有一条，向下一档推进
      s += 3;
    } else {
      // 全新羁绊：给一点分，否则 AI 会系统性低估"开新线"的价值，
      // 表现就是它只会沿着已有羁绊一直加深，阵容永远长不出第二条腿。
      s += 0.4;
    }
  }
  return s;
}

function copiesOf(p: PlayerState, defId: string, star: number): number {
  let n = 0;
  for (const u of allUnits(p)) if (u.defId === defId && u.star === star) n++;
  return n;
}

/**
 * 立刻 / 逼近合成的额外价值。三合成是自走棋最大的单次战力跳变，值得重估。
 *
 * 判序必须从高星级往下走：否则"场上已有一个 2★ + 备战席一张 1★"这种情况
 * 会被 `one === 1` 提前拦下只拿到 8 分，而实际上这张牌是通往**第二个** 2★ 的进度，
 * 价值远高于一张孤立的一星。
 */
export function mergeValue(p: PlayerState, defId: string): number {
  const two = copiesOf(p, defId, 2);
  const one = copiesOf(p, defId, 1);
  // 买进一张 1★ 只在 one>=2 时才立刻凑出第三张 2★ → 3★；
  // 仅有两张 2★（one<2）时这张牌离 3★ 还差两张 1★，是进度不是高光
  if (two >= 2 && one >= 2) return 60; // 买进来立刻 3★ —— 高光时刻
  if (two >= 2) return 18; // 已有两张 2★：这张 1★ 是通往第三张 2★ 的进度
  if (two === 1) return 18; // 已有 2★，这张是通往第二个 2★ 的进度
  if (one >= 2) return 26; // 买进来立刻变 2★
  if (one === 1) return 8;
  return 0;
}

/**
 * 备战席定期清理。
 *
 * 没有这一步，搜牌型 AI 会在开局几回合内用 9 张互不相关的杂牌把备战席塞满，
 * 然后**永久卡死**：因为它再也腾不出连续三格去凑任何一个三星。
 * 表面症状是"它一直在刷新但从来凑不出东西"，实际是空间管理失效。
 *
 * 清理原则：卖掉"离合成最远"的低价值棋子 —— 两张一星的凑合价值，
 * 高于一张孤立的高费。始终至少留出 3 格，这是凑一次三星所需的最小连续空间。
 */
function tidyBench(w: AiWorld, p: PlayerState): void {
  const free = BENCH_SLOTS - benchCount(p);
  if (free >= 3) return;
  const cands: { iid: number; v: number }[] = [];
  for (const u of p.bench) {
    if (!u) continue;
    const one = copiesOf(p, u.defId, 1);
    const two = copiesOf(p, u.defId, 2);
    let v = powerScore(u) * 0.5;
    if (u.star === 1) {
      v += one >= 3 ? 34 : one === 2 ? 24 : one === 1 ? 2 : 0;
      // 场上已有一个 2★：这张 1★ 是通往第二个 2★ 的进度，绝不能当垃圾卖掉
      if (two >= 1) v += 22;
    } else if (u.star === 2) {
      v += two >= 3 ? 60 : two === 2 ? 44 : two === 1 ? 12 : 0;
    }
    cands.push({ iid: u.iid, v });
  }
  cands.sort((a, b) => a.v - b.v);
  let need = 3 - free;
  for (const c of cands) {
    if (need <= 0) break;
    if (w.sell(p, c.iid)) need--;
  }
}

/**
 * 备战席满时，为更有价值的牌腾位置。
 *
 * 没有这一步，搜牌型 AI 会死在一个很隐蔽的状态里：备战席塞满一堆**各一张**的棋子，
 * 任何一张都凑不成三星，而它还在继续买新的名字。表现就是"它一直在刷新，但什么也没凑出来"。
 *
 * 留下价值的判断核心是"离合成有多近"，而不是"这张牌本身有多强" ——
 * 三张一星的凑合价值，远高于一张孤立的三费。
 */
function makeRoomFor(w: AiWorld, p: PlayerState, incoming: number): boolean {
  if (benchCount(p) < BENCH_SLOTS) return true;
  let worstIid = -1;
  let worstVal = Infinity;
  for (const u of p.bench) {
    if (!u) continue;
    let v = powerScore(u) * 0.4;
    const one = copiesOf(p, u.defId, 1);
    const two = copiesOf(p, u.defId, 2);
    if (u.star === 1) {
      v += one >= 3 ? 40 : one === 2 ? 22 : 4;
      if (two >= 1) v += 22; // 同上：这是通往第二个 2★ 的进度
    } else if (u.star === 2) {
      v += two >= 2 ? 60 : two === 1 ? 18 : 6;
    }
    // 场上已有同名：留着等合成能直接提升战力
    if (p.board.some((x) => x !== null && x.defId === u.defId)) v += 12;
    if (v < worstVal) {
      worstVal = v;
      worstIid = u.iid;
    }
  }
  if (worstIid < 0) return false;
  // 新牌必须明显更值得留才值得卖掉现有的一张，否则会陷入无意义的换手
  if (incoming <= worstVal * 1.15) return false;
  return w.sell(p, worstIid);
}

/** 单张牌的购买欲望分。越高越想买。 */
export function scoreCard(p: PlayerState, defId: string, round: number, prof: AiProfile): number {
  const def = CHAMPION_BY_ID[defId];
  if (!def) return -1;
  const fake: UnitInstance = { iid: -1, defId, star: 1, items: [] };
  let s = powerScore(fake) * 0.45;
  s += traitGain(p, defId);
  s += mergeValue(p, defId) * prof.mergeBias;

  // 性格偏好
  for (const t of [...def.origins, ...def.classes]) {
    if (prof.preferred.includes(t)) s += 9;
  }
  // 费用与阶段的匹配度：前期高费卡买来也是废的（人口不够上不了场）
  const affordability = p.level - def.cost;
  if (affordability < 0) s -= 8 * -affordability;
  // 后期 1 费卡价值衰减
  if (round > 14 && def.cost === 1) s -= 10;
  if (round > 20 && def.cost <= 2) s -= 10;

  // 开新线的隐性成本：占掉一个备战席格。
  // 没有这一项，AI 会每回合都买一个新名字，然后下一回合又把它们当垃圾卖掉 ——
  // 任何一张都攒不到第二张，三星因此永远凑不出来。
  // 压力越大（备战席越满），越只能买"能推进已有进度"的牌。
  const owned = copiesOf(p, defId, 1) + copiesOf(p, defId, 2);
  if (owned === 0) {
    const pressure = benchCount(p) / BENCH_SLOTS;
    s -= (6 + pressure * 22) * Math.max(0.5, prof.mergeBias);
  }

  return s;
}

/** 该等级下 AI 期望达到的人口 */
export function targetLevel(prof: AiProfile, round: number): number {
  const t = 2 + (round - 1) * 0.3 * prof.levelPace;
  return clamp(Math.round(t), 2, prof.levelCap);
}

// ── 决策 ────────────────────────────────────────────────

/**
 * AI 执行一次完整的准备阶段决策。
 * 顺序刻意模仿真人：先看牌 → 买 → 要不要再刷 → 要不要升级 → 最后布阵 → 顺手锁牌。
 */
export function aiTakeTurn(w: AiWorld, p: PlayerState): void {
  const prof = p.ai;
  if (!prof) return;
  const rng = w.rng;

  const hpRatio = p.hp / PLAYER_START_HP;
  // 危机感：血越少越搏命
  const panic = clamp(Math.pow(1 - hpRatio, 1.4), 0, 1);
  // 名次焦虑：人越少，越接近终局，越不能等
  const endgame = clamp((8 - w.aliveCount()) / 6, 0, 1);
  const urgency = clamp(panic * 0.75 + endgame * 0.45, 0, 1);

  // 危机时把"存钱底线"整个掀掉 —— 这时候还在吃利息就是等死
  const floor = Math.max(0, Math.round(prof.rollFloor * (1 - urgency * 0.85)));
  const aggression = clamp(prof.aggression + urgency * 0.35, 0, 1);
  const noise = prof.noise;

  // ── 先整理备战席，再开始买 ──
  tidyBench(w, p);

  // ── 买牌 + 刷新 ──
  let rollsLeft = Math.round(2 + aggression * 5);
  let guard = 0;
  while (guard++ < 24) {
    let bought = false;
    for (let s = 0; s < SHOP_SLOTS; s++) {
      const id = p.shop[s];
      if (!id) continue;
      const def = CHAMPION_BY_ID[id];
      if (!def) continue;
      if (p.gold < def.cost) continue;
      if (benchCount(p) >= BENCH_SLOTS) {
        // 备战席满了：先看看有没有值得为之腾位置的好牌
        const probe = scoreCard(p, id, w.round, prof);
        if (!makeRoomFor(w, p, probe)) break;
      }

      const want = scoreCard(p, id, w.round, prof) + (rng.next() - 0.5) * noise * 22;
      // 阈值随危机感下降：血少了，什么都买（先活下来再说）
      const threshold = 26 - urgency * 14 + (1 - aggression) * 8;
      if (want >= threshold) {
        if (w.buy(p, s).ok) bought = true;
      }
    }

    const canAffordRoll = p.gold - REROLL_COST >= floor;
    // 商店里已经没想要的了，才值得刷新
    const shopIsDry = !p.shop.some((id) => id && scoreCard(p, id, w.round, prof) >= 26 - urgency * 14);
    const wantMore = (shopIsDry || !bought) && rng.next() < 0.35 + aggression * 0.6;
    if (rollsLeft > 0 && canAffordRoll && wantMore) {
      if (!w.reroll(p)) break;
      rollsLeft--;
      continue;
    }
    break;
  }

  // ── 升级 ──
  const target = targetLevel(prof, w.round);
  // 危机时更愿意把钱换成即时战力而非人口，但终局必须冲人口（否则场上少人）
  const levelReserve = urgency > 0.6 ? 4 : Math.max(6, floor);
  let levelGuard = 0;
  while (p.level < target && p.gold >= XP_BUY_COST + levelReserve && levelGuard++ < 8) {
    if (!w.buyExp(p)) break;
  }
  // 钱多到溢出又没到目标等级：继续砸经验（真人也是这么干的）。
  // 但绝不突破性格的等级上限 —— 否则赌狗流会在后期莫名其妙变成九人口阵容。
  while (p.level < prof.levelCap && p.gold >= 30 && levelGuard++ < 12) {
    if (!w.buyExp(p)) break;
  }

  // ── 布阵 ──
  autoArrange(p, w.pool);

  // ── 装配 ──
  // 必须放在布阵之后：装备只发给上场的棋子，发给备战席的等于浪费。
  autoEquip(p);

  // ── 锁商店：有张很想要的牌，这回合买不起但下回合能买得起 ──
  p.shopLocked = p.shop.some((id) => {
    if (!id) return false;
    const def = CHAMPION_BY_ID[id];
    if (!def) return false;
    if (def.cost <= p.gold) return false; // 买得起就别锁
    if (def.cost > p.gold + projectedNextIncome(p)) return false; // 下回合也买不起，锁了没意义
    return scoreCard(p, id, w.round, prof) >= 42;
  });

  // ── 手滑：偶尔做一次没道理的事。这是"人味"最廉价也最有效的来源。 ──
  if (rng.next() < noise * 0.18 && p.gold > 12) {
    w.reroll(p);
  }
}

/** 下一次准备阶段预计能拿到的钱（基础收入 + 利息的粗略估计） */
function projectedNextIncome(p: PlayerState): number {
  return 5 + Math.min(5, Math.floor(p.gold / 10)) + 2;
}
