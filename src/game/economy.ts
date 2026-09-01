/**
 * 经济系统。
 *
 * 自走棋的策略张力有一半来自这里：同样的钱，是今天变强还是明天变强？
 * 利息机制（每 10 金 +1，上限 5）是这套张力的支点 —— 它让"忍住不买"成为一种有回报的决策。
 */

import {
  INCOME_BASE,
  INCOME_INTEREST_MAX,
  INCOME_INTEREST_TIER,
  LOSE_STREAK_GOLD,
  WIN_STREAK_GOLD,
  XP_TO_NEXT,
  MAX_LEVEL,
} from '../core/config';
import type { PlayerState } from './state';

export interface IncomeBreakdown {
  base: number;
  interest: number;
  streak: number;
  /** 胜利额外奖励 */
  win: number;
  total: number;
}

export function interestOf(gold: number): number {
  return Math.max(0, Math.min(INCOME_INTEREST_MAX, Math.floor(gold / INCOME_INTEREST_TIER)));
}

/** 连胜 / 连败奖励。连败给得更晚但同样有上限 —— 这是"连败翻盘路径"的经济基础。 */
export function streakGold(streak: number): number {
  const n = Math.abs(streak);
  const table = streak > 0 ? WIN_STREAK_GOLD : LOSE_STREAK_GOLD;
  return table[Math.min(n, table.length - 1)];
}

export function computeIncome(p: PlayerState, won: boolean, skipStreak = false): IncomeBreakdown {
  const base = INCOME_BASE;
  // 利息按"结算前手上的钱"算，与 TFT 一致：先发利息再动余额
  const interest = interestOf(p.gold);
  // 轮空回合（skipStreak）不结算连胜/连败档位金 —— 轮空不是胜利，也不能变成"领钱回合"
  const streak = skipStreak ? 0 : streakGold(p.streak);
  const win = won ? 1 : 0;
  return { base, interest, streak, win, total: base + interest + streak + win };
}

/** 升到下一级还差多少经验。已满级返回 0。 */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return XP_TO_NEXT[Math.max(0, Math.min(XP_TO_NEXT.length - 1, level - 1))];
}

/**
 * 加经验并处理升级。可能一次连升多级。
 * @returns 实际升到的等级
 */
export function gainXp(p: PlayerState, amount: number): number {
  p.xp += amount;
  while (p.level < MAX_LEVEL) {
    const need = xpToNext(p.level);
    if (need <= 0 || p.xp < need) break;
    p.xp -= need;
    p.level++;
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
  return p.level;
}
