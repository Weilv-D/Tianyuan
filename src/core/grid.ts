import { BOARD_COLS, BOARD_ROWS } from './config';
import type { Cell } from './types';

export const cellIndex = (c: number, r: number): number => r * BOARD_COLS + c;

export function inBounds(c: number, r: number): boolean {
  return c >= 0 && c < BOARD_COLS && r >= 0 && r < BOARD_ROWS;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.c === b.c && a.r === b.r;
}

/**
 * 切比雪夫距离 —— 与"攻击距离 1 = 周围 8 格"的直觉一致。
 * 相比曼哈顿距离，斜向移动不再被惩罚，棋盘感更自然。
 */
export function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));
}

export function euclid(a: Cell, b: Cell): number {
  const dc = a.c - b.c;
  const dr = a.r - b.r;
  return Math.sqrt(dc * dc + dr * dr);
}

const NEIGHBORS_8: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** 8 邻域偏移顺序固定 —— 保证寻路结果确定，不会因遍历顺序抖动 */
export const NEIGHBOR_OFFSETS = NEIGHBORS_8;

export interface BfsResult {
  /** 从起点到终点的完整路径（不含起点） */
  path: Cell[];
  /** 终点 */
  goal: Cell;
}

/**
 * 从 start 出发做 BFS，找到第一个满足 isGoal 的可达格子。
 *
 * @param blocked 占据格判定（传入格子是否被"实体"占用）。起点视为可通行；
 *                终点同样受此约束 —— 占用格永远不能作为落脚点，
 *                否则两个单位写进同一格，occ 占位表即告腐坏。
 * @param maxNodes 搜索上限，防止极端情况下的性能塌方
 *
 * 返回 null 表示不可达（此时单位原地不动，等下一帧再试 —— 比乱走更符合直觉）。
 */
// L5：battle.ts:distanceField 与此处 bfsTo 共享同一个 BFS 模板，但前者直读 this.occ 老后者拿 blocked 回调，已在内核边界上定义清楚，暂维持双份以保持每一边的语义完整性。
export function bfsTo(
  start: Cell,
  isGoal: (c: number, r: number) => boolean,
  blocked: (c: number, r: number) => boolean,
  maxNodes = BOARD_COLS * BOARD_ROWS,
): BfsResult | null {
  const startIdx = cellIndex(start.c, start.r);
  if (isGoal(start.c, start.r)) return { path: [], goal: start };

  const prev = new Int16Array(BOARD_COLS * BOARD_ROWS).fill(-1);
  const seen = new Uint8Array(BOARD_COLS * BOARD_ROWS);
  // 固定容量的环形队列，零 GC 压力（每 tick 数十次调用也不掉帧）
  const queue = new Int16Array(BOARD_COLS * BOARD_ROWS);
  let head = 0;
  let tail = 0;

  seen[startIdx] = 1;
  queue[tail++] = startIdx;
  let visited = 0;

  while (head < tail) {
    const cur = queue[head++];
    if (++visited > maxNodes) return null;
    const cc = cur % BOARD_COLS;
    const cr = (cur - cc) / BOARD_COLS;

    for (let i = 0; i < 8; i++) {
      const off = NEIGHBORS_8[i];
      const nc = cc + off[0];
      const nr = cr + off[1];
      if (!inBounds(nc, nr)) continue;
      const ni = cellIndex(nc, nr);
      if (seen[ni]) continue;
      // 占用格既不能穿过、也不能落脚 —— 没有例外
      if (blocked(nc, nr)) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      queue[tail++] = ni;
      if (isGoal(nc, nr)) {
        return { path: reconstruct(prev, startIdx, ni), goal: { c: nc, r: nr } };
      }
    }
  }
  return null;
}

function reconstruct(prev: Int16Array, startIdx: number, endIdx: number): Cell[] {
  const out: Cell[] = [];
  let cur = endIdx;
  while (cur !== startIdx && cur >= 0) {
    const c = cur % BOARD_COLS;
    const r = (cur - c) / BOARD_COLS;
    out.push({ c, r });
    cur = prev[cur];
  }
  out.reverse();
  return out;
}

/**
 * 找到"能攻击到 target"的最近可站格，返回第一步该往哪走。
 * 若已经在射程内，返回 null（原地输出）。
 */
export function stepTowardAttackPosition(
  from: Cell,
  target: Cell,
  range: number,
  blocked: (c: number, r: number) => boolean,
): Cell | null {
  // 站位格 = 射程内的空格；目标脚下那格被显式排除 ——
  // 走上目标的格子等于和它重叠，是占位表腐坏的源头
  const res = bfsTo(
    from,
    (c, r) => chebyshev({ c, r }, target) <= range && !(c === target.c && r === target.r),
    blocked,
  );
  if (!res || res.path.length === 0) return null;
  return res.path[0];
}

/** 在指定格子集合中挑选一个离 origin 最近且空着的格子（用于刺客跳后排） */
export function nearestFreeCell(
  origin: Cell,
  candidates: Cell[],
  blocked: (c: number, r: number) => boolean,
): Cell | null {
  let best: Cell | null = null;
  let bestD = Infinity;
  for (const cand of candidates) {
    if (blocked(cand.c, cand.r)) continue;
    const d = euclid(origin, cand);
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  return best;
}
