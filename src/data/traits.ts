import type { TraitDef } from '../core/types';

/**
 * 羁绊配置表。
 *
 * 设计原则（对应 2.1「羁绊不是数值堆砌」）：
 * 每条羁绊都必须提供一条**机制层面的质变**，而不只是加数值。
 * 质变被归纳为五类，全表覆盖：
 *   [站位]  改变开局站位 / 行动逻辑（刺客跳后排）
 *   [技能]  改变技能行为（龙渊强化施法、方士溅射）
 *   [经济]  改变资源节奏（剑宗击杀回蓝、术士击杀刷新）
 *   [生存]  改变死亡规则（幽冥复活、天庭无敌）
 *   [节奏]  改变时间曲线（机关攻速成长、山海流血叠层）
 */
export const TRAITS: readonly TraitDef[] = [
  // ─────────────── 地域羁绊 (origin) ───────────────
  {
    id: 'tian',
    name: '天庭',
    category: 'origin',
    description: '受天命护佑，开阵即披金光。',
    breakpoints: [2, 4],
    effectText: [
      '战斗开始时，天庭棋子获得 8% 最大生命的护盾。',
      '战斗开始时，天庭棋子获得 20% 最大生命的护盾；护盾被打破时对周围 1 格敌人造成 120% 法强的法术伤害。',
    ],
    colors: [1, 2],
  },
  {
    id: 'youming',
    name: '幽冥',
    category: 'origin',
    description: '生死簿上无名，亡者亦可再战。',
    breakpoints: [2, 4],
    effectText: [
      '友军阵亡时，为最近的友军回复阵亡棋子 6% 的最大生命。',
      '幽冥棋子首次阵亡时以 15% 生命复活，并获得 30% 攻速加成直至战斗结束。',
    ],
    colors: [1, 2],
  },
  {
    id: 'shanhai',
    name: '山海',
    category: 'origin',
    description: '荒古巨兽之血，撕咬不止。',
    breakpoints: [2, 4],
    effectText: [
      '普攻附加【流血】：3 秒内共造成 8% 目标最大生命的真实伤害。',
      '普攻附加【流血】：3 秒内共造成 16% 目标最大生命的真实伤害，并使其受到的治疗效果降低 40%，持续 3 秒。',
    ],
    colors: [1, 2],
  },
  {
    id: 'jianzong',
    name: '剑宗',
    category: 'origin',
    description: '一剑断岳，剑意不绝。',
    breakpoints: [2, 4],
    effectText: [
      '暴击率 +20%。',
      '暴击伤害 +20%，无视目标 18% 护甲，全队无视 12%~20% 护甲（随剑宗人数）；击杀敌人后立即回复 20 点法力。',
    ],
    colors: [1, 2],
  },
  {
    id: 'yaozu',
    name: '妖族',
    category: 'origin',
    description: '嗜血而生，绝境化形。',
    breakpoints: [2, 4],
    effectText: [
      '全能吸血 +15%（技能伤害同样吸血）。',
      '全能吸血 +36%；生命首次低于 60% 时化形：回复 24% 最大生命，清除控制效果，获得 35% 攻速、15% 攻击力与 35% 减伤，持续 6 秒。',
    ],
    colors: [1, 2],
  },
  {
    id: 'jiguan',
    name: '机关',
    category: 'origin',
    description: '齿轮咬合，愈战愈疾。',
    breakpoints: [2, 4],
    effectText: [
      '护甲 +22；每 5 秒永久获得 10% 攻速（可叠加）。',
      '每次攻击叠加 9% 攻速（最多 8 层）；每第 4 次攻击额外造成 140% 攻击力的物理伤害。',
    ],
    colors: [1, 2],
  },
  {
    id: 'danding',
    name: '丹鼎',
    category: 'origin',
    description: '炉火不熄，金丹续命。',
    breakpoints: [2, 4],
    effectText: [
      '丹鼎棋子每秒回复 1.5% 最大生命。',
      '丹鼎棋子每秒回复 1.5% 最大生命和 3 点法力；治疗溢出的部分转化为等量护盾。',
    ],
    colors: [1, 2],
  },
  {
    id: 'longyuan',
    name: '龙渊',
    category: 'origin',
    description: '吞吐云雾，法力如渊。',
    breakpoints: [2, 4],
    effectText: [
      '龙渊棋子法强 +30。',
      '龙渊棋子技能伤害 +32%；全队法强 +18、技能伤害 +9%；施法后 4 秒内，下一次普攻额外造成 80% 法强的法术伤害。',
    ],
    colors: [1, 2],
  },

  {
    id: 'momen',
    name: '墨门',
    category: 'origin',
    description: '兼爱非攻，九守如城。',
    breakpoints: [3, 6, 9],
    effectText: [
      '墨门棋子获得 10% 全伤害减免与 10% 最大生命。',
      '所有友军获得 8% 全伤害减免；墨门棋子每秒回复 2% 最大生命。',
      '兼爱：友军受到的伤害有 30% 转由全体墨门棋子均摊；墨门棋子的全伤害减免提升至 20%。',
    ],
    colors: [0, 1, 2],
  },
  {
    id: 'bingjia',
    name: '兵家',
    category: 'origin',
    description: '百战之师，愈杀愈奋。',
    breakpoints: [2, 5, 8],
    effectText: [
      '兵家棋子攻击力 +35%。',
      '所有友军攻击力 +26%、攻速 +20%。',
      '百战：任意友军击杀敌人时，全体友军永久 +12% 攻击力与 +9% 攻速；兵家棋子完成击杀时此加成翻倍。',
    ],
    colors: [0, 1, 2],
  },

  // ─────────────── 职业羁绊 (class) ───────────────
  {
    id: 'warrior',
    name: '武将',
    category: 'class',
    description: '陷阵之志，有死无生。',
    breakpoints: [2, 4, 6],
    effectText: [
      '攻击力 +20%。',
      '攻击力 +45%；每次攻击命中叠加 2.5% 攻击力（最多 10 层）。',
      '攻击力 +75%；受到的物理伤害降低 18%。',
    ],
    colors: [0, 1, 2],
  },
  {
    id: 'guardian',
    name: '护卫',
    category: 'class',
    description: '立如磐石，以身护道。',
    breakpoints: [2, 4, 6],
    effectText: [
      '生命 +14%，护甲 +16。',
      '生命 +24%，护甲 +26；战斗开始时为相邻友军提供 12% 最大生命护盾。',
      '生命 +28%，护甲 +32，攻击力 +45%；每 3 秒为自身提供 2% 最大生命护盾，受到物理伤害时反弹 52% 基础护甲值的伤害。',
    ],
    colors: [0, 1, 2],
  },
  {
    id: 'assassin',
    name: '刺客',
    category: 'class',
    description: '影落无声，取首于万军。',
    breakpoints: [2, 3],
    effectText: [
      '战斗开始 1 秒后跃入敌方最后排，落地后获得 0.7 秒无敌；暴击率 +20%。',
      '跃入后 5 秒内获得 35% 攻速；暴击伤害 +35%。',
    ],
    colors: [1, 2],
  },
  {
    id: 'marksman',
    name: '神射',
    category: 'class',
    description: '百步穿杨，箭无虚发。',
    breakpoints: [2, 3],
    effectText: [
      '攻击距离 +1；攻击力 +15%。',
      '每第 3 次攻击必定暴击，且暴击伤害 +30%。',
    ],
    colors: [1, 2],
  },
  {
    id: 'mage',
    name: '方士',
    category: 'class',
    description: '符箓通神，术法无涯。',
    breakpoints: [2, 4, 6],
    effectText: [
      '法强 +24。',
      '法强 +46；技能命中魔抗 -20%（4 秒）；全体开战 12% 护盾，二档再 +6%。',
      '法强 +78；技能对目标周围 1 格造成 55% 溅射伤害。',
    ],
    colors: [0, 1, 2],
  },
  {
    id: 'warlock',
    name: '术士',
    category: 'class',
    description: '以咒蚀骨，伤入魂魄。',
    breakpoints: [2, 3],
    effectText: [
      '技能伤害的 15% 转化为无法减免的真实伤害。',
      '技能伤害的 30% 转化为无法减免的真实伤害；技能命中使目标受到的治疗降低 30%，持续 3 秒。',
    ],
    colors: [1, 2],
  },
  {
    id: 'support',
    name: '丹师',
    category: 'class',
    description: '悬壶济世，妙手回春。',
    breakpoints: [2, 4],
    effectText: [
      '全体友军每秒回复 1.2% 最大生命。',
      '治疗与护盾效果 +80%；友军阵亡时，其余友军获得 20% 攻速，持续 8 秒。',
    ],
    colors: [1, 2],
  },
];

export const TRAIT_BY_ID: Record<string, TraitDef> = Object.fromEntries(
  TRAITS.map((t) => [t.id, t]),
);

// 羁绊档位色（铜 / 银 / 金 / 虹）的唯一真源在 src/render/view/palette.ts 的 TRAIT_TIER_COLOR_HEX。
