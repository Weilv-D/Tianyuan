/**
 * 存档 v3 数据层回归（M4）。
 *
 * 覆盖：v3 载荷结构 / 读档往返无损 / v2 旧档自动迁移（无损证据）/
 * 迁移写回失败时静默保留旧键 / 坏档归零与 v3 损坏时的 v2 兜底。
 * localStorage 全部用内存桩替换（beforeEach 装配 / afterEach 还原）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Match } from '../src/game/match';
import type { BattleSnapshot } from '../src/game/replay';
import {
  clearSave,
  describeSave,
  hasSave,
  loadMatch,
  saveMatch,
  saveMeta,
} from '../src/game/save';
import { boardIdx, createUnit } from '../src/game/state';

const V3_KEY = 'inkarena.save.v3';
const V2_KEY = 'inkarena.save.v2';

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

/** 只读桩：getItem/removeItem 正常，setItem 恒抛 —— 模拟配额满 / 隐私模式写入失败 */
class NoWriteStorage {
  private map: Map<string, string>;
  constructor(entries: [string, string][] = []) {
    this.map = new Map(entries);
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(): void {
    throw new Error('quota exceeded');
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

/** 手造一份 v2 旧载荷：真实 Match.toJSON() 去掉 M4 新增字段（mode / battleSnapshots） */
function legacyV2Payload(seed = 777): { raw: string; data: Record<string, unknown> } {
  const data = { ...new Match(seed).toJSON() } as Record<string, unknown>;
  delete data.mode;
  delete data.battleSnapshots;
  return { raw: JSON.stringify({ v: 2, savedAt: 1234567890, data }), data };
}

/** 组装一个带真实内容的 Match（mode 默认 daily 以验证模式持久化） */
function makeMatch(mode: 'normal' | 'daily' = 'daily'): Match {
  const m = new Match(20260830, '墨客', mode);
  m.round = 5;
  m.phase = 'result';
  m.humanRank = 3;
  m.settings.autoDeploy = false;
  m.log.push('测试日志 · 第 5 回合');
  const pan = createUnit('pan');
  pan.items.push('x1');
  m.players[0].board[boardIdx(3, 0)] = pan;
  m.players[0].gold = 42;
  m.players[0].hp = 66;
  m.players[0].level = 6;
  m.players[2].alive = false;
  m.players[2].rank = 8;
  const snap: BattleSnapshot = {
    round: 5,
    config: {
      seed: 7,
      units: [{ uid: 1, defId: 'pan', team: 0, star: 1, cell: { c: 0, r: 3 } }],
      traits: { 0: [], 1: [] },
    },
    winner: 0,
    ticks: 40,
    eventsDigest: '',
  };
  m.battleSnapshots.push(snap);
  return m;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveMatch / loadMatch（v3）', () => {
  it('saveMatch 写入 v3 载荷：{ v:3, savedAt, mode, data }', () => {
    const m = makeMatch('daily');
    saveMatch(m);
    const raw = localStorage.getItem(V3_KEY);
    expect(raw).not.toBeNull();
    const payload = JSON.parse(raw!) as {
      v: number;
      savedAt: number;
      mode: 'normal' | 'daily';
      data: ReturnType<Match['toJSON']>;
    };
    expect(payload.v).toBe(3);
    expect(typeof payload.savedAt).toBe('number');
    expect(payload.mode).toBe('daily');
    expect(payload.data).toEqual(m.toJSON());
  });

  it('loadMatch 往返无损：round/phase/players/mode/battleSnapshots 逐字段一致', () => {
    const m = makeMatch('daily');
    saveMatch(m);
    const loaded = loadMatch();
    expect(loaded).not.toBeNull();
    expect(loaded!.mode).toBe('daily');
    expect(loaded!.round).toBe(5);
    expect(loaded!.phase).toBe('result');
    expect(loaded!.players).toEqual(m.players);
    expect(loaded!.battleSnapshots).toEqual(m.battleSnapshots);
    // 整体快照深度相等 = "读回来是同一局"的最强证据
    expect(loaded!.toJSON()).toEqual(m.toJSON());
  });

  it('无存档时 loadMatch 返回 null', () => {
    expect(loadMatch()).toBeNull();
  });
});

describe('v2 旧档迁移', () => {
  it('v2 载荷读档成功：mode 归 normal、battleSnapshots 归空，且迁移无损', () => {
    const { data } = legacyV2Payload();
    localStorage.setItem(V2_KEY, JSON.stringify({ v: 2, savedAt: 1234567890, data }));

    const loaded = loadMatch();
    expect(loaded).not.toBeNull();
    expect(loaded!.mode).toBe('normal');
    expect(loaded!.battleSnapshots).toEqual([]);
    // 无损证据：读回的 Match 再序列化 = 原始数据逐字段保留 + M4 字段按缺省补齐
    expect(loaded!.toJSON()).toEqual({ ...data, mode: 'normal', battleSnapshots: [] });
  });

  it('读档成功即写回 v3 并清除旧键；再读走 v3 结果一致', () => {
    const { raw } = legacyV2Payload(999);
    localStorage.setItem(V2_KEY, raw);

    const first = loadMatch();
    expect(first).not.toBeNull();
    expect(localStorage.getItem(V3_KEY)).not.toBeNull();
    expect(localStorage.getItem(V2_KEY)).toBeNull(); // v3 已确认落盘，旧键清除

    const second = loadMatch();
    expect(second!.toJSON()).toEqual(first!.toJSON());
    expect(second!.mode).toBe('normal');
  });

  it('迁移写回失败（配额满）：读档仍成功，旧键静默保留', () => {
    const { raw } = legacyV2Payload(555);
    vi.stubGlobal('localStorage', new NoWriteStorage([[V2_KEY, raw]]));

    const loaded = loadMatch();
    expect(loaded).not.toBeNull();
    expect(loaded!.mode).toBe('normal');
    expect(localStorage.getItem(V3_KEY)).toBeNull();
    expect(localStorage.getItem(V2_KEY)).toBe(raw); // 唯一数据源不能删
  });

  it('v3 键损坏但 v2 完好：兜底救回并完成迁移', () => {
    const { raw } = legacyV2Payload(333);
    localStorage.setItem(V3_KEY, '{oops 损坏的档');
    localStorage.setItem(V2_KEY, raw);

    const loaded = loadMatch();
    expect(loaded).not.toBeNull();
    expect(loaded!.mode).toBe('normal');
  });

  it('v2 载荷结构校验不过（players 空 / JSON 损坏 / 版本号不对）→ 迁移拒绝', () => {
    localStorage.setItem(V2_KEY, JSON.stringify({ v: 2, data: { players: [] } }));
    expect(loadMatch()).toBeNull();
    localStorage.setItem(V2_KEY, '{oops');
    expect(loadMatch()).toBeNull();
    localStorage.setItem(V2_KEY, JSON.stringify({ v: 1, data: { players: [{}] } }));
    expect(loadMatch()).toBeNull();
  });
});

describe('hasSave / clearSave / saveMeta / describeSave', () => {
  it('hasSave：v3 或 v2 任一存在即亮"继续"；clearSave 双键全清', () => {
    expect(hasSave()).toBe(false);

    const { raw } = legacyV2Payload();
    localStorage.setItem(V2_KEY, raw);
    expect(hasSave()).toBe(true); // 只有旧档也算有存档

    localStorage.removeItem(V2_KEY);
    saveMatch(makeMatch());
    expect(hasSave()).toBe(true);

    localStorage.setItem(V2_KEY, raw);
    clearSave();
    expect(hasSave()).toBe(false);
    expect(localStorage.getItem(V2_KEY)).toBeNull(); // 残留旧档不能让"继续"复活
  });

  it('saveMeta / describeSave 给出可用摘要', () => {
    expect(saveMeta()).toBeNull();
    expect(describeSave()).toBe('');

    const m = makeMatch();
    saveMatch(m);
    const meta = saveMeta();
    expect(meta).not.toBeNull();
    expect(meta!.round).toBe(5);
    expect(meta!.humanHp).toBe(66);
    expect(meta!.humanAlive).toBe(true);
    expect(typeof meta!.savedAt).toBe('number');
    const summary = describeSave();
    expect(summary).toContain('第 5 回合');
    expect(summary).toContain('生命 66');
  });
});

describe('坏档归零', () => {
  it('v3 载荷 JSON 损坏 / players 空 / 版本号不对 → 当作没有存档', () => {
    localStorage.setItem(V3_KEY, '{oops');
    expect(loadMatch()).toBeNull();
    localStorage.setItem(V3_KEY, JSON.stringify({ v: 3, data: { players: [] } }));
    expect(loadMatch()).toBeNull();
    localStorage.setItem(V3_KEY, JSON.stringify({ v: 2, data: { players: [{}] } }));
    expect(loadMatch()).toBeNull(); // v3 键里装旧版本数据：不认
  });
});
