/**
 * 装备配置表。
 *
 * 设计原则：**每件合成装备都必须带一个机制，而不是"属性翻倍"。**
 * 纯属性装备（"+50 攻击"）不会改变玩家的决策，它只是把已有玩法数值放大；
 * 带机制的装备（"击杀回复 18% 生命"）会改变玩家的构筑与站位思路。
 *
 * 8 个组件 → 28 种两两组合，这里实装 14 种。剩下的组合不是"没做完"，
 * 而是刻意留白：给玩家留出"这两个合出来会是什么"的探索空间，
 * 同时避免 28 件装备带来的认知负担。
 */

export type ItemTier = 'component' | 'combined';

/** 装备提供的属性加成。字段名与 Unit 的面板属性一一对应。 */
export interface ItemBonus {
  hp: number;
  atk: number;
  sp: number;
  armor: number;
  mr: number;
  /** 攻速百分比（0.12 = +12%） */
  aspd: number;
  critChance: number;
  critMult: number;
  /** 普攻吸血 */
  lifesteal: number;
  /** 全能吸血（技能伤害也吸） */
  omnivamp: number;
  startMp: number;
  damageAmp: number;
}

/** 需要内核运行时支持的机制，走 TraitState 的既有字段 */
export interface ItemMods {
  /** 破甲比例 */
  armorPen: number;
  /** 技能增伤 */
  skillAmp: number;
  /** 物理减伤 */
  physicalDr: number;
  /** 法术减伤 */
  magicDr: number;
  manaPerSec: number;
  /** 每秒回复最大生命的百分比 */
  hpRegenPctPerSec: number;
  healAmp: number;
  /** 全类型减伤。魔抗装之所以要带上它，见「玄冥衣」条目下的说明。 */
  allDr: number;
}

/** 需要钩子实现的机制 */
export type ItemHookId = 'executeHeal' | 'immortal' | 'thorns' | 'momentum' | 'healToShield';

export interface ItemDef {
  id: string;
  name: string;
  tier: ItemTier;
  desc: string;
  /** 合成配方。组件为空。 */
  recipe?: [string, string];
  bonus: Partial<ItemBonus>;
  mods?: Partial<ItemMods>;
  hooks?: ItemHookId[];
  /** 钩子的数值参数 */
  params?: Record<string, number>;
  /** 程序化图标的绘制方案 */
  glyph: ItemGlyph;
}

export type ItemGlyph =
  | 'blade'
  | 'armor'
  | 'orb'
  | 'boot'
  | 'jade'
  | 'talisman'
  | 'gauntlet'
  | 'cloak'
  | 'soulblade'
  | 'lance'
  | 'bloodfang'
  | 'stupa'
  | 'turtle'
  | 'chaosorb'
  | 'voidpearl'
  | 'bloodpearl'
  | 'gale'
  | 'shadow'
  | 'darkrobe'
  | 'undying'
  | 'rebirth'
  | 'titan';

export const ITEMS: readonly ItemDef[] = [
  // ── 组件 ────────────────────────────────────────────
  {
    id: 'moren',
    name: '翠玦',
    tier: 'component',
    desc: '攻击力 +12',
    bonus: { atk: 12 },
    glyph: 'blade',
  },
  {
    // M4 调平（sim:items 配对实测，每档 960 局同种子双向）：纯防御组件在
    // 胜率口径下天然吃亏（DESIGN §十三.4 已知边界），护甲 12 多轮实测在
    // 零线下 0.5~1.5 个百分点徘徊（内核数次版本更迭间 -1.0/-0.7/-1.5）。
    // 提至护甲 16 实测 +0.7%，同窗加测护甲 16 + 生命 60 得 +0.4% 互为印证；
    // 护甲 18/20 档反而落回零下（护甲边际在 44~56 区间已进 RESIST 曲线
    // 平缓段，且 ±1.5 个百分点的抽样噪声主导），取最小有效档 16。
    id: 'xuanjia',
    name: '金锭',
    tier: 'component',
    desc: '护甲 +16',
    bonus: { armor: 16 },
    glyph: 'armor',
  },
  {
    id: 'lingzhu',
    name: '灵珠',
    tier: 'component',
    desc: '法强 +16',
    bonus: { sp: 16 },
    glyph: 'orb',
  },
  {
    id: 'yunlv',
    name: '轻羽',
    tier: 'component',
    desc: '攻速 +12%',
    bonus: { aspd: 0.12 },
    glyph: 'boot',
  },
  {
    id: 'xueyu',
    name: '青莲',
    tier: 'component',
    desc: '生命 +160',
    bonus: { hp: 160 },
    glyph: 'jade',
  },
  {
    // M4 调平（sim:items 配对实测，每档 960 局同种子双向）：原值 startMp 12 +
    // 回蓝 1 实测 -10.3%（v1.1.0 基线）。毒性分解实验（同进程运行时改参，
    // 每档 960 局）：startMp 12 单独 -13.1%，回蓝 1 单独 -6.7%，且回蓝
    // 1/2/3 档呈单调恶化（-6.7/-8.4/-10.8）—— 任何小剂量法力参数都是净负。
    // 机理诊断（事件流级）：法符被装配逻辑分给处决类 carry（十殿）时，
    // 施法循环前移使处决在敌方血线未达 24% 阈值时提前/加频释放，斩杀段与
    // 「每处决一人全队回复 15%」连锁双双落空，持有者技能伤害 -36%；
    // 而弹道类持有者（应龙）同参数 +126%。属参数 × 机制结构问题，非内核缺陷。
    // 修法：保留 startMp 12 与回蓝 1（组件定位：回天符的初始法力来源），
    // 以法强 +48、生命 +90 覆盖净负，实测 +4.1%（当前内核）转正入带。
    id: 'fafu',
    name: '法符',
    tier: 'component',
    desc: '法强 +48，生命 +90。初始法力 +12，每秒回蓝 +1。',
    bonus: { startMp: 12, sp: 48, hp: 90 },
    mods: { manaPerSec: 1 },
    glyph: 'talisman',
  },
  {
    // M4 调平（sim:items 配对实测，2880 局）：原值暴击率 12% 实测 -0.6%，
    // 加大暴击率至 16% 反而 -1.7%（暴击期望 = 概率 × (倍率-1) ≈ 5%，对
    // 技能流阵容近乎死词条）。补攻击力 +8（与「拳套」语义一致）实测 +1.6%
    // 转正。血玉 / 玄甲同轮 2880 局复测分别为 +2.1% / +0.5%，均已为正，不动。
    id: 'quantao',
    name: '紫晶',
    tier: 'component',
    desc: '暴击率 +12%，攻击力 +8。',
    bonus: { critChance: 0.12, atk: 8 },
    glyph: 'gauntlet',
  },
  {
    id: 'doupeng',
    name: '赤绳',
    tier: 'component',
    desc: '魔抗 +12，生命 +90',
    bonus: { mr: 12, hp: 90 },
    glyph: 'cloak',
  },

  // ── 合成装备 ────────────────────────────────────────
  {
    id: 'duanhun',
    name: '断魂刃',
    tier: 'combined',
    desc: '攻击力 +30。击杀敌人后回复 18% 最大生命。',
    recipe: ['moren', 'moren'],
    bonus: { atk: 30 },
    hooks: ['executeHeal'],
    params: { healPct: 0.18 },
    glyph: 'soulblade',
  },
  {
    id: 'pojia',
    name: '破甲杖',
    tier: 'combined',
    desc: '攻击力 +20，护甲 +10。攻击无视目标 35% 护甲。',
    recipe: ['moren', 'xuanjia'],
    bonus: { atk: 20, armor: 10 },
    mods: { armorPen: 0.35 },
    glyph: 'lance',
  },
  {
    id: 'xueyin',
    name: '血饮',
    tier: 'combined',
    desc: '攻击力 +18，暴击率 +10%。获得 18% 全能吸血。',
    recipe: ['moren', 'quantao'],
    bonus: { atk: 18, critChance: 0.1, omnivamp: 0.18 },
    glyph: 'bloodfang',
  },
  {
    // 纯减伤装在"胜率增量"这个口径下天然吃亏 —— 你是靠杀人赢的，不是靠活着赢的。
    // 但 +3.8% 已经低到玩家不会想合它了，所以补上 6% 全类型减伤，
    // 让它真正配上"不动"这个名字：不只是抗物理，是全面站得住。
    id: 'budong',
    name: '不动明王',
    tier: 'combined',
    desc: '护甲 +28。受到的物理伤害降低 15%，所有伤害降低 6%。',
    recipe: ['xuanjia', 'xuanjia'],
    bonus: { armor: 28 },
    mods: { physicalDr: 0.15, allDr: 0.06 },
    glyph: 'stupa',
  },
  {
    id: 'xuanwu',
    name: '玄武甲',
    tier: 'combined',
    desc: '生命 +300，护甲 +16。受到物理伤害时反弹其中 20%。',
    recipe: ['xuanjia', 'xueyu'],
    bonus: { hp: 300, armor: 16 },
    hooks: ['thorns'],
    params: { reflectPct: 0.2 },
    glyph: 'turtle',
  },
  {
    id: 'hunyuan',
    name: '混元珠',
    tier: 'combined',
    desc: '法强 +48。',
    recipe: ['lingzhu', 'lingzhu'],
    bonus: { sp: 48 },
    glyph: 'chaosorb',
  },
  {
    // M2 调平（sim:items 配对实测，每件 960 局）：原值（法强 22 / 初始法力 15 /
    // 技能增幅 18%）实测 -1.8%，为全表成品最低。法强 22→32 仅 +0.3 个百分点
    // （-1.8%→-1.5%），去除初始法力后 +4.7%（该参数实测承载 -6.2 个百分点，
    // 与组件法符 startMp 12 + 回蓝 1 = -10.3% 的证据一致），落回成品带内。
    // 技能增幅维持 18%。
    id: 'taixu',
    name: '太虚经',
    tier: 'combined',
    desc: '法强 +32。技能伤害 +18%。',
    recipe: ['lingzhu', 'fafu'],
    bonus: { sp: 32 },
    mods: { skillAmp: 0.18 },
    glyph: 'voidpearl',
  },
  {
    id: 'xuehun',
    name: '血魂珠',
    tier: 'combined',
    desc: '法强 +26，生命 +260。获得 22% 全能吸血。',
    recipe: ['lingzhu', 'xueyu'],
    bonus: { sp: 26, hp: 260, omnivamp: 0.22 },
    glyph: 'bloodpearl',
  },
  {
    // 原版是纯攻速 +32%，但两个云履（各 +12%，可给两人）加起来就 +24%，
    // 合成反而是负收益 —— 实测 -0.4%。纯属性翻倍救不了它，必须给机制。
    id: 'jifeng',
    name: '疾风弓',
    tier: 'combined',
    // 第一版叠层是 8 层 ×4%，但一场战斗平均只有 12 秒，8 次普攻还没打完就结束了 ——
    // 满层攻速是个摸不到的天花板。改成 5 层 ×7%（满层 +35%）：五六次攻击
    // （约 5 秒）就能吃满，这才叫"越打越快"。
    desc: '攻速 +20%。每次普攻命中叠加 7% 攻速，最多 5 层。',
    recipe: ['yunlv', 'yunlv'],
    bonus: { aspd: 0.2 },
    hooks: ['momentum'],
    params: { aspdPerStack: 0.07, maxStacks: 5 },
    glyph: 'gale',
  },
  {
    // 同样是纯属性装，合成收益 -0.3%。加破甲后它有了明确定位：
    // 打高护甲前排的那一件，而不是"又一个暴击装"。
    id: 'yingxi',
    name: '影袭',
    tier: 'combined',
    desc: '攻速 +14%，暴击率 +18%，暴击伤害 +28%。攻击无视目标 25% 护甲。',
    recipe: ['yunlv', 'quantao'],
    bonus: { aspd: 0.14, critChance: 0.18, critMult: 0.28 },
    mods: { armorPen: 0.25 },
    glyph: 'shadow',
  },
  {
    // 原版纯魔抗装，实测只有 +1.5%，是所有成品里最弱的 —— 原因不是数值给少了，
    // 而是**这个游戏里魔抗本身就是废属性**：六套预设主力全是物理输出，
    // 堆魔抗等于空过一件装备。所以改成"魔抗为主 + 全类型减伤"，
    // 保留对法术的特化定位，同时不至于对物理阵容完全无效。
    id: 'xuanming',
    name: '玄冥衣',
    tier: 'combined',
    desc: '魔抗 +26，护甲 +16。受到的所有伤害降低 8%。',
    recipe: ['doupeng', 'doupeng'],
    bonus: { mr: 26, armor: 16 },
    mods: { allDr: 0.08 },
    glyph: 'darkrobe',
  },
  {
    // M2 调平（sim:items 配对实测，每件 960 局）：面板生命 260→220、260→140 两档
    // 实测边际胜率几乎不动，该件强度主体是复活机制而非面板数值。
    // 复活比例 0.25→0.15 档实测 -2.1 个百分点（+11.5%→+9.4%），0.15→0.08 档实测
    // +0.1 个百分点（+9.4%→+9.5%，噪声级）：复活血量降过生存阈值后边际消失，
    // 0.15 为该机制在不重设计前提下的最优可达档。面板数值维持原值。
    // M4 重设计（当前内核配对实测，每档 960 局）：复活机制本体承载约 +11 个
    // 百分点，且对「挂在持有者身上」的代价全部免疫 —— 易伤 20/25/30/40 四档、
    // 躯壳崩解 0.012~0.03（8 秒累计 10%~24% 最大生命，0.03 档复活单位 5 秒内
    // 必死）、复活法力清零，各档与无代价档差值全部 ≤1 个百分点；面板生命
    // 260→140 亦不掉强度。强度主体是复活事件本身的占位扰动与火力重定向。
    // 唯一有效杠杆 = 拉开死亡与复活的间隔：延迟期间单位不占位、不可被选为目标，
    // 敌方火力被迫转回队友。实测 0/1/2/3 秒 = +17.2/+14.1/+13.2/+13.4，
    // 取 2 秒（前 2 秒斜率约 -2pp/秒，2 秒后饱和）。
    id: 'buxiu',
    name: '鹤龄镜',
    tier: 'combined',
    desc: '生命 +260，魔抗 +14。首次阵亡 2 秒后，以 15% 生命原地爬起。',
    recipe: ['doupeng', 'xueyu'],
    bonus: { hp: 260, mr: 14 },
    hooks: ['immortal'],
    params: { hpPct: 0.15, reviveDelay: 2 },
    glyph: 'undying',
  },
  {
    // 原版合成收益 -2.0%，全场最差 —— 两个法符拆开给两个辅助，比合一件
    // 给一个人更划算。回蓝是线性收益，翻倍没有质变，所以给它一个
    // "溢出不浪费"的机制：治疗满血目标时，溢出的部分转成护盾。
    // 这条同时解决了丹师/治疗流最大的痛点——满血时治疗全浪费。
    id: 'huitian',
    name: '回天灯',
    tier: 'combined',
    desc: '初始法力 +28，每秒回蓝 +4，治疗提升 30%。其治疗若溢出，溢出量的 70% 转为护盾。',
    recipe: ['fafu', 'fafu'],
    bonus: { startMp: 28 },
    mods: { manaPerSec: 4, healAmp: 0.3 },
    hooks: ['healToShield'],
    params: { shieldPct: 0.7 },
    glyph: 'rebirth',
  },
  {
    id: 'juling',
    name: '巨灵冠',
    tier: 'combined',
    desc: '生命 +520。每秒回复 1.5% 最大生命。',
    recipe: ['xueyu', 'xueyu'],
    bonus: { hp: 520 },
    mods: { hpRegenPctPerSec: 0.015 },
    glyph: 'titan',
  },
];

export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export const COMPONENT_IDS: readonly string[] = ITEMS.filter((i) => i.tier === 'component').map((i) => i.id);

/** 配方索引： "a+b"（已排序） → 合成结果 id */
export const RECIPE_INDEX: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const it of ITEMS) {
    if (!it.recipe) continue;
    const [a, b] = it.recipe;
    out[[a, b].sort().join('+')] = it.id;
  }
  return out;
})();

/** 查两件组件能合成什么。不能合成返回 null。 */
export function combine(a: string, b: string): string | null {
  return RECIPE_INDEX[[a, b].sort().join('+')] ?? null;
}

