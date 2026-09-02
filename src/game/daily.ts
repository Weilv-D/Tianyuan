/**
 * 每日挑战（M4）· 契约与本地成绩。
 *
 * 种子 = 本地日期（YYYY-MM-DD）的 32 位哈希。日期由入口层（MenuScene）注入
 * new Date() —— 本文件不读时钟（游戏逻辑禁 Date.now 的纪律），哈希本身是纯函数，
 * 同一天任何时刻算出的种子一致，商店/AI/配对流因此固定。
 *
 * 成绩 = 对局最终名次（1 最优，8 最差）；本地保留每日最低名次。
 * 成绩只存"今天"的一条：跨天后旧日期记录被新一天的首记自然覆写。
 */
import { fnv1aHex } from './replay';

/** 本地时区日期键：YYYY-MM-DD。直接读本地年/月/日字段，绝不经 UTC 换算。 */
export function todayKey(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 同一天任何时刻返回同一 32 位无符号种子：对日期键做 FNV-1a（口径见 replay.ts） */
export function dailySeedFor(d: Date): number {
  return parseInt(fnv1aHex(todayKey(d)), 16) >>> 0;
}

export interface DailyBest {
  /** YYYY-MM-DD（本地时区） */
  date: string;
  /** 该日历史最低名次（1 最优） */
  rank: number;
}

const DAILY_KEY = 'inkarena.daily.v1';

/** 读取当日前的本地最佳名次；无记录 / 数据损坏（隐私模式清空、JSON 坏档、名次越界）返回 null，绝不抛出 */
export function loadDailyBest(): DailyBest | null {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DailyBest> | null;
    if (!parsed || typeof parsed.date !== 'string' || typeof parsed.rank !== 'number') return null;
    // 域校验：名次是 1~8 的整数，越界记录视作损坏 —— 防坏档把「每日最佳」钉在荒谬值上
    if (!Number.isInteger(parsed.rank) || parsed.rank < 1 || parsed.rank > 8) return null;
    return { date: parsed.date, rank: parsed.rank };
  } catch {
    return null;
  }
}

/**
 * 记录一次每日挑战结果；返回是否刷新了该日纪录（名次更低）。
 *
 * 分支：
 * - 当日无记录（存储为空、坏档，或既有记录属于旧日期）→ 覆写并返回 true；
 * - 既有当日记录且新名次 < 既有值 → 覆写并返回 true；
 * - 其余（名次不优于既有值）→ 不动存储，返回 false。
 *
 * 存储不可用（隐私模式 / 配额满）按"未刷新"处理返回 false —— 与 save.ts 同口径，
 * 绝不让持久化失败炸掉结算流程。
 */
export function recordDailyResult(d: Date, rank: number): boolean {
  if (!Number.isInteger(rank) || rank < 1 || rank > 8) return false;
  const date = todayKey(d);
  try {
    const prev = loadDailyBest();
    if (prev && prev.date === date && !(rank < prev.rank)) return false;
    localStorage.setItem(DAILY_KEY, JSON.stringify({ date, rank }));
    return true;
  } catch {
    return false;
  }
}
