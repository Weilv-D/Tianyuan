/**
 * 本地存档。
 *
 * 存的是整个 Match 的可序列化快照（含 RNG 状态与卡池），所以读回来是**同一局**，
 * 不是"重开一局看起来差不多的"。这是"关掉网页明天继续打"成立的前提。
 *
 * v3（M4）：载荷新增 mode（对局模式）与 data.battleSnapshots（每场战斗回放快照，
 * 随 Match.toJSON 序列化）。v2 旧档在读档时自动迁移到 v3 键，迁移无损。
 *
 * 容错原则：任何解析失败都当作"没有存档"，绝不让一个坏档把游戏卡在启动页。
 */

import { Match } from './match';
import type { PlayerState } from './state';

const KEY = 'inkarena.save.v3';
/** v2 旧键：只作迁移来源。迁移成功后清除，写回失败时保留（下次读档重试迁移）。 */
const LEGACY_KEY = 'inkarena.save.v2';

export interface SaveMeta {
  round: number;
  humanHp: number;
  humanAlive: boolean;
  savedAt: number;
}

interface SavePayload {
  v?: number;
  mode?: Match['mode'];
  data?: ReturnType<Match['toJSON']>;
}

/** 解析 + 结构校验，返回可喂给 Match.fromJSON 的数据；任何异常都归零为 null */
function loadData(raw: string, expectV: number): ReturnType<Match['toJSON']> | null {
  try {
    const parsed = JSON.parse(raw) as SavePayload;
    if (!parsed || parsed.v !== expectV || !parsed.data) return null;
    // 基本结构校验，防止配额截断/旧版本残留的半截载荷把游戏搞崩：
    // fromJSON 假定的字段逐个验型，缺一样就当"没有存档"（容错原则见文件头）
    const d = parsed.data;
    if (!Array.isArray(d.players) || d.players.length === 0) return null;
    if (typeof d.rngState !== 'number' || typeof d.round !== 'number') return null;
    if (typeof d.phase !== 'string' || typeof d.pool !== 'object' || d.pool === null) return null;
    if (!Array.isArray(d.ghosts)) return null;
    // 注意：mode/battleSnapshots/humanRank 等是 v3 增量字段，v2 旧档合法地
    // 缺失、由 fromJSON 兜底 —— 校验只钉 v2/v3 共有的骨架字段
    return d;
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  try {
    if (localStorage.getItem(KEY) !== null) return true;
    // 只有 v2 旧档也算有存档：读档时会被迁移，"继续"按钮必须亮
    return localStorage.getItem(LEGACY_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveMatch(m: Match): boolean {
  try {
    const payload = { v: 3, savedAt: Date.now(), mode: m.mode, data: m.toJSON() };
    localStorage.setItem(KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    // 隐私模式 / 配额满：存档失败不应该影响正在进行的对局，但必须显式暴露，
    // 否则“继续”按钮会静默读到上一次成功的旧档，回退若干回合且无提示（M4）。
    const isQuota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
    if (isQuota) {
      console.warn('[存档] localStorage 配额已满，存档未写入，请清理浏览器存储后重试');
      try { localStorage.setItem('inkarena.save.error', String(Date.now())); } catch {}
    }
    return false;
  }
}

export function loadMatch(): Match | null {
  try {
    const v3raw = localStorage.getItem(KEY);
    if (v3raw) {
      const data = loadData(v3raw, 3);
      if (data) return Match.fromJSON(data);
      // v3 键存在但损坏：不急着判负，继续尝试旧键兜底
    }
    // ── v3 缺失（或损坏）→ 读 v2 旧档做迁移 ──
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (!legacyRaw) return null;
    const data = loadData(legacyRaw, 2);
    if (!data) return null;
    // v2 数据没有 mode / battleSnapshots 字段，fromJSON 归 'normal' / []
    const m = Match.fromJSON(data);
    // 读档成功即写回 v3（saveMatch 自吞写失败）。
    // 只有确认 v3 真正落盘后才清旧键 —— 写回失败时旧键是唯一数据源，
    // 删了就真丢了；留着等下次读档自动重试迁移。
    saveMatch(m);
    // 成功判定回读并解析：配额异常时 setItem 可能留下半截载荷，
    // 只判键存在会误报成功、下次启动重复迁移（回读失败 = 保留旧键重试）
    let migrated = false;
    try {
      const w = JSON.parse(localStorage.getItem(KEY) ?? '0') as { data?: unknown };
      migrated =
        !!w && typeof w === 'object' && 'data' in w && Match.fromJSON(w.data as Parameters<typeof Match.fromJSON>[0]).round === m.round;
    } catch {
      migrated = false;
    }
    if (migrated) {
      try {
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        /* 删不掉也无害：后续读档永远优先 v3 */
      }
    }
    return m;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
    // 旧键一并清：否则"开新对局"后 hasSave 仍会因残留旧档亮"继续"
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* 忽略 */
  }
}

export function saveMeta(): SaveMeta | null {
  const m = loadMatch();
  if (!m) return null;
  return {
    round: m.round,
    humanHp: m.human.hp,
    humanAlive: m.human.alive,
    savedAt: Date.now(),
  };
}

/** 玩家偏好（音量等），与对局存档分开存，换局不丢 */
export interface Preferences {
  volBgm: number;
  volSfx: number;
  volUi: number;
  muted: boolean;
  autoDeploy: boolean;
  /** 静观模式：震动归零、闪光关闭、飘字去冲击缩放、天命之印缩短（前庭敏感/低配降级档） */
  calm: boolean;
  /** 典藏音乐：授权 CC0 曲目接管 BGM（关 = 程序化五声音阶合成，D4） */
  licensedMusic: boolean;
}

const PREF_KEY = 'inkarena.prefs.v1';

export const DEFAULT_PREFS: Preferences = {
  volBgm: 0.5,
  volSfx: 0.75,
  volUi: 0.6,
  muted: false,
  autoDeploy: true,
  calm: false,
  licensedMusic: true,
};

export function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    const out: Preferences = { ...DEFAULT_PREFS };
    if (typeof parsed.volBgm === 'number' && Number.isFinite(parsed.volBgm)) out.volBgm = Math.max(0, Math.min(1, parsed.volBgm));
    if (typeof parsed.volSfx === 'number' && Number.isFinite(parsed.volSfx)) out.volSfx = Math.max(0, Math.min(1, parsed.volSfx));
    if (typeof parsed.volUi === 'number' && Number.isFinite(parsed.volUi)) out.volUi = Math.max(0, Math.min(1, parsed.volUi));
    if (typeof parsed.muted === 'boolean') out.muted = parsed.muted;
    if (typeof parsed.autoDeploy === 'boolean') out.autoDeploy = parsed.autoDeploy;
    if (typeof parsed.calm === 'boolean') out.calm = parsed.calm;
    if (typeof parsed.licensedMusic === 'boolean') out.licensedMusic = parsed.licensedMusic;
    return out;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Preferences): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* 忽略 */
  }
}

/** 供 UI 展示用的一行摘要 */
export function describeSave(): string {
  const m = loadMatch();
  if (!m) return '';
  const p = m.players[0] as PlayerState | undefined;
  return p ? `第 ${m.round} 回合 · 生命 ${p.hp} · 等级 ${p.level}` : `第 ${m.round} 回合`;
}
