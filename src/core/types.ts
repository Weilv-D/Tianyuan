/** 战斗内核的公共类型定义。渲染层与模拟层共享，但内核不依赖渲染。 */

export type TeamId = number;

/** 伤害类型：决定减伤公式、飘字配色、特效语言 */
export type DamageType = 'physical' | 'magic' | 'true';

/** 稀有度即费用档位（1~5 费） */
export type Rarity = 1 | 2 | 3 | 4 | 5;

/** 星级 */
export type Star = 1 | 2 | 3;

/**
 * 职业定位。决定：
 * - 程序化剪影绘制（UnitSprite 按 class 走不同轮廓）
 * - 基础属性模板
 * - 默认站位倾向
 */
export type UnitClass =
  | 'warrior' // 武将：近战前排，攻守均衡
  | 'guardian' // 护卫：高生命高护甲，低输出
  | 'assassin' // 刺客：开局跳后排，高爆低血
  | 'marksman' // 神射：4 格远程，持续物理
  | 'mage' // 方士：3 格远程，技能爆发
  | 'warlock' // 术士：真伤 / 持续伤害
  | 'support'; // 丹师：治疗 / 增益

/** 格子坐标 */
export interface Cell {
  c: number;
  r: number;
}

/** 状态效果类型 */
export type StatusKind =
  | 'stun' // 眩晕：完全无法行动
  | 'silence' // 沉默：无法施法
  | 'disarm' // 缴械：无法普攻
  | 'slow' // 缓速：攻速与移速下降
  | 'wound' // 重伤：受到治疗降低
  | 'burn' // 灼烧：法术持续伤害
  | 'bleed' // 流血：物理持续伤害
  | 'atkUp' // 攻击力提升
  | 'aspdUp' // 攻速提升
  | 'armorUp' // 护甲提升
  | 'mrUp' // 魔抗提升
  | 'shield' // 护盾（数值单独存在 unit.shield）
  | 'invuln' // 无敌
  | 'taunt' // 嘲讽：强制成为攻击目标
  | 'stealth' // 潜行：不可被选为目标
  | 'armorShred' // 破甲：护甲降低
  | 'mrShred' // 破魔：魔抗降低
  | 'dr' // 减伤：受到的所有伤害降低
  | 'vulnerability' // 受伤加深（易伤）
  | 'spellCharge' // 附魔：下次普攻附加额外法伤（value = 附加伤害数值）
  | 'ccImmune' // 免疫控制
  | 'drain'; // 吸血加成

export interface StatusEffect {
  kind: StatusKind;
  /** 剩余 tick 数 */
  ticks: number;
  /** 强度：百分比增益 / 每秒伤害 / 护盾值等，语义按 kind 而定 */
  value: number;
  /** 来源 uid，用于归属击杀与特效配色 */
  srcUid: number;
  /** DoT 的结算伤害类型（burn=法术、bleed=真实）；非 DoT 状态不使用 */
  dtype?: DamageType;
}

/** 棋子静态定义（配置表驱动） */
export interface ChampionDef {
  id: string;
  name: string;
  /** 称号，展示在详情面板 */
  title: string;
  cost: Rarity;
  /** 种族 / 阵营羁绊（地域羁绊） */
  origins: string[];
  /** 职业羁绊 */
  classes: string[];
  /** 基础属性（一星裸值） */
  base: {
    hp: number;
    atk: number;
    /** 法术强度，技能伤害的主要加成来源 */
    sp: number;
    armor: number;
    mr: number;
    /** 每秒攻击次数 */
    aspd: number;
    /** 攻击距离（切比雪夫格数，1 = 相邻 8 格） */
    range: number;
    /** 每格移动耗时（秒），越小越快 */
    moveTime: number;
    /** 初始法力值 */
    startMp: number;
    /** 法力上限 */
    maxMp: number;
    critChance: number;
    critMult: number;
  };
  skill: string;
  /** 程序化剪影参数：让同职业不同棋子也能一眼区分 */
  silhouette: SilhouetteKey;
  /** 主色调（阵营归属感），十六进制 */
  hue: number;
}

/** 剪影方案的具名枚举，渲染层按 key 走不同绘制函数 */
export type SilhouetteKey =
  | 'bladeGeneral' // 刀将
  | 'spearVanguard' // 枪先锋
  | 'stoneGuard' // 石卫
  | 'ironBull' // 铁牛
  | 'shadowHood' // 影兜
  | 'twinDagger' // 双刃
  | 'bowSniper' // 弓狙
  | 'crossbowGunner' // 弩机
  | 'talismanMage' // 符法师
  | 'lanternSage' // 灯仙
  | 'hexWarlock' // 咒术士
  | 'bonePuppet' // 骨偶
  | 'gourdHealer' // 葫芦医
  | 'bannerSupport' // 幡辅
  | 'dragonSovereign' // 龙君
  | 'foxSpirit'; // 狐仙

export interface TraitDef {
  id: string;
  name: string;
  /** origin = 地域/种族，class = 职业 */
  category: 'origin' | 'class';
  description: string;
  /** 各档位所需数量 */
  breakpoints: number[];
  /** 各档位描述（与 breakpoints 等长） */
  effectText: string[];
  /** 档位色：0=铜 1=银 2=金 3=虹 */
  colors: number[];
}

/** 一场战斗中，某阵营已激活的羁绊档位 */
export interface ActiveTrait {
  id: string;
  count: number;
  /** 达成的最高档位索引，-1 表示未激活 */
  tier: number;
}

/** 战斗入场单位描述 */
export interface BattleUnitInput {
  uid: number;
  defId: string;
  team: TeamId;
  star: Star;
  cell: Cell;
  /** 装备 id 列表。内核自行拆解为属性 / 状态修正 / 行为钩子三层。 */
  items?: string[];
  /** 装备带来的属性加成（已汇总）。通常由 items 推导，仅在外部需要覆盖时使用。 */
  bonus?: Partial<{
    hp: number;
    atk: number;
    sp: number;
    armor: number;
    mr: number;
    aspd: number;
    critChance: number;
    /** 暴击伤害倍率增量（影袭） */
    critMult: number;
    lifesteal: number;
    /** 全能吸血（技能伤害也吸） */
    omnivamp: number;
    startMp: number;
    damageAmp: number;
  }>;
  /** 墨兽（PvE 单位）。渲染层据此换用墨色剪影，与玩家棋子区分。 */
  monster?: boolean;
  /** 召唤物标记（createMinion 内部派生用）。天命判定与技能乘区据此排除召唤物。 */
  isMinion?: boolean;
  /** 攻击力倍率（乘在星级倍率之后、装备加成之前）。引导轮墨兽 0.08，缺省 1。 */
  powMult?: number;
}

export interface BattleConfig {
  seed: number;
  units: BattleUnitInput[];
  traits: Record<TeamId, ActiveTrait[]>;
  /** 演习模式：不受超时限制，用于弱网/断线兜底 */
  maxTicks?: number;
}

export interface BattleResult {
  winner: TeamId | null; // null = 平局
  ticks: number;
  /** 剩余存活单位 uid */
  survivors: Record<TeamId, number[]>;
  /** 双方剩余总生命值（用于计算玩家掉血） */
  remainingHpRatio: Record<TeamId, number>;
  timeout: boolean;
}
