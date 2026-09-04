import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { ITEMS, COMPONENT_IDS, RECIPE_INDEX, combine } from '../src/data/items';
import { LEGEND_T3 } from '../src/core/config';
import { mkBattle, unitInput } from './helpers';

/**
 * v1.9 全配方装备矩阵 + 新钩子回归。
 *
 * 装备表是玩家每局都在消费的系统，两条硬契约在这里钉死：
 *  1. 配方完备性 —— 8 组件两两组合（含同件）36 种，一种不多、一种不少。
 *     少一种，玩家把两件组件拖在一起就会"合不出东西"，这是最恶性的体验破绽。
 *  2. 钩子行为 —— 每件新装备的机制都要有最小可复现的战斗级断言，
 *     防止"数据在、钩子没接上"的静默失效（装备层最常见的死法）。
 */
describe('装备配方矩阵（v1.9 全配方）', () => {
  it('8 组件两两组合（含同件）恰为 36 种，且全部有唯一成品', () => {
    expect(COMPONENT_IDS.length).toBe(8);
    const pairs = new Set<string>();
    for (let i = 0; i < COMPONENT_IDS.length; i++) {
      for (let j = i; j < COMPONENT_IDS.length; j++) {
        pairs.add([COMPONENT_IDS[i], COMPONENT_IDS[j]].sort().join('+'));
      }
    }
    expect(pairs.size).toBe(36);
    // 每一对都能合出东西
    for (const key of pairs) {
      expect(RECIPE_INDEX[key], `配方缺失: ${key}`).toBeTruthy();
    }
    // 反向：每条 recipe 都属于这 36 对之一
    const recipes = ITEMS.filter((i) => i.tier === 'combined').map((i) => i.recipe!.slice().sort().join('+'));
    expect(recipes.length).toBe(36);
    expect(new Set(recipes).size).toBe(36);
    for (const key of recipes) expect(pairs.has(key), `配方越界: ${key}`).toBe(true);
  });

  it('combine() 与 RECIPE_INDEX 同口径（排序无关）', () => {
    expect(combine('moren', 'lingzhu')).toBe('guanri');
    expect(combine('lingzhu', 'moren')).toBe('guanri');
    expect(combine('quantao', 'quantao')).toBe('zixiaozhu');
    expect(combine('duanhun', 'moren')).toBeNull(); // 成品不再是原料
  });

  it('装备 id/名称/图key 唯一，成品都带配方', () => {
    const ids = new Set(ITEMS.map((i) => i.id));
    const names = new Set(ITEMS.map((i) => i.name));
    expect(ids.size).toBe(ITEMS.length);
    expect(names.size).toBe(ITEMS.length);
    for (const it of ITEMS) {
      if (it.tier === 'combined') expect(it.recipe).toBeTruthy();
      else expect(it.recipe).toBeFalsy();
    }
  });
});

/** 按 defId 找单位（helpers 的 uid 跨测试自增，不可硬编码） */
function byDef(battle: Battle, defId: string) {
  const u = battle.units.find((x) => x.entry.id === defId);
  if (!u) throw new Error(`找不到单位 ${defId}`);
  return u;
}

/** 1v1 微型战斗工具：A 持有指定装备，跑 N tick 返回战斗实例 */
function duel(itemId: string, seed = 777, ticks = 240) {
  const battle = mkBattle(
    [
      unitInput('pan', 0, { c: 0, r: 6 }, { items: [itemId] }),
      unitInput('jingyu', 1, { c: 7, r: 1 }),
    ],
    seed,
  );
  for (let i = 0; i < ticks && !battle.finished; i++) battle.step();
  return { battle, a: byDef(battle, 'pan') };
}

describe('装备钩子回归（v1.9 新件）', () => {
  it('贯日枪：普攻命中追加一段法术伤害（source=item）', () => {
    const { battle } = duel('guanri');
    const itemHits = battle.events.filter(
      (e) => e.t === 'damage' && e.source === 'item' && e.type === 'magic',
    );
    expect(itemHits.length).toBeGreaterThan(0);
  });

  it('寒渊镰：普攻给目标上 slow', () => {
    const { battle } = duel('hanyuan');
    const slows = battle.events.filter((e) => e.t === 'status' && e.kind === 'slow' && e.added);
    expect(slows.length).toBeGreaterThan(0);
  });

  it('缚龙爪：损血叠攻（半血 ≈ +16%）', () => {
    const battle = mkBattle([unitInput('pan', 0, { c: 0, r: 6 }, { items: ['fulong'] }), unitInput('jingyu', 1, { c: 7, r: 1 })]);
    const a = byDef(battle, 'pan');
    a.hp = a.maxHp * 0.5;
    for (let i = 0; i < 30; i++) battle.step();
    // 半血跨过 5 个 10% 档 → +5×4% = 20%（缺血管内的取整使 0.5 恰在档上，容差 ±4%）
    expect(a.permAtkPct).toBeGreaterThanOrEqual(0.16);
    expect(a.permAtkPct).toBeLessThanOrEqual(0.2);
  });

  it('流星弩：击杀后获得攻速爆发', () => {
    const battle = mkBattle([unitInput('pan', 0, { c: 0, r: 6 }, { items: ['liuxing'] }), unitInput('jingyu', 1, { c: 7, r: 1 })]);
    const a = byDef(battle, 'pan');
    const b = byDef(battle, 'jingyu');
    b.hp = 1;
    battle.dealDamage(a, b, 10 ** 6, 'true');
    expect(a.statuses.some((s) => s.kind === 'aspdUp')).toBe(true);
  });

  it('流星弩层数上限只数本源：外来 aspdUp 不挤占「至多 2 层」', () => {
    // 垂天翼/羁绊/技能都会往同单位挂 aspdUp。此前计数不分来源，一件外来
    // 攻速就让 killFrenzy 永远到不了自己的 2 层 —— 装备间歇性哑火
    const battle = mkBattle(
      [
        unitInput('pan', 0, { c: 0, r: 6 }, { items: ['liuxing'] }),
        unitInput('jingyu', 1, { c: 7, r: 1 }),
        unitInput('jingyu', 1, { c: 7, r: 2 }),
      ],
    );
    const a = byDef(battle, 'pan');
    const enemies = battle.units.filter((x) => x.entry.id === 'jingyu');
    // 模拟任意外来 aspdUp（垂天翼开战 / 丹师亡语等同型来源）
    battle.addStatus(a, a, 'aspdUp', 30, 10);
    const srcCount = () => a.statuses.filter((s) => s.kind === 'aspdUp' && s.src === 'killFrenzy').length;
    expect(srcCount()).toBe(0);
    for (const foe of enemies) {
      foe.hp = 1;
      battle.dealDamage(a, foe, 10 ** 6, 'true');
    }
    expect(srcCount()).toBe(2); // 两次击杀都吃到本源层数，不被外来层封顶
  });

  it('赤练鞭：普攻上易伤', () => {
    const { battle } = duel('chilian');
    const vulns = battle.events.filter((e) => e.t === 'status' && e.kind === 'vulnerability' && e.added);
    expect(vulns.length).toBeGreaterThan(0);
  });

  it('青圭杖：施法后获得护盾', () => {
    const battle = mkBattle([unitInput('pan', 0, { c: 0, r: 6 }, { items: ['qinggui'] }), unitInput('jingyu', 1, { c: 7, r: 1 })], 777, 600);
    const a = byDef(battle, 'pan');
    a.mp = a.maxMp; // 立即施法
    for (let i = 0; i < 90 && !battle.finished; i++) battle.step();
    const shields = battle.events.filter((e) => e.t === 'shield' && e.uid === a.uid && e.amount > 0);
    expect(shields.length).toBeGreaterThan(0);
  });

  it('追风履：每秒成长攻速，增量累加（不覆盖羁绊成长）', () => {
    const battle = mkBattle([unitInput('pan', 0, { c: 0, r: 6 }, { items: ['zhuifeng'] }), unitInput('jingyu', 1, { c: 7, r: 1 })]);
    const a = byDef(battle, 'pan');
    a.permAspdPct = 0.2; // 模拟羁绊先写入的成长
    for (let i = 0; i < 95; i++) battle.step(); // ~3 秒
    expect(a.permAspdPct).toBeGreaterThan(0.2);
    expect(a.permAspdPct).toBeCloseTo(0.2 + 0.045, 3); // 3 层 × 1.5%
  });

  it('玄铁重甲：周期净化减益', () => {
    const battle = mkBattle([unitInput('pan', 0, { c: 0, r: 6 }, { items: ['xuantie'] }), unitInput('jingyu', 1, { c: 7, r: 1 })]);
    const a = byDef(battle, 'pan');
    battle.addStatus(byDef(battle, 'jingyu'), a, 'slow', 30, 30);
    expect(a.statuses.some((s) => s.kind === 'slow')).toBe(true);
    for (let i = 0; i < 160; i++) battle.step();
    expect(a.statuses.some((s) => s.kind === 'slow')).toBe(false);
  });

  it('玄铁重甲净化只摘一条：多段流血一次清一层（「净化一个减益」的语义）', () => {
    // burn/bleed 是可多条并存的叠层 DoT。此前 removeStatus 按 kind 整类全清，
    // 一次净化把几段流血全部抹平 —— 与文案"一个减益"直接矛盾
    const battle = mkBattle([unitInput('pan', 0, { c: 0, r: 6 }, { items: ['xuantie'] }), unitInput('jingyu', 1, { c: 7, r: 1 })]);
    const a = byDef(battle, 'pan');
    const foe = byDef(battle, 'jingyu');
    battle.addDot(foe, a, 'bleed', 5, 30, 'true');
    battle.addDot(foe, a, 'bleed', 5, 30, 'true');
    expect(a.statuses.filter((s) => s.kind === 'bleed').length).toBe(2);
    for (let i = 0; i < 160; i++) battle.step(); // 5 秒一次净化：只到第一次（tick 150）
    const left = a.statuses.filter((s) => s.kind === 'bleed').length;
    expect(left).toBe(1); // 旧实现此处为 0（整类全清）
  });

  it('引魂灯：施法后治疗生命最低友军', () => {
    const battle = mkBattle(
      [
        unitInput('pan', 0, { c: 0, r: 6 }, { items: ['yinhun'] }),
        unitInput('duanyue', 0, { c: 1, r: 6 }),
        unitInput('jingyu', 1, { c: 7, r: 1 }),
      ],
      777,
      600,
    );
    const a = byDef(battle, 'pan');
    const mate = byDef(battle, 'duanyue');
    mate.hp = mate.maxHp * 0.4; // 队友成为最低血目标
    a.mp = a.maxMp;
    for (let i = 0; i < 90 && !battle.finished; i++) battle.step();
    const heals = battle.events.filter((e) => e.t === 'heal' && e.dstUid === mate.uid);
    expect(heals.length).toBeGreaterThan(0);
  });

  it('九尾面：施法后下一次普攻必定暴击并追加法伤', () => {
    // 持件者必须是法强单位：追加法伤 = 300% 法强，物理手（pan 法强 0）拿九尾面
    // 时该段恒为零、事件不可观测 —— 此前"至少其一"的 OR 断言把这一点掩盖了
    //（第七轮审查实证）。靶子用 3★：吃住暴击物伤，法伤段才有出手窗口。
    const battle = mkBattle(
      [unitInput('wuhuo', 0, { c: 0, r: 6 }, { items: ['jiuwei'] }), unitInput('jingyu', 1, { c: 7, r: 1 }, { star: 3 })],
      777,
      900,
    );
    const a = byDef(battle, 'wuhuo');
    a.mp = a.maxMp;
    for (let i = 0; i < 180 && !battle.finished; i++) battle.step();
    const foxCrit = battle.events.some((e) => e.t === 'damage' && e.srcUid === a.uid && e.crit && e.type === 'physical' && e.source === 'attack');
    const bonusMagic = battle.events.some((e) => e.t === 'damage' && e.srcUid === a.uid && e.type === 'magic' && e.source === 'item');
    expect(foxCrit).toBe(true);
    expect(bonusMagic).toBe(true);
  });

  it('狮心盾：承伤转蓝提高 40%（小伤害不受上限截断）', () => {
    const build = (itemId?: string) => {
      const battle = mkBattle([
        unitInput('pan', 0, { c: 0, r: 6 }, itemId ? { items: [itemId] } : {}),
        unitInput('jingyu', 1, { c: 7, r: 1 }),
      ]);
      const a = byDef(battle, 'pan');
      a.mp = 0;
      battle.dealDamage(byDef(battle, 'jingyu'), a, 100, 'true');
      return a.mp;
    };
    const base = build();
    const withShield = build('shixin');
    expect(withShield).toBeCloseTo(base * 1.4, 1);
  });

  it('摄魂铃：受普攻概率眩晕攻击者', () => {
    const battle = mkBattle([unitInput('pan', 0, { c: 0, r: 6 }, { items: ['shehun'] }), unitInput('jingyu', 1, { c: 7, r: 1 })], 777, 600);
    for (let i = 0; i < 600 && !battle.finished; i++) battle.step();
    const stuns = battle.events.filter((e) => e.t === 'status' && e.kind === 'stun' && e.added);
    expect(stuns.length).toBeGreaterThan(0);
  });

  it('紫金炉：普攻命中额外回蓝，且法力变化发 mana 事件（蓝条/回放与内核同源）', () => {
    const run = (withZijin: boolean) => {
      const battle = mkBattle(
        withZijin
          ? [unitInput('pan', 0, { c: 0, r: 6 }, { items: ['zijin'] }), unitInput('jingyu', 1, { c: 7, r: 1 })]
          : [unitInput('pan', 0, { c: 0, r: 6 }), unitInput('jingyu', 1, { c: 7, r: 1 })],
        777,
        400,
      );
      for (let i = 0; i < 400 && !battle.finished; i++) battle.step();
      return battle;
    };
    const armed = run(true);
    const bare = run(false);
    const manaOf = (battle: Battle, defId: string) => {
      const u = byDef(battle, defId);
      return battle.events.filter((e) => e.t === 'mana' && e.uid === u.uid).length;
    };
    // 紫金炉每次命中在普攻回蓝之外额外 +3 并补发 mana 事件（此前缺发时渲染层
    // 蓝条滞后）—— 武装方的 mana 事件数应多于裸装方（同样普攻次数，多出紫金炉
    // 自己的回蓝事件）。不用结算时点 mp 比较：施法会清空 mp，终值不稳定。
    const armedEvents = manaOf(armed, 'pan');
    expect(armedEvents).toBeGreaterThan(0);
    expect(armedEvents).toBeGreaterThan(manaOf(bare, 'pan'));
  });

  it('墨龙旗：开战全体友军获得 22% 减伤（2026-09-02 定档）', () => {
    const battle = mkBattle(
      [
        unitInput('pan', 0, { c: 0, r: 6 }, { items: ['molongqi'] }),
        unitInput('duanyue', 0, { c: 1, r: 6 }),
        unitInput('jingyu', 1, { c: 7, r: 1 }),
      ],
      777,
      2,
    );
    for (const defId of ['pan', 'duanyue']) {
      expect(byDef(battle, defId).statuses.some((s) => s.kind === 'dr' && s.value === 22)).toBe(true);
    }
    // 敌方不吃旗
    expect(byDef(battle, 'jingyu').statuses.some((s) => s.kind === 'dr')).toBe(false);
  });

  it('鹤龄镜：在死亡位置原地复活（死亡点被占时取邻近空格）', () => {
    // 队友在场：持有者阵亡后战斗不终局，复活调度才有机会执行
    const battle = mkBattle([
      unitInput('pan', 0, { c: 2, r: 5 }, { items: ['buxiu'] }),
      unitInput('duanyue', 0, { c: 2, r: 6 }),
      unitInput('jingyu', 1, { c: 7, r: 0 }),
    ]);
    const a = byDef(battle, 'pan');
    const deathCell = { ...a.cell };
    battle.dealDamage(byDef(battle, 'jingyu'), a, 10 ** 6, 'true');
    expect(a.alive).toBe(false);
    expect(a.deathCell).toEqual(deathCell);
    // 鹤龄镜延迟 2 秒复活
    for (let i = 0; i < 90 && !a.alive; i++) battle.step();
    expect(a.alive).toBe(true);
    expect(a.cell).toEqual(deathCell); // 死亡点未被占 → 原地起身
  });

  it('鹤龄镜：本队最后单位阵亡时复活窗不被提前终局吞掉（1v1 无队友）', () => {
    const battle = mkBattle([
      unitInput('pan', 0, { c: 2, r: 5 }, { items: ['buxiu'] }),
      unitInput('jingyu', 1, { c: 7, r: 0 }),
    ]);
    const a = byDef(battle, 'pan');
    battle.dealDamage(byDef(battle, 'jingyu'), a, 10 ** 6, 'true');
    expect(a.alive).toBe(false);
    // 复活窗未兑现：持有方虽全灭，checkEnd 不得提前判负
    for (let i = 0; i < 30; i++) battle.step();
    expect(battle.finished).toBe(false);
    // 2 秒复活窗到期后必须真实复活（复活事件 = 以自身为源的 heal）
    for (let i = 0; i < 90 && !battle.finished; i++) battle.step();
    expect(battle.events.some((e) => e.t === 'heal' && e.srcUid === a.uid && e.dstUid === a.uid)).toBe(true);
  });

  it('惊雷锤：技能伤害可暴击（种子确定某次 crit）', () => {
    const battle = mkBattle([unitInput('pan', 0, { c: 0, r: 6 }, { items: ['jinglei'] }), unitInput('jingyu', 1, { c: 7, r: 1 })], 777, 900);
    const a = byDef(battle, 'pan');
    a.mp = a.maxMp;
    for (let i = 0; i < 240 && !battle.finished; i++) battle.step();
    const skillDmg = battle.events.filter((e) => e.t === 'damage' && e.source === 'skill');
    expect(skillDmg.length).toBeGreaterThan(0);
    // 固定种子下至少一跳技能暴击（惊雷锤 20% × 多段技能伤害）
    expect(skillDmg.some((e) => e.t === 'damage' && e.crit)).toBe(true);
  });
});

describe('三星五费 · 天命（v1.9 大加强定档）', () => {
  it('天命包数值：生命/战力乘区、护盾 35%、吸血 20%、技能 1.25×', () => {
    const battle = mkBattle([unitInput('haotian', 0, { c: 0, r: 6 }, { star: 3 })]);
    const u = byDef(battle, 'haotian');
    const base = { hp: 1180, atk: 190 };
    // 3★ 常规倍率 × 天命层：HP 3.24×2.0 = 6.48；攻 2.1×2.0 = 4.2
    expect(u.maxHp).toBe(Math.round(base.hp * 3.24 * LEGEND_T3.hpMult));
    expect(u.atk).toBe(Math.round(base.atk * 2.1 * LEGEND_T3.powerMult));
    expect(u.shield).toBe(Math.round(u.maxHp * 0.35));
    expect(u.omnivamp).toBeCloseTo(0.2, 5);
    expect(u.trait.skillCritChance).toBe(0);
  });

  it('2★ 五费不享受天命', () => {
    const battle = mkBattle([unitInput('haotian', 0, { c: 0, r: 6 }, { star: 2 })]);
    const u = byDef(battle, 'haotian');
    expect(u.maxHp).toBe(Math.round(1180 * 1.8));
    expect(u.shield).toBe(0);
    expect(u.omnivamp).toBe(0);
  });
});
