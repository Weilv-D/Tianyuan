import type { BattleEvent, FxKind } from './events';
import type { Rng } from './rng';
import type { Cell, DamageType, StatusKind, TeamId } from './types';
import type { Unit } from './unit';
import type { TargetMode } from '../data/champions';

/**
 * 单位身上由羁绊 / 装备沉淀下来的修正。
 *
 * 为什么挂在单位而不是挂在队伍上：自走棋的常规是"羁绊加成作用于持有该羁绊的棋子"，
 * 只有明确写"全体友军"的效果才作用于全队。挂在单位上让"谁吃到了加成"永远可解释。
 */
export interface TraitState {
  /** 技能伤害加成 */
  skillAmp: number;
  /** 技能伤害转为真实伤害的比例（术士） */
  skillTrueRatio: number;
  physicalDr: number;
  magicDr: number;
  allDr: number;
  /** 无视目标护甲的比例（0~1）。高护甲阵容的天然克星。 */
  armorPen: number;
  /** 木石之躯：受到"反弹类"伤害的减免比例（0~1）。机关构装体的荆棘抗性。 */
  thornResist: number;
  healAmp: number;
  shieldAmp: number;
  manaPerSec: number;
  hpRegenPctPerSec: number;
  /** 承受伤害转化法力的倍率（装备：狮心盾）。1 = 原口径。 */
  manaFromDamageMult: number;
  /** 技能暴击率（装备：惊雷锤）。dealDamage 对 source='skill' 的伤害按此掷骰。 */
  skillCritChance: number;
  /** 技能暴击倍率（绝对值；0 = 回落持有者普攻暴伤）。 */
  skillCritMult: number;
  /** 已激活羁绊 → 档位+1（0 表示未激活）。供战斗内循环做 O(1) 查询。 */
  tier: Record<string, number>;
  /** 累计伤害加深（余烬阶段等全局效果单独处理） */
}

export function createTraitState(): TraitState {
  return {
    skillAmp: 0,
    skillTrueRatio: 0,
    physicalDr: 0,
    magicDr: 0,
    allDr: 0,
    armorPen: 0,
    thornResist: 0,
    healAmp: 0,
    shieldAmp: 0,
    manaPerSec: 0,
    hpRegenPctPerSec: 0,
    manaFromDamageMult: 1,
    skillCritChance: 0,
    skillCritMult: 0,
    tier: {},
  };
}

/** 伤害结算的可选参数 */
export interface DamageOptions {
  source?: 'attack' | 'skill' | 'dot' | 'trait' | 'item';
  canCrit?: boolean;
  forceCrit?: boolean;
  /** 是否触发攻击类钩子（山海流血、武将叠层…） */
  isAttack?: boolean;
  /** 由反伤等"派生伤害"置位，防止 A 反弹给 B、B 再反弹给 A 的无限递归 */
  noReflect?: boolean;
  /** 由墨门「兼爱」分摊伤害置位，防止分摊再次触发分摊的递归 */
  noShare?: boolean;
  /** 豁免真伤单跳上限（MECH.trueHitCapRatio）。仅供处决类技能的
   *  "低于阈值直接斩杀"一跳使用 —— 该跳语义是裁定死亡而非输出伤害 */
  ignoreTrueCap?: boolean;
  /** 静默伤害：正常结算但不发 damage 事件（用于高频小额分摊，避免飘字刷屏） */
  silent?: boolean;
}

/**
 * 抗性、减伤与真伤上限结算后的伤害包。
 * 重定向类机制可以减少目标实际承受量，并把派生伤害延后到本次命中完成后执行。
 */
export interface IncomingDamage {
  amount: number;
  deferred: (() => void)[];
}

/**
 * 普攻结算前的可变修正包。
 * 神射"每 3 次必爆"、龙渊"施法后附伤"、机关"每 4 次额外伤害"都通过这个口子注入，
 * 战斗主循环只认这一个契约，加新机制不必改循环。
 */
export interface AttackModifier {
  forceCrit: boolean;
  /** 额外附加的法术伤害（绝对值） */
  bonusMagic: number;
  /** 额外附加的物理伤害（绝对值） */
  bonusPhysical: number;
}

/** 钩子签名表 */
export interface BattleHooks {
  onBattleStart: ((api: BattleApi, team: number) => void)[];
  onTick: ((api: BattleApi, team: number, tick: number) => void)[];
  onPreAttack: ((api: BattleApi, src: Unit, dst: Unit, mod: AttackModifier) => void)[];
  onAttackHit: ((api: BattleApi, src: Unit, dst: Unit, amount: number, type: DamageType) => void)[];
  onDamageDealt: ((api: BattleApi, src: Unit, dst: Unit, amount: number, type: DamageType, source: string) => void)[];
  onIncomingDamage: ((api: BattleApi, dst: Unit, src: Unit | null, damage: IncomingDamage, type: DamageType, opts: DamageOptions) => void)[];
  onDamageTaken: ((api: BattleApi, dst: Unit, src: Unit | null, amount: number, type: DamageType, opts: DamageOptions) => void)[];
  onKill: ((api: BattleApi, killer: Unit, victim: Unit) => void)[];
  onDeath: ((api: BattleApi, victim: Unit, killer: Unit | null) => void)[];
  onCast: ((api: BattleApi, unit: Unit) => void)[];
  onShieldBreak: ((api: BattleApi, unit: Unit) => void)[];
  /** 治疗溢出。带上 src 是因为「回天符」这类装备挂在**治疗者**身上，
   *  只拿到被治疗者无法判断该不该触发。 */
  onHealOverflow: ((api: BattleApi, target: Unit, src: Unit | null, overflow: number) => void)[];
}

export function createHooks(): BattleHooks {
  return {
    onBattleStart: [],
    onTick: [],
    onPreAttack: [],
    onAttackHit: [],
    onDamageDealt: [],
    onIncomingDamage: [],
    onDamageTaken: [],
    onKill: [],
    onDeath: [],
    onCast: [],
    onShieldBreak: [],
    onHealOverflow: [],
  };
}

/** 持续区域（地面法阵 / 墨池 / 潮汐） */
export interface ZoneOptions {
  cell: Cell;
  radius: number;
  /** 持续秒数 */
  dur: number;
  srcUid: number;
  team: number;
  /** 每秒伤害（0 表示纯状态区域） */
  dps: number;
  type: DamageType;
  status?: { kind: StatusKind; dur: number; value: number };
  /** 跟随某单位移动（不动明王的火环） */
  followUid?: number;
  fx?: FxKind;
}

/**
 * 战斗内核对外暴露的能力面。技能、羁绊、装备都只通过它作用于战场，
 * 由此保证"加内容不改逻辑"。
 */
export interface BattleApi {
  readonly rng: Rng;
  readonly tick: number;
  readonly units: readonly Unit[];

  unitByUid(uid: number): Unit | null;
  aliveUnits(): Unit[];
  alliesOf(u: Unit): Unit[];
  enemiesOf(u: Unit): Unit[];
  hooksOf(team: number): BattleHooks;
  /**
   * 与 team 敌对的全部队伍号（升序，顺序确定）。
   * 取代此前 `1 - team` 的硬编码推算 —— 那要求 team 恒为 0/1，
   * 一旦出现第三个队伍号就会静默失效：钩子挂到不存在的队伍上，
   * 机制无声消失（不报错、不影响胜负，只是伤害没了），极难排查。
   */
  enemyTeamsOf(team: TeamId): TeamId[];

  emit(e: BattleEvent): void;
  fx(
    kind: FxKind,
    opts: {
      uid?: number;
      cell?: Cell;
      targetUid?: number;
      radius?: number;
      team?: number;
      params?: Record<string, number>;
    },
  ): void;

  occupied(c: number, r: number): boolean;
  unitAt(c: number, r: number): Unit | null;
  unitsInRadius(center: Cell, radius: number, team?: number): Unit[];
  /** 目标选择（含 allEnemies / enemyDensest 等策略） */
  resolveTargets(u: Unit, mode: TargetMode, count?: number): Unit[];
  resolveTargetCell(u: Unit, mode: TargetMode): Cell;

  dealDamage(src: Unit | null, dst: Unit, raw: number, type: DamageType, opts?: DamageOptions): number;
  heal(src: Unit | null, dst: Unit, amount: number, source: 'skill' | 'trait' | 'item'): number;
  addShield(src: Unit | null, dst: Unit, amount: number, dur: number): void;
  addStatus(src: Unit, dst: Unit, kind: StatusKind, dur: number, value: number): void;
  removeStatus(u: Unit, kind: StatusKind): void;
  addDot(src: Unit, dst: Unit, kind: 'burn' | 'bleed', dps: number, dur: number, type: DamageType): void;

  teleport(u: Unit, cell: Cell, dur: number): void;
  knockback(u: Unit, from: Cell, distance: number): void;
  summon(src: Unit, cell: Cell, hpPct: number, atkPct: number): Unit | null;
  revive(u: Unit, hpPct: number, src: Unit): void;
  /** 生成一片持续区域（墨池 / 潮汐 / 明王火环） */
  addZone(o: ZoneOptions): void;

  /** 延迟执行（秒）。用于弹幕、延迟雷击、多段剑雨。 */
  schedule(delaySeconds: number, fn: (api: BattleApi) => void): void;
  /**
   * 延迟复活（秒）：除延迟语义外，在复活兑现前 checkEnd 不终局 ——
   * 否则持有者作为本队最后单位阵亡时，复活窗会被即时胜负判定吞掉。
   */
  scheduleRevive(u: Unit, delaySeconds: number, hpPct: number): void;

  /** 余烬阶段的全局增伤 */
  overtimeAmp(): number;
}
