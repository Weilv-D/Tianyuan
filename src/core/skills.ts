import type { BattleApi } from './api';
import { chebyshev, inBounds } from './grid';
import { effAtk, effSp, hasStatus, type Unit } from './unit';
import { STAR_SKILL_SCALE, TICK_RATE } from './config';
import type { SkillSpec, TargetMode } from '../data/champions';
import type { Cell, DamageType, StatusKind } from './types';

/**
 * 技能引擎。
 *
 * 每个 SkillKind 一个完整实现，棋子通过参数组合得到差异化技能。
 * 所有伤害都走 skillDamage()，统一处理：星级缩放 → 技能增伤 → 真伤转化 → 暴击标记。
 */

/** 减益类状态：技能的 p.status 若是这些，施加给受击敌人；其余一律视为自身增益 */
const DEBUFF_KINDS = new Set<StatusKind>([
  'stun', 'silence', 'disarm', 'slow', 'wound',
  'burn', 'bleed', 'armorShred', 'mrShred', 'vulnerability', 'taunt',
]);

/** 技能原始伤害 = (攻击力 × atk倍率 + 法强 × sp倍率 + 固定值) × 星级技能倍率 */
export function skillRaw(u: Unit, atk = 0, sp = 0, flat = 0): number {
  return (atk * effAtk(u) + sp * effSp(u) + flat) * STAR_SKILL_SCALE[u.star - 1];
}

/**
 * 统一技能伤害出口。
 * 术士的"真伤转化"在此生效：把伤害按比例拆成真伤 + 原类型两段，
 * 而不是简单替换类型 —— 这样护甲/魔抗仍然对剩余部分起作用，数值更可预测。
 */
export function skillDamage(
  api: BattleApi,
  src: Unit,
  dst: Unit,
  raw: number,
  type: DamageType,
  forceCrit = false,
): number {
  const amp = 1 + src.trait.skillAmp;
  const tr = src.trait.skillTrueRatio;
  const total = raw * amp;
  if (tr > 0 && type !== 'true') {
    const dealt =
      api.dealDamage(src, dst, total * tr, 'true', { source: 'skill', forceCrit }) +
      api.dealDamage(src, dst, total * (1 - tr), type, { source: 'skill', forceCrit });
    return dealt;
  }
  return api.dealDamage(src, dst, total, type, { source: 'skill', forceCrit });
}

/** 施加技能附带的状态（可选） */
function applyStatus(api: BattleApi, src: Unit, dst: Unit, p: SkillSpec['params']): void {
  const s = p.status;
  if (!s) return;
  api.addStatus(src, dst, s.kind as StatusKind, s.dur, s.value ?? 0);
}

/** 选中目标后的通用收尾：治疗、叠层、护盾 */
function onHits(api: BattleApi, src: Unit, hitCount: number, p: SkillSpec['params']): void {
  if (p.healOnHit && hitCount > 0) {
    api.heal(src, src, src.maxHp * p.healOnHit * hitCount, 'skill');
  }
  if (p.shieldOnHit && hitCount > 0) {
    api.addShield(src, src, src.maxHp * p.shieldOnHit, 8);
  }
  if (p.stackAtkOnHit && hitCount > 0) {
    src.permAtkPct += p.stackAtkOnHit * hitCount;
  }
}

/** 在 center 周围找敌人的辅助 */
function foesIn(api: BattleApi, src: Unit, center: Cell, radius: number): Unit[] {
  return api.unitsInRadius(center, radius).filter((x) => x.team !== src.team && x.alive);
}

/** 收集沿直线（含起点方向）经过的格子 */
function lineCells(from: Cell, to: Cell, length: number): Cell[] {
  const dc = Math.sign(to.c - from.c);
  const dr = Math.sign(to.r - from.r);
  const out: Cell[] = [];
  for (let i = 1; i <= length; i++) {
    const c = from.c + dc * i;
    const r = from.r + dr * i;
    if (!inBounds(c, r)) break;
    out.push({ c, r });
  }
  return out;
}

type Impl = (api: BattleApi, u: Unit, spec: SkillSpec, target: Unit | null, cell: Cell) => void;

const IMPL: Record<string, Impl> = {
  // ─────────── 单体爆发 ───────────
  strike: (api, u, spec, target, cell) => {
    const p = spec.params;
    const type = p.type ?? 'physical';
    const radius = p.radius ?? 0;
    let hits = 0;
    if (radius > 0) {
      const center = target ? target.cell : cell;
      api.fx('burst', { uid: u.uid, cell: center, radius, params: { hue: type === 'physical' ? 0 : 2 } });
      for (const e of foesIn(api, u, center, radius)) {
        let raw = skillRaw(u, p.atk, p.sp, p.flat);
        if (p.threshold && e.hp / e.maxHp < p.threshold) raw *= 2;
        skillDamage(api, u, e, raw, type, p.forceCrit);
        applyStatus(api, u, e, p);
        hits++;
      }
    } else if (target) {
      api.fx('slash', { uid: u.uid, targetUid: target.uid });
      let raw = skillRaw(u, p.atk, p.sp, p.flat);
      if (p.threshold && target.hp / target.maxHp < p.threshold) raw *= 2;
      skillDamage(api, u, target, raw, type, p.forceCrit);
      applyStatus(api, u, target, p);
      hits = 1;
    }
    onHits(api, u, hits, p);
  },

  // ─────────── 自身环爆 ───────────
  nova: (api, u, spec, _target, cell) => {
    const p = spec.params;
    const type = p.type ?? 'physical';
    const radius = p.radius ?? 1;
    const shots = p.shots ?? 1;
    const interval = p.interval ?? 0.4;

    // 镇岳：先跃向敌阵最密集处
    if (spec.target !== 'self') {
      api.fx('dashTrail', { uid: u.uid, cell });
      api.teleport(u, cell, 0.3);
    }
    if (p.invulnWhileCasting) api.addStatus(u, u, 'invuln', Math.max(0.1, shots * interval), 0);
    // 增益类 status 一律施加给自身（此前只有 aspdUp 走这条分支，
    // 赤瞳的 atkUp 被当成减益推给了敌人）
    if (p.status && !DEBUFF_KINDS.has(p.status.kind as StatusKind)) {
      api.addStatus(u, u, p.status.kind as StatusKind, p.status.dur ?? 6, p.status.value ?? 0);
    }

    let wave = 0;
    const waveFn = (a: BattleApi) => {
      // 多波技能（昊天剑雨等）施法者中途阵亡后不再继续结算
      if (!u.alive) return;
      wave++;
      a.fx('nova', { uid: u.uid, radius, params: { hue: type === 'physical' ? 0 : 2, wave } });
      let hits = 0;
      for (const e of foesIn(a, u, u.cell, radius)) {
        skillDamage(a, u, e, skillRaw(u, p.atk, p.sp, p.flat), type, p.forceCrit);
        // 每波只补施非强控减益（stun/wound 已在施放瞬间一次性施加，逐波刷新会超出设计时长）
        if (p.status) {
          const k = p.status.kind as StatusKind;
          if (DEBUFF_KINDS.has(k) && k !== 'stun' && k !== 'wound') applyStatus(a, u, e, p);
        }
        hits++;
      }
      onHits(a, u, hits, p);
      if (wave < shots) a.schedule(interval, waveFn);
    };
    // 强控/重伤在施放瞬间对范围内敌人一次性施加
    if (p.status && (p.status.kind === 'stun' || p.status.kind === 'wound')) {
      for (const e of foesIn(api, u, u.cell, radius)) api.addStatus(u, e, p.status.kind as StatusKind, p.status.dur ?? 1.5, p.status.value ?? 0);
    }
    waveFn(api);
  },

  // ─────────── 指定点范围爆发 ───────────
  aoe: (api, u, spec, _target, cell) => {
    const p = spec.params;
    const type = p.type ?? 'magic';
    const radius = p.radius ?? 1;
    const run = (a: BattleApi) => {
      if (!u.alive) return; // 延迟落地的 AoE：施法者已死则不再结算
      a.fx('burst', { uid: u.uid, cell, radius, params: { hue: type === 'magic' ? 2 : 0 } });
      a.fx('groundMark', { cell, radius });
      let hits = 0;
      for (const e of foesIn(a, u, cell, radius)) {
        skillDamage(a, u, e, skillRaw(u, p.atk, p.sp, p.flat), type, p.forceCrit);
        applyStatus(a, u, e, p);
        hits++;
      }
      onHits(a, u, hits, p);
    };
    if (p.delay && p.delay > 0) {
      api.fx('groundMark', { cell, radius, params: { telegraph: 1, dur: p.delay } });
      api.schedule(p.delay, run);
    } else {
      run(api);
    }
  },

  // ─────────── 直线穿透 ───────────
  line: (api, u, spec, _target, cell) => {
    const p = spec.params;
    const type = p.type ?? 'physical';
    const length = p.length ?? 4;
    const cells = lineCells(u.cell, cell, length);
    api.fx('beam', { uid: u.uid, cell: cells[cells.length - 1] ?? cell, params: { hue: type === 'magic' ? 3 : 0 } });
    let hits = 0;
    for (const c of cells) {
      const e = api.unitAt(c.c, c.r);
      if (e && e.alive && e.team !== u.team) {
        skillDamage(api, u, e, skillRaw(u, p.atk, p.sp, p.flat), type, p.forceCrit);
        applyStatus(api, u, e, p);
        if (p.knockback) api.knockback(e, u.cell, p.knockback);
        hits++;
      }
    }
    onHits(api, u, hits, p);
  },

  // ─────────── 光束扫射（含灼烧） ───────────
  beam: (api, u, spec, _target, cell) => {
    const p = spec.params;
    const type = p.type ?? 'magic';
    const length = p.length ?? 5;
    if (p.invulnWhileCasting) api.addStatus(u, u, 'ccImmune', 1.2, 0);
    const emitAt = (a: BattleApi) => {
      if (!u.alive) return; // 0.55s 延迟光束：施法者已死则不再结算
      const cells = lineCells(u.cell, cell, length);
      a.fx('beam', { uid: u.uid, cell: cells[cells.length - 1] ?? cell, params: { hue: 3 } });
      let hits = 0;
      for (const c of cells) {
        const e = a.unitAt(c.c, c.r);
        if (e && e.alive && e.team !== u.team) {
          skillDamage(a, u, e, skillRaw(u, p.atk, p.sp, p.flat), type, p.forceCrit);
          if (p.dpsSp) a.addDot(u, e, 'burn', skillRaw(u, 0, p.dpsSp), p.status?.dur ?? 4, 'magic');
          if (p.status && p.status.kind !== 'burn') applyStatus(a, u, e, p);
          hits++;
        }
      }
      onHits(a, u, hits, p);
    };
    api.fx('castRing', { uid: u.uid, params: { hue: 3 } });
    api.schedule(0.55, emitAt);
  },

  // ─────────── 突进斩 ───────────
  dashStrike: (api, u, spec, target) => {
    const p = spec.params;
    // 连斩深度经闭包参数携带（每次顶层施放从 0 起算）。
    // 此前存在 u.traitStacks['qingming'] 且从不清零：首次连斩到顶后计数永久停在
    // maxRepeats，之后每次施放的"击杀再施放"永远静默 —— 与文案"至多 2 次"（每次施放）矛盾。
    const cast = (a: BattleApi, t: Unit, depth: number) => {
      const type = p.type ?? 'physical';
      // 落到目标身边最近的空格
      let dest: Cell | null = null;
      let best = Infinity;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const c = t.cell.c + dc;
          const r = t.cell.r + dr;
          if (!inBounds(c, r)) continue;
          if (a.occupied(c, r)) continue;
          const d = chebyshev({ c, r }, u.cell);
          if (d < best) {
            best = d;
            dest = { c, r };
          }
        }
      }
      a.fx('dashTrail', { uid: u.uid, cell: dest ?? t.cell });
      if (dest) a.teleport(u, dest, 0.22);

      const radius = p.radius ?? 0;
      const victims = radius > 0 ? foesIn(a, u, t.cell, radius) : [t];
      a.fx('slash', { uid: u.uid, targetUid: t.uid });
      let hits = 0;
      let killed = false;
      for (const e of victims) {
        const before = e.alive;
        skillDamage(a, u, e, skillRaw(u, p.atk, p.sp, p.flat), type, p.forceCrit ?? false);
        if (before && !e.alive) killed = true;
        hits++;
      }
      onHits(a, u, hits, p);
      if (killed && p.resetOnKill) {
        u.mp = Math.min(u.maxMp, u.maxMp * p.resetOnKill);
        // maxRepeats 语义 = 最多额外施放次数（青冥文案"至多 2 次"）
        if (p.maxRepeats && depth < p.maxRepeats) {
          a.schedule(0.25, (api2) => {
            if (!u.alive) return;
            const t2 = api2.resolveTargets(u, spec.target, 1)[0] ?? null;
            if (t2) cast(api2, t2, depth + 1);
          });
        }
      }
    };
    if (target) cast(api, target, 0);
  },

  // ─────────── 连续弹幕 ───────────
  volley: (api, u, spec, target) => {
    const p = spec.params;
    const type = p.type ?? 'physical';
    const shots = p.shots ?? 3;
    const interval = p.interval ?? 0.5;
    let fired = 0;
    let curTarget = target;
    const fire = (a: BattleApi) => {
      if (!u.alive) return;
      if (!curTarget || !curTarget.alive) {
        curTarget = a.resolveTargets(u, 'enemyNearest', 1)[0] ?? null;
        if (!curTarget) return;
      }
      const isLast = fired === shots - 1;
      const mult = isLast ? 2 : 1;
      a.fx('pierce', { uid: u.uid, targetUid: curTarget.uid });
      a.emit({
        t: 'projectile',
        tick: a.tick,
        uid: u.uid,
        targetUid: curTarget.uid,
        from: { c: u.cell.c, r: u.cell.r },
        to: { c: curTarget.cell.c, r: curTarget.cell.r },
        dur: 0.12,
        kind: u.range >= 4 ? 'arrow' : 'bolt',
      });
      skillDamage(a, u, curTarget, skillRaw(u, p.atk, p.sp, p.flat) * mult, type, p.forceCrit);
      if (p.status) {
        const s = a.unitByUid(u.uid);
        if (s) a.addStatus(s, s, p.status.kind as StatusKind, p.status.dur, p.status.value ?? 0);
      }
      fired++;
      if (fired < shots) a.schedule(interval, fire);
    };
    fire(api);
  },

  // ─────────── 群体治疗 ───────────
  healBurst: (api, u, spec, target) => {
    const p = spec.params;
    const amount = u.maxHp * (p.value ?? 0) + effSp(u) * (p.sp ?? 0);
    const isTeamWide = spec.target === 'allAllies';
    const list = isTeamWide
      ? api.units.filter((x) => x.alive && x.team === u.team)
      : ([target, api.units.filter((x) => x.alive && x.team === u.team && x !== target).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]].filter(Boolean) as Unit[]);
    // shots 只用于单体模式的目标数上限；全体治疗不得被它截断
    //（白娘的 shots=3 是给敌方重伤的人数用的，此前把 9 人口的治疗也砍到了 3 人）
    const healed = isTeamWide ? list : list.slice(0, p.shots ?? list.length);

    api.fx('healWave', { uid: u.uid, params: { hue: 4 } });
    for (const al of healed) {
      api.heal(u, al, amount, 'skill');
      // 减益类 status（白娘的重伤）只走下方"随机敌人"分支，绝不能套在友军身上
      if (p.status && !DEBUFF_KINDS.has(p.status.kind as StatusKind)) {
        api.addStatus(u, al, p.status.kind as StatusKind, p.status.dur, p.status.value ?? 0);
      }
      if (p.damageReduction) api.addStatus(u, al, 'dr', 6, p.damageReduction * 100);
      api.fx('healWave', { cell: al.cell });
    }
    // 白娘：对随机敌人施加重伤（治疗降低）
    if (spec.target === 'allAllies' && p.status && p.status.kind === 'wound') {
      const foes = api.units.filter((x) => x.alive && x.team !== u.team);
      api.rng.shuffle(foes);
      for (const e of foes.slice(0, p.shots ?? 3)) {
        api.addStatus(u, e, 'wound', p.status.dur, p.status.value ?? 0);
        api.fx('debuffMark', { targetUid: e.uid });
      }
    }
  },

  // ─────────── 群体护盾 ───────────
  shieldAll: (api, u, spec) => {
    const p = spec.params;
    const amount = u.maxHp * (p.value ?? 0);
    // 护盾时长与敌方控制时长（p.dur，青丘的魅惑）语义不同，用 shieldDur 覆盖，
    // 避免青丘 2.5s 的魅惑把全队护盾也压成 2.5s
    const shieldDur = p.shieldDur ?? 8;
    for (const al of api.units) {
      if (!al.alive || al.team !== u.team) continue;
      api.addShield(u, al, amount, shieldDur);
      if (p.status && !DEBUFF_KINDS.has(p.status.kind as StatusKind)) api.addStatus(u, al, p.status.kind as StatusKind, p.status.dur, p.status.value ?? 0);
      if (p.damageReduction) api.addStatus(u, al, 'dr', shieldDur, p.damageReduction * 100);
      api.fx('shieldWall', { cell: al.cell });
    }
    // 青丘：全体敌人魅惑（眩晕 + 易伤）
    if (p.dur && p.vulnerability) {
      for (const e of api.units) {
        if (!e.alive || e.team === u.team) continue;
        api.addStatus(u, e, 'stun', p.dur, 0);
        api.addStatus(u, e, 'vulnerability', p.dur + 2, p.vulnerability * 100);
        api.fx('debuffMark', { targetUid: e.uid });
      }
    }
  },

  // ─────────── 召唤 ───────────
  summon: (api, u, spec) => {
    const p = spec.params;
    if (!p.summon) return;
    api.fx('summon', { uid: u.uid });
    for (let i = 0; i < p.summon.count; i++) {
      let placed = false;
      for (let ring = 1; ring <= 3 && !placed; ring++) {
        for (let dr = -ring; dr <= ring && !placed; dr++) {
          for (let dc = -ring; dc <= ring && !placed; dc++) {
            const c = u.cell.c + dc;
            const r = u.cell.r + dr;
            if (!inBounds(c, r)) continue;
            if (api.occupied(c, r)) continue;
            api.summon(u, { c, r }, p.summon.hpPct, p.summon.atkPct, p.summon.name);
            api.fx('summon', { cell: { c, r } });
            placed = true;
          }
        }
      }
    }
    if (p.status) {
      for (const al of api.units) {
        if (al.alive && al.team === u.team) api.addStatus(u, al, p.status.kind as StatusKind, p.status.dur, p.status.value ?? 0);
      }
    }
  },

  // ─────────── 连锁 ───────────
  chain: (api, u, spec, target) => {
    const p = spec.params;
    const type = p.type ?? 'magic';
    const jumps = p.jumps ?? 3;
    let cur = target;
    const hitSet = new Set<number>();
    for (let i = 0; i < jumps; i++) {
      if (!cur || !cur.alive) break;
      hitSet.add(cur.uid);
      const falloff = Math.pow(1 - (p.falloff ?? 0.15), i);
      api.fx('beam', { uid: u.uid, targetUid: cur.uid, params: { hue: 5 } });
      skillDamage(api, u, cur, skillRaw(u, p.atk, p.sp, p.flat) * falloff, type);
      applyStatus(api, u, cur, p);
      // 跳向最近的未命中敌人
      let next: Unit | null = null;
      let best = Infinity;
      for (const e of api.units) {
        if (!e.alive || e.team === u.team || hitSet.has(e.uid)) continue;
        const d = chebyshev(e.cell, cur.cell);
        if (d < best) {
          best = d;
          next = e;
        }
      }
      cur = next;
    }
  },

  // ─────────── 全场处决 ───────────
  execute: (api, u, spec) => {
    const p = spec.params;
    const raw = skillRaw(u, p.atk, p.sp, p.flat);
    const threshold = p.threshold ?? 0.25;
    api.fx('nova', { uid: u.uid, radius: 8, params: { hue: 6 } });
    let executed = 0;
    for (const e of [...api.units]) {
      if (!e.alive || e.team === u.team) continue;
      if (e.hp / e.maxHp < threshold) {
        // 斩杀一跳豁免真伤单跳上限：处决的语义是"裁定死亡"而非输出伤害，
        // 若被 MECH.trueHitCapRatio 钳制则处决机制整体失效
        api.dealDamage(u, e, e.hp + e.shield + 9999, 'true', { source: 'skill', ignoreTrueCap: true });
        executed++;
      } else {
        skillDamage(api, u, e, raw, 'true');
      }
    }
    if (executed > 0) {
      // 十殿：每处决一人，全体友军回复 15%（此前只按"处决过"结一次）
      const healPct = (p.healPerExecute ?? 0.15) * executed;
      for (const al of api.units) {
        if (al.alive && al.team === u.team) api.heal(u, al, al.maxHp * healPct, 'skill');
      }
    }
  },

  // ─────────── 自身强化 ───────────
  selfBuff: (api, u, spec) => {
    const p = spec.params;
    const dur = p.dur ?? 6;
    if (p.value) api.addShield(u, u, u.maxHp * p.value, dur);
    if (p.status) api.addStatus(u, u, p.status.kind as StatusKind, p.status.dur ?? dur, p.status.value ?? 0);
    // 苍嗥：攻速 + 攻击力双增，击杀续期
    if (spec.params.status?.kind === 'aspdUp' && u.entry.id === 'canghao') {
      api.addStatus(u, u, 'atkUp', dur, 45);
      // 续期回调只注册一次。
      // 此前每次施放都无条件 push 一个新闭包，而 killHandlers 从不回收：施放 N 次
      // 就有 N 个闭包，每次击杀要遍历全部 N 个（重复刷新状态 + 重复推送 buffAura
      // 特效事件）。闭包体只依赖 u 与 dur，与"第几次施放"无关，注册一次即等价。
      if (!u.traitStacks['canghaoRenew']) {
        u.traitStacks['canghaoRenew'] = 1;
        u.killHandlers.push((a) => {
          if (!hasStatus(u, 'aspdUp')) return;
          for (const s of u.statuses) {
            if (s.kind === 'aspdUp' || s.kind === 'atkUp') s.ticks = Math.round(dur * TICK_RATE);
          }
          a.fx('buffAura', { uid: u.uid, params: { hue: 1 } });
        });
      }
    }
    if (p.invulnWhileCasting) {
      api.addStatus(u, u, 'invuln', dur, 0);
      api.addStatus(u, u, 'ccImmune', dur, 0);
    }
    // 不动明王 / 磐：环绕伤害 + 反弹用持续区域实现
    if (p.dpsSp && p.radius) {
      api.addZone({
        cell: u.cell,
        radius: p.radius,
        dur,
        srcUid: u.uid,
        team: u.team,
        dps: skillRaw(u, 0, p.dpsSp),
        type: p.type ?? 'magic',
        followUid: u.uid,
        fx: 'groundMark',
      });
    }
    // 磐 / 不动：反弹所受伤害（noReflect 阻断"反弹的伤害再被反弹"）。
    // 锚定本次施放附带的增益（不动→免疫 / 磐→护甲）：增益消失后反弹一并结束，"期间反弹"才名副其实
    if (p.reflect) {
      const anchor: StatusKind | undefined = p.invulnWhileCasting
        ? 'invuln'
        : (p.status?.kind as StatusKind | undefined);
      // 反弹钩子只注册一次。
      // onDamageTaken 是全场最热的钩子（每一次受击都会遍历），此前每次施放都往
      // 上面追加一个新闭包：过期增益对应的历史闭包虽然会立刻 return，但仍要被
      // 逐个调用，热路径成本随施放次数线性上升。窗口判定本来就由 anchor 状态
      // 在运行时完成（增益过期即 return），与"注册了几份"无关 —— 注册一次即等价。
      if (!u.traitStacks['reflectHooked']) {
        u.traitStacks['reflectHooked'] = 1;
        api.hooksOf(u.team).onDamageTaken.push((a, dst, src, amt, type, opts) => {
          if (anchor && !hasStatus(u, anchor)) return;
          if (type !== 'physical' && type !== 'magic') return;
          if (opts.noReflect) return;
          if (dst.uid !== u.uid || !u.alive || !src || !src.alive) return;
          a.dealDamage(u, src, Math.max(1, amt * p.reflect!), 'physical', { source: 'skill', noReflect: true });
        });
      }
    }
    api.fx('buffAura', { uid: u.uid, params: { hue: 1 } });
  },

  // ─────────── 地面持续区域 ───────────
  field: (api, u, spec, _target, cell) => {
    const p = spec.params;
    api.fx('groundMark', { cell, radius: p.radius ?? 1, params: { hue: 2 } });
    api.addZone({
      cell,
      radius: p.radius ?? 1,
      dur: p.dur ?? 5,
      srcUid: u.uid,
      team: u.team,
      dps: skillRaw(u, 0, p.dpsSp ?? 0),
      type: p.type ?? 'magic',
      status: p.status ? { kind: p.status.kind as StatusKind, dur: p.status.dur, value: p.status.value ?? 0 } : undefined,
      fx: 'groundMark',
    });
    if (p.damageReduction) api.addStatus(u, u, 'dr', p.dur ?? 5, p.damageReduction * 100);
  },

  // ─────────── 复活 ───────────
  resurrect: (api, u, spec) => {
    const p = spec.params;
    const dead = api.units.filter((x) => !x.alive && x.team === u.team && !x.isMinion && !x.revived);
    if (dead.length > 0) {
      // 优先复活费用最高的阵亡者
      dead.sort((a, b) => b.entry.cost - a.entry.cost || a.uid - b.uid);
      const chosen = dead[0];
      api.fx('summon', { cell: chosen.cell });
      api.revive(chosen, p.value ?? 0.45, u);
      api.fx('healWave', { cell: chosen.cell });
    } else {
      for (const al of api.units) {
        if (al.alive && al.team === u.team) {
          api.heal(u, al, al.maxHp * (p.value ?? 0.45), 'skill');
          api.fx('healWave', { cell: al.cell });
        }
      }
    }
  },
};

/** 施放技能的统一入口 */
export function executeSkill(api: BattleApi, u: Unit): void {
  const spec = u.entry.skillSpec;
  if (!spec) return;
  const impl = IMPL[spec.kind];
  if (!impl) return;
  const target = api.resolveTargets(u, spec.target, 1)[0] ?? null;
  const cell = api.resolveTargetCell(u, spec.target);
  impl(api, u, spec, target, cell);
}

/** 供 UI 展示的技能目标说明 */
export function targetModeLabel(mode: TargetMode): string {
  switch (mode) {
    case 'self': return '自身';
    case 'currentTarget': return '当前目标';
    case 'enemyNearest': return '最近敌人';
    case 'enemyLowestHp': return '残血敌人';
    case 'enemyHighestAtk': return '最强敌人';
    case 'enemyFarthest': return '最远敌人';
    case 'enemyDensest': return '敌阵密集处';
    case 'enemyLongestLine': return '贯穿方向';
    case 'enemyHalfBoard': return '敌方半场';
    case 'allyLowestHp': return '残血友军';
    case 'allAllies': return '全体友军';
    case 'allEnemies': return '全体敌人';
    case 'deadAlly': return '阵亡友军';
    default: return '';
  }
}
