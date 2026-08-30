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
import type { Unit } from './unit';

/** 一件装备拆出来的三层效果 */
export interface ItemEffects {
  bonus: Partial<ItemBonus>;
  mods: Partial<ItemMods>;
  hooks: ItemHookId[];
  params: Record<string, number>;
}

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
      const n = Math.min(max, (src.traitStacks['momentum'] ?? 0) + 1);
      src.traitStacks['momentum'] = n;
      src.permAspdPct = n * per;
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
      if (!has(victim, 'immortal') || victim.revived || victim.isMinion) return;
      if (victim.itemUsed.has('immortal')) return;
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
}

function paramOf(u: Unit, key: string): number {
  for (const id of u.itemIds) {
    const def = ITEM_BY_ID[id];
    const v = def?.params?.[key];
    if (v !== undefined) return v;
  }
  return 0;
}
