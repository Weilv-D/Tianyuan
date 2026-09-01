/**
 * 装备运行时。
 *
 * 装备分三层生效，与羁绊共用同一套机制，不引入新概念：
 *  1. **面板属性** —— 在 createUnit 时并入 Unit 的静态面板（`bonus`）
 *  2. **状态修正** —— 在开战前累加进 `Unit.trait`（与羁绊同一份 TraitState）
 *  3. **行为钩子** —— 注册到队伍的 BattleHooks，与羁绊钩子并列执行
 *
 * 之所以不新开一套"装备状态"，是因为羁绊与装备在内核里是同一类东西：
 * "给某个单位加上某些数值修正和行为"。多一套并行结构只会让减伤/增伤的
 * 计算顺序变成需要维护两遍的隐患。
 */

import { ITEM_BY_ID, type ItemBonus, type ItemMods, type ItemHookId } from '../data/items';
import type { BattleApi, TraitState } from './api';
import type { StatusKind } from './types';
import type { Unit } from './unit';

/** 一件装备拆出来的三层效果 */
export interface ItemEffects {
  bonus: Partial<ItemBonus>;
  mods: Partial<ItemMods>;
  hooks: ItemHookId[];
  params: Record<string, number>;
}

/**
 * 装备数值的三层聚合口径（全表统一，勿单件破例）：
 *   bonus / mods —— 按件**求和**（两件玄甲就是两份护甲，玩家直觉一致）；
 *   params（钩子参数）—— 同键取 **max**：同一单位穿两件同钩装备时，行为钩子
 *   只注册一次、数值取最强一件（如两件贯日枪只结算一件的 40% 附加）。
 *   比率类参数取 max 是防乘区爆炸的既定裁决（warBanner 同注释）；
 *   图鉴与合成提示按此口径描述，UI 不承诺"叠加"。
 */
export function itemEffects(itemIds: readonly string[]): ItemEffects {
  const bonus: Record<string, number> = {};
  const mods: Record<string, number> = {};
  const hooks: ItemHookId[] = [];
  const params: Record<string, number> = {};

  for (const id of itemIds) {
    const def = ITEM_BY_ID[id];
    if (!def) continue;
    for (const [k, v] of Object.entries(def.bonus)) {
      bonus[k] = (bonus[k] ?? 0) + (v as number);
    }
    if (def.mods) {
      for (const [k, v] of Object.entries(def.mods)) mods[k] = (mods[k] ?? 0) + (v as number);
    }
    if (def.hooks) hooks.push(...def.hooks);
    if (def.params) {
      for (const [k, v] of Object.entries(def.params)) params[k] = Math.max(params[k] ?? 0, v);
    }
  }
  return {
    bonus: bonus as Partial<ItemBonus>,
    mods: mods as Partial<ItemMods>,
    hooks,
    params,
  };
}

/**
 * 把装备的状态修正累加进单位的 TraitState。
 * 注意是**累加**而非覆盖 —— 羁绊先写，装备后加，两者叠加生效。
 */
export function applyItemMods(u: Unit, itemIds: readonly string[]): void {
  if (itemIds.length === 0) return;
  const { mods } = itemEffects(itemIds);
  const t: TraitState = u.trait;
  if (mods.armorPen) t.armorPen = Math.min(0.85, t.armorPen + mods.armorPen);
  if (mods.skillAmp) t.skillAmp += mods.skillAmp;
  if (mods.physicalDr) t.physicalDr = Math.min(0.9, t.physicalDr + mods.physicalDr);
  if (mods.magicDr) t.magicDr = Math.min(0.9, t.magicDr + mods.magicDr);
  if (mods.manaPerSec) t.manaPerSec += mods.manaPerSec;
  if (mods.hpRegenPctPerSec) t.hpRegenPctPerSec += mods.hpRegenPctPerSec;
  if (mods.healAmp) t.healAmp += mods.healAmp;
  if (mods.allDr) t.allDr = Math.min(0.9, t.allDr + mods.allDr);
  // 倍率/绝对值语义的字段取最大而不是求和：两把狮心盾不该把承伤转蓝叠到 1.6
  if (mods.manaFromDamageMult) t.manaFromDamageMult = Math.max(t.manaFromDamageMult, mods.manaFromDamageMult);
  if (mods.skillCritChance) t.skillCritChance = Math.min(1, t.skillCritChance + mods.skillCritChance);
  if (mods.skillCritMult) t.skillCritMult = Math.max(t.skillCritMult, mods.skillCritMult);
}

/**
 * 注册装备钩子。
 *
 * 钩子挂在队伍上，但每个回调都会先检查"这个单位到底有没有这件装备"——
 * 这是唯一安全的方式，因为队伍里还有其他五个单位。
 */
export function applyItemHooks(api: BattleApi, team: number, units: readonly Unit[]): void {
  const h = api.hooksOf(team);
  const has = (u: Unit, hook: ItemHookId): boolean => u.itemHooks.includes(hook);

  // 断魂刃：击杀回复 18% 最大生命。让 carry 有滚雪球能力，也给翻盘留了口子
  if (units.some((u) => has(u, 'executeHeal'))) {
    h.onKill.push((a, killer) => {
      if (!has(killer, 'executeHeal') || !killer.alive) return;
      const pct = paramOf(killer, 'healPct');
      a.heal(killer, killer, killer.maxHp * pct, 'item');
    });
  }

  // 玄武甲：受到物理伤害反弹。
  // 原版按「护甲值 × 系数」反弹 —— 护甲 44 反弹 11 点，对上一次平 A 动辄上百的
  // 战场来说等于没有，实测这件装备只有 +3.9%，玩家不会想合它。
  // 改成按「受到的伤害 × 百分比」反弹，反弹量才随局势一起放大。
  if (units.some((u) => has(u, 'thorns'))) {
    h.onDamageTaken.push((a, dst, src, amount, type, opts) => {
      if (type !== 'physical' || opts.noReflect) return;
      if (!has(dst, 'thorns') || !dst.alive || !src || !src.alive) return;
      const reflect = paramOf(dst, 'reflectPct');
      if (reflect <= 0) return;
      a.dealDamage(dst, src, amount * reflect, 'physical', {
        source: 'item',
        noReflect: true,
      });
    });
  }

  // 疾风履：越打越快。叠层挂在 permAspdPct 上（它本来就参与 effAspd 计算），
  // 不新开状态字段 —— 装备的成长性不该再引入一套并行结构。
  if (units.some((u) => has(u, 'momentum'))) {
    // onAttackHit 只在普攻命中时触发，恒为 physical，不必再判伤害类型
    h.onAttackHit.push((a, src, _dst, _amount) => {
      if (!has(src, 'momentum') || !src.alive) return;
      if (src.itemUsed.has('momentum')) return; // 满层后不再重复计算
      const per = paramOf(src, 'aspdPerStack');
      const max = paramOf(src, 'maxStacks');
      const prev = src.traitStacks['momentum'] ?? 0;
      const n = Math.min(max, prev + 1);
      src.traitStacks['momentum'] = n;
      // 只累加本次新增层数的贡献。
      // 此前这里是 `permAspdPct = n * per`（按总量重算），会把兵家/机关等羁绊
      // 在开战前累加进 permAspdPct 的攻速成长整体覆盖掉 —— 实测羁绊的 +0.2
      // 在第 1 次普攻命中后即归零且永不恢复。装备的成长必须叠加在既有数值之上，
      // 而不是重新定义它。
      src.permAspdPct += (n - prev) * per;
      if (n >= max) {
        src.itemUsed.add('momentum');
        a.emit({ t: 'fx', tick: a.tick, uid: src.uid, kind: 'buffAura', params: { hue: 1 } });
      }
    });
  }

  // 回天符：治疗溢出转护盾。解决治疗流"满血时治疗全浪费"的结构性痛点
  if (units.some((u) => has(u, 'healToShield'))) {
    h.onHealOverflow.push((a, target, src, overflow) => {
      if (!src || !has(src, 'healToShield') || !target.alive) return;
      a.addShield(src, target, overflow * paramOf(src, 'shieldPct'), 6);
    });
  }

  // 不朽衣：首次阵亡以 params.hpPct 比例复活（当前 15%，M2 调平），
  // 阵亡后 params.reviveDelay 秒才爬起（0 = 立即）。
  // M4 归因（配对实测）：复活机制本体 ≈ +11pp，且对三类持有者代价全部免疫 ——
  // 易伤 20~40、躯壳崩解 0.012~0.03（8 秒累计 24% 最大生命）、复活法力清零，
  // 各档与无代价档差值全部 ≤1pp；复活血量 15%→8%（M2）亦不掉强度。
  // 强度主体是「复活事件」本身的占位扰动与火力重定向，与复活血量/时长/施法无关，
  // 任何挂在复活单位身上的代价都打不中。唯一有效杠杆 = 拉开死亡与复活的间隔：
  // 延迟期间单位不占位、不可选中，敌方火力被迫转回队友，事件价值被稀释。
  if (units.some((u) => has(u, 'immortal'))) {
    h.onDeath.push((a, victim) => {
      if (!has(victim, 'immortal') || victim.isMinion) return;
      if (victim.itemUsed.has('immortal')) return;
      // M2修复：移除对 victim.revived 的检查。此前幽冥四档先触发并置 revived=true
      // 后，不朽衣因 revived 互斥而永久静默（且不消耗 itemUsed，整局作废）。
      // 改为仅以 itemUsed 作来源内互斥，允许幽冥与不朽衣各自复活一次。
      // 同一次死亡只消耗一个来源：若本 tick 已被幽冥拉起（victim.alive），
      // 不朽衣保留到下次阵亡，避免“同死双耗”的浪费。
      if (victim.alive) return;
      victim.itemUsed.add('immortal');
      const delay = paramOf(victim, 'reviveDelay');
      const doRevive = (api: BattleApi): void => {
        if (!victim.alive) api.revive(victim, paramOf(victim, 'hpPct'), victim);
      };
      if (delay > 0) a.schedule(delay, doRevive);
      else doRevive(a);
      a.emit({
        t: 'fx',
        tick: a.tick,
        uid: victim.uid,
        kind: 'buffAura',
      });
    });
  }

  // ── v1.9 全配方扩展（17 个钩子）。共用纪律：
  //  · onTick 类钩子按注册队伍闭包过滤 u.team !== team，防止双队重复结算；
  //  · 叠层走 permAtkPct/permAspdPct 的「增量累加 + traitStacks 记此前值」，
    // 与疾风弓 momentum 同一套安全模式（禁止按总量重算，会覆盖羁绊成长）；
  //  · 计数/冷却用 traitStacks，一次性消耗用 itemUsed。 ──

  // 贯日枪：普攻命中追加 40% 法强的法术伤害（onAttackHit 恒为普攻命中）
  if (units.some((u) => has(u, 'sunSpear'))) {
    h.onAttackHit.push((a, src, dst) => {
      if (!has(src, 'sunSpear') || !src.alive || !dst.alive) return;
      const ratio = paramOf(src, 'spRatio');
      if (ratio <= 0) return;
      a.dealDamage(src, dst, src.sp * ratio, 'magic', { source: 'item' });
    });
  }

  // 寒渊镰：普攻减速（slow 同时压攻速与移速，追击/风筝双向生效）
  if (units.some((u) => has(u, 'frost'))) {
    h.onAttackHit.push((a, src, dst) => {
      if (!has(src, 'frost') || !src.alive || !dst.alive) return;
      a.addStatus(src, dst, 'slow', paramOf(src, 'slowDur'), paramOf(src, 'slowPct'));
    });
  }

  // 缚龙爪：损血叠攻。节流 0.2s，按「应得值 - 此前值」增量写入 permAtkPct
  if (units.some((u) => has(u, 'berserk'))) {
    h.onTick.push((a, team, tick) => {
      if (tick % 6 !== 0) return;
      for (const u of a.units) {
        if (u.team !== team || !u.alive || !has(u, 'berserk')) continue;
        const per = paramOf(u, 'atkPerStep');
        const step = paramOf(u, 'stepPct');
        const cap = paramOf(u, 'capPct') * 100;
        const steps = Math.floor((1 - u.hp / u.maxHp) / Math.max(0.01, step));
        const v = Math.min(cap, steps * per);
        const prev = u.traitStacks['fulongPrev'] ?? 0;
        if (v === prev) continue;
        u.permAtkPct += (v - prev) / 100;
        u.traitStacks['fulongPrev'] = v;
      }
    });
  }

  // 流星弩：击杀后攻速爆发（aspdUp 可叠，按层数上限封顶）
  if (units.some((u) => has(u, 'killFrenzy'))) {
    h.onKill.push((a, killer) => {
      if (!has(killer, 'killFrenzy') || !killer.alive) return;
      const stacks = killer.statuses.filter((s) => s.kind === 'aspdUp').length;
      if (stacks >= paramOf(killer, 'maxStacks')) return;
      a.addStatus(killer, killer, 'aspdUp', paramOf(killer, 'dur'), paramOf(killer, 'aspdPct'));
      a.fx('buffAura', { uid: killer.uid, params: { hue: 0 } });
    });
  }

  // 赤练鞭：普攻上易伤（vulnerability 非叠加种类 → 自动刷新时长/取最大值）
  if (units.some((u) => has(u, 'venom'))) {
    h.onAttackHit.push((a, src, dst) => {
      if (!has(src, 'venom') || !src.alive || !dst.alive) return;
      a.addStatus(src, dst, 'vulnerability', paramOf(src, 'vulnDur'), paramOf(src, 'vulnPct'));
    });
  }

  // 青圭杖：施法后自盾（法系前排的"打完一轮还有余量"）
  if (units.some((u) => has(u, 'castShield'))) {
    h.onCast.push((a, u) => {
      if (!has(u, 'castShield') || !u.alive) return;
      a.addShield(u, u, u.maxHp * paramOf(u, 'shieldPct'), paramOf(u, 'shieldDur'));
    });
  }

  // 追风履：每秒 +1.5% 攻速成长（增量累加，封顶 16 秒 × 1.5）
  if (units.some((u) => has(u, 'windRunner'))) {
    h.onTick.push((a, team, tick) => {
      if (tick % 30 !== 0) return;
      for (const u of a.units) {
        if (u.team !== team || !u.alive || !has(u, 'windRunner')) continue;
        const per = paramOf(u, 'aspdPerSec');
        const maxStacks = Math.floor(paramOf(u, 'capPct') / Math.max(0.01, per));
        const prev = u.traitStacks['zhuifengStacks'] ?? 0;
        if (prev >= maxStacks) continue;
        u.traitStacks['zhuifengStacks'] = prev + 1;
        u.permAspdPct += per / 100;
      }
    });
  }

  // 玄铁重甲：周期净化自身减益（按优先序摘一个，5 秒一次）
  if (units.some((u) => has(u, 'ironPurge'))) {
    const PURGE_ORDER: readonly StatusKind[] = [
      'stun', 'silence', 'disarm', 'wound', 'slow',
      'burn', 'bleed', 'vulnerability', 'armorShred', 'mrShred', 'taunt',
    ];
    h.onTick.push((a, team, tick) => {
      for (const u of a.units) {
        if (u.team !== team || !u.alive || !has(u, 'ironPurge')) continue;
        if (tick % Math.max(1, Math.round(paramOf(u, 'everyTicks'))) !== 0) continue;
        for (const kind of PURGE_ORDER) {
          if (!u.statuses.some((s) => s.kind === kind)) continue;
          a.removeStatus(u, kind);
          a.fx('buffAura', { uid: u.uid });
          break;
        }
      }
    });
  }

  // 紫电镰：施法后攻速爆发
  if (units.some((u) => has(u, 'castAspd'))) {
    h.onCast.push((a, u) => {
      if (!has(u, 'castAspd') || !u.alive) return;
      const stacks = u.statuses.filter((s) => s.kind === 'aspdUp').length;
      if (stacks >= paramOf(u, 'maxStacks')) return;
      a.addStatus(u, u, 'aspdUp', paramOf(u, 'dur'), paramOf(u, 'aspdPct'));
      a.fx('buffAura', { uid: u.uid, params: { hue: 2 } });
    });
  }

  // 引魂灯：施法后治疗生命最低的友军（按持有者法强折算）
  if (units.some((u) => has(u, 'castHeal'))) {
    h.onCast.push((a, u) => {
      if (!has(u, 'castHeal') || !u.alive) return;
      const t = a.resolveTargets(u, 'allyLowestHp', 1)[0];
      if (!t) return;
      const healed = a.heal(u, t, u.sp * paramOf(u, 'healSpRatio'), 'item');
      if (healed > 0.5) a.fx('healWave', { uid: t.uid });
    });
  }

  // 垂天翼：开战攻速（onBattleStart 每队各注册一次，has() 天然按持有者过滤）
  if (units.some((u) => has(u, 'wingStart'))) {
    h.onBattleStart.push((a, team) => {
      for (const u of a.units) {
        if (u.team !== team || !u.alive || !has(u, 'wingStart')) continue;
        a.addStatus(u, u, 'aspdUp', paramOf(u, 'dur'), paramOf(u, 'aspdPct'));
      }
    });
  }

  // 九尾面：施法后标记，下一次普攻必爆 + 追加法伤（onPreAttack 消费标记）
  if (units.some((u) => has(u, 'foxReady'))) {
    h.onCast.push((_a, u) => {
      if (has(u, 'foxReady') && u.alive) u.traitStacks['jiuweiReady'] = 1;
    });
    h.onPreAttack.push((_a, src, _dst, mod) => {
      if (!has(src, 'foxReady') || !src.traitStacks['jiuweiReady']) return;
      src.traitStacks['jiuweiReady'] = 0;
      mod.forceCrit = true;
      mod.bonusMagic += src.sp * paramOf(src, 'bonusSpRatio');
    });
  }

  // 拂尘扇：每第 N 次普攻缴械目标
  if (units.some((u) => has(u, 'disarmSwat'))) {
    h.onAttackHit.push((a, src, dst) => {
      if (!has(src, 'disarmSwat') || !src.alive || !dst.alive) return;
      const every = Math.max(2, Math.round(paramOf(src, 'everyHits')));
      const n = ((src.traitStacks['fuchenHits'] ?? 0) as number) + 1;
      if (n < every) {
        src.traitStacks['fuchenHits'] = n;
        return;
      }
      src.traitStacks['fuchenHits'] = 0;
      a.addStatus(src, dst, 'disarm', paramOf(src, 'disarmDur'), 0);
    });
  }

  // 霜翎环：普攻命中按最大生命百分比回复（amount ≤0 = 被闪避/护盾全吃，不回）
  if (units.some((u) => has(u, 'onHitHeal'))) {
    h.onAttackHit.push((a, src, _dst, amount) => {
      if (!has(src, 'onHitHeal') || !src.alive) return;
      if ((amount ?? 0) <= 0) return;
      a.heal(src, src, src.maxHp * paramOf(src, 'healPct'), 'item');
    });
  }

  // 紫金炉：普攻命中额外回蓝（与内核每次普攻 +10 并行，吃法力锁与上限）
  if (units.some((u) => has(u, 'critMana'))) {
    h.onAttackHit.push((_a, src) => {
      if (!has(src, 'critMana') || !src.alive || src.isMinion) return;
      if (src.manaLock > 0) return;
      src.mp = Math.min(src.maxMp, src.mp + paramOf(src, 'mpPerHit'));
    });
  }

  // 墨龙旗：开战为全体友军上减伤（多面旗不重复结算，params 聚合本就取最大）
  if (units.some((u) => has(u, 'warBanner'))) {
    h.onBattleStart.push((a, team) => {
      const holder = a.units.find((u) => u.team === team && u.alive && has(u, 'warBanner'));
      if (!holder) return;
      for (const al of a.units) {
        if (al.team !== team || !al.alive) continue;
        a.addStatus(holder, al, 'dr', paramOf(holder, 'dur'), paramOf(holder, 'drPct'));
      }
      a.fx('shieldWall', { team });
    });
  }

  // 摄魂铃：受普攻概率眩晕攻击者，内置冷却（traitStacks 存下次可触发 tick）
  if (units.some((u) => has(u, 'bellStun'))) {
    h.onDamageTaken.push((a, dst, src, _amount, _type, opts) => {
      if (!has(dst, 'bellStun') || !dst.alive || !src || !src.alive) return;
      if (opts.source !== 'attack') return;
      const next = dst.traitStacks['shehunNextTick'] ?? 0;
      if (a.tick < next) return;
      if (!a.rng.chance(paramOf(dst, 'chance'))) return;
      dst.traitStacks['shehunNextTick'] = a.tick + paramOf(dst, 'cdTicks');
      a.addStatus(dst, src, 'stun', paramOf(dst, 'stunDur'), 0);
      a.fx('debuffMark', { uid: src.uid });
    });
  }
}

function paramOf(u: Unit, key: string): number {
  // 与 itemEffects 的 params 聚合同一口径：多件同类钩子取最大值。
  // 取"首个命中件"会在双持同钩装备时钩子实参小于聚合面（momentum 提前封顶等）。
  let m = 0;
  for (const id of u.itemIds) {
    const v = ITEM_BY_ID[id]?.params?.[key];
    if (v !== undefined) m = Math.max(m, v);
  }
  return m;
}
