import {
  ATTACK_WINDUP_RATIO,
  BOARD_COLS,
  BOARD_ROWS,
  BATTLE_TIMEOUT_TICKS,
  CAST_WINDUP_SECONDS,
  DOT_TICKS_PER_SEC,
  DT,
  MANA_FROM_DAMAGE_CAP,
  MANA_FROM_DAMAGE_RATIO,
  MANA_LOCK_AFTER_CAST,
  MANA_PER_ATTACK,
  MANA_REGEN_PER_SEC,
  OVERTIME_AMP_PER_SEC,
  OVERTIME_START_TICK,
  MECH,
  RESIST_BASE,
  RETARGET_INTERVAL,
  TIMEOUT_WIN_RATIO,
  SHIELD_CAP_RATIO,
  TICK_RATE,
} from './config';
import { Rng } from './rng';
import { cellIndex, chebyshev, inBounds, NEIGHBOR_OFFSETS, stepTowardAttackPosition } from './grid';
import { createUnit, createMinion, effArmor, effAspd, effAtk, effMr, effMoveTime, isTargetable, type Unit } from './unit';
import { applyTraits } from './traits';
import { applyItemHooks, applyItemMods } from './items';
import { executeSkill } from './skills';
import {
  createHooks,
  type AttackModifier,
  type BattleApi,
  type BattleHooks,
  type DamageOptions,
  type ZoneOptions,
} from './api';
import type { BattleEvent, EventSink, FxKind, SpawnInfo } from './events';
import type { BattleConfig, BattleResult, Cell, DamageType, StatusKind, TeamId } from './types';
import type { TargetMode } from '../data/champions';

const CONTROL_KINDS = new Set<StatusKind>(['stun', 'silence', 'disarm', 'slow', 'taunt']);
const STACKABLE_KINDS = new Set<StatusKind>(['aspdUp', 'atkUp', 'armorUp', 'mrUp', 'dr']);
const EFFECT_INTERVAL = Math.max(1, Math.round(TICK_RATE / DOT_TICKS_PER_SEC));

interface Zone extends ZoneOptions {
  id: number;
  endsAtTick: number;
}

interface ScheduledTask {
  atTick: number;
  seq: number;
  fn: (api: BattleApi) => void;
}

/**
 * 战斗内核。
 *
 * 设计契约：
 *  1. 完全无头 —— 不引用任何渲染 / DOM / 时间 API
 *  2. 完全确定 —— 同一 seed + 同一输入 ⇒ 逐帧一致的事件流
 *  3. 固定步长 —— 30Hz 逻辑帧，渲染层自行插值
 */
export class Battle implements BattleApi {
  readonly rng: Rng;
  tick = 0;
  units: Unit[] = [];
  events: BattleEvent[] = [];

  private readonly hooks = new Map<TeamId, BattleHooks>();
  private sortedTeams: TeamId[] = [];
  private readonly occ = new Int16Array(BOARD_COLS * BOARD_ROWS).fill(-1);
  private zones: Zone[] = [];
  private scheduled: ScheduledTask[] = [];
  private seq = 0;
  private nextUid = 1;
  private zoneId = 1;
  private sink: EventSink | null = null;
  private readonly recordEvents: boolean;
  private readonly maxTicks: number;

  finished = false;
  result: BattleResult | null = null;

  constructor(cfg: BattleConfig, sink: EventSink | null = null, recordEvents = true) {
    this.rng = new Rng(cfg.seed);
    this.sink = sink;
    this.recordEvents = recordEvents;
    this.maxTicks = cfg.maxTicks && cfg.maxTicks > 0 ? cfg.maxTicks : BATTLE_TIMEOUT_TICKS;

    // 1) 建单位（uid 升序，保证遍历顺序确定）。
    //    输入校验与 createUnit 的「未知棋子即抛」同契约：重复 uid / 越界格 /
    //    重叠格立刻抛错。静默跳过会腐坏 occ 占位表，寻路与命中全盘错位且事后无从查起。
    const inputs = [...cfg.units].sort((a, b) => a.uid - b.uid);
    const seenUid = new Set<number>();
    for (const input of inputs) {
      if (seenUid.has(input.uid)) {
        throw new Error(`战斗输入重复 uid: ${input.uid}（${input.defId}）`);
      }
      seenUid.add(input.uid);
      if (!inBounds(input.cell.c, input.cell.r)) {
        throw new Error(`战斗输入越界格: (${input.cell.c},${input.cell.r}) ${input.defId}`);
      }
      const i = cellIndex(input.cell.c, input.cell.r);
      if (this.occ[i] !== -1) {
        throw new Error(`战斗输入重叠格: (${input.cell.c},${input.cell.r}) ${input.defId} 与 uid ${this.occ[i]} 冲突`);
      }
      const u = createUnit(input);
      this.units.push(u);
      this.nextUid = Math.max(this.nextUid, u.uid + 1);
      this.occ[i] = u.uid;
    }

    // 2) 套用羁绊（按队伍字典序，先数值后钩子）
    // ⚠ 顺序契约：钩子按"羁绊 id 字典序 → 装备"的固定顺序注册，
    //    SHIELD_CAP_RATIO 等全局上限的"谁先吃满额度"依赖此顺序 —— 改动前先想清楚。
    const teams = [...new Set(this.units.map((u) => u.team))].sort((a, b) => a - b);
    for (const team of teams) {
      if (!this.hooks.has(team)) this.hooks.set(team, createHooks());
    }
    this.sortedTeams = [...this.hooks.keys()].sort((a, b) => a - b);
    for (const team of teams) {
      const teamUnits = this.units.filter((u) => u.team === team);
      applyTraits(this, team, cfg.traits[team] ?? [], teamUnits);
    }

    // 2.5) 套用装备：状态修正进 Unit.trait（与羁绊叠加），行为钩子进队伍 hooks
    for (const team of teams) {
      const teamUnits = this.units.filter((u) => u.team === team);
      for (const u of teamUnits) applyItemMods(u, u.itemIds);
      applyItemHooks(this, team, teamUnits);
    }

    // 3) 开场钩子（刺客跳后排、天庭护盾、护卫护盾…）
    for (const team of teams) {
      for (const fn of this.hooks.get(team)!.onBattleStart) fn(this, team);
    }

    this.emit({
      t: 'start',
      tick: 0,
      units: this.units.map<SpawnInfo>((u) => ({
        uid: u.uid,
        defId: u.entry.id,
        team: u.team,
        star: u.star,
        cell: { c: u.cell.c, r: u.cell.r },
        maxHp: u.maxHp,
        hp: u.hp,
      })),
    });
  }

  // ───────────────── 事件 ─────────────────

  emit(e: BattleEvent): void {
    if (this.recordEvents) this.events.push(e);
    this.sink?.(e);
  }

  fx(
    kind: FxKind,
    opts: {
      uid?: number;
      cell?: Cell;
      targetUid?: number;
      radius?: number;
      team?: TeamId;
      params?: Record<string, number>;
    },
  ): void {
    this.emit({ t: 'fx', tick: this.tick, kind, ...opts });
  }

  /** 取走尚未消费的事件（渲染层每帧调用） */
  drainEvents(): BattleEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ───────────────── 查询 ─────────────────

  unitByUid(uid: number): Unit | null {
    for (const u of this.units) if (u.uid === uid) return u;
    return null;
  }

  aliveUnits(): Unit[] {
    return this.units.filter((u) => u.alive);
  }

  alliesOf(u: Unit): Unit[] {
    return this.units.filter((x) => x.alive && x.team === u.team);
  }

  enemiesOf(u: Unit): Unit[] {
    return this.units.filter((x) => x.alive && x.team !== u.team);
  }

  hooksOf(team: TeamId): BattleHooks {
    let h = this.hooks.get(team);
    if (!h) {
      h = createHooks();
      this.hooks.set(team, h);
      this.sortedTeams = [...this.hooks.keys()].sort((a, b) => a - b);
    }
    return h;
  }

  enemyTeamsOf(team: TeamId): TeamId[] {
    const out: TeamId[] = [];
    for (const t of this.hooks.keys()) if (t !== team) out.push(t);
    return out.sort((a, b) => a - b);
  }

  occupied(c: number, r: number): boolean {
    if (!inBounds(c, r)) return true;
    return this.occ[cellIndex(c, r)] !== -1;
  }

  unitAt(c: number, r: number): Unit | null {
    if (!inBounds(c, r)) return null;
    const uid = this.occ[cellIndex(c, r)];
    if (uid === -1) return null;
    return this.unitByUid(uid);
  }

  unitsInRadius(center: Cell, radius: number, team?: TeamId): Unit[] {
    const out: Unit[] = [];
    for (const u of this.units) {
      if (!u.alive) continue;
      if (team !== undefined && u.team !== team) continue;
      if (chebyshev(u.cell, center) <= radius) out.push(u);
    }
    return out;
  }

  overtimeAmp(): number {
    if (this.tick < OVERTIME_START_TICK) return 0;
    return ((this.tick - OVERTIME_START_TICK) / TICK_RATE) * OVERTIME_AMP_PER_SEC;
  }

  // ───────────────── 目标选择 ─────────────────

  resolveTargets(u: Unit, mode: TargetMode, count = 1): Unit[] {
    const enemies = this.units.filter((x) => isTargetable(x) && x.team !== u.team);
    const allies = this.units.filter((x) => x.alive && x.team === u.team);
    switch (mode) {
      case 'self':
        return [u];
      case 'currentTarget': {
        const t = this.unitByUid(u.targetUid);
        return t && t.alive ? [t] : this.pickNearestEnemy(u);
      }
      case 'enemyNearest':
        return this.pickNearestEnemy(u);
      case 'enemyLowestHp':
        return this.sliceBy(enemies, (a, b) => a.hp / a.maxHp - b.hp / b.maxHp, count);
      case 'enemyHighestAtk':
        return this.sliceBy(enemies, (a, b) => effAtk(b) - effAtk(a), count);
      case 'enemyFarthest':
        return this.sliceBy(enemies, (a, b) => chebyshev(b.cell, u.cell) - chebyshev(a.cell, u.cell), count);
      case 'allyLowestHp':
        return this.sliceBy(allies, (a, b) => a.hp / a.maxHp - b.hp / b.maxHp, count);
      case 'allAllies':
        return allies;
      case 'allEnemies':
        return enemies;
      case 'deadAlly':
        return this.units.filter((x) => !x.alive && x.team === u.team && !x.isMinion);
      default:
        return [];
    }
  }

  private sliceBy(list: Unit[], cmp: (a: Unit, b: Unit) => number, count: number): Unit[] {
    const sorted = [...list].sort(cmp);
    return count >= sorted.length ? sorted : sorted.slice(0, count);
  }

  /** 最近敌人：用 BFS 距离场，避免把"隔着人墙"的敌人误判为最近 */
  private pickNearestEnemy(u: Unit): Unit[] {
    const enemies = this.units.filter((x) => isTargetable(x) && x.team !== u.team);
    if (enemies.length === 0) return [];
    const field = this.distanceField(u);
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const e of enemies) {
      let d = field[cellIndex(e.cell.c, e.cell.r)];
      if (d < 0) {
        // 目标格被自身占据，取周围最小可达距离
        d = Infinity;
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const c = e.cell.c + dc;
          const r = e.cell.r + dr;
          if (!inBounds(c, r)) continue;
          const v = field[cellIndex(c, r)];
          if (v >= 0 && v < d) d = v;
        }
      }
      if (d < 0) d = 999;
      // 嘲讽优先级最高
      const taunted = e.statuses.some((s) => s.kind === 'taunt');
      const score = taunted ? d - 100 : d;
      if (score < bestD || (score === bestD && best && e.uid < best.uid)) {
        bestD = score;
        best = e;
      }
    }
    return best ? [best] : [];
  }

  private _distScratch: Int16Array | null = null;
  private _queueScratch: Int16Array | null = null;
  /**
   * 从 u 出发的 BFS 距离场（-1 = 不可达）— L8：复用 scratch buffer，零分配热路径。
   * 返回的是内部缓冲：仅当次调用有效，下一次 distanceField 会覆盖 —— 禁止缓存
   * 或跨调用持有（当前唯一调用方 pickNearestEnemy 即取即用）。
   */
  private distanceField(u: Unit): Int16Array {
    const dist = this._distScratch ?? new Int16Array(BOARD_COLS * BOARD_ROWS);
    this._distScratch = dist;
    dist.fill(-1);
    const startIdx = cellIndex(u.cell.c, u.cell.r);
    dist[startIdx] = 0;
    const queue = this._queueScratch ?? new Int16Array(BOARD_COLS * BOARD_ROWS);
    this._queueScratch = queue;
    let head = 0;
    let tail = 0;
    queue[tail++] = startIdx;
    while (head < tail) {
      const cur = queue[head++];
      const cc = cur % BOARD_COLS;
      const cr = (cur - cc) / BOARD_COLS;
      const d = dist[cur];
      for (let i = 0; i < 8; i++) {
        const off = NEIGHBOR_OFFSETS[i];
        const nc = cc + off[0];
        const nr = cr + off[1];
        if (!inBounds(nc, nr)) continue;
        const ni = cellIndex(nc, nr);
        if (dist[ni] !== -1) continue;
        const occUid = this.occ[ni];
        if (occUid !== -1 && occUid !== u.uid) continue;
        dist[ni] = d + 1;
        queue[tail++] = ni;
      }
    }
    return dist;
  }

  resolveTargetCell(u: Unit, mode: TargetMode): Cell {
    switch (mode) {
      case 'self':
        return u.cell;
      case 'enemyDensest':
        return this.densestEnemyCell(u, 1);
      case 'enemyHalfBoard':
        return this.enemyHalfBoardCell(u);
      case 'enemyLongestLine':
        return this.longestLineEndpoint(u);
      default: {
        const t = this.resolveTargets(u, mode, 1)[0];
        return t ? t.cell : u.cell;
      }
    }
  }

  /** 敌人最密集的格子（邻域计分，平局取行优先的最小格） */
  private densestEnemyCell(u: Unit, radius: number): Cell {
    const foes = this.units.filter((x) => x.alive && x.team !== u.team);
    if (foes.length === 0) return u.cell;
    return densest(foes, radius);
  }

  private enemyHalfBoardCell(u: Unit): Cell {
    const foes = this.units.filter((x) => x.alive && x.team !== u.team);
    if (foes.length === 0) return u.cell;
    let sc = 0;
    let sr = 0;
    for (const f of foes) {
      sc += f.cell.c;
      sr += f.cell.r;
    }
    return { c: Math.round(sc / foes.length), r: Math.round(sr / foes.length) };
  }

  /** 找一个能贯穿最多敌人的方向，返回该方向末端格 */
  private longestLineEndpoint(u: Unit): Cell {
    const foes = this.units.filter((x) => x.alive && x.team !== u.team);
    if (foes.length === 0) return u.cell;
    const dirs: [number, number][] = [
      [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1],
    ];
    let bestDir = dirs[0];
    let bestCount = -1;
    let bestDist = Infinity;
    for (const [dc, dr] of dirs) {
      let count = 0;
      let dist = Infinity;
      for (let i = 1; i <= 8; i++) {
        const c = u.cell.c + dc * i;
        const r = u.cell.r + dr * i;
        if (!inBounds(c, r)) break;
        if (foes.some((f) => f.cell.c === c && f.cell.r === r)) {
          count++;
          if (i < dist) dist = i;
        }
      }
      if (count > bestCount || (count === bestCount && dist < bestDist)) {
        bestCount = count;
        bestDist = dist;
        bestDir = [dc, dr];
      }
    }
    let c = u.cell.c;
    let r = u.cell.r;
    for (let i = 1; i <= 8; i++) {
      const nc = u.cell.c + bestDir[0] * i;
      const nr = u.cell.r + bestDir[1] * i;
      if (!inBounds(nc, nr)) break;
      c = nc;
      r = nr;
    }
    return { c, r };
  }

  // ───────────────── 数值结算 ─────────────────

  dealDamage(src: Unit | null, dst: Unit, raw: number, type: DamageType, opts: DamageOptions = {}): number {
    if (!dst.alive || raw <= 0) return 0;
    const source = opts.source ?? 'skill';

    // 无敌
    if (dst.statuses.some((s) => s.kind === 'invuln')) {
      if (!opts.silent) {
        this.emit({
          t: 'damage',
          tick: this.tick,
          srcUid: src?.uid ?? -1,
          dstUid: dst.uid,
          amount: 0,
          type,
          crit: false,
          kill: false,
          source,
        });
      }
      return 0;
    }

    let amount = raw * (1 + (src?.damageAmp ?? 0)) * (1 + this.overtimeAmp());

    // 暴击：唯一的结算点。调用方若已掷骰（普攻 / 神射必爆），以 forceCrit 传入结果，
    // 此处只乘一次倍率、不再掷骰 —— 否则暴伤变成倍率的平方、暴击率变成 1-(1-p)²。
    // canCrit=true 表示"由这里掷骰"（如机关第 4 击的附加物伤）。
    let crit = false;
    const callerDecided = opts.forceCrit === true;
    const canCrit = callerDecided || opts.canCrit === true;
    if (src && canCrit) {
      crit = callerDecided || this.rng.chance(Math.max(0, src.critChance));
      if (crit) amount *= src.critMult;
    }

    // 易伤
    let vuln = 0;
    for (const s of dst.statuses) if (s.kind === 'vulnerability') vuln += s.value;
    amount *= 1 + vuln / 100;

    // 抗性
    if (type === 'physical') {
      let armor = effArmor(dst);
      if (src) armor *= 1 - Math.min(0.85, src.trait.armorPen);
      amount *= RESIST_BASE / (RESIST_BASE + armor);
      amount *= 1 - Math.min(0.9, dst.trait.physicalDr);
    } else if (type === 'magic') {
      amount *= RESIST_BASE / (RESIST_BASE + effMr(dst));
      amount *= 1 - Math.min(0.9, dst.trait.magicDr);
    }

    // 通用减伤：真伤按契约无视抗性与减伤（易伤是增伤，仍然生效）
    if (type !== 'true') {
      let dr = dst.trait.allDr;
      for (const s of dst.statuses) if (s.kind === 'dr') dr += s.value / 100;
      amount *= 1 - Math.min(0.9, dr);
    }
    if (amount < 0) amount = 0;

    // M2「机制软化」：真伤单跳上限。
    // 真伤无视抗性与减伤，是数值上唯一无法反制的输出通道；不设上限时，
    // 大额真伤一跳可达目标 maxHp 的数倍（诊断：亡语对后期最大单跳 ≈4.5×maxHp）。
    // 钳制点必须在抗性/减伤结算之后、护盾吸收之前 —— 对"结算后的最终数值"封顶。
    // 处决类技能的斩杀一跳经 ignoreTrueCap 豁免（见 DamageOptions）。
    if (type === 'true' && !opts.ignoreTrueCap && MECH.trueHitCapRatio > 0) {
      const cap = dst.maxHp * MECH.trueHitCapRatio;
      if (amount > cap) amount = cap;
    }

    // 护盾吸收
    let absorbed = 0;
    if (dst.shield > 0) {
      absorbed = Math.min(dst.shield, amount);
      dst.shield -= absorbed;
      amount -= absorbed;
      this.emit({ t: 'shield', tick: this.tick, uid: dst.uid, amount: -absorbed, total: dst.shield });
      if (dst.shield <= 0.001) {
        dst.shield = 0;
        // 护盾数值归零，对应的 shield 状态必须同生共死地移除。
        // 此前只清数值不清状态：残留的 shield 状态带着破碎前的 value 一直挂到
        // 到期为止，① 渲染层据此画出一条已经归零的护盾条；② 期间再次 addShield
        // 会命中 existing 分支，把新数值写进这条过期状态 —— 数值与状态互相污染。
        // 先清理再触发 onShieldBreak，让钩子看到一个干净状态（可安全重新上盾）。
        const n = dst.statuses.length;
        dst.statuses = dst.statuses.filter((s) => s.kind !== 'shield');
        if (dst.statuses.length !== n) {
          this.emit({ t: 'status', tick: this.tick, uid: dst.uid, kind: 'shield', dur: 0, value: 0, added: false });
        }
        for (const fn of this.hooks.get(dst.team)?.onShieldBreak ?? []) fn(this, dst);
      }
    }

    const before = dst.hp;
    dst.hp -= amount;
    const hpLoss = before - dst.hp;
    const final = hpLoss + absorbed;

    dst.takenDamage += final;
    if (src) src.dealtDamage += final;

    // 受击回蓝
    const manaGain = Math.min(MANA_FROM_DAMAGE_CAP, (final / dst.maxHp) * MANA_FROM_DAMAGE_RATIO);
    if (!dst.isMinion && dst.manaLock <= 0) {
      dst.mp = Math.min(dst.maxMp, dst.mp + manaGain);
    }

    // 吸血语义：普攻 = 普攻吸血 + 全能吸血；其余伤害（技能/DoT/反伤）只吃全能吸血
    if (src && final > 0) {
      const pct = opts.isAttack === true ? src.lifesteal + src.omnivamp : src.omnivamp;
      if (pct > 0) this.heal(src, src, final * pct, 'trait');
    }

    const kill = dst.hp <= 0;
    if (!opts.silent) {
      this.emit({
        t: 'damage',
        tick: this.tick,
        srcUid: src?.uid ?? -1,
        dstUid: dst.uid,
        amount: Math.round(final),
        type,
        crit,
        kill,
        source,
      });
    }

    for (const fn of this.hooks.get(src?.team ?? -1)?.onDamageDealt ?? []) {
      if (src) fn(this, src, dst, final, type, source);
    }
    for (const fn of this.hooks.get(dst.team)?.onDamageTaken ?? []) fn(this, dst, src, final, type, opts);

    if (kill) this.killUnit(dst, src);
    return final;
  }

  heal(src: Unit | null, dst: Unit, amount: number, source: 'skill' | 'trait' | 'item'): number {
    if (!dst.alive || amount <= 0) return 0;
    let amt = amount * (1 + (src?.trait.healAmp ?? 0));
    let wound = 0;
    for (const s of dst.statuses) if (s.kind === 'wound') wound += s.value;
    amt *= 1 - Math.min(0.9, wound / 100);
    const before = dst.hp;
    dst.hp = Math.min(dst.maxHp, dst.hp + amt);
    const healed = dst.hp - before;
    const overflow = Math.max(0, amt - healed);
    dst.healed += healed;
    if (src) src.healed += healed;
    if (healed > 0.5) {
      this.emit({ t: 'heal', tick: this.tick, srcUid: src?.uid ?? -1, dstUid: dst.uid, amount: Math.round(healed) });
    }
    if (overflow > 0.5) {
      for (const fn of this.hooks.get(dst.team)?.onHealOverflow ?? []) fn(this, dst, src, overflow);
    }
    void source;
    return healed;
  }

  /**
   * 护盾口径（渲染层与测试照此消费）：unit.shield 为当前总量；shield 事件的
   * amount 是本次增量、total 是累加后总量；shield 状态的 value 存总量。
   * 续盾是"刷新"而非"叠加"：时长取剩余与新增的较大者，数值并入总量。
   */
  addShield(src: Unit | null, dst: Unit, amount: number, dur: number): void {
    if (!dst.alive || amount <= 0) return;
    const amt = amount * (1 + (src?.trait.shieldAmp ?? 0));
    const before = dst.shield;
    dst.shield = Math.min(dst.shield + amt, dst.maxHp * SHIELD_CAP_RATIO);
    const added = dst.shield - before;
    // 护盾以"持续状态"形式存在，到期时清空
    const existing = dst.statuses.find((s) => s.kind === 'shield');
    if (existing) {
      existing.ticks = Math.max(existing.ticks, Math.round(dur * TICK_RATE));
      existing.value = dst.shield;
    } else {
      dst.statuses.push({ kind: 'shield', ticks: Math.round(dur * TICK_RATE), value: dst.shield, srcUid: src?.uid ?? -1 });
    }
    this.emit({ t: 'shield', tick: this.tick, uid: dst.uid, amount: Math.round(added), total: Math.round(dst.shield) });
    this.emit({ t: 'status', tick: this.tick, uid: dst.uid, kind: 'shield', dur, value: Math.round(amt), added: true });
  }

  addStatus(src: Unit, dst: Unit, kind: StatusKind, dur: number, value: number): void {
    if (!dst.alive) return;
    if (CONTROL_KINDS.has(kind) && (dst.ccImmune > 0 || dst.statuses.some((s) => s.kind === 'ccImmune'))) return;
    const ticks = Math.max(1, Math.round(dur * TICK_RATE));
    if (!STACKABLE_KINDS.has(kind)) {
      const existing = dst.statuses.find((s) => s.kind === kind);
      if (existing) {
        existing.ticks = Math.max(existing.ticks, ticks);
        existing.value = Math.max(existing.value, value);
        existing.srcUid = src.uid;
        this.emit({ t: 'status', tick: this.tick, uid: dst.uid, kind, dur, value, added: true });
        return;
      }
    }
    dst.statuses.push({ kind, ticks, value, srcUid: src.uid });
    this.emit({ t: 'status', tick: this.tick, uid: dst.uid, kind, dur, value, added: true });
  }

  removeStatus(u: Unit, kind: StatusKind): void {
    u.statuses = u.statuses.filter((s) => s.kind !== kind);
    this.emit({ t: 'status', tick: this.tick, uid: u.uid, kind, dur: 0, value: 0, added: false });
  }

  addDot(src: Unit, dst: Unit, kind: 'burn' | 'bleed', dps: number, dur: number, type: DamageType): void {
    if (!dst.alive || dps <= 0) return;
    // 结算类型随状态走（burn=法术、bleed 由调用方定，山海传 'true'），
    // 不能在 tickDots 里按 kind 硬编码 —— 否则"流血走真实伤害"的设计失效
    dst.statuses.push({ kind, ticks: Math.round(dur * TICK_RATE), value: dps, srcUid: src.uid, dtype: type });
    this.emit({ t: 'status', tick: this.tick, uid: dst.uid, kind, dur, value: Math.round(dps), added: true });
    this.emit({ t: 'fx', tick: this.tick, kind: kind === 'burn' ? 'burnTick' : 'bleedTick', uid: dst.uid });
  }

  // ───────────────── 位移 / 召唤 / 复活 ─────────────────

  teleport(u: Unit, cell: Cell, dur: number): void {
    if (!u.alive) return;
    // 落点被占（典型：跃向敌阵最密集处）时改落就近空格；满盘找不到则取消位移。
    // 无条件覆写 occ 会把占格单位变成"幽灵"，占位表从此不可信。
    let dest = cell;
    if (this.occ[cellIndex(cell.c, cell.r)] !== -1) {
      const free = this.nearestFreeCellTo(cell, 3);
      if (!free) return;
      dest = free;
    }
    const from = { c: u.cell.c, r: u.cell.r };
    this.occ[cellIndex(from.c, from.r)] = -1;
    u.cell = { c: dest.c, r: dest.r };
    this.occ[cellIndex(dest.c, dest.r)] = u.uid;
    u.moveFrom = from;
    u.moveTo = { c: dest.c, r: dest.r };
    u.moveT = 0;
    u.moveDur = dur;
    this.emit({ t: 'blink', tick: this.tick, uid: u.uid, from, to: { c: dest.c, r: dest.r }, dur });
  }

  /** 距 origin 切比雪夫 ring 内最近的空格（找不到返回 null） */
  private nearestFreeCellTo(origin: Cell, maxRing: number): Cell | null {
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
          const c = origin.c + dc;
          const r = origin.r + dr;
          if (!inBounds(c, r)) continue;
          if (this.occ[cellIndex(c, r)] === -1) return { c, r };
        }
      }
    }
    return null;
  }

  knockback(u: Unit, from: Cell, distance: number): void {
    if (!u.alive) return;
    const dc = Math.sign(u.cell.c - from.c);
    const dr = Math.sign(u.cell.r - from.r);
    for (let i = distance; i >= 1; i--) {
      const c = u.cell.c + dc * i;
      const r = u.cell.r + dr * i;
      if (!inBounds(c, r)) continue;
      if (this.occ[cellIndex(c, r)] !== -1) continue;
      this.teleport(u, { c, r }, 0.18);
      return;
    }
  }

  summon(src: Unit, cell: Cell, hpPct: number, atkPct: number, _name: string): Unit | null {
    if (this.units.length >= 64) return null;
    // 落点防护下沉到内核：与 teleport() 同一口径。
    // 此前这里直接覆写 occ —— 越界写会写到表外、占格写会把原单位变成"幽灵"，
    // 恰好违反本文件与 grid.ts 反复声明的"占位表不可腐坏"不变量。
    // 之前唯一没出事的原因是调用方（skills.ts 的 summon 实现）在调用前自查了
    // occupied；把架构级不变量的守护放在调用方，等于给每个未来的召唤路径埋雷。
    if (!inBounds(cell.c, cell.r)) return null;
    let dest = cell;
    if (this.occ[cellIndex(cell.c, cell.r)] !== -1) {
      const free = this.nearestFreeCellTo(cell, 3);
      if (!free) return null;
      dest = free;
    }
    const uid = this.nextUid++;
    const m = createMinion(uid, src, dest, hpPct, atkPct);
    this.units.push(m);
    this.occ[cellIndex(dest.c, dest.r)] = uid;
    this.emit({
      t: 'start',
      tick: this.tick,
      units: [
        {
          uid,
          defId: src.entry.id,
          team: src.team,
          star: 1,
          cell: { c: dest.c, r: dest.r },
          maxHp: m.maxHp,
          hp: m.hp,
        },
      ],
    });
    return m;
  }

  revive(u: Unit, hpPct: number, src: Unit): void {
    if (u.alive) return;
    // Reserve a destination before changing state. A failed revive must remain
    // a complete death state rather than creating an alive, unoccupied unit.
    let dest = this.nearestFreeCellTo(src.cell, 3);
    if (!dest) {
      for (let r = 0; r < BOARD_ROWS && !dest; r++) {
        for (let c = 0; c < BOARD_COLS && !dest; c++) {
          if (this.occ[cellIndex(c, r)] === -1) dest = { c, r };
        }
      }
    }
    if (!dest) return;

    u.alive = true;
    u.revived = true;
    u.hp = Math.max(1, Math.round(u.maxHp * hpPct));
    u.statuses = [];
    u.shield = 0;
    u.mp = u.maxMp;
    u.attackCd = 0;
    u.windupLeft = 0;
    u.castWindupLeft = 0;
    u.moveFrom = null;
    u.moveTo = null;
    u.moveT = 0;
    u.moveDur = 0;
    u.moveCd = 0;
    u.retargetCd = 0;
    u.targetUid = -1;
    u.cell = dest;
    this.occ[cellIndex(dest.c, dest.r)] = u.uid;
    this.emit({ t: 'heal', tick: this.tick, srcUid: src.uid, dstUid: u.uid, amount: u.hp });
  }

  addZone(o: ZoneOptions): void {
    this.zones.push({ ...o, id: this.zoneId++, endsAtTick: this.tick + Math.round(o.dur * TICK_RATE) });
  }

  schedule(delaySeconds: number, fn: (api: BattleApi) => void): void {
    this.scheduled.push({ atTick: this.tick + Math.max(1, Math.round(delaySeconds * TICK_RATE)), seq: this.seq++, fn });
  }

  // ───────────────── 死亡 ─────────────────

  private killUnit(u: Unit, killer: Unit | null): void {
    if (!u.alive) return;
    u.hp = 0;
    u.alive = false;
    u.shield = 0;
    u.statuses = [];
    u.windupLeft = 0;
    u.castWindupLeft = 0;
    const idx = cellIndex(u.cell.c, u.cell.r);
    if (this.occ[idx] === u.uid) this.occ[idx] = -1;
    if (killer) killer.kills++;
    this.emit({ t: 'death', tick: this.tick, uid: u.uid, killerUid: killer?.uid ?? -1 });
    if (killer) {
      for (const fn of this.hooks.get(killer.team)?.onKill ?? []) fn(this, killer, u);
      for (const h of killer.killHandlers) h(this, u);
    }
    for (const fn of this.hooks.get(u.team)?.onDeath ?? []) fn(this, u, killer);
  }

  // ───────────────── 主循环 ─────────────────

  step(): void {
    if (this.finished) return;
    this.tick++;

    // 1) 队伍钩子（L6：缓存排序，1200 tick×分配+排序 → O(1)）
    for (const team of this.sortedTeams) {
      const h = this.hooks.get(team)!;
      for (const fn of h.onTick) fn(this, team, this.tick);
    }

    // 2) 状态计时 + 持续效果
    this.tickStatuses();
    if (this.tick % EFFECT_INTERVAL === 0) {
      this.tickDots();
      this.tickZones();
    }

    // 3) 延迟任务（按 (tick, seq) 排序，保证确定）
    if (this.scheduled.length > 0) {
      const due = this.scheduled.filter((t) => t.atTick <= this.tick);
      if (due.length > 0) {
        this.scheduled = this.scheduled.filter((t) => t.atTick > this.tick);
        due.sort((a, b) => a.atTick - b.atTick || a.seq - b.seq);
        for (const t of due) t.fn(this);
      }
    }

    // 4) 单位行为（uid 升序，确定性关键）
    // units 构造时即按 uid 升序、召唤物以递增 uid 追加 —— 有序性是构造不变量，
    // 这里按快照长度遍历即可（召唤物不在出生 tick 内行动，与原快照语义一致），无需排序拷贝。
    // 奇数 tick 反向遍历：uid 升序意味着 team 0 永远先结算（先手攻击、先手击杀），
    // 固定顺序会积累成约 10 个百分点的站位偏差 —— 逐拍轮换把它抹平，且保持完全确定。
    const count = this.units.length;
    const reverse = this.tick % 2 === 1;
    for (let k = 0; k < count; k++) {
      const u = this.units[reverse ? count - 1 - k : k];
      if (!u.alive || this.finished) continue;
      this.updateUnit(u);
    }

    // 5) 结算判定
    this.checkEnd();
  }

  private updateUnit(u: Unit): void {
    // 移动插值推进
    if (u.moveDur > 0) {
      u.moveT += DT;
      if (u.moveT >= u.moveDur) {
        u.moveT = u.moveDur;
        u.moveDur = 0;
      }
    }

    // 回蓝 / 自然回复
    if (u.manaLock > 0) u.manaLock -= DT;
    else if (!u.isMinion) u.mp = Math.min(u.maxMp, u.mp + (MANA_REGEN_PER_SEC + u.trait.manaPerSec) * DT);
    if (u.trait.hpRegenPctPerSec > 0 && u.hp < u.maxHp) {
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * u.trait.hpRegenPctPerSec * DT);
    }

    if (u.moveCd > 0) u.moveCd -= DT;
    if (u.attackCd > 0) u.attackCd -= DT;
    if (u.retargetCd > 0) u.retargetCd -= DT;

    // 攻击前摇进行中
    if (u.windupLeft > 0) {
      u.windupLeft -= DT;
      if (u.windupLeft <= 0) this.resolveAttack(u);
      return;
    }

    // 吟唱中
    if (u.castWindupLeft > 0) {
      u.castWindupLeft -= DT;
      if (u.castWindupLeft <= 0) this.resolveCast(u);
      return;
    }

    // 控制判定
    const stunned = u.statuses.some((s) => s.kind === 'stun');
    if (stunned) return;

    // 施法
    if (!u.isMinion && u.mp >= u.maxMp && !u.statuses.some((s) => s.kind === 'silence')) {
      u.castWindupLeft = CAST_WINDUP_SECONDS;
      this.emit({
        t: 'castStart',
        tick: this.tick,
        uid: u.uid,
        skillId: u.entry.skill,
        windup: CAST_WINDUP_SECONDS,
      });
      return;
    }

    // 选目标
    if (u.retargetCd <= 0 || u.targetUid < 0) {
      const t = this.pickNearestEnemy(u)[0];
      u.targetUid = t ? t.uid : -1;
      u.retargetCd = RETARGET_INTERVAL;
      if (!t) return;
    }
    const target = this.unitByUid(u.targetUid);
    if (!target || !target.alive) {
      u.targetUid = -1;
      u.retargetCd = 0;
      return;
    }

    const dist = chebyshev(u.cell, target.cell);
    if (dist <= u.range) {
      if (u.attackCd <= 0 && !u.statuses.some((s) => s.kind === 'disarm')) {
        this.beginAttack(u, target);
      }
      return;
    }

    // 移动
    if (u.moveCd > 0) return;
    const next = stepTowardAttackPosition(u.cell, target.cell, u.range, (c, r) => this.occupied(c, r));
    if (!next) {
      u.moveCd = 0.2;
      return;
    }
    const from = { c: u.cell.c, r: u.cell.r };
    this.occ[cellIndex(from.c, from.r)] = -1;
    u.cell = { c: next.c, r: next.r };
    this.occ[cellIndex(next.c, next.r)] = u.uid;
    u.moveFrom = from;
    u.moveTo = { c: next.c, r: next.r };
    u.moveT = 0;
    u.moveDur = effMoveTime(u);
    u.moveCd = u.moveDur;
    this.emit({ t: 'move', tick: this.tick, uid: u.uid, from, to: { c: next.c, r: next.r }, dur: u.moveDur });
  }

  private beginAttack(u: Unit, target: Unit): void {
    const interval = 1 / effAspd(u);
    const windup = interval * ATTACK_WINDUP_RATIO;
    u.attackCd = interval;
    u.windupLeft = windup;
    u.windupTotal = windup;
    u.windupTargetUid = target.uid;
    const isRanged = u.range > 1;
    this.emit({
      t: 'attackStart',
      tick: this.tick,
      uid: u.uid,
      targetUid: target.uid,
      windup,
      isRanged,
    });
    if (isRanged) {
      this.emit({
        t: 'projectile',
        tick: this.tick,
        uid: u.uid,
        targetUid: target.uid,
        from: { c: u.cell.c, r: u.cell.r },
        to: { c: target.cell.c, r: target.cell.r },
        dur: windup,
        kind: u.range >= 4 ? 'arrow' : 'orb',
      });
    }
  }

  private resolveAttack(u: Unit): void {
    const target = this.unitByUid(u.windupTargetUid);
    u.windupLeft = 0;
    if (!target || !target.alive) return;

    const mod: AttackModifier = { forceCrit: false, bonusMagic: 0, bonusPhysical: 0 };
    for (const fn of this.hooks.get(u.team)?.onPreAttack ?? []) fn(this, u, target, mod);

    // 龙渊「施法附魔」
    const chargeIdx = u.statuses.findIndex((s) => s.kind === 'spellCharge');
    if (chargeIdx >= 0) {
      mod.bonusMagic += u.statuses[chargeIdx].value;
      u.statuses.splice(chargeIdx, 1);
    }

    const base = effAtk(u);
    // 暴击只在这里掷一次骰，倍率交由 dealDamage 统一结算（forceCrit 传入结果）
    const crit = mod.forceCrit || this.rng.chance(Math.max(0, u.critChance));
    this.fx('impact', { uid: u.uid, targetUid: target.uid, params: { crit: crit ? 1 : 0 } });
    const dealt = this.dealDamage(u, target, base, 'physical', {
      source: 'attack',
      isAttack: true,
      canCrit: false,
      forceCrit: crit,
    });
    if (mod.bonusMagic > 0) {
      this.dealDamage(u, target, mod.bonusMagic, 'magic', { source: 'trait' });
      this.fx('impact', { uid: u.uid, targetUid: target.uid, params: { hue: 2 } });
    }
    if (mod.bonusPhysical > 0) {
      // 附加物伤（机关第 4 击等）保持可暴击：canCrit 交给 dealDamage 掷骰
      this.dealDamage(u, target, mod.bonusPhysical, 'physical', { source: 'trait', isAttack: true, canCrit: true });
      this.fx('impact', { uid: u.uid, targetUid: target.uid, params: { hue: 0 } });
    }

    u.attackCount++;
    if (!u.isMinion && u.manaLock <= 0) {
      u.mp = Math.min(u.maxMp, u.mp + MANA_PER_ATTACK);
      this.emit({ t: 'mana', tick: this.tick, uid: u.uid, mp: u.mp, maxMp: u.maxMp });
    }
    for (const fn of this.hooks.get(u.team)?.onAttackHit ?? []) fn(this, u, target, dealt, 'physical');
  }

  private resolveCast(u: Unit): void {
    u.castWindupLeft = 0;
    if (!u.alive) return;
    u.mp = 0;
    u.manaLock = MANA_LOCK_AFTER_CAST;
    u.castCount++;
    this.emit({ t: 'cast', tick: this.tick, uid: u.uid, skillId: u.entry.skill, params: { star: u.star } });
    executeSkill(this, u);
    for (const fn of this.hooks.get(u.team)?.onCast ?? []) fn(this, u);
  }

  private tickStatuses(): void {
    for (const u of this.units) {
      if (!u.alive || u.statuses.length === 0) continue;
      let shieldExpired = false;
      for (const s of u.statuses) s.ticks--;
      u.statuses = u.statuses.filter((s) => {
        if (s.ticks > 0) return true;
        if (s.kind === 'shield') shieldExpired = true;
        this.emit({ t: 'status', tick: this.tick, uid: u.uid, kind: s.kind, dur: 0, value: 0, added: false });
        return false;
      });
      if (shieldExpired) u.shield = 0;
    }
  }

  private tickDots(): void {
    const dt = 1 / DOT_TICKS_PER_SEC;
    // killUnit 不会从 units 里摘除单位，遍历中不存在增删，无需拷贝
    for (const u of this.units) {
      if (!u.alive) continue;
      for (const s of u.statuses) {
        if (s.kind !== 'burn' && s.kind !== 'bleed') continue;
        const src = this.unitByUid(s.srcUid);
        const type: DamageType = s.dtype ?? (s.kind === 'burn' ? 'magic' : 'physical');
        this.emit({ t: 'fx', tick: this.tick, kind: s.kind === 'burn' ? 'burnTick' : 'bleedTick', uid: u.uid });
        this.dealDamage(src, u, s.value * dt, type, { source: 'dot' });
      }
    }
  }

  private tickZones(): void {
    if (this.zones.length === 0) return;
    const dt = 1 / DOT_TICKS_PER_SEC;
    for (const z of this.zones) {
      if (z.followUid !== undefined) {
        const f = this.unitByUid(z.followUid);
        if (f && f.alive) z.cell = { c: f.cell.c, r: f.cell.r };
      }
      if (z.dps > 0) {
        const src = this.unitByUid(z.srcUid);
        for (const e of this.unitsInRadius(z.cell, z.radius)) {
          if (e.team === z.team) continue;
          this.dealDamage(src, e, z.dps * dt, z.type, { source: 'trait' });
        }
      }
      if (z.status) {
        const src = this.unitByUid(z.srcUid);
        if (src) {
          for (const e of this.unitsInRadius(z.cell, z.radius)) {
            if (e.team === z.team) continue;
            this.addStatus(src, e, z.status.kind, z.status.dur, z.status.value);
          }
        }
      }
      if (this.tick % (TICK_RATE * 2) === 0) this.fx(z.fx ?? 'groundMark', { cell: z.cell, radius: z.radius });
    }
    this.zones = this.zones.filter((z) => z.endsAtTick > this.tick);
  }

  private checkEnd(): void {
    if (this.finished) return;
    const aliveByTeam = new Map<TeamId, number>();
    for (const u of this.units) {
      if (!u.alive) continue;
      aliveByTeam.set(u.team, (aliveByTeam.get(u.team) ?? 0) + 1);
    }
    if (aliveByTeam.size === 1) {
      const winner = [...aliveByTeam.keys()][0];
      this.finish(winner, false);
      return;
    }
    if (aliveByTeam.size === 0) {
      this.finish(null, false);
      return;
    }
    if (this.tick >= this.maxTicks) {
      // 超时裁定。口径与 finish 的记录一致：只算非召唤物（isMinion）——
      // 召唤物撑血不能算赢，冠军全灭也不能靠召唤物续命。
      const ratio: Record<number, number> = {};
      const champAlive = new Map<TeamId, number>();
      for (const [team] of aliveByTeam) {
        const units = this.units.filter((u) => u.team === team && !u.isMinion);
        champAlive.set(team, units.filter((u) => u.alive).length);
        const cur = units.reduce((s, u) => s + Math.max(0, u.hp), 0);
        const max = units.reduce((s, u) => s + u.maxHp, 0);
        ratio[team] = max > 0 ? cur / max : 0;
      }
      // 按剩余生命比例裁定。排序必须按 ratio 本身 —— 按队伍号排会把
      // "低号队伍血量领先"的超时局全部误判成平局，污染所有平衡数据
      const teams = Object.keys(ratio).map(Number).sort((a, b) => ratio[b] - ratio[a]);
      let winner: TeamId | null;
      if (teams.length < 2) {
        // 防御（ratio 对每个在场队恒有键，此分支正常不可达）：现存队冠军有活口才判胜
        winner = teams.length === 1 && (champAlive.get(teams[0]) ?? 0) > 0 ? teams[0] : null;
      } else if ((champAlive.get(teams[0]) ?? 0) > 0 && (champAlive.get(teams[1]) ?? 0) === 0) {
        // 一方冠军全灭、仅召唤物存活：冠军存活方直接胜，不比血量比例
        winner = teams[0];
      } else {
        winner = ratio[teams[0]] - ratio[teams[1]] > TIMEOUT_WIN_RATIO ? teams[0] : null;
      }
      this.finish(winner, true);
    }
  }

  private finish(winner: TeamId | null, timeout: boolean): void {
    this.finished = true;
    const survivors: Record<number, number[]> = {};
    const remainingHpRatio: Record<number, number> = {};
    const byTeam = new Map<TeamId, Unit[]>();
    for (const u of this.units) if (!u.isMinion) {
      let arr = byTeam.get(u.team);
      if (!arr) { arr = []; byTeam.set(u.team, arr); }
      arr.push(u);
    }
    for (const [team, teamUnits] of byTeam) {
      if (!survivors[team]) survivors[team] = [];
      for (const u of teamUnits) if (u.alive) survivors[team].push(u.uid);
      const cur = teamUnits.reduce((s, x) => s + Math.max(0, x.hp), 0);
      const max = teamUnits.reduce((s, x) => s + x.maxHp, 0);
      remainingHpRatio[team] = max > 0 ? cur / max : 0;
    }
    for (const u of this.units) if (u.isMinion && !(u.team in survivors)) survivors[u.team] = [];
    this.result = { winner, ticks: this.tick, survivors, remainingHpRatio, timeout };
    this.emit({ t: 'end', tick: this.tick, winner, timeout });
  }

  run(): BattleResult {
    let guard = 0;
    while (!this.finished && guard < this.maxTicks + 10) {
      this.step();
      guard++;
    }
    if (!this.result) this.finish(null, true);
    return this.result!;
  }
}

/** 敌人最密集格（供外部复用） */
export function densest(foes: readonly Unit[], radius: number): Cell {
  let best: Cell = { c: 0, r: 0 };
  let bestScore = -1;
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      let score = 0;
      for (const f of foes) {
        const d = chebyshev({ c, r }, f.cell);
        if (d <= radius) score += 1 + (radius - d);
      }
      if (score > bestScore) {
        bestScore = score;
        best = { c, r };
      }
    }
  }
  return best;
}
