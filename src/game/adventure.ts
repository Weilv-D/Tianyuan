/**
 * PVE 奇遇轮（M3）· 契约与恩赐实现。
 *
 * 奇遇轮为 4 / 10 / 16，全场恰三次（Match.isAdventureRound）；墨兽轮为
 * 1 / 7 / 13 / 19 / 25（Match.isBeastRound）。同一回合全员共享同一份 2~3 选 1 恩赐：
 * AI 在 beginRound 内按原型偏好即选，人类在准备阶段任意时刻点选；
 * 进入战斗阶段未选即过期（无惩罚）。
 *
 * 纪律：恩赐全部走既有经济/装备/经验/上场系统，不新增资源种类；
 * 发放必须守恒（援军占用卡池、器匣物品计入持有）；文案规格口吻（每档绝对数值）。
 *
 * 数值表依据（阶段划分与档位，全部为绝对数值）：
 * - 阶段线：前期 < 8（奇遇轮 4），中期 8~13（奇遇轮 10），后期 ≥ 14（奇遇轮 16）。
 *   三次奇遇对准开局 / 中盘 / 后程三段成长弧，每次恰落一档。
 * - 金币档 10/16/24：基础收入 5 金/回合，前期 10 金 = 2 回合基础收入；
 *   后期满利息玩家每回合进账约 14 金（5 基础 + 5 利息 + 连胜/胜利），24 金
 *   约等于两回合的满额进账，是"有用但不改写经济规则"的一笔。
 * - 经验档 8/14/20：经验可按 4 金 = 4 经验兑换（XP_BUY_COST 口径），
 *   取金币档 × 0.8 折算，与金币恩赐保持同一量级；每回合自然经验 4 点，
 *   前期 8 点 = 2 回合的自然增长。
 * - 援军档：统一发放 2★ 棋子，费用档 1/2/3 费随阶段递增，占卡池 3 张；
 *   2★ 卖出价 = 费用 ×3 − 1（state.sellValue 口径），三档折金 2/5/8。
 *   折金低于金币档是刻意的：援军的价值在"即时战力 + 免刷牌"，
 *   费用档随阶段递增保证后期拿到的不是一张上不了场的低费卡。
 * - 组件档 2/3/3：组件 = 三分之一件成品，与墨兽轮掉落同一来源、同一守恒口径
 *   （addItem 入器匣，只进不出）。前期 2 件约等于一轮墨兽胜场的掉落量，
 *   是"让这局的装备计划提前一拍"的恩赐，不改写装备总量上限。
 * - 顿悟档：恒定 +1 级，走既有升级表结算（发放 xpToNext(level) 点经验，
 *   经验条不跳变）；已达最高等级 9 级时经验不再入账（economy 口径），
 *   按经验档等值折金（4 金 = 4 经验口径，后期档 20 金）—— 与援军折金同一守恒先例。
 * - 器匣档：恒定 1 件成品装备。成品只能经墨兽轮获得（组件合成，或 19/25 轮
 *   胜场直接掉落），其有效价值随阶段自然上升（核心棋子定型、装备栏位渐满），
 *   恒定一件已达成"前期小后期大"的实际体感；若按数量递增（后期 2 件）会
 *   一次性注入 2 件装备的战力差，破坏墨兽轮的装备经济。
 */
import type { Rng } from '../core/rng';
import { MAX_LEVEL } from '../core/config';
import { COMPONENT_IDS, ITEMS } from '../data/items';

export type AdventureKind = 'item' | 'gold' | 'xp' | 'components' | 'level' | 'reinforce';

export interface AdventureOption {
  kind: AdventureKind;
  /** 规格口吻短题，自含绝对数值（如「金币 +12」） */
  title: string;
  /** 规格口吻说明，每档绝对数值，禁「提升至/翻倍」相对表述 */
  desc: string;
}

export interface AdventureOffer {
  round: number;
  /** 2~3 个选项；同一回合全体玩家看到的选项完全一致 */
  options: AdventureOption[];
}

// ── 数值表（发放函数与文案共同取值，保证"标题写多少就发多少"）──

export type AdventureStage = 'early' | 'mid' | 'late';

/** 阶段划分：前期 < 8（奇遇轮 4），中期 8~13（奇遇轮 10），后期 ≥ 14（奇遇轮 16）（依据见文件头） */
export function adventureStage(round: number): AdventureStage {
  if (round < 8) return 'early';
  if (round < 14) return 'mid';
  return 'late';
}

/** 金币档：前期 10 / 中期 16 / 后期 24 */
export function adventureGold(round: number): number {
  const t = adventureStage(round);
  return t === 'early' ? 10 : t === 'mid' ? 16 : 24;
}

/** 经验档：前期 8 / 中期 14 / 后期 20（= 金币档 × 0.8，4 金 = 4 经验口径） */
export function adventureXp(round: number): number {
  const t = adventureStage(round);
  return t === 'early' ? 8 : t === 'mid' ? 14 : 20;
}

/** 援军费用档：前期 1 费 / 中期 2 费 / 后期 3 费（一律 2★，占卡池 3 张） */
export function adventureReinforceCost(round: number): number {
  const t = adventureStage(round);
  return t === 'early' ? 1 : t === 'mid' ? 2 : 3;
}

/** 组件档：前期 2 / 中期 3 / 后期 3（与墨兽轮掉落同一来源、同一守恒口径） */
export function adventureComponents(round: number): number {
  const t = adventureStage(round);
  return t === 'early' ? 2 : 3;
}

/** 成品装备池（item 恩赐从合成装备里随机，与墨兽轮组件掉落区分开） */
export const COMBINED_ITEM_IDS: readonly string[] = ITEMS.filter((i) => i.tier === 'combined').map((i) => i.id);

/** 2★ 援军入不了账（备战席满 / 卡池余量不足）时的折金返还额 = 2★ 卖出价 */
export function reinforceRefund(round: number): number {
  return adventureReinforceCost(round) * 3 - 1;
}

// ── 选项文案 ────────────────────────────────────────────

function optionFor(kind: AdventureKind, round: number): AdventureOption {
  switch (kind) {
    case 'gold': {
      const n = adventureGold(round);
      return { kind, title: `金币 +${n}`, desc: `立即获得 ${n} 金币，计入持有金币，参与下回合利息结算。` };
    }
    case 'xp': {
      const n = adventureXp(round);
      return { kind, title: `经验 +${n}`, desc: `立即获得 ${n} 点经验，按升级表结算，可一次连升多级。` };
    }
    case 'item':
      return {
        kind,
        title: '丹青成装 · 随机成品装备一件',
        desc: `随机获得一件成品装备（合成装备池 ${COMBINED_ITEM_IDS.length} 选 1），放入装备栏，可装配或卖出。`,
      };
    case 'components': {
      const n = adventureComponents(round);
      return {
        kind,
        title: `组件 ×${n}`,
        desc: `随机获得 ${n} 件组件装备（组件池 ${COMPONENT_IDS.length} 选 1 各自独立），放入装备栏，可合成、装配或卖出。`,
      };
    }
    case 'level':
      return {
        kind,
        title: '顿悟 · 等级 +1',
        desc: `立即提升 1 级（按升级表结算）；已达最高等级 ${MAX_LEVEL} 级时改为获得 ${adventureXp(round)} 金。`,
      };
    case 'reinforce': {
      const cost = adventureReinforceCost(round);
      return {
        kind,
        title: '援军 · 随机 2★ 棋子入驻备战席',
        desc: `免费获得一个 2★ ${cost} 费棋子（占卡池 3 张），入驻备战席；备战席已满时按 ${reinforceRefund(round)} 金折算返还。`,
      };
    }
  }
}

/**
 * 选项展示顺序。掷出的种类集合是无序的，按此固定次序排列，
 * 保证同一 offer 全员看到的排序一致、断言可写死。
 */
const DISPLAY_ORDER: readonly AdventureKind[] = ['gold', 'xp', 'components', 'item', 'level', 'reinforce'];

/**
 * 由对局 rng 掷出本回合的恩赐选项。
 * 确定性契约：同一种子流 + 同一回号码 → 完全相同的选项。
 *
 * 选项数量 2 或 3 各半：3 选信息量更大；2 选让"偏好项缺席"更常见，
 * AI 与人类的取舍才有张力。
 */
export function rollAdventureOffer(round: number, rng: Rng): AdventureOffer {
  const kinds = rng.shuffle([...DISPLAY_ORDER]);
  const count = rng.chance(0.5) ? 3 : 2;
  const chosen = kinds.slice(0, count);
  chosen.sort((a, b) => DISPLAY_ORDER.indexOf(a) - DISPLAY_ORDER.indexOf(b));
  return { round, options: chosen.map((kind) => optionFor(kind, round)) };
}

// ── 事件流指纹 ──────────────────────────────────────────

/**
 * FNV-1a 32 位散列的 8 位十六进制指纹（纯同步、零依赖，用于战斗事件流摘要）。
 *
 * 唯一实现收敛在 replay.ts（M4 回放线的契约文件）：M3 记录快照与 M4 校验回放
 * 必须用同一函数，否则摘要口径系统性不符。此处仅再导出，保持原导入路径不变。
 */
export { fnv1aHex } from './replay';
