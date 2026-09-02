import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Match } from '../src/game/match';
import { clearSave, hasSave, loadMatch, saveMatch } from '../src/game/save';
import { createUnit } from '../src/game/state';

const SAVE_KEY = 'inkarena.save.v3';
const DAILY_KEY = 'inkarena.save.v3.daily';
const LEGACY_KEY = 'inkarena.save.v2';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

function playedMatch(): Match {
  const match = new Match(20260830, '墨客', 'daily');
  match.beginRound();
  match.human.gold = 42;
  match.human.hp = 66;
  match.humanRank = 3;
  match.human.board[0] = createUnit('pan');
  return match;
}

beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('本地存档', () => {
  it('保存后恢复的是同一局对局（按模式分键）', () => {
    const match = playedMatch();
    expect(saveMatch(match)).toBe(true);
    expect(loadMatch('daily')?.toJSON()).toEqual(match.toJSON());
  });

  it('每日档与普通档分键，互不覆盖（v3.1）', () => {
    const daily = playedMatch(); // mode = 'daily'
    expect(saveMatch(daily)).toBe(true);
    // 普通档入口读不到每日档 —— 此前两模式共用一键，玩每日会静默覆盖普通进度
    expect(loadMatch()).toBeNull();
    expect(hasSave()).toBe(false);
    expect(hasSave('daily')).toBe(true);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(localStorage.getItem(DAILY_KEY)).not.toBeNull();

    // 两档并存时各自读写各自的键
    const normal = new Match(777, '行者', 'normal');
    normal.beginRound();
    expect(saveMatch(normal)).toBe(true);
    expect(loadMatch()?.toJSON()).toEqual(normal.toJSON());
    expect(loadMatch('daily')?.toJSON()).toEqual(daily.toJSON());

    // 终局/放弃只清本局模式：清每日档不动普通档
    clearSave('daily');
    expect(hasSave('daily')).toBe(false);
    expect(hasSave()).toBe(true);
  });

  it('旧版存档会无损迁移并删除旧键', () => {
    const data = { ...playedMatch().toJSON() } as Record<string, unknown>;
    delete data.mode;
    delete data.battleSnapshots;
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ v: 2, savedAt: 1, data }));

    const loaded = loadMatch();
    expect(loaded?.mode).toBe('normal');
    expect(loaded?.round).toBe(data.round);
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('坏档被忽略，不会卡住启动流程', () => {
    localStorage.setItem(SAVE_KEY, '{broken');
    expect(loadMatch()).toBeNull();
  });

  it('损坏键不点亮"继续"入口，且读档/判档都会清理坏键（自愈）', () => {
    // 半截载荷（配额写中断）：JSON 合法但缺骨架字段
    localStorage.setItem(DAILY_KEY, JSON.stringify({ v: 3, savedAt: 1, data: { players: [], round: 1 } }));
    expect(hasSave('daily')).toBe(false);
    // hasSave 判定失败即清键，坏键不残留
    expect(localStorage.getItem(DAILY_KEY)).toBeNull();

    // 语法坏档：loadMatch 清理后入口消失（每日档无 v2 兜底，必须自愈）
    localStorage.setItem(DAILY_KEY, '{broken');
    expect(loadMatch('daily')).toBeNull();
    expect(localStorage.getItem(DAILY_KEY)).toBeNull();
    expect(hasSave('daily')).toBe(false);
  });

  it('普通档坏键清理后不波及可用的 v2 旧档（读档仍可迁移）', () => {
    const data = { ...playedMatch().toJSON() } as Record<string, unknown>;
    delete data.mode;
    delete data.battleSnapshots;
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ v: 2, savedAt: 1, data }));
    localStorage.setItem(SAVE_KEY, '{broken');

    // hasSave 清理坏 v3 键，但 v2 旧档仍在 → "继续"仍亮
    expect(hasSave()).toBe(true);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    // loadMatch 走 v2 迁移路径，正常恢复
    const loaded = loadMatch();
    expect(loaded?.mode).toBe('normal');
    expect(loaded?.round).toBe(data.round);
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('清除存档后继续入口消失', () => {
    saveMatch(playedMatch());
    expect(hasSave('daily')).toBe(true);
    clearSave('daily');
    expect(hasSave('daily')).toBe(false);
  });
});
