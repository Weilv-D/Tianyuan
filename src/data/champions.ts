import type { ChampionDef, Rarity, UnitClass } from '../core/types';

/**
 * 技能行为种类。
 *
 * 每种 kind 在 src/core/skills.ts 中有一个**完整的**行为实现（含特效事件、状态、判定）。
 * 棋子通过参数组合得到差异化技能 —— 这是配置驱动，不是"占位符"：
 * 同名 kind 的两个棋子，因目标选择、伤害类型、半径、附加状态不同而完全是两种玩法。
 */
export type SkillKind =
  | 'strike' // 单体爆发
  | 'aoe' // 指定点范围爆发
  | 'line' // 直线穿透
  | 'nova' // 自身环爆
  | 'dashStrike' // 突进斩
  | 'volley' // 连续弹幕
  | 'healBurst' // 群体治疗
  | 'shieldAll' // 群体护盾
  | 'summon' // 召唤
  | 'chain' // 连锁
  | 'execute' // 全场处决
  | 'selfBuff' // 自身强化
  | 'field' // 地面持续区域
  | 'beam' // 光束扫射
  | 'resurrect'; // 复活

/** 技能目标选择策略 */
export type TargetMode =
  | 'self'
  | 'currentTarget'
  | 'enemyNearest'
  | 'enemyLowestHp'
  | 'enemyHighestAtk'
  | 'enemyFarthest'
  | 'enemyDensest' // 敌人最密集的格子
  | 'enemyLongestLine' // 能贯穿最多敌人的方向
  | 'enemyHalfBoard' // 敌方半场中心
  | 'allyLowestHp'
  | 'allAllies'
  | 'allEnemies'
  | 'deadAlly';

export interface SkillParams {
  /** 攻击力倍率（1.0 = 100% 攻击力） */
  atk?: number;
  /** 法术强度倍率 */
  sp?: number;
  /** 固定基础值（随技能星级倍率缩放） */
  flat?: number;
  type?: 'physical' | 'magic' | 'true';
  /** 范围半径（切比雪夫格） */
  radius?: number;
  /** 持续秒数 */
  dur?: number;
  /** 附加状态 */
  status?: { kind: string; dur: number; value?: number };
  /** 治疗 / 护盾 / 增益的百分比值 */
  value?: number;
  /** 弹幕次数 */
  shots?: number;
  /** 弹幕间隔（秒） */
  interval?: number;
  /** 连锁跳数与每跳衰减 */
  jumps?: number;
  falloff?: number;
  /** 处决阈值（目标生命百分比） */
  threshold?: number;
  /** 直线长度 */
  length?: number;
  /** 附加：必定暴击 */
  forceCrit?: boolean;
  /** 附加：击杀后刷新法力比例 */
  resetOnKill?: number;
  /** 附加：连斩次数上限 */
  maxRepeats?: number;
  /** 附加：施法期间无敌 */
  invulnWhileCasting?: boolean;
  /** 附加：施法延迟（秒），用于"预兆 → 落地"的二段演出 */
  delay?: number;
  /** 附加：命中后回复自身生命（最大生命百分比） */
  healOnHit?: number;
  /** 附加：命中后获得护盾（最大生命百分比） */
  shieldOnHit?: number;
  /** 附加：每命中一名敌人获得的攻击力加成（百分比，持续战斗） */
  stackAtkOnHit?: number;
  /** 附加：击退格数 */
  knockback?: number;
  /** 召唤物配置 */
  summon?: { count: number; hpPct: number; atkPct: number; name: string };
  /** DPS 类每秒倍率（field / beam 灼烧） */
  dpsSp?: number;
  /** 反弹比例（受到伤害的百分比） */
  reflect?: number;
  /** 减伤比例 */
  damageReduction?: number;
  /** 敌方受伤加深 */
  vulnerability?: number;
  /** 群体护盾的持续时间（秒）；缺省 8。与敌方控制时长 p.dur 语义不同 */
  shieldDur?: number;
  /** 全场处决：每处决一名敌人，全体友军回复的最大生命百分比 */
  healPerExecute?: number;
}

export interface SkillSpec {
  kind: SkillKind;
  name: string;
  /** 描述模板，{atk} / {sp} / {radius} / {dur} / {value} 由参数回填，杜绝文案与数值脱节 */
  desc: string;
  target: TargetMode;
  params: SkillParams;
}

export interface ChampionEntry extends ChampionDef {
  cls: UnitClass;
  skill: string;
  skillSpec: SkillSpec;
}

const S = (
  hp: number,
  atk: number,
  sp: number,
  armor: number,
  mr: number,
  aspd: number,
  range: number,
  moveTime: number,
  startMp: number,
  maxMp: number,
  critChance = 0.12,
  critMult = 1.5,
) => ({ hp, atk, sp, armor, mr, aspd, range, moveTime, startMp, maxMp, critChance, critMult });

/**
 * 32 名棋子。费用分布 7/7/7/7/4。
 * 每个棋子同时归属 1 条地域羁绊 + 1 条职业羁绊，无重复组合（保证每张卡都是唯一的构筑拼图）。
 */
export const CHAMPIONS: readonly ChampionEntry[] = [
  // ───────────── 一费 ─────────────
  {
    id: 'duanyue', name: '断岳', title: '墨刀卫', cost: 1 as Rarity,
    origins: ['jianzong'], classes: ['warrior'], cls: 'warrior',
    base: S(700, 60, 0, 24, 20, 0.65, 1, 0.55, 20, 60, 0.15, 1.5),
    silhouette: 'bladeGeneral', hue: 0x56648c,
    skill: 'duanyue_q',
    skillSpec: {
      kind: 'strike', name: '断岳式', target: 'currentTarget',
      desc: '斩出开碑一击，造成 {atk} 攻击力 + {sp} 法强的物理伤害；若目标生命低于 35%，伤害翻倍。',
      params: { atk: 2.8, sp: 0.4, type: 'physical', threshold: 0.35, flat: 0 },
    },
  },
  {
    id: 'pan', name: '磐', title: '石灵', cost: 1 as Rarity,
    origins: ['jiguan'], classes: ['guardian'], cls: 'guardian',
    base: S(820, 38, 0, 34, 32, 0.6, 1, 0.6, 0, 65),
    silhouette: 'stoneGuard', hue: 0x8a7f6a,
    skill: 'pan_q',
    skillSpec: {
      kind: 'selfBuff', name: '岩心', target: 'self',
      desc: '获得 {value} 最大生命的护盾与 40 点护甲，持续 {dur} 秒；期间每次受击，反弹所受伤害的 {reflect}。',
      params: { value: 0.18, dur: 6, reflect: 0.25, status: { kind: 'armorUp', dur: 6, value: 40 } },
    },
  },
  {
    id: 'ajiu', name: '阿玖', title: '灵狐', cost: 1 as Rarity,
    origins: ['yaozu'], classes: ['assassin'], cls: 'assassin',
    base: S(520, 56, 0, 18, 18, 0.8, 1, 0.45, 0, 55, 0.2, 1.75),
    silhouette: 'shadowHood', hue: 0xc99162,
    skill: 'ajiu_q',
    skillSpec: {
      kind: 'dashStrike', name: '狐影闪', target: 'enemyLowestHp',
      desc: '瞬移至生命最低的敌人身侧，造成 {atk} 攻击力的物理伤害，本次必定暴击。',
      params: { atk: 2.2, type: 'physical', forceCrit: true },
    },
  },
  {
    id: 'qinghe', name: '青禾', title: '药童', cost: 1 as Rarity,
    origins: ['danding'], classes: ['support'], cls: 'support',
    base: S(560, 32, 48, 16, 26, 0.6, 3, 0.6, 15, 55),
    silhouette: 'gourdHealer', hue: 0x5e8a70,
    skill: 'qinghe_q',
    skillSpec: {
      kind: 'healBurst', name: '春风化雨', target: 'allyLowestHp',
      desc: '为生命最低的 2 名友军回复 {value} 最大生命 + {sp} 法强的生命，并赋予 5 秒 20% 攻速。',
      params: { value: 0.18, sp: 0.6, shots: 2, status: { kind: 'aspdUp', dur: 5, value: 20 } },
    },
  },
  {
    id: 'jingyu', name: '惊羽', title: '弓手', cost: 1 as Rarity,
    origins: ['shanhai'], classes: ['marksman'], cls: 'marksman',
    base: S(500, 58, 0, 16, 16, 0.7, 4, 0.6, 0, 50),
    silhouette: 'bowSniper', hue: 0x74958a,
    skill: 'jingyu_q',
    skillSpec: {
      kind: 'volley', name: '连珠箭', target: 'currentTarget',
      desc: '3 秒内连射 {shots} 箭，每箭造成 {atk} 攻击力的物理伤害，最后一箭造成双倍伤害。',
      params: { atk: 0.7, type: 'physical', shots: 5, interval: 0.6 },
    },
  },
  {
    id: 'yeyou', name: '夜游', title: '鬼差', cost: 1 as Rarity,
    origins: ['youming'], classes: ['warlock'], cls: 'warlock',
    base: S(540, 38, 58, 18, 26, 0.65, 3, 0.58, 0, 55),
    silhouette: 'bonePuppet', hue: 0x44547a,
    skill: 'yeyou_q',
    skillSpec: {
      kind: 'strike', name: '勾魂索', target: 'enemyHighestAtk',
      desc: '锁拿魂魄，造成 {sp} 法强的真实伤害，并沉默目标 {dur} 秒。',
      params: { sp: 1.7, type: 'true', status: { kind: 'silence', dur: 1.8, value: 0 } },
    },
  },
  {
    id: 'kutong', name: '苦童', title: '药奴', cost: 1 as Rarity,
    origins: ['danding'], classes: ['warrior'], cls: 'warrior',
    base: S(740, 46, 42, 26, 26, 0.6, 1, 0.55, 0, 60),
    silhouette: 'ironBull', hue: 0x8f9779,
    skill: 'kutong_q',
    skillSpec: {
      kind: 'nova', name: '毒瘴', target: 'self',
      desc: '向周围 {radius} 格释放毒瘴，造成 {sp} 法强的法术伤害，并使其中敌人受到的治疗降低 50%，持续 {dur} 秒。',
      params: { sp: 1.1, radius: 1, type: 'magic', status: { kind: 'wound', dur: 4, value: 50 } },
    },
  },

  // ───────────── 二费 ─────────────
  {
    id: 'lingxiao', name: '凌霄', title: '天兵', cost: 2 as Rarity,
    origins: ['tian'], classes: ['guardian'], cls: 'guardian',
    base: S(900, 56, 0, 32, 32, 0.6, 1, 0.58, 0, 70),
    silhouette: 'spearVanguard', hue: 0xa8853f,
    skill: 'lingxiao_q',
    skillSpec: {
      kind: 'line', name: '奔雷枪', target: 'enemyLongestLine',
      desc: '挺枪突进，贯穿直线 {length} 格，造成 {atk} 攻击力的物理伤害，击退 {knockback} 格并眩晕 {dur} 秒。',
      params: { atk: 2.2, length: 4, type: 'physical', knockback: 1, status: { kind: 'stun', dur: 1.0, value: 0 } },
    },
  },
  {
    id: 'canghao', name: '苍嗥', title: '荒狼', cost: 2 as Rarity,
    origins: ['shanhai'], classes: ['warrior'], cls: 'warrior',
    base: S(800, 70, 0, 30, 22, 0.65, 1, 0.5, 0, 60),
    silhouette: 'ironBull', hue: 0x9c6b4a,
    skill: 'canghao_q',
    skillSpec: {
      kind: 'selfBuff', name: '狂血', target: 'self',
      desc: '进入狂血状态 {dur} 秒：攻速 +50%、攻击力 +45%；期间每次击杀，狂血时长刷新至满。',
      params: {
        dur: 8,
        status: { kind: 'aspdUp', dur: 8, value: 50 },
      },
    },
  },
  {
    id: 'yuansu', name: '元素', title: '符师', cost: 2 as Rarity,
    origins: ['longyuan'], classes: ['mage'], cls: 'mage',
    base: S(640, 36, 70, 18, 30, 0.65, 3, 0.6, 0, 56),
    silhouette: 'talismanMage', hue: 0x7286ad,
    skill: 'yuansu_q',
    skillSpec: {
      kind: 'aoe', name: '五雷符', target: 'enemyDensest',
      desc: '在最密集处降下雷罚，{radius} 格内造成 {sp} 法强的法术伤害并眩晕 {dur} 秒。',
      params: { sp: 2.4, radius: 1, type: 'magic', status: { kind: 'stun', dur: 1.2, value: 0 } },
    },
  },
  {
    id: 'yingsha', name: '影刹', title: '双刃', cost: 2 as Rarity,
    origins: ['jianzong'], classes: ['assassin'], cls: 'assassin',
    base: S(560, 65, 0, 20, 20, 0.85, 1, 0.45, 0, 60, 0.25, 1.8),
    silhouette: 'twinDagger', hue: 0x4c5a78,
    skill: 'yingsha_q',
    skillSpec: {
      kind: 'dashStrike', name: '影袭', target: 'enemyLowestHp',
      desc: '瞬杀生命最低的敌人，造成 {atk} 攻击力的物理伤害；若击杀，立即恢复 {resetOnKill} 法力。',
      params: { atk: 3.1, type: 'physical', resetOnKill: 0.6 },
    },
  },
  {
    id: 'muji', name: '木机', title: '傀儡', cost: 2 as Rarity,
    origins: ['jiguan'], classes: ['marksman'], cls: 'marksman',
    base: S(540, 62, 0, 20, 18, 0.75, 4, 0.6, 0, 60),
    silhouette: 'crossbowGunner', hue: 0xa8895c,
    skill: 'muji_q',
    skillSpec: {
      kind: 'volley', name: '连弩齐射', target: 'currentTarget',
      desc: '倾泻 {shots} 发弩矢，每发造成 {atk} 攻击力的物理伤害；每发命中提升自身 6% 攻速（至多 8 层，持续 5 秒）。',
      params: { atk: 0.55, type: 'physical', shots: 8, interval: 0.4, status: { kind: 'aspdUp', dur: 5, value: 6 } },
    },
  },
  {
    id: 'moyu', name: '墨羽', title: '冥鸦', cost: 2 as Rarity,
    origins: ['youming'], classes: ['mage'], cls: 'mage',
    base: S(560, 38, 70, 18, 30, 0.65, 3, 0.6, 0, 70),
    silhouette: 'hexWarlock', hue: 0x3a4664,
    skill: 'moyu_q',
    skillSpec: {
      kind: 'field', name: '墨狱', target: 'enemyDensest',
      desc: '在敌人最密集处泼洒墨池，持续 {dur} 秒：每秒造成 {dpsSp} 法强的法术伤害，并降低其中敌人 30% 攻速。',
      params: { dur: 5, dpsSp: 0.62, radius: 1, type: 'magic', status: { kind: 'slow', dur: 5, value: 30 } },
    },
  },
  {
    id: 'bainiang', name: '白娘', title: '蛇姬', cost: 2 as Rarity,
    origins: ['danding'], classes: ['support'], cls: 'support',
    base: S(620, 36, 58, 20, 32, 0.6, 3, 0.6, 20, 65),
    silhouette: 'foxSpirit', hue: 0x8fae96,
    skill: 'bainiang_q',
    skillSpec: {
      kind: 'healBurst', name: '蛇涎回春', target: 'allAllies',
      desc: '为全体友军回复 {value} 最大生命 + {sp} 法强的生命；同时对 {shots} 名随机敌人施加 {dur} 秒重伤（受治疗降低 40%）。',
      params: { value: 0.12, sp: 0.5, shots: 3, dur: 3, status: { kind: 'wound', dur: 3, value: 40 } },
    },
  },

  // ───────────── 三费 ─────────────
  {
    id: 'wujiu', name: '无咎', title: '剑修', cost: 3 as Rarity,
    origins: ['jianzong'], classes: ['warrior'], cls: 'warrior',
    base: S(860, 72, 20, 28, 26, 0.7, 1, 0.5, 0, 78, 0.2, 1.7),
    silhouette: 'bladeGeneral', hue: 0x9fb0aa,
    skill: 'wujiu_q',
    skillSpec: {
      kind: 'strike', name: '无咎剑域', target: 'currentTarget',
      desc: '剑气纵横，对目标及其周围 {radius} 格造成 {atk} 攻击力 + {sp} 法强的物理伤害；每命中一名敌人，永久 +6% 攻击力。',
      params: { atk: 2.4, sp: 0.6, radius: 1, type: 'physical', stackAtkOnHit: 0.06 },
    },
  },
  {
    id: 'xuanwu', name: '玄武', title: '玄龟', cost: 3 as Rarity,
    origins: ['shanhai'], classes: ['guardian'], cls: 'guardian',
    base: S(1150, 42, 32, 42, 42, 0.55, 1, 0.65, 0, 110),
    silhouette: 'stoneGuard', hue: 0x4f7a6a,
    skill: 'xuanwu_q',
    skillSpec: {
      kind: 'shieldAll', name: '玄冥之护', target: 'allAllies',
      desc: '为全体友军提供相当于自身 {value} 最大生命的护盾，持续 {dur} 秒；护盾生效期间受到伤害降低 {damageReduction}。',
      params: { value: 0.1, dur: 8, damageReduction: 0.12 },
    },
  },
  {
    id: 'chitong', name: '赤瞳', title: '妖将', cost: 3 as Rarity,
    origins: ['yaozu'], classes: ['warrior'], cls: 'warrior',
    base: S(960, 82, 0, 30, 26, 0.65, 1, 0.5, 0, 65),
    silhouette: 'ironBull', hue: 0xb0402a,
    skill: 'chitong_q',
    skillSpec: {
      kind: 'nova', name: '血怒', target: 'self',
      desc: '横扫周围 {radius} 格，造成 {atk} 攻击力的物理伤害；每命中一名敌人回复 {healOnHit} 最大生命，并获得 6 秒 25% 攻击力。',
      params: { atk: 2.1, radius: 1, type: 'physical', healOnHit: 0.08, status: { kind: 'atkUp', dur: 6, value: 25 } },
    },
  },
  {
    id: 'dasiming', name: '大司命', title: '巫祝', cost: 3 as Rarity,
    origins: ['youming'], classes: ['support'], cls: 'support',
    base: S(720, 40, 62, 22, 36, 0.6, 3, 0.6, 10, 70),
    silhouette: 'bannerSupport', hue: 0xa85e75,
    skill: 'dasiming_q',
    skillSpec: {
      kind: 'resurrect', name: '招魂', target: 'deadAlly',
      desc: '复活一名阵亡友军，恢复 {value} 最大生命与满额法力；若无阵亡友军，则改为全体回复 {value} 最大生命。',
      params: { value: 0.45 },
    },
  },
  {
    id: 'aoyin', name: '敖姻', title: '龙女', cost: 3 as Rarity,
    origins: ['longyuan'], classes: ['mage'], cls: 'mage',
    base: S(700, 38, 86, 20, 32, 0.65, 3, 0.6, 0, 70),
    silhouette: 'talismanMage', hue: 0x5f8796,
    skill: 'aoyin_q',
    skillSpec: {
      kind: 'chain', name: '潮生链', target: 'enemyNearest',
      desc: '水链在 {jumps} 名敌人间跳跃，每次造成 {sp} 法强的法术伤害（每跳衰减 15%），并降低 25% 攻速 3 秒。',
      params: { sp: 1.75, jumps: 4, falloff: 0.15, type: 'magic', status: { kind: 'slow', dur: 3, value: 25 } },
    },
  },
  {
    id: 'budong', name: '不动', title: '铜人', cost: 3 as Rarity,
    origins: ['jiguan'], classes: ['guardian'], cls: 'guardian',
    base: S(1080, 48, 52, 48, 46, 0.55, 1, 0.65, 0, 85),
    silhouette: 'stoneGuard', hue: 0xb08d57,
    skill: 'budong_q',
    skillSpec: {
      kind: 'selfBuff', name: '不动明王', target: 'self',
      desc: '结不动印 {dur} 秒：免疫所有伤害与控制，反弹所受伤害的 {reflect}，并每秒对周围 {radius} 格造成 {dpsSp} 法强的法术伤害。',
      params: { dur: 4, reflect: 0.3, radius: 1, dpsSp: 0.5, type: 'magic', invulnWhileCasting: true },
    },
  },
  {
    id: 'xinhuan', name: '辛环', title: '雷部', cost: 3 as Rarity,
    origins: ['tian'], classes: ['mage'], cls: 'mage',
    base: S(690, 36, 90, 20, 32, 0.65, 4, 0.6, 0, 72),
    silhouette: 'talismanMage', hue: 0xc9a96a,
    skill: 'xinhuan_q',
    skillSpec: {
      kind: 'aoe', name: '天雷引', target: 'enemyDensest',
      desc: '引动天雷，{delay} 秒后劈向最密集处，{radius} 格内造成 {sp} 法强的法术伤害并眩晕 {dur} 秒。',
      params: { sp: 3.0, radius: 1, delay: 1.2, type: 'magic', status: { kind: 'stun', dur: 1.5, value: 0 } },
    },
  },

  // ───────────── 四费 ─────────────
  {
    id: 'zhenyue', name: '镇岳', title: '天王', cost: 4 as Rarity,
    origins: ['tian'], classes: ['guardian'], cls: 'guardian',
    base: S(1180, 70, 0, 44, 42, 0.6, 1, 0.55, 0, 90),
    silhouette: 'spearVanguard', hue: 0xa8853f,
    skill: 'zhenyue_q',
    skillSpec: {
      kind: 'nova', name: '镇岳', target: 'enemyDensest',
      desc: '跃向敌阵最密集处并砸落：{radius} 格内造成 {atk} 攻击力的物理伤害并眩晕 {dur} 秒，自身获得 {shieldOnHit} 最大生命的护盾。',
      params: { atk: 2.6, radius: 2, type: 'physical', status: { kind: 'stun', dur: 1.8, value: 0 }, shieldOnHit: 0.18, dur: 1.8 },
    },
  },
  {
    id: 'jiuying', name: '九婴', title: '大妖', cost: 4 as Rarity,
    origins: ['yaozu'], classes: ['warlock'], cls: 'warlock',
    base: S(920, 50, 112, 30, 36, 0.65, 3, 0.55, 0, 90),
    silhouette: 'hexWarlock', hue: 0x8b3a3a,
    skill: 'jiuying_q',
    skillSpec: {
      kind: 'aoe', name: '九首吞天', target: 'enemyDensest',
      desc: '九首齐噬：{radius} 格内造成 {sp} 法强的法术伤害；每命中一名敌人回复 {healOnHit} 最大生命。',
      params: { sp: 3.8, radius: 2, type: 'magic', healOnHit: 0.08 },
    },
  },
  {
    id: 'gongshu', name: '公输', title: '机巧', cost: 4 as Rarity,
    origins: ['jiguan'], classes: ['marksman'], cls: 'marksman',
    base: S(720, 92, 20, 28, 26, 0.8, 5, 0.6, 0, 85),
    silhouette: 'crossbowGunner', hue: 0x9a8b6f,
    skill: 'gongshu_q',
    skillSpec: {
      kind: 'summon', name: '机关兽', target: 'self',
      desc: '召唤 {count} 只机关傀儡参战（继承 {hpPct} 生命与 {atkPct} 攻击力）；召唤时全体友军获得 6 秒 25% 攻速。',
      params: { summon: { count: 2, hpPct: 0.55, atkPct: 0.75, name: '机关兽' }, status: { kind: 'aspdUp', dur: 6, value: 25 } },
    },
  },
  {
    id: 'qingming', name: '青冥', title: '剑仙', cost: 4 as Rarity,
    origins: ['jianzong'], classes: ['assassin'], cls: 'assassin',
    base: S(740, 78, 0, 26, 26, 0.9, 1, 0.45, 0, 80, 0.35, 1.9),
    silhouette: 'twinDagger', hue: 0xa7b6d4,
    skill: 'qingming_q',
    skillSpec: {
      kind: 'dashStrike', name: '一剑霜寒', target: 'enemyFarthest',
      desc: '瞬入敌方后排，对 {radius} 格内所有敌人造成 {atk} 攻击力、必定暴击的物理伤害；若造成击杀可再次施放（至多 2 次）。',
      params: { atk: 2.7, radius: 1, type: 'physical', forceCrit: true, resetOnKill: 1, maxRepeats: 2 },
    },
  },
  {
    id: 'baopu', name: '抱朴', title: '丹王', cost: 4 as Rarity,
    origins: ['danding'], classes: ['support'], cls: 'support',
    base: S(800, 40, 98, 26, 42, 0.6, 3, 0.6, 15, 85),
    silhouette: 'lanternSage', hue: 0xd0b273,
    skill: 'baopu_q',
    skillSpec: {
      kind: 'healBurst', name: '金丹济世', target: 'allAllies',
      desc: '为全体友军回复 {value} 最大生命 + {sp} 法强的生命，并赋予 6 秒 {damageReduction} 减伤与 30 点护甲。',
      params: { value: 0.25, sp: 0.9, damageReduction: 0.3, status: { kind: 'armorUp', dur: 6, value: 30 } },
    },
  },
  {
    id: 'zhuyan', name: '朱炎', title: '毕方', cost: 4 as Rarity,
    origins: ['shanhai'], classes: ['mage'], cls: 'mage',
    base: S(780, 44, 105, 26, 34, 0.65, 4, 0.6, 0, 78),
    silhouette: 'talismanMage', hue: 0xcf7254,
    skill: 'zhuyan_q',
    skillSpec: {
      kind: 'beam', name: '焚天羽', target: 'enemyLongestLine',
      desc: '喷吐贯穿 {length} 格的焚天火羽，沿途造成 {sp} 法强的法术伤害，并附加 4 秒灼烧（每秒 {dpsSp} 法强）。',
      params: { sp: 3.2, length: 5, type: 'magic', status: { kind: 'burn', dur: 4, value: 0 }, dpsSp: 0.35 },
    },
  },
  {
    id: 'canglan', name: '沧澜', title: '龙王', cost: 4 as Rarity,
    origins: ['longyuan'], classes: ['guardian'], cls: 'guardian',
    base: S(1160, 52, 84, 42, 46, 0.6, 2, 0.6, 0, 90),
    silhouette: 'dragonSovereign', hue: 0x4a7392,
    skill: 'canglan_q',
    skillSpec: {
      kind: 'field', name: '沧海潮汐', target: 'enemyHalfBoard',
      desc: '在敌方半场涌起潮汐，持续 {dur} 秒：每秒造成 {dpsSp} 法强的法术伤害并降低 25% 移速与攻速；自身获得 25% 减伤。',
      params: { dur: 6, dpsSp: 0.92, radius: 2, type: 'magic', status: { kind: 'slow', dur: 6, value: 25 }, damageReduction: 0.25 },
    },
  },

  // ───────────── 四期扩军 · 一费 ─────────────
  {
    id: 'moyan', name: '墨岩', title: '石匠', cost: 1 as Rarity,
    origins: ['momen'], classes: ['guardian'], cls: 'guardian',
    base: S(880, 36, 0, 36, 34, 0.55, 1, 0.62, 0, 65),
    silhouette: 'stoneGuard', hue: 0x6e6152,
    skill: 'moyan_q',
    skillSpec: {
      kind: 'selfBuff', name: '墨壁', target: 'self',
      desc: '凿墨为壁：获得 {value} 最大生命的护盾与 36 点护甲，持续 {dur} 秒，期间反弹所受伤害的 {reflect}。',
      params: { value: 0.16, dur: 6, reflect: 0.2, status: { kind: 'armorUp', dur: 6, value: 36 } },
    },
  },
  {
    id: 'yunchu', name: '云杼', title: '织机师', cost: 1 as Rarity,
    origins: ['momen'], classes: ['mage'], cls: 'mage',
    base: S(560, 34, 52, 16, 28, 0.6, 3, 0.6, 0, 55),
    silhouette: 'talismanMage', hue: 0x7286ad,
    skill: 'yunchu_q',
    skillSpec: {
      kind: 'chain', name: '飞杼', target: 'enemyNearest',
      desc: '掷出飞杼，在 {jumps} 名敌人间穿引，每次造成 {sp} 法强的法术伤害（每跳衰减 15%）并降低 20% 攻速 2 秒。',
      params: { sp: 1.5, jumps: 3, falloff: 0.15, type: 'magic', status: { kind: 'slow', dur: 2, value: 20 } },
    },
  },
  {
    id: 'zhenfeng', name: '砺锋', title: '磨刀叟', cost: 1 as Rarity,
    origins: ['bingjia'], classes: ['warrior'], cls: 'warrior',
    base: S(720, 62, 0, 24, 20, 0.65, 1, 0.55, 15, 60, 0.15, 1.55),
    silhouette: 'bladeGeneral', hue: 0x96825f,
    skill: 'zhenfeng_q',
    skillSpec: {
      kind: 'strike', name: '开锋', target: 'currentTarget',
      desc: '新发于硎：造成 {atk} 攻击力的物理伤害；目标生命低于 30% 时伤害翻倍。',
      params: { atk: 2.5, type: 'physical', threshold: 0.3 },
    },
  },
  {
    id: 'jinghong', name: '惊鸿', title: '猎手', cost: 1 as Rarity,
    origins: ['bingjia'], classes: ['marksman'], cls: 'marksman',
    base: S(510, 56, 0, 16, 16, 0.72, 4, 0.6, 0, 50),
    silhouette: 'bowSniper', hue: 0xa08a62,
    skill: 'jinghong_q',
    skillSpec: {
      kind: 'volley', name: '逐羽', target: 'currentTarget',
      desc: '连射 {shots} 箭，每箭造成 {atk} 攻击力的物理伤害。',
      params: { atk: 0.65, type: 'physical', shots: 4, interval: 0.5 },
    },
  },
  {
    id: 'jiuyuan', name: '九原', title: '巫祝', cost: 1 as Rarity,
    origins: ['youming'], classes: ['mage'], cls: 'mage',
    base: S(560, 36, 56, 18, 26, 0.65, 3, 0.6, 0, 55),
    silhouette: 'hexWarlock', hue: 0x44547a,
    skill: 'jiuyuan_q',
    skillSpec: {
      kind: 'strike', name: '酹祭', target: 'enemyHighestAtk',
      desc: '酹酒祭地：对攻击最高的敌人造成 {sp} 法强的法术伤害，并降低其 25% 攻速 3 秒。',
      params: { sp: 1.5, type: 'magic', status: { kind: 'slow', dur: 3, value: 25 } },
    },
  },
  {
    id: 'lingque', name: '灵雀', title: '雀衣', cost: 1 as Rarity,
    origins: ['yaozu'], classes: ['marksman'], cls: 'marksman',
    base: S(520, 54, 0, 16, 16, 0.75, 4, 0.55, 0, 50, 0.2, 1.7),
    silhouette: 'bowSniper', hue: 0x8fae96,
    skill: 'lingque_q',
    skillSpec: {
      kind: 'volley', name: '雀鸣', target: 'currentTarget',
      desc: '连珠雀鸣：{shots} 箭连射，每箭造成 {atk} 攻击力的物理伤害；每箭命中提升自身 5% 攻速（持续 5 秒）。',
      params: { atk: 0.5, type: 'physical', shots: 5, interval: 0.4, status: { kind: 'aspdUp', dur: 5, value: 5 } },
    },
  },
  {
    id: 'hanxing', name: '寒星', title: '星官', cost: 1 as Rarity,
    origins: ['longyuan'], classes: ['mage'], cls: 'mage',
    base: S(540, 34, 54, 16, 28, 0.65, 4, 0.6, 0, 52),
    silhouette: 'bowSniper', hue: 0x9fb0aa,
    skill: 'hanxing_q',
    skillSpec: {
      kind: 'strike', name: '坠星', target: 'enemyLowestHp',
      desc: '引寒星坠落：对生命最低的敌人造成 {sp} 法强的法术伤害，并降低其 20% 攻速 2 秒。',
      params: { sp: 1.9, type: 'magic', status: { kind: 'slow', dur: 2, value: 20 } },
    },
  },

  // ───────────── 四期扩军 · 二费 ─────────────
  {
    id: 'chiji', name: '驰机', title: '机士', cost: 2 as Rarity,
    origins: ['momen'], classes: ['warrior'], cls: 'warrior',
    base: S(820, 60, 0, 30, 24, 0.65, 1, 0.5, 0, 60),
    silhouette: 'spearVanguard', hue: 0x7a8aa0,
    skill: 'chiji_q',
    skillSpec: {
      kind: 'line', name: '驰突', target: 'enemyLongestLine',
      desc: '持戟驰突：贯穿直线 {length} 格，造成 {atk} 攻击力的物理伤害并击退 {knockback} 格。',
      params: { atk: 2.0, length: 4, type: 'physical', knockback: 1 },
    },
  },
  {
    id: 'guicheng', name: '圭城', title: '筑城吏', cost: 2 as Rarity,
    origins: ['momen'], classes: ['guardian'], cls: 'guardian',
    base: S(940, 42, 0, 34, 34, 0.55, 1, 0.62, 0, 70),
    silhouette: 'stoneGuard', hue: 0x7c7261,
    skill: 'guicheng_q',
    skillSpec: {
      kind: 'shieldAll', name: '城垣', target: 'allAllies',
      desc: '筑起城垣：全体友军获得 {value} 最大生命的护盾与 10% 减伤，持续 6 秒。',
      params: { value: 0.09, damageReduction: 0.1, shieldDur: 6 },
    },
  },
  {
    id: 'xijue', name: '袭爵', title: '袭位者', cost: 2 as Rarity,
    origins: ['bingjia'], classes: ['assassin'], cls: 'assassin',
    base: S(580, 68, 0, 20, 20, 0.85, 1, 0.45, 0, 60, 0.25, 1.8),
    silhouette: 'twinDagger', hue: 0xb59a6a,
    skill: 'xijue_q',
    skillSpec: {
      kind: 'dashStrike', name: '夺嫡', target: 'enemyLowestHp',
      desc: '袭杀生命最低的敌人，造成 {atk} 攻击力的物理伤害；若击杀，立即恢复 {resetOnKill} 法力。',
      params: { atk: 2.9, type: 'physical', resetOnKill: 0.5 },
    },
  },
  {
    id: 'paoche', name: '抛车', title: '车兵', cost: 2 as Rarity,
    origins: ['bingjia'], classes: ['marksman'], cls: 'marksman',
    base: S(600, 64, 0, 22, 18, 0.7, 4, 0.6, 0, 60),
    silhouette: 'crossbowGunner', hue: 0x8a7a5c,
    skill: 'paoche_q',
    skillSpec: {
      kind: 'volley', name: '石弩', target: 'currentTarget',
      desc: '抛射巨石 {shots} 发，每发造成 {atk} 攻击力的物理伤害；命中后自身获得 8% 攻速 3 秒。',
      params: { atk: 0.62, type: 'physical', shots: 4, interval: 0.55, status: { kind: 'aspdUp', dur: 3, value: 8 } },
    },
  },
  {
    id: 'yaoguang', name: '瑶光', title: '星使', cost: 2 as Rarity,
    origins: ['tian'], classes: ['mage'], cls: 'mage',
    base: S(620, 36, 62, 20, 30, 0.65, 3, 0.6, 0, 56),
    silhouette: 'talismanMage', hue: 0xcbb060,
    skill: 'yaoguang_q',
    skillSpec: {
      kind: 'aoe', name: '星坠', target: 'enemyDensest',
      desc: '瑶光坠地：{radius} 格内造成 {sp} 法强的法术伤害并降低 25% 攻速 2 秒。',
      params: { sp: 2.1, radius: 1, type: 'magic', status: { kind: 'slow', dur: 2, value: 25 } },
    },
  },
  {
    id: 'jiaohan', name: '蛟翰', title: '蛟卒', cost: 2 as Rarity,
    origins: ['shanhai'], classes: ['guardian'], cls: 'guardian',
    base: S(860, 60, 0, 30, 24, 0.6, 1, 0.55, 0, 60),
    silhouette: 'ironBull', hue: 0x4f9484,
    skill: 'jiaohan_q',
    skillSpec: {
      kind: 'nova', name: '翻江', target: 'self',
      desc: '横扫周围 {radius} 格造成 {atk} 攻击力的物理伤害，并获得 6 秒 20% 攻速。',
      params: { atk: 1.9, radius: 1, type: 'physical', status: { kind: 'aspdUp', dur: 6, value: 20 } },
    },
  },
  {
    id: 'chaoji', name: '潮机', title: '海弩手', cost: 2 as Rarity,
    origins: ['shanhai'], classes: ['marksman'], cls: 'marksman',
    base: S(560, 64, 0, 20, 18, 0.75, 4, 0.6, 0, 60),
    silhouette: 'crossbowGunner', hue: 0x8a9a7a,
    skill: 'chaoji_q',
    skillSpec: {
      kind: 'volley', name: '潮弩', target: 'currentTarget',
      desc: '海潮连弩 {shots} 发，每发造成 {atk} 攻击力的物理伤害；每发命中提升自身 6% 攻速（持续 5 秒）。',
      params: { atk: 0.5, type: 'physical', shots: 6, interval: 0.4, status: { kind: 'aspdUp', dur: 5, value: 6 } },
    },
  },

  // ───────────── 四期扩军 · 三费 ─────────────
  {
    id: 'xuanji', name: '璇玑', title: '玑衡师', cost: 3 as Rarity,
    origins: ['momen'], classes: ['mage'], cls: 'mage',
    base: S(680, 36, 78, 20, 32, 0.65, 3, 0.6, 0, 70),
    silhouette: 'talismanMage', hue: 0x56648c,
    skill: 'xuanji_q',
    skillSpec: {
      kind: 'aoe', name: '衡雷', target: 'enemyDensest',
      desc: '璇玑引雷：{delay} 秒后劈向最密集处，{radius} 格内造成 {sp} 法强的法术伤害并眩晕 {dur} 秒。',
      params: { sp: 2.6, radius: 1, delay: 0.6, type: 'magic', status: { kind: 'stun', dur: 1.2, value: 0 } },
    },
  },
  {
    id: 'baitao', name: '白陶', title: '陶正', cost: 3 as Rarity,
    origins: ['momen'], classes: ['support'], cls: 'support',
    base: S(640, 34, 56, 20, 30, 0.6, 3, 0.6, 15, 60),
    silhouette: 'gourdHealer', hue: 0xd6c6a4,
    skill: 'baitao_q',
    skillSpec: {
      kind: 'healBurst', name: '陶钧', target: 'allAllies',
      desc: '为全体友军回复 {value} 最大生命 + {sp} 法强的生命，并获得 6 秒 {damageReduction} 减伤。',
      params: { value: 0.1, sp: 0.45, damageReduction: 0.15 },
    },
  },
  {
    id: 'guzhen', name: '鼓震', title: '鼓吏', cost: 3 as Rarity,
    origins: ['bingjia'], classes: ['warrior'], cls: 'warrior',
    base: S(880, 74, 0, 28, 26, 0.65, 1, 0.5, 0, 65),
    silhouette: 'ironBull', hue: 0xa85e44,
    skill: 'guzhen_q',
    skillSpec: {
      kind: 'selfBuff', name: '擂鼓', target: 'self',
      desc: '擂鼓进军：攻速 +{statusValue}，持续 {dur} 秒。',
      params: { status: { kind: 'aspdUp', dur: 7, value: 45 } },
    },
  },
  {
    id: 'zhechong', name: '折冲', title: '折冲郎', cost: 3 as Rarity,
    origins: ['bingjia'], classes: ['guardian'], cls: 'guardian',
    base: S(1000, 50, 0, 42, 40, 0.55, 1, 0.62, 0, 80),
    silhouette: 'spearVanguard', hue: 0x8a7a5a,
    skill: 'zhechong_q',
    skillSpec: {
      kind: 'line', name: '折冲', target: 'enemyLongestLine',
      desc: '折冲御侮：贯穿直线 {length} 格，造成 {atk} 攻击力的物理伤害，击退 {knockback} 格并眩晕 {dur} 秒。',
      params: { atk: 2.0, length: 4, type: 'physical', knockback: 1, status: { kind: 'stun', dur: 1.0, value: 0 } },
    },
  },
  {
    id: 'wuhuo', name: '巫火', title: '火祝', cost: 3 as Rarity,
    origins: ['youming'], classes: ['warlock'], cls: 'warlock',
    base: S(600, 40, 72, 20, 30, 0.65, 3, 0.58, 0, 65),
    silhouette: 'bonePuppet', hue: 0x5f3a38,
    skill: 'wuhuo_q',
    skillSpec: {
      kind: 'strike', name: '焚祭', target: 'enemyHighestAtk',
      desc: '以火焚祭：对攻击最高的敌人造成 {sp} 法强的真实伤害，并附加 {dur} 秒灼烧（每秒 {statusFlat} 伤害）。',
      params: { sp: 1.6, type: 'true', status: { kind: 'burn', dur: 3, value: 40 } },
    },
  },
  {
    id: 'ruijin', name: '锐金', title: '金锋', cost: 3 as Rarity,
    origins: ['jianzong'], classes: ['assassin'], cls: 'assassin',
    base: S(660, 74, 0, 24, 24, 0.85, 1, 0.45, 0, 65, 0.3, 1.85),
    silhouette: 'twinDagger', hue: 0x8ea6b8,
    skill: 'ruijin_q',
    skillSpec: {
      kind: 'dashStrike', name: '金错刀', target: 'enemyLowestHp',
      desc: '错金一闪：袭杀生命最低的敌人，造成 {atk} 攻击力的物理伤害；若击杀，立即恢复 {resetOnKill} 法力。',
      params: { atk: 2.4, type: 'physical', resetOnKill: 0.4 },
    },
  },
  {
    id: 'taozhu', name: '陶朱', title: '货殖翁', cost: 3 as Rarity,
    origins: ['danding'], classes: ['warrior'], cls: 'warrior',
    base: S(840, 66, 30, 28, 28, 0.6, 1, 0.55, 0, 60),
    silhouette: 'ironBull', hue: 0xb5964f,
    skill: 'taozhu_q',
    skillSpec: {
      kind: 'nova', name: '散金', target: 'self',
      desc: '散金惑敌：周围 {radius} 格内造成 {sp} 法强的法术伤害，并使其受到的治疗降低 40%，持续 3 秒。',
      params: { sp: 1.3, radius: 1, type: 'magic', status: { kind: 'wound', dur: 3, value: 40 } },
    },
  },

  // ───────────── 四期扩军 · 四费 ─────────────
  {
    id: 'yusuan', name: '玉算', title: '算家', cost: 4 as Rarity,
    origins: ['momen'], classes: ['warlock'], cls: 'warlock',
    base: S(760, 44, 100, 26, 34, 0.65, 3, 0.6, 0, 85),
    silhouette: 'hexWarlock', hue: 0x6f8f9e,
    skill: 'yusuan_q',
    skillSpec: {
      kind: 'chain', name: '筹策', target: 'enemyNearest',
      desc: '运筹百步：水算在 {jumps} 名敌人间流转，每次造成 {sp} 法强的法术伤害（每跳衰减 12%），并使命中者受到的伤害提高 15%，持续 3 秒。',
      params: { sp: 2.4, jumps: 5, falloff: 0.12, type: 'magic', status: { kind: 'vulnerability', dur: 3, value: 15 } },
    },
  },
  {
    id: 'moliu', name: '墨骝', title: '墨骑', cost: 4 as Rarity,
    origins: ['momen'], classes: ['warrior'], cls: 'warrior',
    base: S(1020, 84, 0, 32, 28, 0.7, 1, 0.45, 0, 70),
    silhouette: 'ironBull', hue: 0x544a3e,
    skill: 'moliu_q',
    skillSpec: {
      kind: 'nova', name: '踏阵', target: 'self',
      desc: '踏破敌阵：横扫周围 {radius} 格造成 {atk} 攻击力的物理伤害；每命中一名敌人回复 {healOnHit} 最大生命，并获得 6 秒 20% 攻击力。',
      params: { atk: 2.3, radius: 1, type: 'physical', healOnHit: 0.07, status: { kind: 'atkUp', dur: 6, value: 20 } },
    },
  },
  {
    id: 'podu', name: '破度', title: '度朔', cost: 4 as Rarity,
    origins: ['bingjia'], classes: ['assassin'], cls: 'assassin',
    base: S(760, 80, 0, 26, 26, 0.9, 1, 0.42, 0, 75, 0.35, 1.9),
    silhouette: 'shadowHood', hue: 0x8a5a44,
    skill: 'podu_q',
    skillSpec: {
      kind: 'dashStrike', name: '破军', target: 'enemyLowestHp',
      desc: '破军袭杀生命最低的敌人，造成 {atk} 攻击力的物理伤害，必定暴击；若击杀，立即恢复 {resetOnKill} 法力。',
      params: { atk: 2.6, type: 'physical', forceCrit: true, resetOnKill: 0.8 },
    },
  },
  {
    id: 'jingbo', name: '鲸波', title: '鲸巫', cost: 4 as Rarity,
    origins: ['shanhai'], classes: ['warlock'], cls: 'warlock',
    base: S(860, 46, 106, 28, 36, 0.65, 3, 0.55, 0, 88),
    silhouette: 'hexWarlock', hue: 0x5f8f7a,
    skill: 'jingbo_q',
    skillSpec: {
      kind: 'field', name: '鲸落', target: 'enemyDensest',
      desc: '鲸落成渊：持续 {dur} 秒，{radius} 格内每秒受到 {dpsSp} 法强的法术伤害并降低 30% 攻速。',
      params: { dur: 5, dpsSp: 0.55, radius: 2, type: 'magic', status: { kind: 'slow', dur: 5, value: 30 } },
    },
  },
  {
    id: 'shihu', name: '啸虎', title: '虎贲', cost: 4 as Rarity,
    origins: ['yaozu'], classes: ['marksman'], cls: 'marksman',
    base: S(760, 88, 0, 28, 26, 0.8, 4, 0.6, 0, 80),
    silhouette: 'bowSniper', hue: 0x9a7350,
    skill: 'shihu_q',
    skillSpec: {
      kind: 'volley', name: '虎啸', target: 'currentTarget',
      desc: '啸弓连珠 {shots} 箭，每箭造成 {atk} 攻击力的物理伤害，末箭双倍；命中后自身获得 10% 攻速 5 秒。',
      params: { atk: 0.75, type: 'physical', shots: 4, interval: 0.5, status: { kind: 'aspdUp', dur: 5, value: 10 } },
    },
  },

  // ───────────── 四期扩军 · 五费 ─────────────
  {
    id: 'mozhai', name: '墨翟', title: '巨子', cost: 5 as Rarity,
    origins: ['momen'], classes: ['guardian'], cls: 'guardian',
    base: S(1220, 58, 60, 46, 46, 0.6, 1, 0.6, 0, 95),
    silhouette: 'bannerSupport', hue: 0x4c4640,
    skill: 'mozhai_q',
    skillSpec: {
      kind: 'shieldAll', name: '兼爱', target: 'allAllies',
      desc: '举兼爱之旗：全体友军获得 {value} 最大生命的护盾（持续 8 秒）与 {damageReduction} 减伤。',
      params: { value: 0.14, damageReduction: 0.18, shieldDur: 8 },
    },
  },
  {
    id: 'taibu', name: '太卜', title: '卜帅', cost: 5 as Rarity,
    origins: ['bingjia'], classes: ['warlock'], cls: 'warlock',
    base: S(960, 54, 138, 32, 40, 0.7, 3, 0.55, 0, 95),
    silhouette: 'hexWarlock', hue: 0x50608a,
    skill: 'taibu_q',
    skillSpec: {
      kind: 'execute', name: '卜凶', target: 'allEnemies',
      desc: '卜敌凶期：对所有敌人造成 {sp} 法强的真实伤害；生命低于 {threshold} 者立即处决。每处决一人，全体友军回复 10% 生命。',
      params: { sp: 1.7, type: 'true', threshold: 0.2, healPerExecute: 0.1 },
    },
  },
  {
    id: 'gouchen', name: '勾陈', title: '勾陈帝', cost: 5 as Rarity,
    origins: ['tian'], classes: ['mage'], cls: 'mage',
    base: S(1020, 52, 132, 36, 44, 0.7, 4, 0.55, 0, 90),
    silhouette: 'talismanMage', hue: 0x66789c,
    skill: 'gouchen_q',
    skillSpec: {
      kind: 'beam', name: '勾陈垣', target: 'enemyLongestLine',
      desc: '勾陈六星贯穿 {length} 格，沿途造成 {sp} 法强的法术伤害，并使命中者魔抗 -30%（持续 6 秒）。',
      params: { sp: 4.2, length: 6, type: 'magic', status: { kind: 'mrShred', dur: 6, value: 30 } },
    },
  },
  {
    id: 'wangxiang', name: '望乡', title: '望乡人', cost: 5 as Rarity,
    origins: ['youming'], classes: ['support'], cls: 'support',
    base: S(880, 48, 118, 28, 46, 0.65, 3, 0.55, 20, 100),
    silhouette: 'lanternSage', hue: 0x8f8574,
    skill: 'wangxiang_q',
    skillSpec: {
      kind: 'resurrect', name: '引魂', target: 'deadAlly',
      desc: '提灯引魂：复活一名阵亡友军，恢复 {value} 最大生命与满额法力；若无阵亡友军，则改为全体回复 {value} 最大生命。',
      params: { value: 0.5 },
    },
  },
  {
    id: 'zhaoye', name: '照夜', title: '照夜白', cost: 5 as Rarity,
    origins: ['jianzong'], classes: ['assassin'], cls: 'assassin',
    base: S(980, 96, 0, 30, 30, 0.9, 1, 0.42, 0, 85, 0.4, 2.0),
    silhouette: 'twinDagger', hue: 0xbfc9d8,
    skill: 'zhaoye_q',
    skillSpec: {
      kind: 'dashStrike', name: '照夜', target: 'enemyFarthest',
      desc: '照夜入敌阵：对 {radius} 格内所有敌人造成 {atk} 攻击力的物理伤害，必定暴击；若造成击杀可再次施放（至多 2 次）。',
      params: { atk: 2.9, radius: 1, type: 'physical', forceCrit: true, resetOnKill: 1, maxRepeats: 2 },
    },
  },
  {
    id: 'muyuan', name: '木鸢', title: '木鸢', cost: 5 as Rarity,
    origins: ['jiguan'], classes: ['assassin'], cls: 'assassin',
    base: S(860, 90, 40, 28, 28, 0.95, 1, 0.4, 0, 80, 0.35, 1.85),
    silhouette: 'shadowHood', hue: 0xb0a070,
    skill: 'muyuan_q',
    skillSpec: {
      kind: 'strike', name: '鸢喙', target: 'currentTarget',
      desc: '木鸢俯击：造成 {atk} 攻击力的物理伤害；目标生命低于 {threshold} 时伤害翻倍。',
      params: { atk: 3.1, type: 'physical', threshold: 0.28 },
    },
  },

  // ───────────── 五费 ─────────────
  {
    id: 'shidian', name: '十殿', title: '阎君', cost: 5 as Rarity,
    origins: ['youming'], classes: ['warlock'], cls: 'warlock',
    base: S(1020, 60, 150, 36, 42, 0.7, 3, 0.55, 0, 95),
    silhouette: 'bonePuppet', hue: 0x6e3f3a,
    skill: 'shidian_q',
    skillSpec: {
      kind: 'execute', name: '十殿审判', target: 'allEnemies',
      desc: '审判全场：对所有敌人造成 {sp} 法强的真实伤害；生命低于 {threshold} 者立即处决。每处决一人，全体友军回复 15% 生命。',
      // threshold 0.24 → 0.20（M 残留专项）：处决斩杀窗收窄 4 个百分点。
      // 量化依据（scripts/ab-pair.ts，CRN n=250）：「亡语→后期」双向平均
      // 99.8% → 90.0%（-9.8p，目标门 ≤92% 达标）；其余配对全部 |Δ| ≤ 2p，
      // 仅「亡语→快攻」-1.6p、「亡语→荆棘」-1.4p —— 对被克制方（后期大招）
      // 特异、对环境中性。0.18 档（→82.8%）扰动更大，按最小扰动原则取 0.20。
      params: { sp: 2.1, type: 'true', threshold: 0.2 },
    },
  },
  {
    id: 'yinglong', name: '应龙', title: '祖龙', cost: 5 as Rarity,
    origins: ['longyuan'], classes: ['mage'], cls: 'mage',
    base: S(1080, 56, 140, 34, 44, 0.7, 4, 0.55, 0, 88),
    silhouette: 'dragonSovereign', hue: 0x4f9484,
    skill: 'yinglong_q',
    skillSpec: {
      kind: 'beam', name: '祖龙吐息', target: 'enemyLongestLine',
      desc: '蓄力后喷吐贯穿 {length} 格的祖龙之息，沿途造成 {sp} 法强的法术伤害，并使命中者魔抗 -35%（持续 6 秒）。',
      params: { sp: 4.7, length: 8, type: 'magic', status: { kind: 'mrShred', dur: 6, value: 35 }, invulnWhileCasting: true },
    },
  },
  {
    id: 'haotian', name: '昊天', title: '天帝', cost: 5 as Rarity,
    origins: ['tian'], classes: ['warrior'], cls: 'warrior',
    base: S(1180, 124, 64, 40, 42, 0.8, 1, 0.5, 0, 110, 0.25, 1.6),
    silhouette: 'bladeGeneral', hue: 0xcbb060,
    skill: 'haotian_q',
    skillSpec: {
      kind: 'nova', name: '天子剑', target: 'self',
      desc: '召来剑雨：{shots} 波、每波对周围 {radius} 格造成 {atk} 攻击力 + {sp} 法强的物理伤害；期间自身无敌且攻速 +50%。',
      params: { atk: 1.1, sp: 0.5, radius: 2, shots: 5, interval: 0.4, type: 'physical', invulnWhileCasting: true, status: { kind: 'aspdUp', dur: 3, value: 50 } },
    },
  },
  {
    id: 'qingqiu', name: '青丘', title: '狐仙', cost: 5 as Rarity,
    origins: ['yaozu'], classes: ['support'], cls: 'support',
    base: S(840, 52, 124, 28, 46, 0.65, 3, 0.55, 0, 100),
    silhouette: 'foxSpirit', hue: 0xc08a9a,
    skill: 'qingqiu_q',
    skillSpec: {
      kind: 'shieldAll', name: '九尾庇佑', target: 'allAllies',
      desc: '全体友军获得 {value} 最大生命的护盾与 8 秒 40% 攻速；同时魅惑全体敌人 {dur} 秒（无法行动，且受伤加深 20%）。',
      params: { value: 0.35, dur: 2.5, status: { kind: 'aspdUp', dur: 8, value: 40 }, vulnerability: 0.2 },
    },
  },
];

export const CHAMPION_BY_ID: Record<string, ChampionEntry> = Object.fromEntries(
  CHAMPIONS.map((c) => [c.id, c]),
);

export const CHAMPION_IDS_BY_COST: Record<number, string[]> = (() => {
  const out: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const c of CHAMPIONS) out[c.cost].push(c.id);
  return out;
})();

/** 百分比格式化（0.45 → "45%"；缺值按 0 渲染，由模板键表统一口径） */
function pctv(v: number | undefined, d = 0): string {
  return `${((v ?? 0) * 100).toFixed(d)}%`;
}

/** 描述模板的占位符键表：键 → 从 params 取值并格式化（文案里出现才取，缺键原样保留） */
const DESC_KEYS: Record<string, (p: SkillParams) => string> = {
  atk: (p) => pctv(p.atk),
  sp: (p) => pctv(p.sp),
  value: (p) => pctv(p.value),
  healOnHit: (p) => pctv(p.healOnHit),
  shieldOnHit: (p) => pctv(p.shieldOnHit),
  damageReduction: (p) => pctv(p.damageReduction),
  reflect: (p) => pctv(p.reflect),
  threshold: (p) => pctv(p.threshold),
  dpsSp: (p) => pctv(p.dpsSp),
  resetOnKill: (p) => pctv(p.resetOnKill),
  hpPct: (p) => pctv(p.summon?.hpPct),
  atkPct: (p) => pctv(p.summon?.atkPct),
  // status.value 为百分点（45 = +45%），与 battle.ts 的 sumStatus()/100 同口径
  statusValue: (p) => pctv((p.status?.value ?? 0) / 100),
  // status.value 为平值（灼烧每秒伤害等），不走百分比
  statusFlat: (p) => String(p.status?.value ?? 0),
  radius: (p) => String(p.radius ?? 1),
  // 控制类技能的时长只存在于 status.dur（stun/silence/wound/burn），顶层 dur 优先
  dur: (p) => String(p.dur ?? p.status?.dur ?? 0),
  delay: (p) => String(p.delay ?? 0),
  length: (p) => String(p.length ?? 0),
  shots: (p) => String(p.shots ?? 1),
  jumps: (p) => String(p.jumps ?? 1),
  knockback: (p) => String(p.knockback ?? 0),
  count: (p) => String(p.summon?.count ?? 0),
};

/** 描述模板回填：保证文案与数值永不脱节 */
export function formatSkillDesc(tpl: string, p: SkillParams): string {
  return tpl.replace(/\{(\w+)\}/g, (m, key: string) =>
    DESC_KEYS[key] ? DESC_KEYS[key](p) : m,
  );
}
