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
 *
 * 可 cfg. 覆盖的面 = MECH + MATCH_TUNING 两个数字块（sweep/sensitivity.json 的
 * cfg.* 键只在这两块的字段名内合法）。config.ts 其余常量（GLOBAL_HP_SCALE、
 * STAR_*_SCALE、POOL_COUNTS、SHOP_ODDS、ROUND_BASE_DAMAGE、XP_* 等）不在此列 ——
 * 它们是"调平衡改源码"的那一面，不参与线上扫描覆盖；需要扫它们请改源码后重跑。
 * LEGEND_T3 单独走 legend.* 前缀（口径 2 把天命包归零时用）。
 */
import { CHAMPION_BY_ID } from '../../src/data/champions';
import { TRAIT_TUNING, TRAIT_TUNING_KEYS, TRAIT_TUNE_KEYS } from '../../src/data/tuning';
import { LEGEND_T3, MATCH_TUNING, MECH } from '../../src/core/config';

export type Overrides = Record<string, number>;

interface JournalEntry {
  obj: Record<string, unknown>;
  key: string;
  had: boolean;
  prev: unknown;
  /** 建桶标记：reset 逆序时桶键删空后整桶移除（仅当桶仍由本实例持有） */
  createdBucket?: boolean;
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
        // 建桶：reset 时若本实例建的桶已无任何键就整桶移除，不残留空桶 —— 空桶
        // 会让后续写侧走"键不存在"报错。桶一旦被外层复用（外层先建桶、内层往里
        // 加键），内层 reset 不能删桶 —— 用"键级回退 + 空桶清理"两层处理。
        const fresh = { [rest]: value };
        (TRAIT_TUNING_KEYS as unknown as Record<string, unknown>)[id] = fresh;
        this.journal.push({ obj: fresh, key: rest, had: false, prev: undefined });
        this.journal.push({ obj: TRAIT_TUNING_KEYS as unknown as Record<string, unknown>, key: id, had: false, prev: undefined, createdBucket: true });
      } else {
        // 桶已存在：单点覆盖允许把"尚未覆盖过的键"从默认值覆盖为新值 ——
        // 白名单（known.includes）已保证键合法，不能用 setNumber 的"键必须
        // 已存在"检查（那只适用于 champ.base/cfg 这类字段固定存在的面）
        const hadKey = rest in bucket;
        this.journal.push({ obj: bucket, key: rest, had: hadKey, prev: bucket[rest] });
        bucket[rest] = value;
      }
      return;
    }
    throw new Error(`未知的 patch 类别：${kind}`);
  }

  /**
   * 逆序还原本补丁的全部写入（含羁绊调参表）。
   *
   * 嵌套口径：本实例只回退自己的 journal —— 内层 withOverrides 还原时绝不动
   * 外层已打、仍在该生效的补丁（历史实现里 reset 无条件 resetTuning() 清空
   * 整张调参表，嵌套时会把外层补丁一并清掉，外层 journal 却仍以为有效；
   * 现按"本实例写过的键"逐键回退，天然支持嵌套）。trait 单点覆盖的
   * TRAIT_TUNING_KEYS[id] 桶由本实例建档时同样还原（delete 空桶或回旧值）。
   */
  reset(): void {
    // 键级回退（逆序）+ 建桶清理：建桶记录必须在所有键删除**之后**才判定
    // 空桶（键删除走逆序，桶清理放第二遍 —— 否则逆序先碰到桶记录时桶还没删键）
    for (let i = this.journal.length - 1; i >= 0; i--) {
      const e = this.journal[i];
      if (e.createdBucket) continue;
      if (e.had) e.obj[e.key] = e.prev;
      else delete e.obj[e.key];
    }
    for (const e of this.journal) {
      if (!e.createdBucket) continue;
      // 桶由本实例新建：键已全部还原，桶若空则整桶移除（不残留空桶误导后续写侧）；
      // 若外层在同一 id 上复用本桶加了别的键，键未空则不删 —— 嵌套语义安全
      const b = e.obj[e.key] as Record<string, number> | undefined;
      if (b && Object.keys(b).length === 0) delete e.obj[e.key];
    }
    this.journal.length = 0;
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
  // legend.<字段>：读天命包单点（与 set 侧的 legend 分支同源 —— 只加写侧会让
  // sweep/ab 的报告里基准值显示 ?，补丁往返可读性破口）
  const legendM = /^legend\.([A-Za-z0-9_]+)$/.exec(path);
  if (legendM) {
    const v = (LEGEND_T3 as unknown as Record<string, unknown>)[legendM[1]];
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
