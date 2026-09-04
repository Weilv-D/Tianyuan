/**
 * 装备配置表。
 *
 * 设计原则：**每件合成装备都必须带一个机制，而不是"属性翻倍"。**
 * 纯属性装备（"+50 攻击"）不会改变玩家的决策，它只是把已有玩法数值放大；
 * 带机制的装备（"击杀回复 18% 生命"）会改变玩家的构筑与站位思路。
 *
 * 8 个组件两两组合（含同件）共 36 种配方，**全配方实装**（v1.9 起）：
 * 任何两件组件拖到一起必定合成 —— "这两个合出来会是什么"的探索
 * 由配方表的多样性承担，而不是靠"合不出来"留白。
 * 全表只有两件刻意保留的**白板位**：混元珠（纯法强）与紫霄珠（纯暴击）——
 * "把一条属性堆到极致"的最朴素路线，各保留一条不被机制绑架的去处。
 *
 * id 命名空间与棋子表（champions.ts）相互独立：个别音译同名的 id
 * （如 xuanwu / budong）在两表各自存在，查表经 ITEM_BY_ID / CHAMPION_BY_ID 隔离，
 * 不会互相命中。
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
  /** 承受伤害转化法力的倍率（狮心盾：被打=回蓝加速）。多件取最大。 */
  manaFromDamageMult: number;
  /** 技能暴击率（惊雷锤）。多件求和，封顶 1。 */
  skillCritChance: number;
  /** 技能暴击倍率（绝对值语义，多件取最大；0 = 用持有者普攻暴伤）。 */
  skillCritMult: number;
}

/**
 * 需要钩子实现的机制。
 *
 * 命名按装备语义而非效果名（hook 是"这件装备的机制"，不是"通用词条"）：
 * v1.9 全配方后共 22 个，全部实装在 core/items.ts 的 applyItemHooks。
 */
export type ItemHookId =
  | 'executeHeal' // 断魂刃：击杀回复
  | 'immortal' // 鹤龄镜：延迟复活
  | 'thorns' // 玄武甲：物理反弹
  | 'momentum' // 疾风弓：普攻叠攻速
  | 'healToShield' // 回天灯：治疗溢出转护盾
  | 'sunSpear' // 贯日枪：普攻追加法伤
  | 'frost' // 寒渊镰：普攻减速
  | 'berserk' // 缚龙爪：损血叠攻
  | 'killFrenzy' // 流星弩：击杀攻速爆发
  | 'venom' // 赤练鞭：普攻上易伤
  | 'castShield' // 青圭杖：施法得盾
  | 'windRunner' // 追风履：每秒成长攻速
  | 'ironPurge' // 玄铁重甲：周期净化
  | 'castAspd' // 紫电镰：施法攻速爆发
  | 'castHeal' // 引魂灯：施法治疗最低友军
  | 'wingStart' // 垂天翼：开战攻速
  | 'foxReady' // 九尾面：施法后必爆强击
  | 'disarmSwat' // 拂尘扇：计数缴械
  | 'onHitHeal' // 霜翎环：普攻回复(按最大生命)
  | 'onHitMana' // 紫金炉：普攻回蓝（历史名 critMana 实为普攻回蓝，2026-09-05 正名）
  | 'warBanner' // 墨龙旗：开战全队减伤
  | 'bellStun'; // 摄魂铃：受击概率眩晕

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
    // v1.9 调档：+7.9% 全表最强组件（第二名 +3.7%），拆开价值压过全部 8 条
    // 法符配方的合成收益。现行档 sp 34、生命 60（初版 48/90，两轮下调后定档），
    // 组件仍居首，合成门槛回落 —— 数值以 bonus 为准，注释不复述第二遍。
    desc: '法强 +34，生命 +60。初始法力 +8，每秒回蓝 +1。',
    bonus: { startMp: 8, sp: 34, hp: 60 },
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
    desc: '攻击力 +24，暴击率 +12%。获得 18% 全能吸血。',
    recipe: ['moren', 'quantao'],
    bonus: { atk: 24, critChance: 0.12, omnivamp: 0.18 },
    glyph: 'bloodfang',
  },
  {
    // 纯减伤装在"胜率增量"这个口径下天然吃亏 —— 你是靠杀人赢的，不是靠活着赢的。
    // 8% 全类型减伤让它真正配上"不动"这个名字；全表配对复测为 +4.9%，
    // 合成比双组件多 +3.3 个百分点。
    id: 'budong',
    name: '不动明王',
    tier: 'combined',
    desc: '护甲 +28。受到的物理伤害降低 15%，所有伤害降低 8%。',
    recipe: ['xuanjia', 'xuanjia'],
    bonus: { armor: 28 },
    mods: { physicalDr: 0.15, allDr: 0.08 },
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
    desc: '法强 +56。',
    recipe: ['lingzhu', 'lingzhu'],
    bonus: { sp: 56 },
    glyph: 'chaosorb',
  },
  {
    // 全表同种子配对复测中，32 法强仍不足以覆盖双组件机会成本；补到 64 法强、
    // 90 生命后单件 +11.2%，合成比双组件多 +2.2 个百分点，技能增幅维持 18%。
    id: 'taixu',
    name: '太虚经',
    tier: 'combined',
    desc: '法强 +64，生命 +90。技能伤害 +18%。',
    recipe: ['lingzhu', 'fafu'],
    bonus: { sp: 64, hp: 90 },
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
    // 保留对法术的特化定位，同时不至于对物理阵容完全无效。补足生命与减伤后
    // 单件 +4.2%，合成比双组件多 +0.6 个百分点，是当前成品带下沿。
    id: 'xuanming',
    name: '玄冥衣',
    tier: 'combined',
    desc: '生命 +180，魔抗 +26，护甲 +16。受到的所有伤害降低 12%。',
    recipe: ['doupeng', 'doupeng'],
    bonus: { hp: 180, mr: 26, armor: 16 },
    mods: { allDr: 0.12 },
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
    // 1.9.0 内核（技能暴击/承伤转蓝/有效伤害口径钳制）落地后全表复测，
    // 合成收益回落到 -3.0%（法强 14 / 治疗提升 45% / 溢出 95% 转盾），
    // 拆开双法符 +17.0% 压过成品 +13.9%。复测定档（sim:items N=48 定向）：
    // 法强 30、治疗提升 80%、溢出全额转盾，单件 +17.6%，与拆分线
    // （2×法符 ≈ +18%）打进噪声带 —— 法符系按 DESIGN「合成增益 ≥ 0」锚验收；
    // 只动本件、不回调法符组件（组件全表正收益的口径不动）。
    id: 'huitian',
    name: '回天灯',
    tier: 'combined',
    desc: '法强 +25，初始法力 +24，每秒回蓝 +4，治疗提升 90%。其治疗若溢出，溢出量全额转为护盾。',
    recipe: ['fafu', 'fafu'],
    bonus: { sp: 25, startMp: 24 },
    mods: { manaPerSec: 4, healAmp: 0.9 },
    hooks: ['healToShield'],
    params: { shieldPct: 1 },
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

  // ── 合成装备 · v1.9 全配方扩展（22 件）────────────────
  // 数值口径与一期一致：面板 ≈ 两组件之和（主轴略溢价），机制是强度主体；
  // 档位全部经平衡工具链 `npm run sim:items` 配对实测后定档（工具链现已迁入 balance 目录，详见各条目注记）。
  {
    // 攻+法的混合出装通道。追加法伤按持有者法强折算 —— 法核拿了是锦上添花，
    // 攻核拿只有 20 点法强的底子，天然把这件推向双修 carry。
    id: 'guanri',
    name: '贯日枪',
    tier: 'combined',
    desc: '攻击力 +18，法强 +20。普攻命中追加 40% 法强的法术伤害。',
    recipe: ['moren', 'lingzhu'],
    bonus: { atk: 18, sp: 20 },
    hooks: ['sunSpear'],
    params: { spRatio: 0.4 },
    glyph: 'lance',
  },
  {
    id: 'qinggui',
    name: '青圭杖',
    tier: 'combined',
    desc: '护甲 +18，法强 +20，技能伤害 +10%。施法后获得 10% 最大生命的护盾，持续 4 秒。',
    recipe: ['xuanjia', 'lingzhu'],
    bonus: { armor: 18, sp: 20 },
    mods: { skillAmp: 0.1 },
    hooks: ['castShield'],
    params: { shieldPct: 0.1, shieldDur: 4 },
    glyph: 'voidpearl',
  },
  {
    id: 'hanyuan',
    name: '寒渊镰',
    tier: 'combined',
    desc: '攻击力 +16，攻速 +16%。普攻使命中目标减速 20%（攻速与移速），持续 2 秒。',
    recipe: ['moren', 'yunlv'],
    bonus: { atk: 16, aspd: 0.16 },
    hooks: ['frost'],
    params: { slowPct: 20, slowDur: 2 },
    glyph: 'soulblade',
  },
  {
    id: 'jinglei',
    name: '惊雷锤',
    tier: 'combined',
    desc: '法强 +26，暴击率 +10%，攻击力 +6。技能伤害可暴击（30% 概率，1.4 倍）。',
    recipe: ['lingzhu', 'quantao'],
    bonus: { sp: 26, critChance: 0.1, atk: 6 },
    mods: { skillCritChance: 0.3, skillCritMult: 1.4 },
    glyph: 'chaosorb',
  },
  {
    id: 'chilian',
    name: '赤练鞭',
    tier: 'combined',
    desc: '攻击力 +14，魔抗 +14，生命 +100。普攻使命中目标受伤加深 12%，持续 3 秒。',
    recipe: ['moren', 'doupeng'],
    bonus: { atk: 14, mr: 14, hp: 100 },
    hooks: ['venom'],
    params: { vulnPct: 12, vulnDur: 3 },
    glyph: 'bloodfang',
  },
  {
    id: 'liuxing',
    name: '流星弩',
    tier: 'combined',
    desc: '攻速 +12%，攻击力 +30，初始法力 +12。击杀后获得 5 秒 50% 攻速（至多 2 层）。',
    recipe: ['moren', 'fafu'],
    bonus: { atk: 30, aspd: 0.12, startMp: 12 },
    hooks: ['killFrenzy'],
    params: { aspdPct: 50, dur: 5, maxStacks: 2 },
    glyph: 'gale',
  },
  {
    id: 'fuchen',
    name: '拂尘扇',
    tier: 'combined',
    desc: '攻速 +14%，魔抗 +14，生命 +100。每第 4 次普攻缴械目标 1.2 秒。',
    recipe: ['yunlv', 'doupeng'],
    bonus: { aspd: 0.14, mr: 14, hp: 100 },
    hooks: ['disarmSwat'],
    params: { everyHits: 4, disarmDur: 1.2 },
    glyph: 'gale',
  },
  {
    id: 'zidian',
    name: '紫电镰',
    tier: 'combined',
    desc: '法强 +24，攻速 +16%。施法后获得 5 秒 45% 攻速（至多 2 层）。',
    recipe: ['lingzhu', 'yunlv'],
    bonus: { sp: 24, aspd: 0.16 },
    hooks: ['castAspd'],
    params: { aspdPct: 45, dur: 5, maxStacks: 2 },
    glyph: 'shadow',
  },
  {
    id: 'shuangling',
    name: '霜翎环',
    tier: 'combined',
    desc: '生命 +200，暴击率 +12%，攻击力 +8。普攻命中回复 1.5% 最大生命。',
    recipe: ['xueyu', 'quantao'],
    bonus: { hp: 200, critChance: 0.12, atk: 8 },
    hooks: ['onHitHeal'],
    params: { healPct: 0.015 },
    glyph: 'chaosorb',
  },
  {
    // 承伤转蓝是"被打"的正反馈 —— 前排穿着它施法循环显著前移，
    // 与法符（初始法力）分属"起手快"与"转得快"两种法力装定位。
    id: 'shixin',
    name: '狮心盾',
    tier: 'combined',
    desc: '护甲 +26，暴击率 +12%，攻击力 +8。承受伤害转化的法力提高 40%。',
    recipe: ['xuanjia', 'quantao'],
    bonus: { armor: 26, critChance: 0.12, atk: 8 },
    mods: { manaFromDamageMult: 1.4 },
    glyph: 'stupa',
  },
  {
    id: 'yinhun',
    name: '引魂灯',
    tier: 'combined',
    desc: '法强 +22，魔抗 +14，生命 +100。施法后为生命最低的友军回复 70% 法强的生命。',
    recipe: ['lingzhu', 'doupeng'],
    bonus: { sp: 22, mr: 14, hp: 100 },
    hooks: ['castHeal'],
    params: { healSpRatio: 0.7 },
    glyph: 'rebirth',
  },
  {
    id: 'shehun',
    name: '摄魂铃',
    tier: 'combined',
    desc: '暴击率 +12%，攻击力 +8，魔抗 +18，生命 +160。受到普攻时 30% 概率眩晕攻击者 1 秒（每 2 秒至多触发一次）。',
    recipe: ['quantao', 'doupeng'],
    bonus: { critChance: 0.12, atk: 8, mr: 18, hp: 160 },
    hooks: ['bellStun'],
    params: { chance: 0.3, stunDur: 1.0, cdTicks: 60 },
    glyph: 'undying',
  },
  {
    id: 'zijin',
    name: '紫金炉',
    tier: 'combined',
    desc: '初始法力 +12，暴击率 +18%，攻击力 +8。普攻命中额外回复 6 点法力。',
    recipe: ['fafu', 'quantao'],
    bonus: { startMp: 12, critChance: 0.18, atk: 8 },
    hooks: ['onHitMana'],
    params: { mpPerHit: 6 },
    glyph: 'voidpearl',
  },
  {
    id: 'jiaowei',
    name: '焦尾琴',
    tier: 'combined',
    desc: '护甲 +26，初始法力 +18，每秒回蓝 +6。',
    recipe: ['xuanjia', 'fafu'],
    bonus: { armor: 26, startMp: 18 },
    mods: { manaPerSec: 6 },
    glyph: 'talisman',
  },
  {
    id: 'molongqi',
    name: '墨龙旗',
    tier: 'combined',
    desc: '初始法力 +16，魔抗 +14，生命 +100。开战时全体友军获得 8 秒 22% 减伤。',
    recipe: ['fafu', 'doupeng'],
    bonus: { startMp: 16, mr: 14, hp: 100 },
    hooks: ['warBanner'],
    // drPct 是百分点口径（22 = 22%）：warBanner 直接把它作为 dr 状态的 value，
    // battle 按 value/100 结算 —— 与赤练鞭 vulnPct、妖族化形 35 同口径，勿改成 0.22
    params: { drPct: 22, dur: 8 },
    glyph: 'darkrobe',
  },
  {
    id: 'jiuwei',
    name: '九尾面',
    tier: 'combined',
    desc: '攻速 +20%，初始法力 +14。施法后，下一次普攻必定暴击并追加 300% 法强的法术伤害。',
    recipe: ['yunlv', 'fafu'],
    bonus: { aspd: 0.2, startMp: 14 },
    hooks: ['foxReady'],
    params: { bonusSpRatio: 3.0 },
    glyph: 'shadow',
  },
  {
    id: 'chuitian',
    name: '垂天翼',
    tier: 'combined',
    desc: '攻速 +16%，生命 +200。开战时获得 8 秒 30% 攻速。',
    recipe: ['yunlv', 'xueyu'],
    bonus: { aspd: 0.16, hp: 200 },
    hooks: ['wingStart'],
    params: { aspdPct: 30, dur: 8 },
    glyph: 'cloak',
  },
  {
    id: 'xuantie',
    name: '玄铁重甲',
    tier: 'combined',
    desc: '护甲 +24，魔抗 +18，生命 +150。每 5 秒净化自身的一个减益状态。',
    recipe: ['xuanjia', 'doupeng'],
    bonus: { armor: 24, mr: 18, hp: 150 },
    hooks: ['ironPurge'],
    params: { everyTicks: 150 },
    glyph: 'turtle',
  },
  {
    id: 'fulong',
    name: '缚龙爪',
    tier: 'combined',
    desc: '攻击力 +16，生命 +200。生命每损失 10%，攻击力 +4%（至多 +32%）。',
    recipe: ['moren', 'xueyu'],
    bonus: { atk: 16, hp: 200 },
    hooks: ['berserk'],
    params: { atkPerStep: 4, stepPct: 0.1, capPct: 0.32 },
    glyph: 'gauntlet',
  },
  {
    id: 'zhuifeng',
    name: '追风履',
    tier: 'combined',
    desc: '护甲 +16，攻速 +16%。开战后每秒获得 1.5% 攻速，至多 +24%。',
    recipe: ['xuanjia', 'yunlv'],
    bonus: { armor: 16, aspd: 0.16 },
    hooks: ['windRunner'],
    params: { aspdPerSec: 1.5, capPct: 24 },
    glyph: 'boot',
  },
  {
    id: 'cuidai',
    name: '翠玉带',
    tier: 'combined',
    desc: '生命 +400，初始法力 +16，每秒回蓝 +2，治疗提升 60%。',
    recipe: ['xueyu', 'fafu'],
    bonus: { hp: 400, startMp: 16 },
    mods: { healAmp: 0.6, manaPerSec: 2 },
    glyph: 'jade',
  },
  {
    // 白板位（与混元珠并列）：暴击的极致数值，不带机制。
    // 默认基线 12%×1.5（期望 1.06×，约 11 名棋子有非默认覆写）；本件后
    // 42%×2.0（期望 1.42×），相对基准约 +34% 期望伤害，与混元珠的法强同为"一条路走到黑"的出口。
    id: 'zixiaozhu',
    name: '紫霄珠',
    tier: 'combined',
    desc: '暴击率 +30%，暴击伤害 +50%。',
    recipe: ['quantao', 'quantao'],
    bonus: { critChance: 0.3, critMult: 0.5 },
    glyph: 'chaosorb',
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
