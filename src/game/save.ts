/**
 * 本地存档。
 *
 * 存的是整个 Match 的可序列化快照（含 RNG 状态与卡池），所以读回来是**同一局**，
 * 不是"重开一局看起来差不多的"。这是"关掉网页明天继续打"成立的前提。
 *
 * v3（M4）：载荷新增 mode（对局模式）与 data.battleSnapshots（每场战斗回放快照，
 * 随 Match.toJSON 序列化）。v2 旧档在读档时自动迁移到 v3 键，迁移无损。
 *
 * v3.1：普通档与每日挑战档**分键**（`inkarena.save.v3` / `inkarena.save.v3.daily`）。
 * 此前两模式共用一个键，玩每日挑战会静默覆盖普通档进度、"继续对局"读回的是
 * 每日残档 —— 进度被跨模式污染。载荷内的 mode 字段保留作自描述。
 *
 * 容错原则：任何解析失败都当作"没有存档"，绝不让一个坏档把游戏卡在启动页。
 */

import { Match } from './match';

/** 对局模式 → 存档键。普通档沿用 v3 原键（旧档无需迁移）。 */
const KEY_BY_MODE: Record<Match['mode'], string> = {
  normal: 'inkarena.save.v3',
  daily: 'inkarena.save.v3.daily',
};
/** v2 旧键：只作迁移来源（v2 时代只有普通档）。迁移成功后清除，写回失败时保留（下次读档重试迁移）。 */
const LEGACY_KEY = 'inkarena.save.v2';

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

export function hasSave(mode: Match['mode'] = 'normal'): boolean {
  try {
    if (localStorage.getItem(KEY_BY_MODE[mode]) !== null) {
      // 键存在不等于有可用存档：配额半截写入 / 手动改坏 / 旧版本残留的损坏载荷
      // 会让"继续"常亮，点进去却被 loadMatch 判空 —— 入口必须与读档同口径
      //（loadData 校验）。损坏键在此一并清除，避免每次都走"判定失败"路径。
      const raw = localStorage.getItem(KEY_BY_MODE[mode]) ?? '';
      if (loadData(raw, 3)) return true;
      try {
        localStorage.removeItem(KEY_BY_MODE[mode]);
      } catch {
        /* 清不掉也照常判无存档 */
      }
      // v3 键损坏但普通档仍有 v2 旧档可迁移 → "继续"仍亮（与 loadMatch 兜底同口径）：
      // 旧键同样验内容 —— 损坏的 v2 载荷不算有存档，且顺手清掉（loadMatch 同款自愈）
      return mode === 'normal' && hasLegacySave();
    }
    // 只有 v2 旧档也算普通档有存档：读档时会被迁移，"继续"按钮必须亮
    return mode === 'normal' && hasLegacySave();
  } catch {
    return false;
  }
}

/** v2 遗留键的"有存档"判定：验型失败即清除（与 loadMatch 的自愈路径同口径） */
function hasLegacySave(): boolean {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw === null) return false;
    if (loadData(raw, 2)) return true;
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* 读不出/清不掉都按无旧档处理 */
  }
  return false;
}

export function saveMatch(m: Match): boolean {
  try {
    // savedAt 仅排查用元数据：不进 seed/rng 流，不影响对局确定性
    //（game 层 Date.now 的唯一白名单点就是本文件）
    const payload = { v: 3, savedAt: Date.now(), mode: m.mode, data: m.toJSON() };
    localStorage.setItem(KEY_BY_MODE[m.mode], JSON.stringify(payload));
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

export function loadMatch(mode: Match['mode'] = 'normal'): Match | null {
  try {
    const key = KEY_BY_MODE[mode];
    const raw = localStorage.getItem(key);
    if (raw) {
      const data = loadData(raw, 3);
      if (data) {
        try {
          return Match.fromJSON(data);
        } catch {
          // 骨架字段通过但深层结构损坏（beastBoard/players[i].board 类型错、
          // 幽灵快照坏元素等）：fromJSON 抛错。与"损坏即无档"同口径 ——
          // 清掉坏键，避免"继续"入口亮着却永远点不进（坏档自愈）。
          try {
            localStorage.removeItem(key);
          } catch {
            /* 清不掉也无害：hasSave 判无存档 */
          }
          return null;
        }
      }
      // 键存在但损坏：普通档继续尝试旧键兜底，但损坏的 v3 键不能再残留 ——
      // 否则"继续"入口会被它长期误导（hasSave 判定失败后同样清理，双口径一致）。
      // 每日档无旧键可兜底：清掉坏键即自愈，下次开局从干净状态走。
      try {
        localStorage.removeItem(key);
      } catch {
        /* 清不掉也无害：hasSave 会与读档同口径判无存档 */
      }
    }
    if (mode !== 'normal') return null;
    // ── 普通档缺失（或损坏）→ 读 v2 旧档做迁移 ──
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (!legacyRaw) return null;
    const data = loadData(legacyRaw, 2);
    if (!data) {
      // v2 旧档损坏（配额半截写入/手动改坏/版本残留）：与 v3 坏键同一自愈口径。
      // 不清理的话 hasSave 只看键存在性仍会亮「继续」，loadMatch 却永远读不出
      // 存档 —— 入口常亮却点不进的坏档幽灵（v3 坏键已清，v2 坏键此前漏了）
      try {
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        /* 清不掉也无害：hasSave 判 v3 无档且 v2 仍在时会二次走这里 */
      }
      return null;
    }
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
      const w = JSON.parse(localStorage.getItem(key) ?? '0') as { data?: unknown };
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

/** 清除指定模式的存档。对局结束/放弃只清本局模式，不波及另一模式的进度。 */
export function clearSave(mode: Match['mode'] = 'normal'): void {
  try {
    localStorage.removeItem(KEY_BY_MODE[mode]);
    // 旧键一并清（仅普通档）：否则"开新对局"后 hasSave 仍会因残留旧档亮"继续"
    if (mode === 'normal') localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* 忽略 */
  }
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

/** 无本地偏好时的出厂默认：跟随系统"减少动态效果"设置（前庭敏感用户首次进入即得舒适档）。
 *  用户在设置面板明确选择后以用户为准 —— 面板写入即落盘，此后不再读系统值。 */
function systemAwareDefaults(): Preferences {
  let calm = DEFAULT_PREFS.calm;
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      calm = true;
    }
  } catch {
    /* 无 matchMedia 环境（测试/嵌入式）按标准默认 */
  }
  return { ...DEFAULT_PREFS, calm };
}

export function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return systemAwareDefaults();
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    const out: Preferences = { ...systemAwareDefaults() };
    if (typeof parsed.volBgm === 'number' && Number.isFinite(parsed.volBgm)) out.volBgm = Math.max(0, Math.min(1, parsed.volBgm));
    if (typeof parsed.volSfx === 'number' && Number.isFinite(parsed.volSfx)) out.volSfx = Math.max(0, Math.min(1, parsed.volSfx));
    if (typeof parsed.volUi === 'number' && Number.isFinite(parsed.volUi)) out.volUi = Math.max(0, Math.min(1, parsed.volUi));
    if (typeof parsed.muted === 'boolean') out.muted = parsed.muted;
    if (typeof parsed.autoDeploy === 'boolean') out.autoDeploy = parsed.autoDeploy;
    if (typeof parsed.calm === 'boolean') out.calm = parsed.calm;
    if (typeof parsed.licensedMusic === 'boolean') out.licensedMusic = parsed.licensedMusic;
    return out;
  } catch {
    return systemAwareDefaults();
  }
}

export function savePrefs(p: Preferences): boolean {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
    return true;
  } catch {
    // 拖动音量等高频路径保持静默（对局存档的失败提示口径不适用于每次 pointermove）；
    // 返回值供设置面板关闭路径做一次性可见提示
    return false;
  }
}
