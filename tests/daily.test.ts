/**
 * 每日挑战数据层回归（M4）。
 *
 * localStorage 用内存 Map 桩替换（beforeEach 装配 / afterEach 还原），
 * 测试不碰真实浏览器存储，Node 环境下同样成立。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailySeedFor, loadDailyBest, recordDailyResult, todayKey } from '../src/game/daily';
import { fnv1aHex } from '../src/game/replay';

/** 内存 localStorage 桩 */
class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

/** 只会抛错的桩：模拟隐私模式 / 配额满 */
class ThrowingStorage {
  getItem(): string | null {
    throw new Error('storage disabled');
  }
  setItem(): void {
    throw new Error('storage disabled');
  }
  removeItem(): void {
    throw new Error('storage disabled');
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('todayKey', () => {
  it('格式为本地时区 YYYY-MM-DD，月/日补零', () => {
    expect(todayKey(new Date(2026, 0, 5, 9, 30, 0))).toBe('2026-01-05');
    expect(todayKey(new Date(2026, 11, 31, 12, 0, 0))).toBe('2026-12-31');
  });

  it('跨日边界：23:59:59 与次日 00:00:00 给出不同 key', () => {
    const before = new Date(2026, 7, 30, 23, 59, 59);
    const after = new Date(2026, 7, 31, 0, 0, 0);
    expect(todayKey(before)).toBe('2026-08-30');
    expect(todayKey(after)).toBe('2026-08-31');
    expect(todayKey(before)).not.toBe(todayKey(after));
  });
});

describe('dailySeedFor', () => {
  it('同一天任何时刻返回同一种子', () => {
    const morning = new Date(2026, 7, 30, 0, 0, 1);
    const noon = new Date(2026, 7, 30, 12, 0, 0);
    const night = new Date(2026, 7, 30, 23, 59, 59);
    expect(dailySeedFor(morning)).toBe(dailySeedFor(noon));
    expect(dailySeedFor(morning)).toBe(dailySeedFor(night));
  });

  it('跨日种子不同', () => {
    const d1 = new Date(2026, 7, 30, 12, 0, 0);
    const d2 = new Date(2026, 7, 31, 12, 0, 0);
    expect(dailySeedFor(d1)).not.toBe(dailySeedFor(d2));
  });

  it('值域为 32 位无符号整数，且等于日期键的 FNV-1a（口径钉死）', () => {
    const d = new Date(2026, 7, 30, 12, 0, 0);
    const seed = dailySeedFor(d);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
    expect(seed).toBe(parseInt(fnv1aHex(todayKey(d)), 16) >>> 0);
  });
});

describe('recordDailyResult / loadDailyBest', () => {
  const day = (): Date => new Date(2026, 7, 30, 20, 0, 0);

  it('首记：无记录时返回 true 并落盘', () => {
    expect(loadDailyBest()).toBeNull();
    expect(recordDailyResult(day(), 5)).toBe(true);
    expect(loadDailyBest()).toEqual({ date: '2026-08-30', rank: 5 });
  });

  it('刷新：名次更低（更优）时覆写并返回 true', () => {
    recordDailyResult(day(), 8);
    expect(recordDailyResult(day(), 3)).toBe(true);
    expect(loadDailyBest()).toEqual({ date: '2026-08-30', rank: 3 });
  });

  it('不刷新：名次不优于既有值时返回 false 且存储不变', () => {
    recordDailyResult(day(), 2);
    expect(recordDailyResult(day(), 5)).toBe(false);
    expect(recordDailyResult(day(), 2)).toBe(false); // 平名次不算刷新
    expect(loadDailyBest()).toEqual({ date: '2026-08-30', rank: 2 });
  });

  it('跨日首记：既有记录属于旧日期时按"无记录"覆写', () => {
    recordDailyResult(new Date(2026, 7, 29, 12, 0, 0), 1);
    expect(recordDailyResult(day(), 7)).toBe(true);
    expect(loadDailyBest()).toEqual({ date: '2026-08-30', rank: 7 });
  });

  it('存储不可用（隐私模式）：读返回 null、写返回 false，绝不抛出', () => {
    vi.stubGlobal('localStorage', new ThrowingStorage());
    expect(loadDailyBest()).toBeNull();
    expect(recordDailyResult(day(), 1)).toBe(false);
  });

  it('坏档归零：JSON 损坏 / 字段类型不对时返回 null', () => {
    const storage = new MemStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem('inkarena.daily.v1', '{oops');
    expect(loadDailyBest()).toBeNull();
    storage.setItem('inkarena.daily.v1', JSON.stringify({ date: 8, rank: 'x' }));
    expect(loadDailyBest()).toBeNull();
  });
});
