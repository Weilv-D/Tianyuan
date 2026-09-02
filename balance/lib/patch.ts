/**
 * 数值补丁层 —— 扫描框架的写入面（原 scripts/lib/patch.ts 原样迁入）。
 *
 * 路径语法（六类，全部指向"已存在的数字字段"，禁止凭空造字段）：
 *   cfg.<字段>                    机制软化常量（core/config.ts 的 MECH / MATCH_TUNING 字段）
 *   legend.<字段>                 天命包数值（core/config.ts 的 LEGEND_T3 数字字段）
 *   champ.<defId>.base.<field>    基础面板：hp/atk/sp/armor/mr/aspd/range/moveTime/startMp/maxMp/critChance/critMult
 *   champ.<defId>.skill.<param>   技能参数：skillSpec.params 里的数字键（如 atk、value、radius）
 *   trait.<id>.scale              整条羁绊等比缩放
 *   trait.<id>.<key>              羁绊单点覆盖（key 必须是 tuning.ts TRAIT_TUNE_KEYS 登记键，
 *                                 与 core/traits.ts 里 tune() 的读取键同源 —— 拼错当场报错）
 */
import { CHAMPION_BY_ID } from '../../src/data/champions';
import { resetTuning, TRAIT_TUNING, TRAIT_TUNING_KEYS, TRAIT_TUNE_KEYS } from '../../src/data/tuning';
import { LEGEND_T3, MATCH_TUNING, MECH } from '../../src/core/config';

export type Overrides = Record<string, number>;

interface JournalEntry {
  obj: Record<string, unknown>;
  key: string;
  had: boolean;
  prev: unknown;
}

const CHAMP_BASE_FIELDS = new Set([
  'hp', 'atk', 'sp', 'armor', 'mr', 'aspd', 'range', 'moveTime', 'startMp', 'maxMp', 'critChance', 'critMult',
]);

function setNumber(target: Record<string, unknown>, key: string, value: number, path: string, journal: JournalEntry[], allowNew = false): void {
  const has = key in target;
  if (!has && !allowNew) throw new Error(`patch 目标不存在：${path}`);
  if (has && typeof target[key] !== 'number') throw new Error(`patch 目标不是数字：${path}`);
  journal.push({ obj: target, key, had: has, prev: target[key] });
  target[key] = value;
}

export class Patcher {
  private journal: JournalEntry[] = [];

  apply(ov: Overrides): void {
    for (const [path, value] of Object.entries(ov)) this.set(path, value);
  }

  private set(path: string, value: number): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`patch 值必须是有限数字：${path}=${value}`);
    // cfg.<字段>：机制/对局常量块单点覆盖（两段路径，先于三段正则判断）
    const cfgM = /^cfg\.([A-Za-z0-9_]+)$/.exec(path);
    if (cfgM) {
      const field = cfgM[1];
      const target = field in MECH ? MECH : field in MATCH_TUNING ? MATCH_TUNING : null;
      if (!target) throw new Error(`cfg 里没有字段 ${field}（MECH / MATCH_TUNING）：${path}`);
      setNumber(target as unknown as Record<string, unknown>, field, value, path, this.journal);
      return;
    }
    // legend.<字段>：天命包单点覆盖（legend 命令的口径 2 用它把包归零）
    const legendM = /^legend\.([A-Za-z0-9_]+)$/.exec(path);
    if (legendM) {
      const field = legendM[1];
      if (!(field in LEGEND_T3)) throw new Error(`LEGEND_T3 里没有字段 ${field}：${path}`);
      setNumber(LEGEND_T3 as unknown as Record<string, unknown>, field, value, path, this.journal);
      return;
    }
    const m = /^([a-z]+)\.([A-Za-z0-9_]+)\.(.+)$/.exec(path);
    if (!m) throw new Error(`patch 路径不合法（应为 cfg.x / champ.x.y / trait.x.y）：${path}`);

    const [, kind, id, rest] = m;
    if (kind === 'champ') {
      const def = CHAMPION_BY_ID[id];
      if (!def) throw new Error(`未知的棋子 id：${id}`);
      if (rest.startsWith('base.')) {
        const field = rest.slice(5);
        if (!CHAMP_BASE_FIELDS.has(field)) throw new Error(`base 里没有字段 ${field}：${path}`);
        setNumber(def.base as unknown as Record<string, unknown>, field, value, path, this.journal);
      } else if (rest.startsWith('skill.')) {
        const key = rest.slice(6);
        const params = def.skillSpec.params as unknown as Record<string, unknown>;
        setNumber(params, key, value, path, this.journal);
      } else {
        throw new Error(`champ 路径只支持 base.* 与 skill.*：${path}`);
      }
      return;
    }
    if (kind === 'trait') {
      if (rest === 'scale') {
        // 整条羁绊等比缩放也必须落在已知羁绊上：错拼 id（如 momen 打成 momem）
        // 会在 TRAIT_TUNING 里静默造键 —— traits.ts 的 tune() 只读真 id 的键，
        // 扫描方以为压了整条羁绊，实际改了个寂寞，结果失真且无告警
        if (!TRAIT_TUNE_KEYS[id]) throw new Error(`未知的羁绊 id：${id}（${path}；可缩放羁绊见 tuning.ts TRAIT_TUNE_KEYS）`);
        setNumber(TRAIT_TUNING as unknown as Record<string, unknown>, id, value, path, this.journal, true);
        return;
      }
      // 单点覆盖只允许 traits.ts 里实际存在、经 tune() 读取的键 ——
      // 拼写错误（trait.momen.amor）必须当场抛错，而不是静默造键让扫描结果失真
      const known = TRAIT_TUNE_KEYS[id];
      if (!known) throw new Error(`未知的羁绊 id：${id}（${path}；可调羁绊见 tuning.ts TRAIT_TUNE_KEYS）`);
      if (!known.includes(rest)) {
        throw new Error(`羁绊 ${id} 没有可调键 ${rest}（${path}；可选键：${known.join(' / ')}）`);
      }
      const bucket = (TRAIT_TUNING_KEYS as unknown as Record<string, unknown>)[id] as Record<string, number> | undefined;
      if (!bucket) {
        (TRAIT_TUNING_KEYS as unknown as Record<string, unknown>)[id] = { [rest]: value };
        this.journal.push({ obj: TRAIT_TUNING_KEYS as unknown as Record<string, unknown>, key: id, had: false, prev: undefined });
      } else {
        setNumber(bucket as unknown as Record<string, unknown>, rest, value, path, this.journal);
      }
      return;
    }
    throw new Error(`未知的 patch 类别：${kind}`);
  }

  /** 逆序还原全部写入（含羁绊调参表） */
  reset(): void {
    // 只在真正 apply 过（journal 非空）才还原 + 全局 resetTuning：
    // 嵌套 withOverrides 时内层的无条件 reset 会把外层已打的补丁一并清掉
    if (this.journal.length === 0) return;
    for (let i = this.journal.length - 1; i >= 0; i--) {
      const e = this.journal[i];
      if (e.had) e.obj[e.key] = e.prev;
      else delete e.obj[e.key];
    }
    this.journal.length = 0;
    resetTuning();
  }
}

/** 打补丁 → 执行 → 必定还原。串行执行路径的标准包装。 */
export function withOverrides<T>(ov: Overrides | null | undefined, fn: () => T): T {
  const p = new Patcher();
  if (ov && Object.keys(ov).length > 0) p.apply(ov);
  try {
    return fn();
  } finally {
    p.reset();
  }
}

/** 读一个路径的当前值（报告里展示"基准值"用）。羁绊单点键不在表里时返回 undefined。 */
export function readCurrent(path: string): number | undefined {
  // cfg.<字段>：读机制/对局常量块（两段路径，先于三段正则判断）
  const cfgM = /^cfg\.([A-Za-z0-9_]+)$/.exec(path);
  if (cfgM) {
    const v = (MECH as unknown as Record<string, unknown>)[cfgM[1]] ??
      (MATCH_TUNING as unknown as Record<string, unknown>)[cfgM[1]];
    return typeof v === 'number' ? v : undefined;
  }
  const m = /^([a-z]+)\.([A-Za-z0-9_]+)\.(.+)$/.exec(path);
  if (!m) return undefined;
  const [, kind, id, rest] = m;
  if (kind === 'champ') {
    const def = CHAMPION_BY_ID[id];
    if (!def) return undefined;
    if (rest.startsWith('base.')) {
      const v = (def.base as unknown as Record<string, number>)[rest.slice(5)];
      return typeof v === 'number' ? v : undefined;
    }
    if (rest.startsWith('skill.')) {
      const v = (def.skillSpec.params as unknown as Record<string, number>)[rest.slice(6)];
      return typeof v === 'number' ? v : undefined;
    }
    return undefined;
  }
  if (kind === 'trait') {
    if (rest === 'scale') return TRAIT_TUNING[id] ?? 1;
    const v = TRAIT_TUNING_KEYS[id]?.[rest];
    return typeof v === 'number' ? v : undefined;
  }
  return undefined;
}
