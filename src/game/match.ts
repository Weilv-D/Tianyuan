/**
 * 对局编排（Match）。
 *
 * 一整局 8 人自走棋的状态机：准备 → 战斗 → 结算 → 淘汰，直到只剩一人。
 *
 * 三条设计契约：
 * 1. **无头可跑** —— 本文件不引用 Phaser / DOM。Node 里可以直接 new Match(seed) 跑完整局，
 *    用于平衡模拟和回归测试。
 * 2. **完全确定** —— 唯一的随机源是 this.rng。同样的 seed + 同样的玩家操作序列 ⇒ 同样的一局。
 * 3. **内核与编排解耦** —— Match 只负责"谁打谁""打完谁掉多少血"，不关心战斗怎么演。
 *    渲染层拿 buildBattleConfig() 去喂 Battle；模拟脚本直接 run()。两边用同一份配置，
 *    所以模拟出来的平衡数据和玩家实际看到的表现是同一件事。
 */

import { Rng } from '../core/rng';
import { Battle } from '../core/battle';
import {
  BENCH_SLOTS,
  MATCH_TUNING,
  MAX_LEVEL,
  PLAYER_START_HP,
  PREP_SECONDS,
  PREP_SECONDS_LATE,
  PREP_LATE_FROM_ROUND,
  REROLL_COST,
  ROUND_BASE_DAMAGE,
  SHOP_SLOTS,
  XP_BUY_AMOUNT,
  XP_BUY_COST,
  XP_PER_ROUND,
} from '../core/config';
import { CHAMPION_BY_ID, CHAMPION_IDS_BY_COST } from '../data/champions';
import { computeTraits } from './comp';
import { gainXp, computeIncome, xpToNext } from './economy';
import { CardPool, rollShop } from './pool';
import { aiTakeTurn, AI_ROSTER, chooseAdventureIndex, makeProfile, type AiWorld } from './ai';
import {
  COMBINED_ITEM_IDS,
  fnv1aHex,
  rollAdventureOffer,
  adventureGold,
  adventureXp,
  adventureComponents,
  adventureReinforceCost,
  reinforceRefund,
  type AdventureOffer,
  type AdventureOption,
} from './adventure';
import type { BattleSnapshot } from './replay';
import { generateBeastBoard, BEAST_NAME } from './beast';
import { addItem, autoEquip, stripItems } from './inventory';
import { COMPONENT_IDS, ITEM_BY_ID } from '../data/items';
import {
  allUnits,
  benchCount,
  boardCap,
  boardColOf,
  boardCount,
  boardIdx,
  boardRowOf,
  bumpIidCounter,
  centerOutColumns,
  cloneBoard,
  createUnit,
  addToBench,
  emptyBench,
  emptyBoard,
  localToGlobalRow,
  resolveMerges,
  sellValue,
  UNIT_DEPTH,
  type PlayerState,
  type Phase,
  type UnitInstance,
} from './state';
import type { ActiveTrait, BattleConfig, BattleResult, BattleUnitInput } from '../core/types';

/** 把一个半场棋盘展开成入场单位。uid 从 1（team 0）或 101（team 1）开始顺序分配。 */
function pushBoard(
  out: BattleUnitInput[],
  board: readonly (UnitInstance | null)[],
  team: 0 | 1
): void {
  let i = 0;
  for (let idx = 0; idx < board.length; idx++) {
    const u = board[idx];
    if (!u) continue;
    out.push({
      uid: team === 0 ? i + 1 : 101 + i,
      defId: u.defId,
      team,
      star: u.star,
      cell: { c: boardColOf(idx), r: localToGlobalRow(team, boardRowOf(idx)) },
      items: u.items.length > 0 ? [...u.items] : undefined,
      monster: u.isBeast ? true : undefined,
      powMult: u.powMult,
    });
    i++;
  }
}

/**
 * 棋盘 → uid 映射。uid 的分配规则必须与 pushBoard 完全一致，
 * 否则结算时"哪个单位活下来了"会对不上号。
 */
export function boardUids(
  board: readonly (UnitInstance | null)[],
  team: 0 | 1
): Map<number, UnitInstance> {
  const out = new Map<number, UnitInstance>();
  let i = 0;
  for (const u of board) {
    if (!u) continue;
    out.set(team === 0 ? i + 1 : 101 + i, u);
    i++;
  }
  return out;
}

export interface Pairing {
  /** 上半场（team 0）的玩家 */
  a: number;
  /** 下半场（team 1）的玩家；-1 表示没有真人对手 */
  b: number;
  /** 墨影对手：沿用该玩家淘汰时的阵容。-1 表示轮空。 */
  ghost: number;
  /**
   * 是否把 pair.a 放到下半场。
   * 玩家永远从下半场观战 —— 这是自走棋不可动摇的视角直觉。
   */
  swap: boolean;
  /** 墨兽轮：所有存活玩家各自单挑同一只墨兽 */
  beast: boolean;
}

export interface RoundOutcome {
  idx: number;
  outcome: 'win' | 'loss' | 'draw' | 'bye';
  damage: number;
  hpAfter: number;
  eliminated: boolean;
  /** 本场掉落的装备（墨兽轮）：组件与成品 ids */
  drops: string[];
  /** 本场掉落的金币（墨兽轮） */
  gold: number;
}

export interface MatchSettings {
  /** 买入棋子后自动上场（有空余人口时）。新手友好默认开，老手可在设置里关掉。 */
  autoDeploy: boolean;
}

/** 买入结果（B3）：失败必带原因，调用方据此提示；不再静默吞卡吞钱 */
export interface BuyResult {
  ok: boolean;
  /** ok=false 时的原因：none=无卡可买；gold=金币不足；bench=备战席满（且无法即合）；pool=卡池不足 */
  reason?: 'none' | 'gold' | 'bench' | 'pool';
}

/** 对局节奏真源：墨兽轮（PvE）恰五次 —— 首回合引导 + 每 6 回合一次，25 轮后纯 PvP 终局 */
export const BEAST_ROUND_SCHEDULE: readonly number[] = [1, 7, 13, 19, 25];
/** 对局节奏真源：奇遇轮恰三次，对准开局 / 中盘 / 后程三段成长弧 */
export const ADVENTURE_ROUND_SCHEDULE: readonly number[] = [4, 10, 16];

/** 单只墨兽的掉落档：全员保底（胜负同发）+ 胜场追加（含成品件数） */
export interface BeastDropTier {
  round: number;
  /** 保底组件数（胜负同发） */
  comp: number;
  /** 保底金币（胜负同发） */
  gold: number;
  /** 胜场追加组件数 */
  winComp: number;
  /** 胜场追加金币 */
  winGold: number;
  /** 胜场追加成品装备数 */
  winCompleted: number;
}

/**
 * 墨兽掉落真源表。下限口径（验收线）：**五轮全败**也有组件 19（= 9.5 件成装当量，
 * 1 成品 = 2 组件）+ 金币 70，高于 9 件 / 60 金的验收线；五轮全胜 27 组件 + 2 成品
 * （= 15.5 件成装当量）+ 96 金。保底对所有玩家无条件发放，胜场追加只多不少。
 */
export const BEAST_DROP_SCHEDULE: readonly BeastDropTier[] = [
  { round: 1, comp: 2, gold: 8, winComp: 0, winGold: 0, winCompleted: 0 },
  { round: 7, comp: 3, gold: 12, winComp: 1, winGold: 4, winCompleted: 0 },
  { round: 13, comp: 4, gold: 14, winComp: 2, winGold: 6, winCompleted: 0 },
  { round: 19, comp: 5, gold: 16, winComp: 2, winGold: 8, winCompleted: 1 },
  { round: 25, comp: 5, gold: 20, winComp: 3, winGold: 10, winCompleted: 1 },
];

export class Match implements AiWorld {
  readonly seed: number;
  rng: Rng;
  pool: CardPool;
  players: PlayerState[];
  round = 0;
  phase: Phase = 'prep';
  pairings: Pairing[] = [];
  /** 玩家的最终名次（0 = 游戏中）。非 AI 玩家的结局写在这里。 */
  humanRank = 0;
  /** 淘汰玩家留下的阵容快照，用于奇数人时的「墨影」对战 */
  private ghosts = new Map<number, (UnitInstance | null)[]>();
  /** 本回合的墨兽阵容（全体玩家面对同一只） */
  private beastBoard: (UnitInstance | null)[] | null = null;
  /** 事件日志，结算面板与调试用 */
  log: string[] = [];
  settings: MatchSettings = { autoDeploy: true };
  /** 对局模式：daily 的种子来自日期哈希，ResultScene 据此记录每日最佳名次 */
  readonly mode: 'normal' | 'daily';
  /**
   * 奇遇轮恩赐选择（M3）：同一回合全员共享同一份 2~3 选 1。
   * 非 null 表示准备阶段待人选择；AI 在 beginRound 内按原型偏好即选，
   * 人类在准备阶段任意时刻点选；进入战斗阶段未选即过期（无惩罚）并清空。
   */
  adventureOffer: AdventureOffer | null = null;
  /** 每场战斗的快照（M4 回放）：种子 + 双方配置 + 结果指纹，随存档持久化 */
  battleSnapshots: BattleSnapshot[] = [];

  constructor(seed: number, humanName = '你', mode: 'normal' | 'daily' = 'normal') {
    this.mode = mode;
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.pool = new CardPool();
    this.players = [];

    // 玩家 0 是人类，1~7 是 AI
    this.players.push(this.blankPlayer(0, humanName, true));
    for (let i = 0; i < AI_ROSTER.length; i++) {
      const entry = AI_ROSTER[i];
      const p = this.blankPlayer(i + 1, entry.name, false);
      p.ai = makeProfile(entry.arch);
      this.players.push(p);
    }
    this.log.push('对局开始 · 八方入场');
  }

  private blankPlayer(idx: number, name: string, isHuman: boolean): PlayerState {
    return {
      idx,
      name,
      isHuman,
      hp: PLAYER_START_HP,
      gold: 2,
      level: 2,
      xp: 0,
      streak: 0,
      bestStreak: 0,
      board: emptyBoard(),
      bench: emptyBench(),
      items: [],
      shop: new Array(SHOP_SLOTS).fill(null),
      shopLocked: false,
      alive: true,
      rank: 0,
      opponents: [],
      wins: 0,
      losses: 0,
      ai: null,
      lastOutcome: null,
      lastDamage: 0,
      totalDamage: 0,
    };
  }

  // ── 查询 ──────────────────────────────────────────────

  get human(): PlayerState {
    return this.players[0];
  }

  alivePlayers(): PlayerState[] {
    return this.players.filter((p) => p.alive);
  }

  aliveCount(): number {
    return this.alivePlayers().length;
  }

  isOver(): boolean {
    return this.aliveCount() <= 1;
  }

  /** 当前排名（用于计分板排序），第 1 名在最前 */
  standings(): PlayerState[] {
    return [...this.players].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      // 已淘汰者名次数字越小越靠前（2 名优于 8 名），升序排列
      if (!a.alive) return (a.rank || 99) - (b.rank || 99);
      if (a.hp !== b.hp) return b.hp - a.hp;
      if (a.level !== b.level) return b.level - a.level;
      return a.idx - b.idx;
    });
  }

  prepSeconds(): number {
    return this.round >= PREP_LATE_FROM_ROUND ? PREP_SECONDS_LATE : PREP_SECONDS;
  }

  /**
   * 读档时是否需要先推进回合（A2：防回合二次结算）。
   *
   * phase='result' 的存档是「战斗结算已落盘、下一回合尚未开始」的中间态：
   * 直接进备战而不推进，同一回合会被 makePairings + applyBattleResult
   * 再结算一遍（双倍掉血、重复淘汰、重复快照）。必须先 beginRound()。
   */
  needsAdvanceOnLoad(): boolean {
    return this.phase === 'result';
  }

  /**
   * 墨兽轮（PvE）：1 / 7 / 13 / 19 / 25，全场恰五次。
   * 第 1 回合是引导轮 —— 人人只有一两个棋子也能打过（攻击力削到 15%），
   * 装备来源从第一轮就建立；此后每 6 回合一次，第 25 轮是最后一只，
   * 其后的纯 PvP 终局不再插入 PvE。
   */
  isBeastRound(round = this.round): boolean {
    return BEAST_ROUND_SCHEDULE.includes(round);
  }

  /**
   * 是否为奇遇轮（PvE 恩赐）：4 / 10 / 16，全场恰三次，
   * 对准开局 / 中盘 / 后程三段成长弧各一次（档位见 adventure.adventureStage）。
   */
  isAdventureRound(round = this.round): boolean {
    return ADVENTURE_ROUND_SCHEDULE.includes(round);
  }

  /** 人类玩家点选奇遇恩赐（index 对应 adventureOffer.options 下标；每回合至多一次） */
  resolveAdventure(index: number): void {
    const offer = this.adventureOffer;
    if (!offer) return; // 已过期（战斗阶段开始被清空）或本回合非奇遇轮：无可选恩赐
    const opt = offer.options[index];
    if (!opt) return; // 非法下标：不发放、不清空，调用方可重试
    this.grantAdventure(this.human, opt, offer.round);
    this.adventureOffer = null;
  }

  /**
   * 发放一份奇遇恩赐（人类 resolveAdventure 与 AI 即选共用同一入口）。
   *
   * 纪律：只走既有系统入账 —— 金币直接加持有、经验走 gainXp、等级走升级表
   * （顿悟发放恰好升 1 级的经验，满级折当档经验）、装备走 addItem（器匣，
   * 组件与成品、墨兽轮 rollItemDrops 同一发放路径）、援军走 createUnit +
   * 卡池扣除（2★ 占 3 张）+ 备战席入驻。任何入不了账的情况（备战席满 /
   * 卡池余量不足）按棋子卖出价折算金币返还，保证卡与金币守恒。
   */
  private grantAdventure(p: PlayerState, opt: AdventureOption, round: number): void {
    switch (opt.kind) {
      case 'gold': {
        const n = adventureGold(round);
        p.gold += n;
        this.log.push(`${p.name} 奇遇 · 金币 +${n}`);
        break;
      }
      case 'xp': {
        const n = adventureXp(round);
        gainXp(p, n);
        this.log.push(`${p.name} 奇遇 · 经验 +${n}（等级 ${p.level}）`);
        break;
      }
      case 'item': {
        const id = this.rng.pick(COMBINED_ITEM_IDS);
        addItem(p, id);
        this.log.push(`${p.name} 奇遇 · 丹青成装 · ${ITEM_BY_ID[id]?.name ?? id} 入装备栏`);
        break;
      }
      case 'components': {
        const n = adventureComponents(round);
        const names: string[] = [];
        for (let i = 0; i < n; i++) {
          const id = this.rng.pick(COMPONENT_IDS);
          addItem(p, id);
          names.push(ITEM_BY_ID[id]?.name ?? id);
        }
        this.log.push(`${p.name} 奇遇 · 组件 ×${n}（${names.join('、')}）入装备栏`);
        break;
      }
      case 'level': {
        // 走既有升级表：发放恰好升 1 级的经验，经验条不跳变；
        // 满级经验不再入账（economy 口径），按 4 金 = 4 经验折金 —— 与援军折金同一守恒先例
        const need = xpToNext(p.level);
        if (need > 0) {
          gainXp(p, need);
          this.log.push(`${p.name} 奇遇 · 顿悟（等级 ${p.level}）`);
        } else {
          const n = adventureXp(round);
          p.gold += n;
          this.log.push(`${p.name} 奇遇 · 顿悟满级 · 折算金币 +${n}`);
        }
        break;
      }
      case 'reinforce':
        this.grantReinforce(p, round);
        break;
    }
  }

  /** 援军恩赐：2★ 棋子占卡池 3 张入驻备战席；入不了账按卖出价折金返还（守恒） */
  private grantReinforce(p: PlayerState, round: number): void {
    const cost = adventureReinforceCost(round);
    const refund = reinforceRefund(round); // = 2★ 卖出价（state.sellValue 口径）
    if (benchCount(p) >= BENCH_SLOTS) {
      p.gold += refund;
      this.log.push(`${p.name} 奇遇 · 援军备战席已满 · 折算金币 +${refund}`);
      return;
    }
    const candidates = (CHAMPION_IDS_BY_COST[cost] ?? []).filter((id) => this.pool.remaining(id) >= 3);
    if (candidates.length === 0) {
      // 该费用档全池余量不足 3 张：改为折金返还，不凭空造卡
      p.gold += refund;
      this.log.push(`${p.name} 奇遇 · 援军卡池余量不足 · 折算金币 +${refund}`);
      return;
    }
    const id = this.rng.pick(candidates);
    for (let i = 0; i < 3; i++) this.pool.take(id);
    const u = createUnit(id, 2);
    const slot = addToBench(p, u);
    if (slot < 0) {
      // 理论不可达（上方已检查备战席有空位），防御性兜底：卡回池、折金返还
      this.pool.giveUnit(id, 2);
      p.gold += refund;
      this.log.push(`${p.name} 奇遇 · 援军备战席已满 · 折算金币 +${refund}`);
      return;
    }
    const merges = resolveMerges(p);
    this.log.push(`${p.name} 奇遇 · 援军 ${CHAMPION_BY_ID[id]?.name ?? id} 2★ 入驻备战席`);
    for (const m of merges) {
      this.log.push(`${p.name} 合成 ${CHAMPION_BY_ID[m.defId]?.name ?? m.defId} ${m.star}★`);
    }
  }

  /** 展示名：墨兽轮显示「墨兽」而不是玩家名 */
  displayNameOfTeam(pair: Pairing, team: 0 | 1): string {
    const idx = this.playerIdxOfTeam(pair, team);
    if (pair.beast) return BEAST_NAME;
    if (idx >= 0) return this.players[idx].name;
    if (pair.ghost >= 0) return '墨影';
    return '（轮空）';
  }

  // ── 回合开始 ──────────────────────────────────────────

  /**
   * 进入下一个准备阶段：发钱、涨经验、刷商店、AI 行动。
   * 这一步在渲染层表现为"回合开始"的那一刻。
   */
  beginRound(): void {
    if (this.isOver()) {
      this.phase = 'over';
      return;
    }
    this.round++;
    this.phase = 'prep';

    // 墨兽阵容在回合开始时生成一次，全体玩家面对同一只。
    // 各自 roll 会导致"有人打 Boss 有人打小怪"，那不是 PvE，是抽奖。
    this.beastBoard = this.isBeastRound() ? generateBeastBoard(this.round, this.rng) : null;

    // 奇遇轮（M3）：全员共享同一份恩赐选项。掷点位置固定在墨兽阵容生成之后、
    // 收入结算之前 —— 同一种子的 rng 流 ⇒ 完全相同的 offer（对局层确定性契约）。
    // 非奇遇轮显式置空，清掉任何残留。
    this.adventureOffer = this.isAdventureRound() ? rollAdventureOffer(this.round, this.rng) : null;

    for (const p of this.alivePlayers()) {
      // 1) 结算上一回合的收入（第一回合没有上一回合）
      if (this.round > 1) {
        const won = p.lastOutcome === 'win';
        const inc = computeIncome(p, won, p.lastOutcome === 'bye');
        p.gold += inc.total;
      }
      // 2) 经验
      gainXp(p, XP_PER_ROUND);
      // 3) 商店：锁定只保一回合，用掉即清
      if (p.shopLocked) {
        p.shopLocked = false;
      } else {
        p.shop = rollShop(this.pool, this.rng, p.level);
      }
    }

    // 4) AI 行动。按 index 顺序，保证确定性。
    for (const p of this.alivePlayers()) {
      if (p.isHuman) continue;
      // 奇遇轮：AI 按原型偏好即选即结算，与人类走同一发放函数。
      // 选择是纯函数不消耗 rng；发放（item/reinforce）消耗的 rng 按 index 顺序
      // 固定发生，整局仍完全可复现。人类玩家的 offer 保留至点选或战斗开始。
      if (p.ai && this.adventureOffer) {
        const idx = chooseAdventureIndex(p.ai, this.adventureOffer);
        this.grantAdventure(p, this.adventureOffer.options[idx], this.adventureOffer.round);
      }
      aiTakeTurn(this, p);
    }

    this.log.push(`第 ${this.round} 回合 · 准备 · 存活 ${this.aliveCount()} 人`);
  }

  // ── 玩家动作 ──────────────────────────────────────────

  /**
   * 买入商店第 slot 张（B2/B3：结果类型化 + 满席买入即合）。
   *
   * 满席且持有 ≥2 张同名 1★（其中一张在备战席，作合成材料与落脚凭证）时，
   * 新子临时落到第 10 格溢出位，resolveMerges 把 3 张同名 1★ 并成 2★——
   * 溢出位必然是组内槽位最高的一张、必然被吃掉，合并后裁回 9 格，席位净腾。
   * 两张同名都在场上、席上无同名 victim → 维持拒绝（保守口径：场上配对的
   * 合成重组只在席位充裕的常态路径发生）。任何入不了账的情况整体回滚。
   */
  buy(p: PlayerState, slot: number): BuyResult {
    const id = p.shop[slot];
    if (!id) return { ok: false, reason: 'none' };
    const def = CHAMPION_BY_ID[id];
    if (!def) return { ok: false, reason: 'none' };
    if (p.gold < def.cost) return { ok: false, reason: 'gold' };
    const copies = allUnits(p).filter((u) => u.defId === id && u.star === 1).length;
    const benchFull = benchCount(p) >= BENCH_SLOTS;
    if (benchFull) {
      if (copies < 2) return { ok: false, reason: 'bench' };
      const hasBenchVictim = p.bench.some((u) => u !== null && u.defId === id && u.star === 1);
      if (!hasBenchVictim) return { ok: false, reason: 'bench' };
    }
    // 卡池不足：保留商店格（缺货卡仍显示，点击提示「卡池不足」），不吞卡
    if (!this.pool.take(id)) return { ok: false, reason: 'pool' };
    p.gold -= def.cost;
    p.shop[slot] = null;
    const u = createUnit(id, 1);

    if (benchFull) {
      // 溢出落位：0~8 已满，新子临时占第 10 格；合成吃掉它后裁回 9 格
      p.bench.push(u);
      const merges = resolveMerges(p);
      while (p.bench.length > BENCH_SLOTS && p.bench[p.bench.length - 1] === null) p.bench.pop();
      if (merges.length === 0 || p.bench.length > BENCH_SLOTS) {
        // 防御性兜底（3 张同名在册时合成必发生，理论不可达）：满席被破坏，整体回滚
        p.bench.length = BENCH_SLOTS;
        this.pool.giveUnit(id, 1);
        p.gold += def.cost;
        p.shop[slot] = id;
        return { ok: false, reason: 'bench' };
      }
      this.log.push(`${p.name} 合成 ${CHAMPION_BY_ID[merges[0].defId]?.name ?? merges[0].defId} ${merges[0].star}★（满席即合）`);
      // 合成出的新 2★ 仍在席上则走自动上场（人口有空位且场上无同名时）
      if (this.settings.autoDeploy) {
        const upgraded = p.bench.find((b) => b !== null && b.defId === id && b.star > 1);
        if (upgraded) this.tryAutoDeploy(p, upgraded.iid);
      }
      return { ok: true };
    }

    // 常路径：新子直接落空格；落不下就整体回滚 —— 卡、钱、商店格一项都不能被吞掉
    if (addToBench(p, u) < 0) {
      this.pool.giveUnit(id, 1);
      p.gold += def.cost;
      p.shop[slot] = id;
      return { ok: false, reason: 'bench' };
    }
    const merges = resolveMerges(p);
    if (merges.length > 0) {
      this.log.push(`${p.name} 合成 ${CHAMPION_BY_ID[merges[0].defId]?.name ?? merges[0].defId} ${merges[0].star}★`);
    }
    // 新手友好：人口有空位就自动上场
    if (this.settings.autoDeploy) this.tryAutoDeploy(p, u.iid);
    return { ok: true };
  }

  /** 卖出棋子，按星级返还金币并把卡放回池 */
  sell(p: PlayerState, iid: number): boolean {
    const fromBoard = p.board.findIndex((u) => u !== null && u.iid === iid);
    const fromBench = p.bench.findIndex((u) => u !== null && u.iid === iid);
    const slot = fromBoard >= 0 ? fromBoard : fromBench;
    if (slot < 0) return false;
    const arr = fromBoard >= 0 ? p.board : p.bench;
    const u = arr[slot];
    if (!u) return false;
    arr[slot] = null;
    p.gold += sellValue(u);
    this.pool.giveUnit(u.defId, u.star);
    stripItems(p, u);
    return true;
  }

  /** 刷新商店 */
  reroll(p: PlayerState): boolean {
    if (p.gold < REROLL_COST) return false;
    p.gold -= REROLL_COST;
    p.shop = rollShop(this.pool, this.rng, p.level);
    return true;
  }

  /** 花 4 金买 4 经验 */
  buyExp(p: PlayerState): boolean {
    if (p.level >= MAX_LEVEL) return false;
    if (p.gold < XP_BUY_COST) return false;
    p.gold -= XP_BUY_COST;
    gainXp(p, XP_BUY_AMOUNT);
    return true;
  }

  /** 把备战席棋子放到场上空位（自动布阵 / 买入后上场用） */
  tryAutoDeploy(p: PlayerState, iid: number): boolean {
    if (boardCount(p) >= boardCap(p)) return false;
    const slot = p.bench.findIndex((u) => u !== null && u.iid === iid);
    if (slot < 0) return false;
    const u = p.bench[slot]!;
    // 同名已在场 → 不上。1.7.0 手动拖拽已放开同名（canPlace），
    // 但自动上场保持单张口径：堆场是玩家的战术决定，不该由"买后即上"替新手做；
    // 合成料留在备战席照样参与 resolveMerges。
    if (p.board.some((x) => x !== null && x.defId === u.defId)) return false;
    const target = this.suggestSlot(p, u.defId);
    p.bench[slot] = null;
    p.board[target] = u;
    return true;
  }

  /** 按职业纵深推荐一个空格 */
  suggestSlot(p: PlayerState, defId: string): number {
    const def = CHAMPION_BY_ID[defId];
    const depthRaw = def ? UNIT_DEPTH[def.cls] ?? 0.5 : 0.5;
    const preferredRow = Math.min(3, Math.floor(depthRaw * 4));
    const order = centerOutColumns();
    for (let r = preferredRow; r < 4; r++) {
      for (const c of order) {
        const i = boardIdx(c, r);
        if (!p.board[i]) return i;
      }
    }
    for (let i = 0; i < p.board.length; i++) if (!p.board[i]) return i;
    return 0;
  }

  // ── 配对与战斗 ────────────────────────────────────────

  /**
   * 生成本回合的配对。
   *
   * 规则：随机洗牌后贪心配对，优先避开最近两回合交过手的对手 ——
   * 玩家最烦的事之一，就是连续三轮撞同一个人。
   * 人数为奇数时，落单者与「墨影」（最近一名被淘汰玩家的阵容）交战；
   * 若还没有人被淘汰，则轮空（不掉血也不加连胜）。
   */
  makePairings(): Pairing[] {
    // 战斗阶段开始处（渲染层 startBattlePhase → makePairings）：清空未选的奇遇恩赐。
    // 过期无惩罚 —— 恩赐是馈赠不是任务，漏选不该变成扣血。
    this.adventureOffer = null;
    // 墨兽轮：每个存活玩家各自单挑同一只墨兽，玩家固定在下半场
    if (this.isBeastRound()) {
      return this.alivePlayers().map((p) => ({ a: p.idx, b: -1, ghost: -1, swap: true, beast: true }));
    }
    const alive = this.rng.shuffle(this.alivePlayers().map((p) => p.idx));
    const out: Pairing[] = [];
    const used = new Set<number>();

    for (const a of alive) {
      if (used.has(a)) continue;
      const cands = alive.filter((b) => b !== a && !used.has(b));
      if (cands.length === 0) {
        const ghost = this.pickGhost(a);
        out.push({ a, b: -1, ghost, swap: a === 0, beast: false });
        used.add(a);
        continue;
      }
      const recent = this.players[a].opponents.slice(-2);
      const fresh = cands.filter((b) => !recent.includes(b));
      const b = (fresh.length > 0 ? fresh : cands)[0];
      used.add(a);
      used.add(b);
      // 人类玩家固定打下半场
      out.push({ a, b, ghost: -1, swap: a === 0, beast: false });
      // 记录交手历史
      this.players[a].opponents.push(b);
      this.players[b].opponents.push(a);
    }
    return out;
  }

  /** 取一个墨影对手：最近被淘汰、且有阵容可复用的玩家 */
  private pickGhost(forIdx: number): number {
    const dead = this.players.filter((p) => !p.alive && p.idx !== forIdx);
    if (dead.length === 0) return -1;
    // 取 rank 最大的（最早被淘汰的）反而最弱，取 rank 最小的（最近淘汰的）最有挑战性
    dead.sort((x, y) => (x.rank || 99) - (y.rank || 99));
    for (const d of dead) {
      if (this.ghosts.has(d.idx) && this.ghosts.get(d.idx)!.some((u) => u !== null)) return d.idx;
    }
    return -1;
  }

  /** 记录一个玩家的阵容快照（每回合结束时调用，淘汰后即成为墨影） */
  private snapshot(p: PlayerState): void {
    this.ghosts.set(p.idx, cloneBoard(p.board));
  }

  /**
   * 构造一场战斗的配置。渲染层用它建 Battle 逐步播放；模拟脚本用它直接 run()。
   * 种子由 对局种子 + 回合 + 配对 派生，保证可复现。
   *
   * @param swap 把 pair.a 放到下半场（team 1）。玩家总是从下半场视角观战 ——
   *             "自己人在下面"是自走棋不可动摇的直觉，不该因为配对顺序而翻转。
   */
  buildBattleConfig(pair: Pairing, swap = false): BattleConfig {
    const pa = this.players[pair.a];
    const seed = (this.seed ^ (this.round * 0x9e3779b1) ^ (pair.a * 0x85ebca6b) ^ ((pair.b + 2) * 0xc2b2ae35)) >>> 0;
    const opponentBoard = this.boardOfOpponent(pair);

    const teamA: 0 | 1 = swap ? 1 : 0;
    const teamB: 0 | 1 = swap ? 0 : 1;

    const units: BattleUnitInput[] = [];
    pushBoard(units, pa.board, teamA);
    pushBoard(units, opponentBoard, teamB);

    return {
      seed,
      units,
      traits: {
        [teamA]: this.traitsOf(pa.board),
        [teamB]: this.traitsOf(opponentBoard),
      },
    };
  }

  /** 棋盘 → 激活羁绊列表 */
  traitsOf(board: readonly (UnitInstance | null)[]): ActiveTrait[] {
    const ids: string[] = [];
    for (const u of board) if (u) ids.push(u.defId);
    return computeTraits(ids).map((t) => ({ id: t.id, count: t.count, tier: t.tier }));
  }

  /**
   * 无头跑完一场（模拟脚本与"别人的战斗"用）。
   *
   * recordEvents=true 时额外计算事件流的 FNV-1a 摘要（M4 回放校验用）。
   * 每场战斗结束都会向 battleSnapshots 追加一条快照（round/config/winner/ticks/digest），
   * 记录是**纯观察者**：config 原样引用、不触碰 this.rng，战斗结果与后续 rng 流
   * 完全不受影响 —— 这是对局层确定性契约的一部分。
   */
  runBattleHeadless(pair: Pairing, swap = pair.swap, recordEvents = false): BattleResult {
    const config = this.buildBattleConfig(pair, swap);
    const battle = new Battle(config, null, recordEvents);
    const result = battle.run();
    this.battleSnapshots.push({
      round: this.round,
      config,
      winner: result.winner as 0 | 1 | null,
      ticks: result.ticks,
      eventsDigest: recordEvents ? fnv1aHex(JSON.stringify(battle.events)) : '',
    });
    return result;
  }

  // ── 结算 ──────────────────────────────────────────────

  /**
   * 败方应受的伤害 = 阶段基础伤害 + 胜方每个**存活**单位的追加伤害。
   * 只算存活单位，是因为"我用三个人换掉你五个，最后只剩一个残血"应该算是打赢了。
   * 第 1 回合例外归零：引导轮的墨兽攻击力已削到 15%，掉血再归零 ——
   * 首战的全部意义是装备教学与节奏体验，不构成任何淘汰威胁。
   */
  damageOf(result: BattleResult, winnerTeam: 0 | 1, winnerBoard: readonly (UnitInstance | null)[]): number {
    if (this.round === 1) return 0;
    const baseCurve = ROUND_BASE_DAMAGE[Math.min(this.round, ROUND_BASE_DAMAGE.length - 1)];
    // 后期处决曲线放缓：round ≥ lateDamageCurveFromRound 的 base 段乘该系数，
    // 存活追加伤害（extra）不受影响 —— 只放缓"阶段处决"，不动"打赢余威"。
    const lateScale =
      this.round >= MATCH_TUNING.lateDamageCurveFromRound ? MATCH_TUNING.lateDamageCurveScale : 1;
    const uids = boardUids(winnerBoard, winnerTeam);
    let extra = 0;
    for (const uid of result.survivors[winnerTeam] ?? []) {
      const u = uids.get(uid);
      if (!u) continue;
      extra += MATCH_TUNING.damagePerSurvivor + (u.star - 1) * MATCH_TUNING.damagePerStar;
    }
    // 至少 1 点：0 伤害的败北会让玩家觉得"白打了"
    return Math.max(1, Math.round((baseCurve * lateScale + extra) * MATCH_TUNING.playerDamageScale));
  }

  /**
   * 结算一场战斗：更新连胜连败、扣血、判定淘汰。
   *
   * 契约：同一 Pairing 只得结算一次 —— 二次结算即双倍掉血/重复掉落。
   * 批量路径走 settleRound（结算后清空 pairings 防重入）；淘汰快进走
   * GameScene.fastForward 的逐场循环（配对现生成现消费）。渲染层永远
   * 不直接调用本方法改写结果。
   *
   * @returns 双方的结果描述
   */
  applyBattleResult(pair: Pairing, result: BattleResult): RoundOutcome[] {
    const pa = this.players[pair.a];
    const opponentBoard = this.boardOfOpponent(pair);
    const out: RoundOutcome[] = [];

    // 轮空：不掉血，但不给连胜奖励（否则轮空太划算）。
    // 连胜/连败计数保留不动（不视作胜也不视作败，TFT 同类口径）——
    // 3 连胜 → 轮空 → 再胜仍按 4 连胜计；当轮的连胜金由 computeIncome
    // 的 skipStreak 压为 0（轮空当轮不发，计数跨轮空延续）。
    // 注意必须排除墨兽轮 —— 墨兽配对的 b 与 ghost 同样是 -1，
    // 不排除的话它会在这里被当成轮空提前返回，既不掉血也不掉装备。
    if (!pair.beast && pair.b < 0 && pair.ghost < 0) {
      pa.lastOutcome = 'bye';
      pa.lastDamage = 0;
      out.push({ idx: pa.idx, outcome: 'bye', damage: 0, hpAfter: pa.hp, eliminated: false, drops: [], gold: 0 });
      return out;
    }

    if (result.winner === null) {
      // 同归于尽：双方都不掉血，连胜连败清零
      pa.lastOutcome = 'draw';
      pa.streak = 0;
      pa.lastDamage = 0;
      out.push({ idx: pa.idx, outcome: 'draw', damage: 0, hpAfter: pa.hp, eliminated: false, drops: [], gold: 0 });
      if (pair.b >= 0) {
        const pb = this.players[pair.b];
        pb.lastOutcome = 'draw';
        pb.streak = 0;
        pb.lastDamage = 0;
        out.push({ idx: pb.idx, outcome: 'draw', damage: 0, hpAfter: pb.hp, eliminated: false, drops: [], gold: 0 });
      }
      return out;
    }

    // pair.a 在 swap 时位于 team 1，所以"a 是否获胜"要按交换后的队号判断
    const aTeam: 0 | 1 = pair.swap ? 1 : 0;
    const aWon = result.winner === aTeam;
    const winnerTeam = result.winner as 0 | 1;
    const dmg = this.damageOf(result, winnerTeam, aWon ? pa.board : opponentBoard);

    if (aWon) {
      this.applyWin(pa, out, pair.beast);
    }
    // 墨影战：赢了没人可掉血；输了照样掉血（否则墨影战 = 免费轮空）
    if (pair.b >= 0) {
      const pb = this.players[pair.b];
      if (aWon) this.applyLoss(pb, dmg, out, pa);
      else this.applyWin(pb, out);
      // 败方的 applyLoss 会把伤害记到胜者名下，这里不要再累加一次
    }
    if (!aWon) this.applyLoss(pa, dmg, out, pair.b >= 0 ? this.players[pair.b] : null, pair.beast);

    return out;
  }

  private applyWin(p: PlayerState, out: RoundOutcome[], beast = false): void {
    p.wins++;
    p.lastOutcome = 'win';
    p.lastDamage = 0;
    this.applyStreak(p, true);
    const drop = beast ? this.rollItemDrops(p, true) : { items: [], gold: 0 };
    out.push({ idx: p.idx, outcome: 'win', damage: 0, hpAfter: p.hp, eliminated: false, drops: drop.items, gold: drop.gold });
  }

  private applyLoss(
    p: PlayerState,
    dmg: number,
    out: RoundOutcome[],
    winner: PlayerState | null,
    beast = false
  ): void {
    p.losses++;
    p.lastOutcome = 'loss';
    p.lastDamage = dmg;
    p.hp = Math.max(0, p.hp - dmg);
    this.applyStreak(p, false);
    if (winner) winner.totalDamage += dmg;
    const dead = p.hp <= 0 && p.alive;
    if (dead) this.eliminate(p);
    // 墨兽轮败野按真源表保底发放（下限口径：全败也过 9 件成装 + 60 金验收线）
    const drop = beast ? this.rollItemDrops(p, false) : { items: [], gold: 0 };
    out.push({ idx: p.idx, outcome: 'loss', damage: dmg, hpAfter: p.hp, eliminated: dead, drops: drop.items, gold: drop.gold });
  }

  boardOfOpponent(pair: Pairing): readonly (UnitInstance | null)[] {
    if (pair.beast) return this.beastBoard ?? emptyBoard();
    return pair.b >= 0 ? this.players[pair.b].board : (this.ghosts.get(pair.ghost) ?? emptyBoard());
  }

  /** 某个队伍对应的玩家序号。-1 = 墨影（已淘汰玩家的残影） */
  playerIdxOfTeam(pair: Pairing, team: 0 | 1): number {
    const teamOfA: 0 | 1 = pair.swap ? 1 : 0;
    if (team === teamOfA) return pair.a;
    return pair.b; // 可能是 -1（墨影 / 轮空）
  }


  /**
   * 墨兽轮掉落：按 BEAST_DROP_SCHEDULE 真源表发放。
   *
   * 结构 = 全员保底（胜负同发）+ 胜场追加：败野的量就是验收下限本身 ——
   * 全败也稳拿 9.5 件成装当量（1 成品 = 2 组件）+ 70 金，"至少 9 件 / 60 金"
   * 由表结构保证而不是由胜率期望保证；胜场只多不少，19/25 轮胜场另含成品。
   * 这不是仁慈，是防雪崩：装备差距一旦在早期拉开，弱势玩家会连输到
   * 再也拿不到装备，对局在中段就提前结束。
   *
   * 发放不设器匣上限（裁决 2026-09-01）：与 stripItems 同一守恒口径 ——
   * 装备只进不出，超过版面格数的部分不可见但仍入存档；卸装侧的容量守卫见
   * inventory.unequipAll（玩家主动卸装才严守 ITEM_BAR_SLOTS）。
   *
   * @returns 实发明细（组件/成品 ids 与金币数），调用方写入 RoundOutcome 供战报呈现
   */
  private rollItemDrops(p: PlayerState, won: boolean): { items: string[]; gold: number } {
    const tier =
      BEAST_DROP_SCHEDULE.find((t) => t.round === this.round) ??
      (this.round < BEAST_DROP_SCHEDULE[0].round ? BEAST_DROP_SCHEDULE[0] : BEAST_DROP_SCHEDULE[BEAST_DROP_SCHEDULE.length - 1]);
    const comp = tier.comp + (won ? tier.winComp : 0);
    const items: string[] = [];
    for (let i = 0; i < comp; i++) {
      const id = this.rng.pick(COMPONENT_IDS);
      addItem(p, id);
      items.push(id);
    }
    if (won) {
      for (let i = 0; i < tier.winCompleted; i++) {
        const id = this.rng.pick(COMBINED_ITEM_IDS);
        addItem(p, id);
        items.push(id);
      }
    }
    const gold = tier.gold + (won ? tier.winGold : 0);
    p.gold += gold;
    return { items, gold };
  }

  /** AI 分配装备：把装备栏里的东西装到最合适的棋子上 */
  equipItemsFor(p: PlayerState): void {
    autoEquip(p);
  }

  private applyStreak(p: PlayerState, won: boolean): void {
    if (won) {
      p.streak = p.streak > 0 ? p.streak + 1 : 1;
      if (p.streak > p.bestStreak) p.bestStreak = p.streak;
    } else {
      p.streak = p.streak < 0 ? p.streak - 1 : -1;
    }
  }

  private eliminate(p: PlayerState): void {
    this.snapshot(p);
    p.alive = false;
    // 淘汰名次 = 淘汰瞬间还活着的人数（含自己）
    p.rank = this.aliveCount() + 1;
    // 阵容回池：让玩家能感觉到"某某死了，他的牌回到池子里了"
    for (const u of allUnits(p)) {
      stripItems(p, u);
      this.pool.giveUnit(u.defId, u.star);
    }
    p.board = emptyBoard();
    p.bench = emptyBench();
    if (p.isHuman) this.humanRank = p.rank;
    this.log.push(`${p.name} 被淘汰 · 第 ${p.rank} 名`);
  }

  /**
   * 结算本回合全部战斗（A3：结算顺序确定性）。
   *
   * 按 this.pairings（makePairings 的产出顺序）逐对 runBattleHeadless +
   * applyBattleResult —— 人类场包含在内，快照由 runBattleHeadless 在正确的
   * rng 位置记录（digest 走 '' 口径）。渲染层与无头模拟共用此顺序，
   * 墨兽轮掉落消费 this.rng 的次序两侧逐位一致（对局层确定性契约）。
   *
   * 前置：本回合已 makePairings 且写入 this.pairings（渲染层 startBattlePhase
   * 与模拟脚本都这么做）；结算后清空，防止同一份配对被二次消费。
   *
   * @returns 每场战斗的 RoundOutcome（与 this.pairings 顺序一一对应）
   */
  settleRound(): RoundOutcome[][] {
    const outs: RoundOutcome[][] = [];
    for (const pair of this.pairings) {
      outs.push(this.applyBattleResult(pair, this.runBattleHeadless(pair)));
    }
    this.pairings = [];
    return outs;
  }

  /** 每回合战斗全部结束后调用：快照阵容、推进阶段、判定游戏结束 */
  endRound(): void {
    for (const p of this.alivePlayers()) this.snapshot(p);
    if (this.isOver()) {
      this.phase = 'over';
      const last = this.alivePlayers()[0];
      if (last) {
        last.rank = 1;
        if (last.isHuman) this.humanRank = 1;
        this.log.push(`${last.name} 获得胜利 · 第 1 名`);
      }
    } else {
      this.phase = 'result';
    }
  }

  // ── 存档 ──────────────────────────────────────────────

  toJSON(): {
    seed: number;
    rngState: number;
    round: number;
    phase: Phase;
    pool: Record<string, number>;
    players: PlayerState[];
    ghosts: [number, (UnitInstance | null)[]][];
    /** 本回合的墨兽阵容 —— 不入存档的话，墨兽回合读档会变成打空场 */
    beastBoard: (UnitInstance | null)[] | null;
    settings: MatchSettings;
    mode: 'normal' | 'daily';
    battleSnapshots: BattleSnapshot[];
    adventureOffer: AdventureOffer | null;
    /** 人类玩家最终名次（淘汰时写入）；旧档缺省 0 = 未定名次 */
    humanRank: number;
  } {
    return {
      seed: this.seed,
      rngState: this.rng.state,
      round: this.round,
      phase: this.phase,
      pool: this.pool.snapshot(),
      players: this.players,
      ghosts: [...this.ghosts.entries()],
      beastBoard: this.beastBoard ? cloneBoard(this.beastBoard) : null,
      settings: this.settings,
      mode: this.mode,
      battleSnapshots: [...this.battleSnapshots],
      adventureOffer: this.adventureOffer,
      humanRank: this.humanRank,
    };
  }

  static fromJSON(data: ReturnType<Match['toJSON']>): Match {
    const m = new Match(data.seed, '你', data.mode ?? 'normal');
    m.rng.state = data.rngState;
    m.round = data.round;
    m.phase = data.phase;
    m.pool.restore(data.pool);
    m.players = data.players;
    m.ghosts = new Map(data.ghosts);
    m.beastBoard = data.beastBoard ? cloneBoard(data.beastBoard) : null;
    m.settings = data.settings ?? { autoDeploy: true };
    m.battleSnapshots = data.battleSnapshots ?? [];
    m.adventureOffer = data.adventureOffer ?? null;
    m.humanRank = data.humanRank ?? 0;
    // iid 计数器必须扫到所有存活引用（含墨影快照与墨兽阵容），
    // 否则读档后 createUnit 可能发出重复 iid，拖拽与视图绑定会串单位
    let maxIid = 0;
    for (const p of m.players) {
      for (const u of allUnits(p)) if (u.iid > maxIid) maxIid = u.iid;
    }
    for (const [, board] of m.ghosts) {
      for (const u of board) if (u && u.iid > maxIid) maxIid = u.iid;
    }
    if (m.beastBoard) {
      for (const u of m.beastBoard) if (u && u.iid > maxIid) maxIid = u.iid;
    }
    bumpIidCounter(maxIid);
    return m;
  }
}
