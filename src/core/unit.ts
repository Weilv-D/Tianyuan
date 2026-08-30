import { GLOBAL_HP_SCALE, STAR_HP_SCALE, STAR_POWER_SCALE, RESIST_CAP } from './config';
import { itemEffects } from './items';
import { createTraitState, type BattleApi, type TraitState } from './api';
import { CHAMPION_BY_ID, type ChampionEntry } from '../data/champions';
import type { BattleUnitInput, Cell, Star, StatusEffect, StatusKind, TeamId } from './types';

/** 战斗中的单位运行时状态。纯数据 + 少量查询方法，不含渲染。 */
export interface Unit {
  uid: number;
  entry: ChampionEntry;
  team: TeamId;
  star: Star;
  isMinion: boolean;
  /** 墨兽（PvE 单位），仅影响渲染 */
  isMonster: boolean;

  // ── 静态面板（已含装备加成，不含临时状态） ──
  maxHp: number;
  hp: number;
  atk: number;
  sp: number;
  baseArmor: number;
  baseMr: number;
  baseAspd: number;
  range: number;
  moveTime: number;
  critChance: number;
  critMult: number;
  lifesteal: number;
  omnivamp: number;
  /** 全局增伤（装备 / 羁绊） */
  damageAmp: number;

  // ── 法力 ──
  mp: number;
  maxMp: number;
  manaLock: number;

  // ── 位置 ──
  cell: Cell;
  alive: boolean;
  /** 渲染用：上一次移动的起止与插值进度 */
  moveFrom: Cell | null;
  moveTo: Cell | null;
  moveT: number;
  moveDur: number;

  // ── 状态 ──
  shield: number;
  statuses: StatusEffect[];
  /** 永久叠层（羁绊/技能的成长型加成） */
  permAtkPct: number;
  permAspdPct: number;
  /** 免疫控制计数（>0 时不可被控） */
  ccImmune: number;
  /** 羁绊 / 装备沉淀下来的修正 */
  trait: TraitState;
  /** 装备 id 列表（内核只读，用于钩子判定与结算展示） */
  itemIds: string[];
  /** 装备提供的行为钩子 id */
  itemHooks: string[];
  /** 已经消耗掉的"一次性"装备机制（如不朽衣的复活） */
  itemUsed: Set<string>;
  /** 各类"叠层数"计数器（武将层数、机关层数…） */
  traitStacks: Record<string, number>;
  /** 击杀回调（技能自定义延拓，例如苍嗥「狂血」击杀续期） */
  killHandlers: ((api: BattleApi, victim: Unit) => void)[];

  // ── 行为计时器（秒） ──
  attackCd: number;
  windupLeft: number;
  windupTotal: number;
  windupTargetUid: number;
  moveCd: number;
  retargetCd: number;
  castWindupLeft: number;
  targetUid: number;
  castCount: number;
  /** 普攻计数，供"每 N 次攻击"类机制使用 */
  attackCount: number;

  // ── 生命周期 ──
  revived: boolean;
  yaozuTransformed: boolean;
  dandingReviveUsed: boolean;

  // ── 统计 ──
  dealtDamage: number;
  takenDamage: number;
  healed: number;
  kills: number;
}

export function createUnit(input: BattleUnitInput): Unit {
  const entry = CHAMPION_BY_ID[input.defId];
  if (!entry) throw new Error(`未知棋子: ${input.defId}`);
  const b = entry.base;
  const si = input.star - 1;
  const hpScale = STAR_HP_SCALE[si];
  const powScale = STAR_POWER_SCALE[si];
  const eff = itemEffects(input.items ?? []);
  // 装备加成与外部传入的 bonus 合并：装备写在前面，外部覆盖写在后面
  const bonus = { ...eff.bonus, ...(input.bonus ?? {}) } as NonNullable<BattleUnitInput['bonus']>;

  const maxHp = Math.round(b.hp * hpScale * GLOBAL_HP_SCALE + (bonus.hp ?? 0));
  const startMp = Math.min(b.startMp + (bonus.startMp ?? 0), b.maxMp);

  return {
    uid: input.uid,
    entry,
    team: input.team,
    star: input.star,
    isMinion: false,
    isMonster: input.monster ?? false,

    maxHp,
    hp: maxHp,
    atk: Math.round(b.atk * powScale + (bonus.atk ?? 0)),
    sp: Math.round(b.sp * powScale + (bonus.sp ?? 0)),
    baseArmor: b.armor + (bonus.armor ?? 0),
    baseMr: b.mr + (bonus.mr ?? 0),
    baseAspd: b.aspd * (1 + (bonus.aspd ?? 0)),
    range: b.range,
    moveTime: b.moveTime,
    critChance: b.critChance + (bonus.critChance ?? 0),
    // 装备的暴伤加成（影袭）必须并入，否则是死数值
    critMult: b.critMult + (bonus.critMult ?? 0),
    lifesteal: bonus.lifesteal ?? 0,
    omnivamp: bonus.omnivamp ?? 0,
    damageAmp: bonus.damageAmp ?? 0,

    mp: startMp,
    maxMp: b.maxMp,
    manaLock: 0,

    cell: { c: input.cell.c, r: input.cell.r },
    alive: true,
    moveFrom: null,
    moveTo: null,
    moveT: 0,
    moveDur: 0,

    shield: 0,
    statuses: [],
    permAtkPct: 0,
    permAspdPct: 0,
    ccImmune: 0,
    trait: createTraitState(),
    traitStacks: {},
    killHandlers: [],
    itemIds: [...(input.items ?? [])],
    itemHooks: eff.hooks,
    itemUsed: new Set(),

    attackCd: 0,
    windupLeft: 0,
    windupTotal: 0,
    windupTargetUid: -1,
    moveCd: 0,
    retargetCd: 0,
    castWindupLeft: 0,
    targetUid: -1,
    castCount: 0,
    attackCount: 0,

    revived: false,
    yaozuTransformed: false,
    dandingReviveUsed: false,

    dealtDamage: 0,
    takenDamage: 0,
    healed: 0,
    kills: 0,
  };
}

/** 由已有单位派生召唤物 */
export function createMinion(uid: number, src: Unit, cell: Cell, hpPct: number, atkPct: number): Unit {
  const m: Unit = { ...createUnit({ uid, defId: src.entry.id, team: src.team, star: 1, cell }) };
  m.isMinion = true;
  m.maxHp = Math.round(src.maxHp * hpPct);
  m.hp = m.maxHp;
  m.atk = Math.round(src.atk * atkPct);
  m.sp = Math.round(src.sp * atkPct);
  m.maxMp = Number.MAX_SAFE_INTEGER; // 召唤物不施法
  m.mp = 0;
  m.range = 1;
  m.baseAspd = 0.7;
  m.moveTime = 0.5;
  return m;
}

// ── 有效属性计算 ────────────────────────────────────────

function sumStatus(u: Unit, kind: StatusKind): number {
  let v = 0;
  for (const s of u.statuses) if (s.kind === kind) v += s.value;
  return v;
}

export function effAtk(u: Unit): number {
  return u.atk * (1 + u.permAtkPct) * (1 + sumStatus(u, 'atkUp') / 100);
}

export function effSp(u: Unit): number {
  return u.sp;
}

export function effAspd(u: Unit): number {
  const up = 1 + u.permAspdPct + sumStatus(u, 'aspdUp') / 100;
  const slow = 1 - Math.min(0.8, sumStatus(u, 'slow') / 100);
  return Math.max(0.15, u.baseAspd * up * slow);
}

export function effArmor(u: Unit): number {
  return clamp(u.baseArmor + sumStatus(u, 'armorUp') - sumStatus(u, 'armorShred'), 0, RESIST_CAP);
}

export function effMr(u: Unit): number {
  return clamp(u.baseMr + sumStatus(u, 'mrUp') - sumStatus(u, 'mrShred'), 0, RESIST_CAP);
}

export function effMoveTime(u: Unit): number {
  const slow = 1 - Math.min(0.7, sumStatus(u, 'slow') / 100);
  return u.moveTime / Math.max(0.3, slow);
}

export function hasStatus(u: Unit, kind: StatusKind): boolean {
  for (const s of u.statuses) if (s.kind === kind) return true;
  return false;
}

export function isStunned(u: Unit): boolean {
  return hasStatus(u, 'stun');
}

export function isSilenced(u: Unit): boolean {
  return hasStatus(u, 'silence');
}

export function isDisarmed(u: Unit): boolean {
  return hasStatus(u, 'disarm');
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 单位是否可被选为攻击目标 */
export function isTargetable(u: Unit): boolean {
  return u.alive && !hasStatus(u, 'stealth');
}
