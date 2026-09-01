import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Match } from '../src/game/match';
import { clearSave, hasSave, loadMatch, saveMatch } from '../src/game/save';
import { createUnit } from '../src/game/state';

const SAVE_KEY = 'inkarena.save.v3';
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
  it('保存后恢复的是同一局对局', () => {
    const match = playedMatch();
    expect(saveMatch(match)).toBe(true);
    expect(loadMatch()?.toJSON()).toEqual(match.toJSON());
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

  it('清除存档后继续入口消失', () => {
    saveMatch(playedMatch());
    expect(hasSave()).toBe(true);
    clearSave();
    expect(hasSave()).toBe(false);
  });
});
