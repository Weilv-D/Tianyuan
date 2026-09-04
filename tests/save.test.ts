import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Match } from '../src/game/match';
import { DEFAULT_PREFS, clearSave, hasSave, loadMatch, saveMatch, savePrefs } from '../src/game/save';
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

  it('深层结构损坏（骨架过、fromJSON 抛）同样清理坏键，不残留死档', () => {
    // players 骨架合法（非空数组）但元素损坏（首元素为 null）—— loadData 骨架
    // 校验拦不住，Match.fromJSON 在遍历 players 时抛错。坏键必须一并清除：
    // 否则"继续"入口亮着却永远点不进。
    const d = { ...playedMatch().toJSON() } as Record<string, unknown>;
    d.players = [null];
    localStorage.setItem(DAILY_KEY, JSON.stringify({ v: 3, savedAt: 1, data: d }));
    expect(hasSave('daily')).toBe(true); // 骨架字段合法 → 入口判定放行
    expect(loadMatch('daily')).toBeNull(); // 读档 fromJSON 抛错 → 清键
    expect(localStorage.getItem(DAILY_KEY)).toBeNull();
    expect(hasSave('daily')).toBe(false); // 坏键已清，入口消失
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

  it('损坏的 v2 旧档被清理，不残留"继续"常亮却读不出的坏档幽灵', () => {
    // v2 键存在但载荷损坏（半截 JSON）：hasSave 与 loadMatch 同口径验内容，
    // 入口判定无存档并顺手清键 —— "继续"不再常亮却永远进不去。
    // （此前 hasSave 只看键存在性，坏档幽灵要等玩家点过一次才自愈。）
    localStorage.setItem(LEGACY_KEY, '{broken');
    expect(hasSave()).toBe(false); // 入口验型：坏旧档不算有存档
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull(); // 入口即清，不留给读档路径
    expect(loadMatch()).toBeNull();
    expect(hasSave()).toBe(false);
  });

  it('骨架损坏的 v2 旧档同样被清理', () => {
    // 结构坏（players 缺失）的 v2 载荷与语法坏档同口径
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ v: 2, savedAt: 1, data: { rngState: 1 } }));
    expect(loadMatch()).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(hasSave()).toBe(false);
  });

  it('清除存档后继续入口消失', () => {
    saveMatch(playedMatch());
    expect(hasSave('daily')).toBe(true);
    clearSave('daily');
    expect(hasSave('daily')).toBe(false);
  });

  it('savePrefs 写入成功返回 true，存储抛错（隐私模式/配额满）返回 false', () => {
    expect(savePrefs({ ...DEFAULT_PREFS })).toBe(true);
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    });
    expect(savePrefs({ ...DEFAULT_PREFS })).toBe(false);
  });
});
