import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailySeedFor, loadDailyBest, recordDailyResult, todayKey } from '../src/game/daily';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('每日挑战', () => {
  it('同一天共享种子，跨日生成新挑战', () => {
    const morning = new Date(2026, 7, 30, 0, 0, 1);
    const night = new Date(2026, 7, 30, 23, 59, 59);
    const tomorrow = new Date(2026, 7, 31, 0, 0, 0);

    expect(todayKey(morning)).toBe('2026-08-30');
    expect(dailySeedFor(night)).toBe(dailySeedFor(morning));
    expect(dailySeedFor(tomorrow)).not.toBe(dailySeedFor(morning));
  });

  it('每天只保存更好的名次，新一天重新计分', () => {
    const day = new Date(2026, 7, 30, 12);
    expect(recordDailyResult(day, 6)).toBe(true);
    expect(recordDailyResult(day, 8)).toBe(false);
    expect(recordDailyResult(day, 2)).toBe(true);
    expect(loadDailyBest()).toEqual({ date: '2026-08-30', rank: 2 });

    expect(recordDailyResult(new Date(2026, 7, 31, 12), 7)).toBe(true);
    expect(loadDailyBest()).toEqual({ date: '2026-08-31', rank: 7 });
  });

  it('浏览器存储不可用时不会阻断游戏', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('disabled'); },
      setItem: () => { throw new Error('disabled'); },
    });
    expect(loadDailyBest()).toBeNull();
    expect(recordDailyResult(new Date(), 1)).toBe(false);
  });
});
