/**
 * 羁绊数值调参表 —— 平衡扫描框架的数据面。
 *
 * `core/traits.ts` 里所有"羁绊给了多少"的量级数字都经 tune() 查这张表：
 *  - 表为空时返回代码字面量（默认值），行为与历史完全一致；
 *  - 写入 KEYS[id][key] 可对单个数字做精确覆盖；
 *  - 写入 SCALE[id] = m 可对整条羁绊做等比缩放（快速灵敏度探测）。
 *
 * 覆盖只应发生在无头模拟进程里（scripts/），线上游戏进程永远读到默认值。
 */

/** 整条羁绊的等比缩放（缺省 = 不缩放） */
export const TRAIT_TUNING: Record<string, number> = {};

/** 单点覆盖：羁绊 id → 数字键 → 绝对值 */
export const TRAIT_TUNING_KEYS: Record<string, Record<string, number>> = {};

/** 查一个羁绊数字。key 不在表里时用默认值（可再乘整条缩放）。 */
export function tune(id: string, key: string, def: number): number {
  const keys = TRAIT_TUNING_KEYS[id];
  if (keys && key in keys) return keys[key];
  const scale = TRAIT_TUNING[id];
  return scale === undefined ? def : def * scale;
}

/** 清空全部覆盖（扫描器在每个配置跑完后调用，保证配置间互不渗透） */
export function resetTuning(): void {
  for (const k of Object.keys(TRAIT_TUNING)) delete TRAIT_TUNING[k];
  for (const k of Object.keys(TRAIT_TUNING_KEYS)) delete TRAIT_TUNING_KEYS[k];
}
