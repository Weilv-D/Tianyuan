import type { BattleApi } from './api';
import { ASSASSIN_LEAP_DELAY, ASSASSIN_SMOKE_DURATION, MECH, TICK_RATE } from './config';
import { chebyshev } from './grid';
import { effArmor, effSp, isStunned, isSilenced, isDisarmed, hasStatus, type Unit } from './unit';
import { tune } from '../data/tuning';
import type { ActiveTrait, StatusKind } from './types';

/** 羁绊数字统一经调参表读取（src/data/tuning.ts）—— 无头扫描器可在线替换，
 *  游戏进程读到的一律是下面的默认字面量。 */
const tuner = (id: string) => (key: string, def: number) => tune(id, key, def);

/**
 * 羁绊运行时。
 *
 * 每条羁绊的"质变"都落在这里。实现上分两类：
 *  A. 静态数值 —— 开局一次性写进单位面板（易读、易查、无运行时开销）
 *  B. 行为钩子 —— 挂在队伍钩子上，按事件驱动
 *
 * 所有羁绊都遵循"高档位包含低档位效果"的叠加规则，玩家不需要背两套数值。
 */

export interface TraitContext {
  api: BattleApi;
  team: number;
  /** 达成的最高档位索引（0 = 第一档） */
  tier: number;
  /** 该队中持有此羁绊的存活单位 */
  members: Unit[];
  /** 该队全部单位 */
  teamUnits: Unit[];
}

type TraitImpl = (ctx: TraitContext) => void;

const isMember = (members: Unit[], u: Unit): boolean => members.includes(u);

function enemiesNear(api: BattleApi, u: Unit, radius: number): Unit[] {
  return api.units.filter((x) => x.alive && x.team !== u.team && chebyshev(x.cell, u.cell) <= radius);
}

function alliesNear(api: BattleApi, u: Unit, radius: number): Unit[] {
  return api.units.filter((x) => x.alive && x.team === u.team && chebyshev(x.cell, u.cell) <= radius);
}

export const TRAIT_IMPL: Record<string, TraitImpl> = {
  // ══════════════ 天庭 [生存] ══════════════
  tian: ({ api, members }) => {
    const t = tuner('tian');
    const tier = members[0]?.trait.tier['tian'] ?? 0;
    const pct = tier >= 1 ? t('shield1', 0.2) : t('shield0', 0.08);
    api.hooksOf(members[0]?.team ?? 0).onBattleStart.push(() => {
      for (const u of members) api.addShield(null, u, u.maxHp * pct, 999);
    });
    if (tier >= 1) {
      api.hooksOf(members[0].team).onShieldBreak.push((_a, unit) => {
        if (!isMember(members, unit)) return;
        api.fx('nova', { uid: unit.uid, radius: 1, params: { hue: 0 } });
        for (const e of enemiesNear(api, unit, 1)) {
          api.dealDamage(unit, e, effSp(unit) * t('novaSp', 1.2), 'magic', { source: 'trait' });
        }
      });
    }
  },

  // ══════════════ 幽冥 [生存] ══════════════
  youming: ({ api, members }) => {
    const t = tuner('youming');
    const tier = members[0].trait.tier['youming'] ?? 0;
    api.hooksOf(members[0].team).onDeath.push((a, victim) => {
      // 阵亡补偿：为最近的存活友军回血。
      // M 残留专项双向试配均量化否决（scripts/ab-pair.ts / sim.ts 200）：
      //   下调 0.04 —— 「亡语→机关」+4.4p，机关（全矩阵下限）综合再降 0.9p，极差恶化；
      //   上调 0.08 —— 「亡语→后期」边回到 100%（超时裁定被回血续命翻转，非线性）
      //   且「荆棘→亡语」+11.9p，极差 22.4 → 24.9，全门崩。维持 0.06。
      const allies = a.units.filter((x) => x.alive && x.team === victim.team);
      if (allies.length === 0) return;
      let nearest = allies[0];
      let best = Infinity;
      for (const al of allies) {
        const d = chebyshev(al.cell, victim.cell);
        if (d < best) {
          best = d;
          nearest = al;
        }
      }
      a.heal(null, nearest, victim.maxHp * t('deathHeal', 0.06), 'trait');

      // 四档：首次阵亡复活（M2修复：与不朽衣解耦，各自一次）
      // 此前用共享的 victim.revived 互斥：幽冥先触发后置 revived=true，不朽衣再看到即直接 return
      // 且整局作废。改为按来源独立计数，各自只触发一次。
      if (tier >= 1 && isMember(members, victim) && !victim.isMinion && !victim.traitStacks['youmingRevived']) {
        victim.traitStacks['youmingRevived'] = 1;
        // 0.65 → 0.48：以 65% 血量复活相当于"多带半个人的战力"，
        // 四档幽冥因此长期霸占胜率榜首。降到 48% 后它依然是唯一的复活机制，
        // 强度来自"多一条命"而不是"复活后还很能打"。
        a.revive(victim, t('reviveHp', 0.15), victim);
        a.addStatus(victim, victim, 'aspdUp', 999, t('reviveAspd', 30));
        a.fx('summon', { uid: victim.uid });
      }
    });
  },

  // ══════════════ 山海 [节奏] ══════════════
  shanhai: ({ api, members }) => {
    const t = tuner('shanhai');
    const tier = members[0].trait.tier['shanhai'] ?? 0;
    // 流血走真实伤害：让「撕咬」成为高护甲阵容的天然克星，
    // 这也是山海作为"消耗流"唯一的正当输出手段
    const totalPct = tier >= 1 ? t('bleed1', 0.16) : t('bleed0', 0.08);
    api.hooksOf(members[0].team).onAttackHit.push((a, src, dst) => {
      if (!isMember(members, src)) return;
      a.addDot(src, dst, 'bleed', (dst.maxHp * totalPct) / 3, 3, 'true');
      if (tier >= 1) a.addStatus(src, dst, 'wound', 3, t('wound', 40));
    });
  },

  // ══════════════ 剑宗 [经济] ══════════════
  jianzong: ({ api, members }) => {
    const t = tuner('jianzong');
    const tier = members[0].trait.tier['jianzong'] ?? 0;
    for (const u of members) {
      u.critChance += t('crit', 0.2);
      if (tier >= 1) {
        u.critMult += t('critMult', 0.2);
        // 破甲：让"暴击流"成为重甲阵容的天然克星，
        // 否则纯堆护甲的阵容在数值上无解，环境会退化为比谁更肉。
        // 0.22 → 0.15：原值把护卫系压得太死，快攻因此一路涨到 76%。
        u.trait.armorPen = t('armorPen', 0.18);
      }
    }
    if (tier >= 1) {
      // 二档起全队小额破甲铺垫：单次生效（人数本身已在公式里自缩放）。
      // 此前此块误嵌在成员循环内 —— 4 剑宗会把全队破甲叠到 0.48 而非 0.12，
      // 全部历史平衡数据都带着这份被夸大的剑宗强度。
      // 数值经调参表（penBase/penStep/penCap），全局重平衡时按矩阵回调。
      const pen = Math.min(t('penCap', 0.2), t('penBase', 0.04) + members.length * t('penStep', 0.04));
      for (const ally of api.units) {
        if (ally.team !== members[0].team) continue;
        ally.trait.armorPen = Math.min(0.85, ally.trait.armorPen + pen);
      }
    }
    if (tier >= 1) {
      api.hooksOf(members[0].team).onKill.push((a, killer) => {
        if (!isMember(members, killer)) return;
        killer.mp = Math.min(killer.maxMp, killer.mp + t('killMana', 20));
        a.emit({ t: 'mana', tick: a.tick, uid: killer.uid, mp: killer.mp, maxMp: killer.maxMp });
      });
    }
  },

  // ══════════════ 妖族 [生存] ══════════════
  yaozu: ({ api, members }) => {
    const t = tuner('yaozu');
    const tier = members[0].trait.tier['yaozu'] ?? 0;
    for (const u of members) u.omnivamp += tier >= 1 ? t('vamp1', 0.36) : t('vamp0', 0.15);
    if (tier >= 1) {
      api.hooksOf(members[0].team).onDamageTaken.push((a, dst) => {
        if (!isMember(members, dst) || dst.yaozuTransformed || !dst.alive) return;
        // 阈值 0.4 → 0.6：血量掉到 40% 才化形，等的是"救命"，
        // 但实战里那时通常已经是被集火中的残血，化形完了也活不下来。
        // 提前到 60% 并附带一次回复，化形才真正成为"绝境翻盘"的时刻 ——
        // 这才符合"绝境化形"这四个字。
        if (dst.hp / dst.maxHp > t('transformAt', 0.6)) return;
        dst.yaozuTransformed = true;
        a.heal(dst, dst, dst.maxHp * t('transformHeal', 0.24), 'trait');
        a.fx('healWave', { uid: dst.uid });
        // 化形：清除一切负面 + 攻速暴涨 + 减伤
        dst.statuses = dst.statuses.filter(
          (s) => s.kind !== 'stun' && s.kind !== 'silence' && s.kind !== 'disarm' && s.kind !== 'slow',
        );
        a.addStatus(dst, dst, 'aspdUp', 6, t('transformAspd', 35));
        a.addStatus(dst, dst, 'dr', 6, t('transformDr', 35));
        a.addStatus(dst, dst, 'atkUp', 6, t('transformAtk', 15));
        a.fx('buffAura', { uid: dst.uid, params: { hue: 1 } });
        a.emit({ t: 'status', tick: a.tick, uid: dst.uid, kind: 'transform', dur: 6, value: 1, added: true });
      });
    }
  },

  // ══════════════ 墨门 [生存] ══════════════
  momen: ({ api, members }) => {
    const t = tuner('momen');
    const tier = members[0].trait.tier['momen'] ?? 0;
    const dr = tier >= 2 ? t('drHigh', 0.2) : t('drLow', 0.1);
    for (const u of members) {
      u.trait.allDr = Math.min(0.9, u.trait.allDr + dr);
      // 生命加成在开战面板阶段生效：直接乘最大生命（羁绊在 createUnit 之后、开战之前结算）
      u.maxHp = Math.round(u.maxHp * (1 + t('hpUp', 0.1)));
      u.hp = u.maxHp;
    }
    if (tier >= 1) {
      for (const u of api.units) {
        if (u.team === members[0].team) u.trait.allDr = Math.min(0.9, u.trait.allDr + t('teamDr', 0.08));
      }
      for (const u of members) u.trait.hpRegenPctPerSec += t('regen', 0.02);
    }
    if (tier >= 2) {
      // 兼爱：友军所受伤害的 30% 转由存活墨门均摊。
      // noShare 防递归；silent 防高频小额分摊把伤害飘字刷成弹幕。
      api.hooksOf(members[0].team).onDamageTaken.push((a, dst, src, amount, type, opts) => {
        if (opts.noShare || !dst.alive) return;
        if (isMember(members, dst)) return;
        const alive = members.filter((m) => m.alive);
        if (alive.length === 0) return;
        const per = (amount * t('sharePct', 0.3)) / alive.length;
        for (const m of alive) {
          a.dealDamage(src, m, per, type, { source: 'trait', noShare: true, silent: true });
        }
      });
    }
  },

  // ══════════════ 兵家 [节奏] ══════════════
  bingjia: ({ api, members }) => {
    const t = tuner('bingjia');
    const tier = members[0].trait.tier['bingjia'] ?? 0;
    for (const u of members) u.atk = Math.round(u.atk * (1 + t('atkUp', 0.35)));
    if (tier >= 1) {
      for (const u of api.units) {
        if (u.team !== members[0].team) continue;
        u.permAtkPct += t('teamAtk', 0.26);
        u.permAspdPct += t('teamAspd', 0.2);
      }
    }
    if (tier >= 2) {
      const team = members[0].team;
      api.hooksOf(team).onKill.push((a, killer) => {
        if (killer.team !== team) return;
        const mult = isMember(members, killer) ? 2 : 1;
        const atk = t('growAtk', 0.12) * mult;
        const aspd = t('growAspd', 0.09) * mult;
        for (const u of a.units) {
          if (!u.alive || u.team !== team) continue;
          u.permAtkPct += atk;
          u.permAspdPct += aspd;
        }
        a.fx('buffAura', { uid: killer.uid, params: { hue: 1 } });
      });
    }
  },

  // ══════════════ 机关 [节奏] ══════════════
  jiguan: ({ api, members }) => {
    const t = tuner('jiguan');
    const tier = members[0].trait.tier['jiguan'] ?? 0;
    for (const u of members) {
      u.baseArmor += t('armor', 22);
      // 木石之躯：构装体对"反弹类"伤害（荆棘等 source==='trait' 的物理反弹）
      // 自带减免 —— 反伤可反制条件化的机关侧形态（DESIGN §十三 2v4 立项解）。
      u.trait.thornResist = Math.min(0.9, t('thornResist', 0.65));
    }
    const team = members[0].team;
    if (tier >= 1) {
      // 破甲通道（二档起，默认 0 = 冬眠）：机关是普攻人海流，输出构成几乎全是
      // 物理（普攻 + 第 4 击附加物伤）。M 残留专项量化结论（scripts/ab-pair.ts，
      // CRN n=250，patch trait.jiguan.pen 扫档）：「机关→荆棘」边对穿甲完全不
      // 敏感 —— 0.10/0.15/0.20/0.35/0.60/0.85 全档该边一律 0.0p（单场总输出
      // 实测仅 +20.5% @0.85，距翻盘悬崖 ~+37% 相差甚远），同时非目标边剧烈
      // 移动（0.85 档「机关→亡语」+58.4p、「机关→快攻」+11.8p、「机关→妖族」
      // -26.6p）。故不作 2v4 修复杠杆烧入，通道保留（剑宗同款 armorPen，
      // battle.ts 结算处统一 min(0.85) 封顶）。后续接续见下方第 4 击注释：
      // N 残留专项已试配 fourthHitGiant / fourthHitCrush 两根结构附加通道，
      // 亦全部量化否决（0 冬眠）。
      const pen = t('pen', 0);
      for (const u of members) u.trait.armorPen = Math.min(0.85, u.trait.armorPen + pen);
    }
    if (tier >= 0) {
      // 每 5 秒永久 +10% 攻速（低档）
      if (tier < 1) {
        api.hooksOf(team).onTick.push((a, _t, tick) => {
          if (tick === 0 || tick % (5 * TICK_RATE) !== 0) return;
          for (const u of members) {
            if (!u.alive) continue;
            u.permAspdPct += t('tickAspd', 0.1);
            a.emit({ t: 'status', tick, uid: u.uid, kind: 'jiguanStack', dur: 0, value: 1, added: true });
          }
        });
      }
    }

    if (tier >= 0) {
      // 围攻（傀儡海 · 2v4 结构边的立项解，DESIGN §十三）：
      // 另一名友军在近窗内先动了手，本成员跟进攻击时追加物理伤 —— 傀儡海
      // "围而攻之"的机制化。两个内禀约束让它避开 M/N 线证伪的老路：
      //   1) 追加量 × effArmor/(100+effArmor) —— crush 同款自缩放，对甲墙
      //      （荆棘 66~102 甲 → 系数 0.40~0.51）特异，对低甲施法队（后期/
      //      亡语 16~30 甲 → ≤0.23）近乎无感，不重演 giant@0.20 的 +65p
      //      非目标边漂移；
      //   2) 随本体普攻结算，天然吃 noReflect 通道，不会被荆棘二次反弹放大。
      // 默认 0 = 冬眠，行为与历史逐字节一致；供 sim:ab / sim:sweep 扫档定装。
      // 定档（2026-08-31，CRN n=250 双向）：gangAtk 6 / 破阵开 / 护卫 t2 卸甲 0.5
      // → 「机关→荆棘」21.0%（原 0%），其余九边 0.0p（破阵判据结构性隔离）。
      const gangAtk = t('gangAtk', 6);
      const gangMinArmor = t('gangMinArmor', 0);
      const gangTargetT2 = t('gangTargetT2', 1);
      if (gangAtk > 0) {
        const windowTicks = Math.max(1, Math.round(t('gangWindow', 0.75) * TICK_RATE));
        const lastHit = new Map<number, { tick: number; srcUid: number }>();
        let nowTick = 0;
        api.hooksOf(team).onTick.push((_a, _t, tick) => {
          nowTick = tick;
        });
        // onDamageTaken 按【受害者队伍】分发（battle.ts 钩子分发口径）：
        // 要观测"友军打了敌方"，recorder 必须挂在敌方队伍的 hooks 上。
        for (const foe of api.enemyTeamsOf(team)) {
          api.hooksOf(foe).onDamageTaken.push((_a, dst, src, _amount, _type, _opts) => {
            if (!src || src === dst || src.team !== team) return;
            if (!dst.alive) return;
            lastHit.set(dst.uid, { tick: nowTick, srcUid: src.uid });
          });
        }
        api.hooksOf(team).onPreAttack.push((_a, src, dst, mod) => {
          if (!isMember(members, src)) return;
          const rec = lastHit.get(dst.uid);
          if (!rec || rec.srcUid === src.uid) return;
          if (nowTick - rec.tick > windowTicks) return;
          // 攻坚门槛（双重，均可独立关闭）：
          //   gangTargetT2 —— 破阵特攻：只认「护卫羁绊达 t2 金甲阵」的队伍成员。
          //     甲值判据（gangMinArmor）的教训：磐的技能 armorUp+40 会瞬时过线，
          //     令后期/亡语的单前排（磐）被围攻速清 → 整队体系崩（0→100p）。
          //     改判"队伍级护卫 t2"后，围攻的火力被结构性锁定在 2v4 的金刚阵上，
          //     其余九边零 collateral。
          //   gangMinArmor —— 通用甲值门槛（0 = 不设），留作微调工具。
          if (gangTargetT2 > 0 && (dst.trait.tier['guardian'] ?? -1) < 2) return;
          if (gangMinArmor > 0 && effArmor(dst) < gangMinArmor) return;
          mod.bonusPhysical += src.atk * gangAtk * (effArmor(dst) / (100 + effArmor(dst)));
        });
      }
    }
    if (tier >= 1) {
      api.hooksOf(team).onAttackHit.push((_a, src) => {
        if (!isMember(members, src)) return;
        const s = (src.traitStacks['jiguan'] ?? 0) + 1;
        src.traitStacks['jiguan'] = s;
        if (s <= 8) src.permAspdPct += t('stackAspd', 0.09);
      });
      api.hooksOf(team).onPreAttack.push((_a, src, dst, mod) => {
        if (!isMember(members, src)) return;
        if ((src.attackCount + 1) % 4 === 0) {
          mod.bonusPhysical += src.atk * t('fourthHitAtk', 1.4);
          // 第 4 击结构附加（N 残留专项「输出构成置换」，默认 0 = 冬眠）：
          // 把第 4 击从"随自身攻击力走"改成"随目标体量走"，验证机制层是否
          // 能替代已被 M 线证伪的数值/穿甲杠杆（机关甲 74~102 远低于
          // RESIST_CAP 220；荆棘方有效池 ≈ 机关总输出 2 倍，是总量差）：
          //   fourthHitGiant —— 巨型杀手：按目标最大生命追加；
          //   fourthHitCrush —— 破甲冲击：按目标有效护甲追加（结算内禀
          //     自缩放 100A/(100+A)，对甲墙特异、低甲无感）。
          // N 残留专项扫档结论（scripts/ab-pair.ts，CRN n=250 --pairs 4，
          // 另附 .qa/probes/n4-output-probe.ts 输出量探针）：
          //   A 档 0.010/0.015/0.020/0.05/0.10/0.20/0.30 与 B 档
          //   0.3/0.5/0.8/1.5/3.0/5.0/7.0 —— 「机关→荆棘」目标边全部
          //   0.0p（A@0.30 才首次 +0.2p），授权档位内机关总输出仅
          //   +1.6%~3.6%，荒谬档（A@0.20=每 4 击追加目标 20% maxHp /
          //   B@5.0=追加 5 倍有效护甲）也只 +22.7%~24.6%，仍低于 M 线
          //   测得的 ~+37% 翻盘悬崖；同时非目标边剧烈漂移（A@0.20：
          //   「机关→后期」+65p、「机关→亡语」+40.8p；B@3.0：
          //   「机关→妖族」-16.6p；小档位下加伤喂受击回蓝反而压低
          //   「机关→亡语/妖族」）—— 六门判据下无任何可烧档位。
          // 故两键保持 0 冬眠（同 pen 通道先例），通道与回归测试保留，
          // 供"护卫 t2 形态置换"大手术接续时取用或移除。
          mod.bonusPhysical += dst.maxHp * t('fourthHitGiant', 0);
          mod.bonusPhysical += effArmor(dst) * t('fourthHitCrush', 0);
        }
      });
    }
  },

  // ══════════════ 丹鼎 [节奏] ══════════════
  danding: ({ api, members }) => {
    const t = tuner('danding');
    const tier = members[0].trait.tier['danding'] ?? 0;
    for (const u of members) {
      u.trait.hpRegenPctPerSec += t('regen', 0.015);
      if (tier >= 1) {
        u.trait.manaPerSec += t('manaPerSec', 3);
      }
    }
    if (tier >= 1) {
      api.hooksOf(members[0].team).onHealOverflow.push((a, target, _src, overflow) => {
        if (!isMember(members, target)) return;
        a.addShield(null, target, overflow, 999);
      });
    }
  },

  // ══════════════ 龙渊 [技能] ══════════════
  longyuan: ({ api, members }) => {
    const t = tuner('longyuan');
    const tier = members[0].trait.tier['longyuan'] ?? 0;
    const team = members[0].team;
    for (const u of members) {
      u.sp += t('spFlat', 30);
      if (tier >= 1) u.trait.skillAmp += t('skillAmp', 0.32);
    }
    // 二档起全队小额法强铺垫：单次生效。此前同类块嵌在成员循环内，
    // 4 龙渊会把全队加成叠 4 次（+40 法强/+24% 增幅），且第二处 teamSp 块
    // 与之共用调参键（默认值 10/12 各一）—— 扫描器一覆盖就同时命中两处。
    // tier>=2 的第三块是死代码（龙渊断点只有 [2,4]），一并移除。
    if (tier >= 1) {
      for (const u of api.units) {
        if (u.team !== team) continue;
        u.sp += t('teamSp', 18);
        u.trait.skillAmp += t('teamAmp', 0.09);
      }
    }
    if (tier >= 1) {
      api.hooksOf(team).onCast.push((a, unit) => {
        if (!isMember(members, unit)) return;
        a.addStatus(unit, unit, 'spellCharge', 4, effSp(unit) * t('spellChargeSp', 0.8));
        a.fx('buffAura', { uid: unit.uid, params: { hue: 2 } });
      });
    }
  },

  // ══════════════ 武将 ══════════════
  warrior: ({ api, members }) => {
    const t = tuner('warrior');
    const tier = members[0].trait.tier['warrior'] ?? 0;
    const pct = t(`atk${tier}`, [0.2, 0.45, 0.75][tier] ?? 0.2);
    for (const u of members) u.atk = Math.round(u.atk * (1 + pct));
    if (tier >= 1) {
      api.hooksOf(members[0].team).onAttackHit.push((a, src) => {
        if (!isMember(members, src)) return;
        const s = src.traitStacks['warrior'] ?? 0;
        if (s >= 10) return;
        src.traitStacks['warrior'] = s + 1;
        src.permAtkPct += t('stackAtk', 0.025);
        if (s + 1 === 10) a.fx('buffAura', { uid: src.uid, params: { hue: 1 } });
      });
    }
    if (tier >= 2) {
      for (const u of members) u.trait.physicalDr += t('physDr', 0.18);
    }
  },

  // ══════════════ 护卫 ══════════════
  guardian: ({ api, members }) => {
    const t = tuner('guardian');
    const tier = members[0].trait.tier['guardian'] ?? 0;
    const hpPct = t(`hp${tier}`, [0.14, 0.24, 0.28][tier] ?? 0.14);
    const armor = t(`armor${tier}`, [16, 26, 32][tier] ?? 16);
    // t2 形态置换（DESIGN §十三 2v4 结构边的立项解）：护甲墙的一部分/全部搬进
    // 生命池，反伤改按最大生命百分比计（血池即引信）。默认 0 = 关闭，
    // 默认关闭时不得改变确定性事件流或实战结果。
    const swapCut = tier >= 2 ? t('t2ArmorCut', 0) : 0;
    const swapHp = tier >= 2 ? t('t2HpGain', 0) : 0;
    for (const u of members) {
      u.maxHp = Math.round(u.maxHp * (1 + hpPct + swapHp));
      u.hp = u.maxHp;
      u.baseArmor += armor * (1 - swapCut);
    }
    const team = members[0].team;
    if (tier >= 1) {
      api.hooksOf(team).onBattleStart.push((a) => {
        for (const u of members) {
          for (const al of alliesNear(a, u, 1)) {
            if (al === u) continue;
            a.addShield(u, al, u.maxHp * t('allyShield', 0.12), 999);
          }
        }
      });
    }
    if (tier >= 2) {
      // 六护卫：给一个攻击力加成。
      // 纯坦阵容的正当性一直有个缺口 —— 六护卫全是低攻击的肉，
      // 荆棘反弹和流血都是"被动挨打换伤害"，主动输出几乎为零。
      // 结果是它站得住但打不死人，对局拖到超时然后判负。
      // 让六护卫自己能还手，"站得住就赢"这句话才真正成立。
      for (const u of members) u.atk = Math.round(u.atk * t('guard6Atk', 1.45));
      api.hooksOf(team).onTick.push((a, _t, tick) => {
        if (tick === 0 || tick % (3 * TICK_RATE) !== 0) return;
        for (const u of members) {
          if (!u.alive) continue;
          a.addShield(u, u, u.maxHp * t('shieldRegen', 0.02), 999);
        }
      });
      // 荆棘：挨打就是输出 —— 纯坦阵容的正当伤害来源。
      // noReflect 标记阻断"反弹的伤害再被反弹"，否则双坦互殴会栈溢出。
      //
      // M2「机制软化」：反射不再逐跳满额 ——
      //   1) 单秒衰减：本秒内第 n 跳 = 基础值 × MECH.thornDecayPerHit^(n-1)。
      //      诊断依据：对机关召唤一役单护卫单秒最多被喂 9 跳，原先按满额
      //      线性兑现，"人海"成为无解的输出放大器。
      //   2) 单秒封顶：同一护卫每秒反射总输出 ≤ maxHp × MECH.thornSecCapHpRatio
      //      （0 = 不封顶），超出部分截断。计数与累计全部以 tick 界
      //      （tick % TICK_RATE === 0）重置，禁止墙钟。
      const thornSec = new Map<number, { hits: number; sum: number }>();
      api.hooksOf(team).onTick.push((_a, _t, tick) => {
        if (tick % TICK_RATE !== 0) return;
        thornSec.clear();
      });
      api.hooksOf(team).onDamageTaken.push((a, dst, src, _amount, type, opts) => {
        if (type !== 'physical' || opts.noReflect) return;
        if (!src || !isMember(members, dst) || !dst.alive || !src.alive) return;
        let st = thornSec.get(dst.uid);
        if (!st) {
          st = { hits: 0, sum: 0 };
          thornSec.set(dst.uid, st);
        }
        // t2 形态置换：反弹改按自身最大生命百分比计（血池即弹药）——
        // 与 t2ArmorCut 配套：甲墙卸掉后物理队咬得动，但每一口都在啃反伤引信。
        const hpThorns = tier >= 2 ? t('t2ThornsHpPct', 0) : 0;
        const base = hpThorns > 0 ? dst.maxHp * hpThorns : dst.baseArmor * t('thornsArmorRatio', 0.52);
        // 承受者是"木石之躯"构装体时，反弹被抗性削减（只影响这一对机制，
        // 反伤总量对其他队伍不变 —— 不踩喂蓝悬崖）。
        const resist = 1 - (src.trait.thornResist ?? 0);
        const decayed = base * resist * Math.pow(MECH.thornDecayPerHit, st.hits);
        const secCap = MECH.thornSecCapHpRatio > 0 ? dst.maxHp * MECH.thornSecCapHpRatio : Infinity;
        const dmg = Math.min(decayed, Math.max(0, secCap - st.sum));
        if (dmg <= 0) return;
        st.hits += 1;
        st.sum += dmg;
        a.dealDamage(dst, src, dmg, 'physical', { source: 'trait', noReflect: true });
      });
    }
  },

  // ══════════════ 刺客 [站位] ══════════════
  assassin: ({ api, members }) => {
    const t = tuner('assassin');
    const tier = members[0].trait.tier['assassin'] ?? 0;
    for (const u of members) {
      u.critChance += t('crit', 0.2);
      if (tier >= 1) u.critMult += t('critMult', 0.35);
    }
    api.hooksOf(members[0].team).onBattleStart.push((a) => {
      // 关键设计：不立即跳。
      // 若开局瞬间跃入，刺客会在己方前排接战前独自面对 7 人集火，必死 ——
      // "刺客克后排"的克制关系就永远无法成立。
      // 延迟 1.0 秒跃入（等双方前排咬住），落地再给 0.7 秒烟遁无敌，
      // 让"切后排"成为一次真正有威胁的战术行动。
      a.schedule(ASSASSIN_LEAP_DELAY, (api) => {
        for (const u of members) {
          if (!u.alive) continue;
          const foes = api.units.filter((x) => x.alive && x.team !== u.team);
          if (foes.length === 0) continue;
          let backRow = foes[0].cell.r;
          for (const f of foes) {
            if (Math.abs(f.cell.r - u.cell.r) > Math.abs(backRow - u.cell.r)) backRow = f.cell.r;
          }
          const candidates: { c: number; r: number }[] = [];
          for (let c = 0; c < 8; c++) {
            for (const r of [backRow, backRow + (u.cell.r > backRow ? -1 : 1)]) {
              if (r >= 0 && r < 8 && !api.occupied(c, r)) candidates.push({ c, r });
            }
          }
          if (candidates.length === 0) continue;
          candidates.sort(
            (p, q) =>
              Math.hypot(p.c - u.cell.c, p.r - u.cell.r) - Math.hypot(q.c - u.cell.c, q.r - u.cell.r),
          );
          api.teleport(u, candidates[0], 0.28);
          if (tier >= 1) api.addStatus(u, u, 'aspdUp', 5, t('leapAspd', 35));
          api.addStatus(u, u, 'invuln', ASSASSIN_SMOKE_DURATION, 0);
          api.fx('dashTrail', { uid: u.uid, cell: candidates[0] });
        }
      });
    });
  },

  // ══════════════ 神射 ══════════════
  marksman: ({ api, members }) => {
    const t = tuner('marksman');
    const tier = members[0].trait.tier['marksman'] ?? 0;
    for (const u of members) {
      u.range += 1;
      // 两档攻击加成同为 15%（文案二档不提攻击力，只加必暴效果）
      u.atk = Math.round(u.atk * (1 + t('atk', 0.15)));
    }
    if (tier >= 1) {
      for (const u of members) u.critMult += t('critMult', 0.3);
      api.hooksOf(members[0].team).onPreAttack.push((_a, src, _dst, mod) => {
        if (!isMember(members, src)) return;
        if (src.attackCount % 3 === 2) mod.forceCrit = true;
      });
    }
  },

  // ══════════════ 方士 [技能] ══════════════
  mage: ({ api, members }) => {
    const t = tuner('mage');
    const tier = members[0].trait.tier['mage'] ?? 0;
    // 固定法强从 [30,68,130] 降到 [24,46,78]：
    // 二星方士基础法强约 100，+68 等于凭空翻倍，再叠龙渊的 +30 就变成
    // "数值上打不动也躲不开"。加成比例必须小于基础值的量级，
    // 否则羁绊就不是"构筑选择"而是"唯一解"。
    const spFlat = t(`sp${tier}`, [24, 46, 78][tier] ?? 24);
    for (const u of members) u.sp += spFlat;
    if (tier >= 1) {
      // 修约定后首档覆盖广了：方士盾转为全队（门档正确但覆盖合理）
      api.hooksOf(members[0].team).onBattleStart.push((a) => {
        const pool = a.units.filter((x) => x.alive && x.team === members[0].team);
        for (const u of pool) a.addShield(null, u, u.maxHp * t('shield', 0.12), 999);
      });
    }
    if (tier >= 2) {
      api.hooksOf(members[0].team).onBattleStart.push((a) => {
        const pool = a.units.filter((x) => x.alive && x.team === members[0].team);
        for (const u of pool) a.addShield(null, u, u.maxHp * t('shield2', 0.06), 999);
      });
    }
    // 修约定后二三档切入晚了：二档起全队小额法强与增伤铺垫（门档后的团队光环）
    if (tier >= 1) {
      for (const u of api.units) {
        if (u.team !== members[0].team) continue;
        u.sp += t('teamSp', 14);
        u.trait.skillAmp += t('teamAmp', 0.06);
      }
    }
    if (tier >= 2) {
      for (const u of api.units) {
        if (u.team !== members[0].team) continue;
        u.sp += t('teamSp2', 10);
        u.trait.skillAmp += t('teamAmp2', 0.05);
      }
    }
    const team = members[0].team;
    if (tier >= 1) {
      api.hooksOf(team).onDamageDealt.push((a, src, dst, _amt, _type, source) => {
        if (source !== 'skill' || !isMember(members, src)) return;
        a.addStatus(src, dst, 'mrShred', 4, t('shred', 20));
      });
    }
    if (tier >= 2) {
      api.hooksOf(team).onDamageDealt.push((a, src, dst, amount, type, source) => {
        if (source !== 'skill' || !isMember(members, src)) return;
        for (const e of a.unitsInRadius(dst.cell, 1)) {
          if (e === dst || e.team === src.team || !e.alive) continue;
          a.dealDamage(src, e, amount * t('splash', 0.55), type, { source: 'trait' });
        }
      });
    }
  },

  // ══════════════ 术士 ══════════════
  warlock: ({ api, members }) => {
    const t = tuner('warlock');
    const tier = members[0].trait.tier['warlock'] ?? 0;
    for (const u of members) u.trait.skillTrueRatio = tier >= 1 ? t('true1', 0.3) : t('true0', 0.15);
    if (tier >= 1) {
      api.hooksOf(members[0].team).onDamageDealt.push((a, src, dst, _amt, _type, source) => {
        if (source !== 'skill' || !isMember(members, src)) return;
        a.addStatus(src, dst, 'wound', 3, t('wound', 30));
      });
    }
  },

  // ══════════════ 丹师 ══════════════
  support: ({ api, members, teamUnits }) => {
    const t = tuner('support');
    const tier = members[0].trait.tier['support'] ?? 0;
    // 二档起全队受益 —— 这是丹师作为"团队支援职业"的定位
    for (const u of teamUnits) u.trait.hpRegenPctPerSec += t('regen', 0.012);
    if (tier >= 1) {
      for (const u of members) {
        u.trait.healAmp += t('healAmp', 0.8);
        u.trait.shieldAmp += t('shieldAmp', 0.8);
      }
      api.hooksOf(members[0].team).onDeath.push((a, victim) => {
        for (const u of a.units) {
          if (!u.alive || u.team !== victim.team) continue;
          const cur = u.traitStacks['supportAspdStacks'] ?? 0;
          if (cur >= 5) continue;
          u.traitStacks['supportAspdStacks'] = cur + 1;
          a.addStatus(victim, u, 'aspdUp', 8, t('deathAspd', 20));
        }
      });
    }
  },
};

/** 计算某队在某羁绊上的成员列表与达成档位 */
export function computeActiveTraits(units: Unit[], traitId: string): { members: Unit[]; tier: number; count: number } {
  const members = units.filter(
    (u) => !u.isMinion && (u.entry.origins.includes(traitId) || u.entry.classes.includes(traitId)),
  );
  // 同名棋子只计一次（升星不叠加羁绊数）
  const unique = new Set(members.map((u) => u.entry.id));
  return { members, tier: 0, count: unique.size };
}

/**
 * 在战斗开局套用全部羁绊。
 * 顺序固定：先写静态数值（members 面板），再注册钩子 —— 保证面板计算与钩子看到的值一致。
 */
export function applyTraits(api: BattleApi, team: number, active: ActiveTrait[], teamUnits: Unit[]): void {
  const sorted = [...active].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const at of sorted) {
    if (at.tier < 0) continue;
    const { members } = computeActiveTraits(teamUnits, at.id);
    if (members.length === 0) continue;
    // 存 0-based 档位（0=首档）：全部实现按此约定编写（tier>=1=二档、>=2=三档、
    // 数值表 [a,b,c][tier] 直接索引）。历史上这里 +1 导致全部条件档提前一档生效，
    // 2026-08-29 修正并全局重平衡。
    for (const m of members) m.trait.tier[at.id] = at.tier;
    const impl = TRAIT_IMPL[at.id];
    if (!impl) continue;
    impl({ api, team, tier: at.tier, members, teamUnits });
  }
}

/** 供单位状态检查复用的守卫（避免各处重复判空） */
export function unitCanAct(u: Unit): boolean {
  return u.alive && !isStunned(u);
}
export function unitCanCast(u: Unit): boolean {
  return u.alive && !isStunned(u) && !isSilenced(u);
}
export function unitCanAttack(u: Unit): boolean {
  return u.alive && !isStunned(u) && !isDisarmed(u);
}
export function unitHasStatus(u: Unit, kind: StatusKind): boolean {
  return hasStatus(u, kind);
}
