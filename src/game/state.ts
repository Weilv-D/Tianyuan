/**
 * 对局状态核心。
 *
 * 这里定义"一整局游戏"的全部可变数据 —— 8 名玩家、棋盘、备战席、商店、卡池。
 * 这一层是纯数据 + 纯函数，**不引用任何 Phaser / DOM**，因此可以在 Node 里无头跑完整局，
 * 用来做平衡模拟与回归测试。渲染层只读它、只通过明确的动作函数改它。
 *
 * 设计契约：
 * 1. 所有随机必须来自 Match 持有的那个 Rng，禁止 Math.random()。
 * 2. 同名棋子允许同时上场；羁绊按拥有该棋子唯一计数，同名堆场不重复叠羁绊。
 *    这是一条刻意的简化：它让羁绊计数与自动站位都不需要处理"同 id 多实例"的歧义，
 *    带来的代价（少了一种堆叠玩法）远小于收益。
 */

import { BENCH_SLOTS, BOARD_COLS, LEGEND_T3, ROWS_PER_SIDE } from '../core/config';
import { CHAMPION_BY_ID } from '../data/champions';
import type { Star } from '../core/types';
import type { AdventureKind } from './adventure';

/** 己方半场格子数（4 行 × 8 列） */
export const BOARD_CELLS = BOARD_COLS * ROWS_PER_SIDE;

/** 对局阶段 */
export type Phase = 'prep' | 'battle' | 'result' | 'over';

/** 场上的一个棋子实例 */
export interface UnitInstance {
  /** 实例 id，全局唯一，仅用于拖拽与视图绑定 */
  iid: number;
  defId: string;
  star: Star;
  /** 已装备的装备 id 列表，最多 3 件 */
  items: string[];
  /** 墨兽（PvE 单位）。渲染层据此换用墨色剪影。 */
  isBeast?: boolean;
  /** 攻击力倍率（乘在星级倍率之后、装备加成之前）。引导轮墨兽 0.15，缺省 1。 */
  powMult?: number;
}

/** AI 性格原型 */
export type AiArchetype = 'aggro' | 'econ' | 'balanced' | 'hyperroll' | 'greedy';

export interface AiProfile {
  arch: AiArchetype;
  /** 性格称号，展示在计分板上，让对手"像个人" */
  label: string;
  /** 搜牌时愿意保留的金币下限 */
  rollFloor: number;
  /** 搜牌激进度 0~1，越高越舍得刷新 */
  aggression: number;
  /** 优先追逐的羁绊 id */
  preferred: string[];
  /** 等级推进速度倍率，1 = 标准 */
  levelPace: number;
  /**
   * 等级上限。
   * 赌狗流（hyperroll）的全部意义是"停在低人口把低费牌搜穿"，所以它必须有一个封顶等级 ——
   * 没有 cap 它就会一路升到 9 级，既搜不到三星又打不过正经阵容，
   * 在玩家眼里就成了"这个对手一直在送"。
   */
  levelCap: number;
  /**
   * 对"三合成"的额外偏好倍率。
   * 赌狗流靠这个成为三星猎人 —— 它和别的性格的区别是"愿意为凑三星多付钱"，
   * 而不是"自废人口"。后者在这个游戏里等于送分，因为上场人数 = 等级。
   */
  mergeBias: number;
  /** 决策噪声 0~1。越大越"手滑"，偶尔会做出次优选择 —— 这是"人味"的来源 */
  noise: number;
  /**
   * 奇遇恩赐偏好序（M3）。奇遇轮 AI 按此序取第一个 offer 里存在的 kind；
   * 一个都不在时取 offer 的第一个选项。选择是纯函数、不消耗 rng ——
   * 同种子同局面必同选择，这是对局层确定性契约的一部分。
   */
  adventurePref: AdventureKind[];
}

export interface PlayerState {
  idx: number;
  name: string;
  isHuman: boolean;
  hp: number;
  gold: number;
  level: number;
  xp: number;
  /** 正 = 连胜，负 = 连败 */
  streak: number;
  /** 历史最佳连胜（结算展示用） */
  bestStreak: number;
  /** 己方半场，索引 = localRow * 8 + col，localRow 0 = 最靠近中线的前排 */
  board: (UnitInstance | null)[];
  /** 备战席 */
  bench: (UnitInstance | null)[];
  /** 装备栏：尚未装配到棋子身上的组件与成品 */
  items: string[];
  /** 商店 5 个卡位，存棋子 id */
  shop: (string | null)[];
  shopLocked: boolean;
  alive: boolean;
  /** 最终名次，0 = 尚未定名次 */
  rank: number;
  /** 最近交手过的对手（越靠后越近），用于配对时回避重复 */
  opponents: number[];
  wins: number;
  losses: number;
  ai: AiProfile | null;
  /** 本回合结果（结算面板用） */
  lastOutcome: 'win' | 'loss' | 'draw' | 'bye' | null;
  lastDamage: number;
  /** 累计造成的伤害；仅胜局结算时累加（结算面板展示为「胜局累计输出」） */
  totalDamage: number;
}

// ── 棋盘索引 ────────────────────────────────────────────

/** 本地行（0=前排）→ 全局 8×8 棋盘行号 */
export function localToGlobalRow(team: 0 | 1, localRow: number): number {
  return team === 0 ? ROWS_PER_SIDE - 1 - localRow : ROWS_PER_SIDE + localRow;
}

/** 全局行号 → 本地行。不属于该半场时返回 -1 */
export function globalToLocalRow(team: 0 | 1, globalRow: number): number {
  if (team === 0) return globalRow >= 0 && globalRow < ROWS_PER_SIDE ? ROWS_PER_SIDE - 1 - globalRow : -1;
  return globalRow >= ROWS_PER_SIDE && globalRow < ROWS_PER_SIDE * 2 ? globalRow - ROWS_PER_SIDE : -1;
}

export function boardIdx(col: number, localRow: number): number {
  return localRow * BOARD_COLS + col;
}

/**
 * 由中心向两侧的列填充顺序（如 8 列 → [3,4,2,5,1,6,0,7]），保证阵型对称。
 *
 * 全项目唯一实现：此前 match/comp/arrange 三处各自用
 * `Math.round(3.5 ± Math.ceil(i/2))` 拼这个序列，`.5` 恒向上取整导致
 * 序列变成 [4,5,3,6,2,7,1,8] —— 越位列 8 混入、列 0 永久缺席
 * （suggestSlot 甚至会把棋子写进 board[32] 而凭空丢子）。
 */
/** 职业纵深：0 = 最前排，1 = 最后排（autoPlace / arrange / suggestSlot 单一真源） */
export const UNIT_DEPTH: Record<string, number> = {
  guardian: 0,
  warrior: 0.12,
  assassin: 0.95,
  marksman: 0.72,
  mage: 0.78,
  warlock: 0.6,
  support: 0.88,
};

export function centerOutColumns(): number[] {
  const out: number[] = [];
  const mid = Math.floor(BOARD_COLS / 2) - 1;
  for (let i = 0; i < BOARD_COLS; i++) {
    // 从中列向左/右交替展开：8 列 → [3,4,2,5,1,6,0,7]
    out.push(i % 2 === 0 ? mid - i / 2 : mid + (i + 1) / 2);
  }
  return out;
}

export function boardColOf(i: number): number {
  return i % BOARD_COLS;
}

export function boardRowOf(i: number): number {
  return Math.floor(i / BOARD_COLS);
}

// ── 查询 ────────────────────────────────────────────────

export function boardUnits(p: PlayerState): UnitInstance[] {
  const out: UnitInstance[] = [];
  for (const u of p.board) if (u) out.push(u);
  return out;
}

export function boardCount(p: PlayerState): number {
  let n = 0;
  for (const u of p.board) if (u) n++;
  return n;
}

export function benchUnits(p: PlayerState): UnitInstance[] {
  const out: UnitInstance[] = [];
  for (const u of p.bench) if (u) out.push(u);
  return out;
}

export function benchCount(p: PlayerState): number {
  let n = 0;
  for (const u of p.bench) if (u) n++;
  return n;
}

export function allUnits(p: PlayerState): UnitInstance[] {
  return [...boardUnits(p), ...benchUnits(p)];
}

/** 上场人口上限 = 等级 */
export function boardCap(p: PlayerState): number {
  return p.level;
}

/** 卖出返还。2★ = 三张 1★ 的价值 - 1，鼓励"合成即锁定价值" */
export function sellValue(u: UnitInstance): number {
  const def = CHAMPION_BY_ID[u.defId];
  if (!def) return 0;
  const cost = def.cost;
  if (u.star === 1) return cost;
  if (u.star === 2) return cost * 3 - 1;
  return cost * 9 - 1;
}

/** 棋子"战力估值"，用于 AI 选谁上场、卖谁。粗粒度即可，不需要精确。 */
export function powerScore(u: UnitInstance): number {
  const def = CHAMPION_BY_ID[u.defId];
  if (!def) return 0;
  const s = u.star;
  // 3★ 五费·天命：估值与 core/config.LEGEND_T3 同源——不乘的话 AI 对天命
  // 低估约三成，搜牌/追三的欲望被系统性压价（AI 不会贱卖它，但会少追它）
  const legend = def.cost === 5 && s === 3;
  const hpM = legend ? LEGEND_T3.hpMult : 1;
  const powM = legend ? LEGEND_T3.powerMult : 1;
  const hp = def.base.hp * (s === 1 ? 1 : s === 2 ? 1.8 : 3.24) * hpM;
  const atk = def.base.atk * (s === 1 ? 1 : s === 2 ? 1.45 : 2.1) * powM;
  const sp = def.base.sp * (s === 1 ? 1 : s === 2 ? 1.45 : 2.1) * powM;
  // 生命按 0.35 折算成"战力"，避免纯肉棋子在估值里虚高
  return hp * 0.012 + atk * 1.0 + sp * 0.8 + (def.base.range >= 3 ? 4 : 0) + s * 6
    // 机制包（25% 开战盾 + 15% 全能吸血 + 免控）的粗估常量
    + (legend ? 60 : 0);
}

// ── 增删 ────────────────────────────────────────────────

let nextIid = 1;
export function newIid(): number {
  return nextIid++;
}
/** 读档后需要把计数器推到安全位置 */
export function bumpIidCounter(v: number): void {
  if (v >= nextIid) nextIid = v + 1;
}

export function createUnit(defId: string, star: Star = 1): UnitInstance {
  return { iid: newIid(), defId, star, items: [] };
}

/** 放入备战席第一个空位。成功返回索引，满返回 -1 */
export function addToBench(p: PlayerState, u: UnitInstance): number {
  for (let i = 0; i < BENCH_SLOTS; i++) {
    if (!p.bench[i]) {
      p.bench[i] = u;
      return i;
    }
  }
  return -1;
}

export function removeUnit(p: PlayerState, iid: number): UnitInstance | null {
  for (let i = 0; i < p.board.length; i++) {
    if (p.board[i] && p.board[i]!.iid === iid) {
      const u = p.board[i];
      p.board[i] = null;
      return u;
    }
  }
  for (let i = 0; i < p.bench.length; i++) {
    if (p.bench[i] && p.bench[i]!.iid === iid) {
      const u = p.bench[i];
      p.bench[i] = null;
      return u;
    }
  }
  return null;
}

export function findUnit(p: PlayerState, iid: number): UnitInstance | null {
  for (const u of p.board) if (u && u.iid === iid) return u;
  for (const u of p.bench) if (u && u.iid === iid) return u;
  return null;
}

// ── 三合成升星 ──────────────────────────────────────────

export interface MergeEvent {
  defId: string;
  star: Star;
  /** 合成发生在场上（true）还是备战席（false） */
  onBoard: boolean;
}

/**
 * 检查并执行所有可能的三合成，支持级联（3 个 2★ → 1 个 3★）。
 *
 * 移除优先级：优先吃掉备战席的同名棋子，保留场上战力。
 * 合成落点：若参与合成的三张里有场上的，落在场上那张的位置；否则落在备战席那张的位置。
 */
export function resolveMerges(p: PlayerState): MergeEvent[] {
  const events: MergeEvent[] = [];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 32) {
    changed = false;
    // 统计 (defId, star) → 所有实例的位置
    const groups = new Map<string, { iid: number; star: Star; where: 'board' | 'bench'; slot: number }[]>();
    for (let i = 0; i < p.board.length; i++) {
      const u = p.board[i];
      if (!u || u.star >= 3) continue;
      const k = `${u.defId}#${u.star}`;
      const g = groups.get(k) ?? [];
      g.push({ iid: u.iid, star: u.star, where: 'board', slot: i });
      groups.set(k, g);
    }
    for (let i = 0; i < p.bench.length; i++) {
      const u = p.bench[i];
      if (!u || u.star >= 3) continue;
      const k = `${u.defId}#${u.star}`;
      const g = groups.get(k) ?? [];
      g.push({ iid: u.iid, star: u.star, where: 'bench', slot: i });
      groups.set(k, g);
    }

    for (const [key, list] of groups) {
      if (list.length < 3) continue;
      const defId = key.slice(0, key.lastIndexOf('#'));
      const star = list[0].star as Star;
      // 排序：场上的排前面（保住场上位置），同位置按 slot 稳定
      list.sort((a, b) => (a.where === b.where ? a.slot - b.slot : a.where === 'board' ? -1 : 1));
      const keep = list[0];
      const eat = list.slice(1, 3);
      // 被吃掉的两张：身上的装备先退回器匣 —— 装备是玩家资产，合成不是回收站
      for (const e of eat) {
        const eaten = e.where === 'board' ? p.board[e.slot] : p.bench[e.slot];
        if (eaten) for (const it of eaten.items) p.items.push(it);
        if (e.where === 'board') p.board[e.slot] = null;
        else p.bench[e.slot] = null;
      }
      const keepUnit = keep.where === 'board' ? p.board[keep.slot]! : p.bench[keep.slot]!;
      const merged: UnitInstance = {
        iid: keep.iid,
        defId,
        star: (star + 1) as Star,
        items: [...keepUnit.items], // 留在场上的那张：装备原样保留（拷贝，避免与被弃实例共享数组引用）
      };
      if (keep.where === 'board') {
        p.board[keep.slot] = merged;
      } else {
        p.bench[keep.slot] = merged;
      }
      events.push({ defId, star: merged.star, onBoard: keep.where === 'board' });
      changed = true;
      break; // 重新扫描，保证级联按正确顺序发生
    }
  }
  return events;
}

// ── 上场 / 下场 ─────────────────────────────────────────

/** 把场上棋子收回备战席。备战席满则返回 false。 */
export function recallUnit(p: PlayerState, iid: number): boolean {
  const slot = p.board.findIndex((x) => x !== null && x.iid === iid);
  if (slot < 0) return false;
  const u = p.board[slot]!;
  const benchSlot = p.bench.findIndex((x) => x === null);
  if (benchSlot < 0) return false;
  p.board[slot] = null;
  p.bench[benchSlot] = u;
  return true;
}

/** 在场上内部移动（拖拽换站位） */
export function moveOnBoard(p: PlayerState, iid: number, slot: number): boolean {
  const from = p.board.findIndex((x) => x !== null && x.iid === iid);
  if (from < 0) return false;
  if (from === slot) return false;
  const tmp = p.board[slot];
  p.board[slot] = p.board[from];
  p.board[from] = tmp;
  return true;
}

/** 备战席内部移动 */
export function moveOnBench(p: PlayerState, iid: number, slot: number): boolean {
  const from = p.bench.findIndex((x) => x !== null && x.iid === iid);
  if (from < 0) return false;
  if (from === slot) return false;
  const tmp = p.bench[slot];
  p.bench[slot] = p.bench[from];
  p.bench[from] = tmp;
  return true;
}

/**
 * 把棋子移动到任意槽位（棋盘 ↔ 备战席，或各自内部），目标格有人则两者交换。
 *
 * 这是拖拽的唯一落点操作 —— 一次交换语义统一处理了四种拖拽方向，
 * 不会出现"从棋盘拖到备战席"和"从备战席拖到棋盘"两套代码各错一半的情况。
 */
export function moveToSlot(p: PlayerState, iid: number, where: 'board' | 'bench', slot: number): boolean {
  const srcBoard = p.board.findIndex((u) => u !== null && u.iid === iid);
  const srcBench = srcBoard >= 0 ? -1 : p.bench.findIndex((u) => u !== null && u.iid === iid);
  if (srcBoard < 0 && srcBench < 0) return false;
  const srcArr = srcBoard >= 0 ? p.board : p.bench;
  const srcSlot = srcBoard >= 0 ? srcBoard : srcBench;
  const dstArr = where === 'board' ? p.board : p.bench;
  if (slot < 0 || slot >= dstArr.length) return false;
  const u = srcArr[srcSlot];
  if (!u) return false;
  const occupant = dstArr[slot];
  srcArr[srcSlot] = occupant;
  dstArr[slot] = u;
  return true;
}

export interface PlaceCheck {
  ok: boolean;
  /** 拒绝原因，直接展示给玩家 —— 阻止操作而不解释，是最差的交互 */
  reason?: string;
}

/** 这次拖拽是否允许。UI 层在松手前就要知道，用于给落点染色。 */
export function canPlace(p: PlayerState, iid: number, where: 'board' | 'bench', slot: number): PlaceCheck {
  const srcBoard = p.board.findIndex((u) => u !== null && u.iid === iid);
  const onBoardNow = srcBoard >= 0;
  const u = onBoardNow ? p.board[srcBoard] : p.bench[p.bench.findIndex((x) => x !== null && x.iid === iid)];
  if (!u) return { ok: false, reason: '找不到这个棋子' };

  if (where === 'board') {
    const occupant = p.board[slot];
    const movingIn = !onBoardNow;
    if (movingIn && !occupant && boardCount(p) >= boardCap(p)) {
      return { ok: false, reason: `人口已满（${boardCount(p)}/${boardCap(p)}），先升级或撤下一个` };
    }
    // 同名棋子允许同时上场（1.7.0 起）：多余的同名是候补合成料，
    // 羁绊仍按"是否拥有该棋子"唯一计数，同名堆场不重复叠羁绊。
  }
  return { ok: true };
}

/** 清空并重建一个空的己方半场 */
export function emptyBoard(): (UnitInstance | null)[] {
  return new Array(BOARD_CELLS).fill(null);
}

export function emptyBench(): (UnitInstance | null)[] {
  return new Array(BENCH_SLOTS).fill(null);
}

/** 深拷贝一份棋盘（幽灵阵容快照用） */
export function cloneBoard(board: readonly (UnitInstance | null)[]): (UnitInstance | null)[] {
  return board.map((u) => (u ? { ...u, items: [...u.items] } : null));
}
