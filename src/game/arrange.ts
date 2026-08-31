/**
 * 自动布阵。
 *
 * 两条用途：AI 每回合收拾自己的阵容；以及给玩家的「一键布阵」按钮（新手友好要求）。
 *
 * 布阵原则：
 * 1. 同名棋子场上只留 1 张（星级最高的那张），其余留在备战席等合成。
 * 2. 至少保证 2 个前排 —— 没有前排，后排会在第一轮技能循环内被刺客和 AOE 清干净，
 *    这是新手最常见的"我明明棋子很好却打不过"的原因。
 * 3. 同纵深内按战力估值从中心向两侧铺开，保证阵型对称。
 */

import { BOARD_COLS, BENCH_SLOTS } from '../core/config';
import { stripItems } from './inventory';
import { CHAMPION_BY_ID } from '../data/champions';
import type { CardPool } from './pool';
import {
  allUnits,
  boardCap,
  centerOutColumns,
  powerScore,
  sellValue,
  type UnitInstance,
  type PlayerState,
} from './state';

/** 职业纵深：0 = 最前排，1 = 最后排 */
const DEPTH: Record<string, number> = {
  guardian: 0,
  warrior: 0.12,
  assassin: 0.95,
  marksman: 0.72,
  mage: 0.78,
  warlock: 0.6,
  support: 0.88,
};

function depthOf(defId: string): number {
  const e = CHAMPION_BY_ID[defId];
  return DEPTH[e?.cls ?? 'warrior'] ?? 0.5;
}

/** 由中心向两侧的列填充顺序（规范实现见 state.centerOutColumns） */
const COL_ORDER: number[] = centerOutColumns();

const ROWS = 4;

/**
 * 重新布阵。会就地修改 p.board / p.bench，溢出的棋子自动卖出并返还金币。
 * @param pool 共享卡池 —— 卖掉的棋子必须退池，否则全局面临通缩
 * @returns 本次卖出返还的金币
 */
export function autoArrange(p: PlayerState, pool: CardPool): number {
  const owned = allUnits(p);
  if (owned.length === 0) return 0;

  // 同名只保留最强的那张上场
  const bestByName = new Map<string, UnitInstance>();
  for (const u of owned) {
    const cur = bestByName.get(u.defId);
    if (!cur || u.star > cur.star || (u.star === cur.star && powerScore(u) > powerScore(cur))) {
      bestByName.set(u.defId, u);
    }
  }
  const roster = [...bestByName.values()];
  const cap = Math.min(boardCap(p), roster.length);

  const byScore = [...roster].sort((a, b) => powerScore(b) - powerScore(a));
  const chosen: UnitInstance[] = [];
  const take = (u: UnitInstance) => {
    if (chosen.length < cap && !chosen.includes(u)) chosen.push(u);
  };

  // 先锁定前排：至少 2 个纵深 < 0.5 的
  const tanks = byScore.filter((u) => depthOf(u.defId) < 0.5);
  for (let i = 0; i < Math.min(2, tanks.length); i++) take(tanks[i]);
  // 其余按战力补足
  for (const u of byScore) {
    if (chosen.length >= cap) break;
    take(u);
  }

  // 站位：纵深小的先放（占前排），同纵深内战力高的靠中心
  chosen.sort((a, b) => {
    const da = depthOf(a.defId);
    const db = depthOf(b.defId);
    if (da !== db) return da - db;
    return powerScore(b) - powerScore(a);
  });

  const newBoard: (UnitInstance | null)[] = new Array(BOARD_COLS * ROWS).fill(null);
  const rowUsed: boolean[][] = Array.from({ length: ROWS }, () => new Array(BOARD_COLS).fill(false));
  for (const u of chosen) {
    let row = Math.min(ROWS - 1, Math.floor(depthOf(u.defId) * ROWS));
    let guard = 0;
    while (rowUsed[row].every(Boolean) && guard++ < ROWS) row = Math.min(ROWS - 1, row + 1);
    let placed = false;
    for (const c of COL_ORDER) {
      if (!rowUsed[row][c]) {
        rowUsed[row][c] = true;
        newBoard[row * BOARD_COLS + c] = u;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // 兜底：扫第一个空格
      for (let i = 0; i < newBoard.length; i++) {
        if (!newBoard[i]) {
          newBoard[i] = u;
          break;
        }
      }
    }
  }

  // 未上场的回备战席：优先保留"离合成最近"的（同名张数多的）
  const chosenIids = new Set(chosen.map((u) => u.iid));
  const rest = owned.filter((u) => !chosenIids.has(u.iid));
  const copies = new Map<string, number>();
  for (const u of rest) copies.set(u.defId, (copies.get(u.defId) ?? 0) + 1);
  rest.sort((a, b) => {
    const ca = copies.get(a.defId) ?? 0;
    const cb = copies.get(b.defId) ?? 0;
    if (ca !== cb) return cb - ca;
    return powerScore(b) - powerScore(a);
  });

  const newBench: (UnitInstance | null)[] = new Array(BENCH_SLOTS).fill(null);
  let refund = 0;
  for (let i = 0; i < rest.length; i++) {
    if (i < BENCH_SLOTS) {
      newBench[i] = rest[i];
    } else {
      refund += sellValue(rest[i]);
      // 溢出的棋子被卖掉：装备回器匣、卡回共享池 —— 两样都不能凭空消失
      stripItems(p, rest[i]);
      pool.giveUnit(rest[i].defId, rest[i].star);
    }
  }

  p.board = newBoard;
  p.bench = newBench;
  p.gold += refund;
  return refund;
}
