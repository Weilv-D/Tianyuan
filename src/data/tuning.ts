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

/**
 * 可调键权威表：羁绊 id → 该羁绊全部可调键名。
 *
 * 来源 = `core/traits.ts` 各 `tuner(id)` 段里的全部 `t('key', …)` 字面量，
 * 与实现严格同源（补丁层按此白名单拒绝拼写错误；运行时只用于校验，不参与取值）。
 * 新增一个可调量时，`traits.ts` 里加 `t('key', …)` 后必须同步登记在这里。
 */
export const TRAIT_TUNE_KEYS: Record<string, readonly string[]> = {
  tian: ['shield0', 'shield1', 'novaSp'],
  youming: ['reviveHp', 'reviveFragilePct', 'reviveFragileDur', 'reviveAspd', 'deathHeal'],
  shanhai: ['bleed0', 'bleed1', 'wound'],
  jianzong: ['crit', 'critMult', 'armorPen', 'penBase', 'penStep', 'penCap', 'killMana'],
  yaozu: ['transformHeal', 'transformDr', 'transformAtk', 'transformAspd', 'transformAt', 'vamp0', 'vamp1'],
  momen: ['drLow', 'drHigh', 'hpUp', 'teamDr', 'regen', 'sharePct'],
  bingjia: ['teamAtk', 'teamAspd', 'growAtk', 'growAspd', 'atkUp', 'siegeAtk', 'siegeArmor'],
  jiguan: [
    'armor', 'pen', 'stackAspd', 'tickAspd', 'fourthHitAtk', 'fourthHitCrush', 'fourthHitGiant',
    'gangAtk', 'gangWindow', 'gangTargetT2', 'gangMinArmor', 'constructMr', 'thornResist',
  ],
  danding: ['manaPerSec', 'regen'],
  longyuan: ['skillAmp', 'spFlat', 'spellChargeSp', 'teamAmp', 'teamSp'],
  warrior: ['physDr', 'stackAtk'],
  guardian: [
    'allyShield', 'shieldRegen', 'thornsArmorRatio', 't2ThornsHpPct', 't2ArmorCut', 't2HpGain', 'guard6Atk',
  ],
  assassin: ['crit', 'critMult', 'breakerPct', 'openerPct', 'leapAspd'],
  marksman: ['critMult', 'atk'],
  mage: ['shield', 'shield2', 'shred', 'splash', 'teamAmp', 'teamAmp2', 'teamSp', 'teamSp2'],
  warlock: ['true0', 'true1', 'wound'],
  support: ['healAmp', 'shieldAmp', 'regen', 'deathAspd'],
};

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
