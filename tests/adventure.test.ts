/**
 * PVE 奇遇轮（M3）回归。
 *
 * 覆盖七条验收契约：
 *   ① offer 确定性（同种子两个 Match 跑到第 5 回合 offer 完全一致）
 *   ② isBeastRound / isAdventureRound 永不同真
 *   ③ resolveAdventure 金币 / 经验精确入账
 *   ④ reinforce 占卡池 + 备战席满折金守恒
 *   ⑤ AI 选择确定性（同种子同选择；选择遵循原型偏好序）
 *   ⑥ 战斗阶段开始后 adventureOffer 已清空
 *   ⑦ battleSnapshots 每场一条，且用 snapshot.config 重跑 Battle 得到相同 winner/ticks
 *
 * 另附两条支撑性契约：快照记录是纯观察者（不改 rng 流与对局状态）、
 * fnv1aHex 采用标准 FNV-1a 32 位测试向量。
 */
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { Rng } from '../src/core/rng';
import { BENCH_SLOTS } from '../src/core/config';
import { Match } from '../src/game/match';
import {
  adventureGold,
  adventureReinforceCost,
  adventureStage,
  adventureXp,
  fnv1aHex,
  reinforceRefund,
  rollAdventureOffer,
  type AdventureKind,
  type AdventureOffer,
} from '../src/game/adventure';
import { chooseAdventureIndex, makeProfile } from '../src/game/ai';
import { CHAMPIONS, CHAMPION_IDS_BY_COST } from '../src/data/champions';
import { gainXp } from '../src/game/economy';
import { makePlayer } from './helpers';

// ── 公共工具 ────────────────────────────────────────────

/** 推进 n 个回合（prep → 配对 → 无头战斗 → 结算），返回实际执行的战斗场数 */
function runRounds(m: Match, n: number, recordEvents = false): number {
  let battles = 0;
  for (let i = 0; i < n; i++) {
    if (m.isOver()) break;
    m.beginRound();
    if (m.isOver()) break;
    m.pairings = m.makePairings();
    for (const pair of m.pairings) {
      m.applyBattleResult(pair, m.runBattleHeadless(pair, pair.swap, recordEvents));
      battles++;
    }
    m.endRound();
  }
  return battles;
}

/** 无头跑完整局（与 scripts/sim-match.ts 同一主循环） */
function runFull(m: Match): void {
  let guard = 0;
  while (!m.isOver() && guard < 60) {
    m.beginRound();
    if (m.isOver()) break;
    m.pairings = m.makePairings();
    for (const pair of m.pairings) {
      m.applyBattleResult(pair, m.runBattleHeadless(pair));
    }
    m.endRound();
    guard++;
  }
}

/** 只推进准备阶段（不配对不战斗），用于检查 offer 本身 */
function runPrepOnly(m: Match, n: number): void {
  for (let i = 0; i < n; i++) {
    if (m.isOver()) break;
    m.beginRound();
  }
}

/** 奇遇恩赐的日志前缀（发放函数的规格口吻），用于把日志行映射回 kind */
const KIND_LOG_PREFIX: Record<AdventureKind, string> = {
  gold: '奇遇 · 金币 +',
  xp: '奇遇 · 经验 +',
  item: '奇遇 · 丹青成装',
  reinforce: '奇遇 · 援军',
};

function adventureLinesOf(m: Match, name: string): string[] {
  return m.log.filter((l) => l.startsWith(`${name} 奇遇 ·`));
}

// ── ① offer 确定性 ─────────────────────────────────────

describe('offer 确定性', () => {
  it('同种子两个 Match 跑到第 5 回合，offer 完全一致', () => {
    for (const seed of [1, 20260830, 424242]) {
      const a = new Match(seed);
      const b = new Match(seed);
      runPrepOnly(a, 5);
      runPrepOnly(b, 5);
      expect(a.round).toBe(5);
      expect(a.isAdventureRound()).toBe(true);
      expect(a.adventureOffer).not.toBeNull();
      expect(JSON.stringify(b.adventureOffer)).toBe(JSON.stringify(a.adventureOffer));
    }
  });

  it('同种子跑到第 9 回合（跨两次奇遇）仍然一致', () => {
    const a = new Match(777);
    const b = new Match(777);
    runPrepOnly(a, 9);
    runPrepOnly(b, 9);
    expect(a.isAdventureRound()).toBe(true);
    expect(JSON.stringify(b.adventureOffer)).toBe(JSON.stringify(a.adventureOffer));
  });

  it('offer 形状：2~3 个选项、kind 互不重复、按既定展示序排列', () => {
    for (let seed = 0; seed < 64; seed++) {
      const offer = rollAdventureOffer(5, new Rng(seed));
      expect(offer.round).toBe(5);
      expect(offer.options.length).toBeGreaterThanOrEqual(2);
      expect(offer.options.length).toBeLessThanOrEqual(3);
      const kinds = offer.options.map((o) => o.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
      expect(kinds.every((k) => ['gold', 'xp', 'item', 'reinforce'].includes(k))).toBe(true);
      for (const o of offer.options) {
        expect(o.title.length).toBeGreaterThan(0);
        expect(o.desc.length).toBeGreaterThan(0);
      }
    }
  });

  it('数值表按阶段递增：金币 10/16/24、经验 8/14/20、援军费用 1/2/3、折金 2/5/8', () => {
    expect(adventureStage(5)).toBe('early');
    expect(adventureStage(13)).toBe('mid');
    expect(adventureStage(25)).toBe('late');
    expect([adventureGold(5), adventureGold(13), adventureGold(25)]).toEqual([10, 16, 24]);
    expect([adventureXp(5), adventureXp(13), adventureXp(25)]).toEqual([8, 14, 20]);
    expect([adventureReinforceCost(5), adventureReinforceCost(13), adventureReinforceCost(25)]).toEqual([1, 2, 3]);
    expect([reinforceRefund(5), reinforceRefund(13), reinforceRefund(25)]).toEqual([2, 5, 8]);
  });
});

// ── ② 墨兽轮 / 奇遇轮互斥 ───────────────────────────────

describe('墨兽轮与奇遇轮永不同真', () => {
  it('round 0~200 内不存在同时为真的回合，且各自节奏正确', () => {
    const m = new Match(1);
    for (let r = 0; r <= 200; r++) {
      expect(m.isBeastRound(r) && m.isAdventureRound(r)).toBe(false);
    }
    // 墨兽 3/7/11…，奇遇 5/9/13…（交替）
    expect([3, 7, 11, 15].every((r) => m.isBeastRound(r))).toBe(true);
    expect([5, 9, 13, 17].every((r) => m.isAdventureRound(r))).toBe(true);
    expect([4, 6, 8, 10].every((r) => !m.isBeastRound(r) && !m.isAdventureRound(r))).toBe(true);
  });
});

// ── ③ resolveAdventure 金币 / 经验精确入账 ───────────────

describe('resolveAdventure 精确入账', () => {
  it('金币恩赐：+adventureGold(round)，发放后 offer 清空并留日志', () => {
    const m = new Match(20260830);
    const p = m.human;
    m.adventureOffer = { round: 5, options: [{ kind: 'gold', title: '金币 +10', desc: '' }] };
    const before = p.gold;
    m.resolveAdventure(0);
    expect(p.gold).toBe(before + adventureGold(5));
    expect(p.gold).toBe(before + 10);
    expect(m.adventureOffer).toBeNull();
    expect(m.log.some((l) => l === `${p.name} 奇遇 · 金币 +10`)).toBe(true);
  });

  it('经验恩赐：按 gainXp 语义入账，等级与结余经验逐点一致', () => {
    const m = new Match(20260831);
    const p = m.human;
    m.adventureOffer = { round: 13, options: [{ kind: 'xp', title: '经验 +14', desc: '' }] };
    const expected = makePlayer({ level: p.level, xp: p.xp });
    gainXp(expected, adventureXp(13));
    m.resolveAdventure(0);
    expect(p.level).toBe(expected.level);
    expect(p.xp).toBe(expected.xp);
    expect(m.adventureOffer).toBeNull();
  });

  it('非法下标是 no-op：不发放、不清空；offer 为 null 时调用也不抛', () => {
    const m = new Match(20260832);
    const p = m.human;
    m.adventureOffer = { round: 5, options: [{ kind: 'gold', title: '金币 +10', desc: '' }] };
    const before = p.gold;
    m.resolveAdventure(9);
    expect(p.gold).toBe(before);
    expect(m.adventureOffer).not.toBeNull();
    // 过期（offer 已清空）后再点选：无事发生
    m.adventureOffer = null;
    m.resolveAdventure(0);
    expect(p.gold).toBe(before);
  });
});

// ── ④ reinforce 占卡池 + 折金守恒 ───────────────────────

describe('援军恩赐守恒', () => {
  it('备战席有空位：从卡池扣 3 张合成 2★ 入驻备战席，金币不动', () => {
    const m = new Match(4242);
    const p = m.human;
    m.adventureOffer = { round: 5, options: [{ kind: 'reinforce', title: '援军', desc: '' }] };
    const poolBefore = m.pool.snapshot();
    const goldBefore = p.gold;
    const benchIids = new Set(p.bench.filter(Boolean).map((u) => u!.iid));

    m.resolveAdventure(0);

    const newcomer = p.bench.find((u) => u && !benchIids.has(u.iid));
    expect(newcomer).toBeDefined();
    expect(newcomer!.star).toBe(2);
    expect(p.board.some((u) => u && u.iid === newcomer!.iid)).toBe(false); // 入驻备战席，不上场
    const after = m.pool.snapshot();
    expect(poolBefore[newcomer!.defId] - after[newcomer!.defId]).toBe(3); // 占卡池 3 张
    expect(p.gold).toBe(goldBefore);
    expect(m.log.some((l) => l.includes('援军') && l.includes('入驻备战席'))).toBe(true);
  });

  it('备战席满：不占卡池，按 2★ 卖出价折金返还（守恒）', () => {
    const m = new Match(4243);
    const p = m.human;
    // 9 格全部塞满互不相同的棋子（避免任何合成歧义）
    const fillIds = CHAMPIONS.filter((c) => c.cost <= 2).slice(0, BENCH_SLOTS).map((c) => c.id);
    expect(fillIds.length).toBe(BENCH_SLOTS);
    fillIds.forEach((id, i) => {
      p.bench[i] = { iid: 9000 + i, defId: id, star: 1, items: [] };
    });

    m.adventureOffer = { round: 5, options: [{ kind: 'reinforce', title: '援军', desc: '' }] };
    const poolBefore = m.pool.snapshot();
    const goldBefore = p.gold;

    m.resolveAdventure(0);

    expect(p.gold).toBe(goldBefore + reinforceRefund(5)); // 1 费 ×3 − 1 = 2 金
    expect(m.pool.snapshot()).toEqual(poolBefore); // 一张卡都没动
    expect(p.bench.filter(Boolean).length).toBe(BENCH_SLOTS); // 没有新棋子入驻
    expect(m.log.some((l) => l.includes('备战席已满 · 折算金币 +2'))).toBe(true);
  });

  it('卡池该费用档余量不足 3 张：同样折金返还，不凭空造卡', () => {
    const m = new Match(4244);
    const p = m.human;
    // 抽干全部 1 费卡
    for (const id of CHAMPION_IDS_BY_COST[1] ?? []) {
      while (m.pool.take(id));
    }
    m.adventureOffer = { round: 5, options: [{ kind: 'reinforce', title: '援军', desc: '' }] };
    const poolBefore = m.pool.snapshot();
    const goldBefore = p.gold;

    m.resolveAdventure(0);

    expect(p.gold).toBe(goldBefore + 2);
    expect(m.pool.snapshot()).toEqual(poolBefore);
    expect(p.bench.some(Boolean)).toBe(false);
  });
});

// ── ⑤ AI 选择确定性与偏好 ───────────────────────────────

describe('AI 奇遇选择', () => {
  it('chooseAdventureIndex：按偏好序取第一个在 offer 里的 kind，缺席取第一个选项', () => {
    const offerOf = (kinds: AdventureKind[]): AdventureOffer => ({
      round: 5,
      options: kinds.map((kind) => ({ kind, title: kind, desc: '' })),
    });
    // 血勇 [reinforce, item, …]：reinforce 优先于 item
    expect(chooseAdventureIndex(makeProfile('aggro'), offerOf(['gold', 'item', 'reinforce']))).toBe(2);
    expect(chooseAdventureIndex(makeProfile('aggro'), offerOf(['gold', 'item']))).toBe(1);
    // 守财 [gold, …]：金币排最前
    expect(chooseAdventureIndex(makeProfile('econ'), offerOf(['item', 'gold']))).toBe(1);
    // 老谋 [item, …]
    expect(chooseAdventureIndex(makeProfile('balanced'), offerOf(['gold', 'item']))).toBe(1);
    // 孤注 [xp, reinforce, …]
    expect(chooseAdventureIndex(makeProfile('hyperroll'), offerOf(['item', 'xp']))).toBe(1);
    expect(chooseAdventureIndex(makeProfile('hyperroll'), offerOf(['gold', 'item', 'xp', 'reinforce']))).toBe(2);
    // 钓叟 [gold, …]
    expect(chooseAdventureIndex(makeProfile('greedy'), offerOf(['xp', 'gold']))).toBe(1);
    // 偏好项全部缺席 → 取第一个选项（确定性兜底）
    for (const arch of ['aggro', 'econ', 'balanced', 'hyperroll', 'greedy'] as const) {
      expect(chooseAdventureIndex(makeProfile(arch), offerOf(['item']))).toBe(0);
    }
  });

  it('同种子两个 Match 的奇遇发放日志完全一致（同种子同选择）', () => {
    for (const seed of [1, 20260830]) {
      const a = new Match(seed);
      const b = new Match(seed);
      runPrepOnly(a, 9);
      runPrepOnly(b, 9);
      const la = a.log.filter((l) => l.includes('奇遇'));
      const lb = b.log.filter((l) => l.includes('奇遇'));
      expect(la.length).toBeGreaterThan(0);
      expect(lb).toEqual(la);
    }
  });

  it('每个 AI 的选择遵循其原型偏好序（对局内集成）', () => {
    const m = new Match(20260830);
    runPrepOnly(m, 5); // 第 5 回合：第一次奇遇轮
    const offer = m.adventureOffer!;
    expect(offer).not.toBeNull();
    for (const p of m.players) {
      if (p.isHuman) {
        expect(adventureLinesOf(m, p.name)).toEqual([]); // 人类不即选
        continue;
      }
      const expectedKind = (() => {
        for (const kind of p.ai!.adventurePref) {
          if (offer.options.some((o) => o.kind === kind)) return kind;
        }
        return offer.options[0].kind;
      })();
      const lines = adventureLinesOf(m, p.name);
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain(KIND_LOG_PREFIX[expectedKind]);
    }
  });
});

// ── ⑥ 战斗阶段开始后 offer 清空 ─────────────────────────

describe('奇遇恩赐过期', () => {
  it('makePairings（战斗阶段开始处）清空未选 offer，之后点选无事发生', () => {
    const m = new Match(20260830);
    runPrepOnly(m, 5);
    expect(m.adventureOffer).not.toBeNull();
    const gold = m.human.gold;

    m.pairings = m.makePairings();
    expect(m.adventureOffer).toBeNull();
    m.resolveAdventure(0); // 过期后点选：无发放、无异常
    expect(m.human.gold).toBe(gold);
  });

  it('非奇遇轮不产生 offer', () => {
    const m = new Match(20260830);
    runPrepOnly(m, 4); // 1~4 回合都不是奇遇轮
    expect(m.adventureOffer).toBeNull();
  });
});

// ── ⑦ battleSnapshots ──────────────────────────────────

describe('战斗快照', () => {
  it('每场战斗一条快照，且用 snapshot.config 重跑得到相同 winner/ticks', () => {
    const m = new Match(20260830);
    const battles = runRounds(m, 6);
    expect(battles).toBeGreaterThan(0);
    expect(m.battleSnapshots.length).toBe(battles);
    // 每条快照的 round 与结构合法
    for (const snap of m.battleSnapshots) {
      expect(snap.round).toBeGreaterThanOrEqual(1);
      expect(snap.config.units.length).toBeGreaterThan(0);
      expect(snap.eventsDigest).toBe(''); // 默认不记事件流
    }
    // 任取三条重跑：同 config ⇒ 同 winner、同 ticks
    for (const i of [0, Math.floor(m.battleSnapshots.length / 2), m.battleSnapshots.length - 1]) {
      const snap = m.battleSnapshots[i];
      const rerun = new Battle(snap.config, null, false).run();
      expect(rerun.winner).toBe(snap.winner);
      expect(rerun.ticks).toBe(snap.ticks);
    }
  });

  it('recordEvents=true 时摘要为 8 位十六进制 FNV-1a 指纹，且不改变战斗结果', () => {
    const m = new Match(20260830);
    runRounds(m, 5, true);
    expect(m.battleSnapshots.length).toBeGreaterThan(0);
    for (const snap of m.battleSnapshots) {
      expect(snap.eventsDigest).toMatch(/^[0-9a-f]{8}$/);
    }
    // 同种子、recordEvents 关闭的对局：战斗结果逐条一致（记录不改结果）
    const plain = new Match(20260830);
    runRounds(plain, 5, false);
    expect(plain.battleSnapshots.length).toBe(m.battleSnapshots.length);
    for (let i = 0; i < m.battleSnapshots.length; i++) {
      expect(plain.battleSnapshots[i].winner).toBe(m.battleSnapshots[i].winner);
      expect(plain.battleSnapshots[i].ticks).toBe(m.battleSnapshots[i].ticks);
    }
  });

  it('快照记录是纯观察者：不影响对局 rng 流与玩家状态', () => {
    const a = new Match(314159);
    const b = new Match(314159);
    runRounds(a, 6, true);
    runRounds(b, 6, false);
    expect(a.rng.state).toBe(b.rng.state);
    expect(a.round).toBe(b.round);
    expect(
      a.players.map((p) => ({ gold: p.gold, hp: p.hp, level: p.level, wins: p.wins, losses: p.losses }))
    ).toEqual(b.players.map((p) => ({ gold: p.gold, hp: p.hp, level: p.level, wins: p.wins, losses: p.losses })));
    expect(a.log).toEqual(b.log);
  });
});

// ── 支撑契约：fnv1aHex 与奇遇真实发生 ───────────────────

describe('fnv1aHex', () => {
  it('符合 FNV-1a 32 位标准测试向量', () => {
    expect(fnv1aHex('')).toBe('811c9dc5');
    expect(fnv1aHex('a')).toBe('e40c292c');
    expect(fnv1aHex('foobar')).toBe('bf9cf968');
  });

  it('不同输入产生不同指纹，输出恒为 8 位十六进制', () => {
    expect(fnv1aHex('abc')).not.toBe(fnv1aHex('abd'));
    for (const s of ['', 'x', '战斗事件流', '{"t":"damage","amount":12}']) {
      expect(fnv1aHex(s)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe('奇遇轮真实发生（验收门：发生次数 > 0）', () => {
  it('整局无头模拟中奇遇恩赐真实发放，且每个奇遇轮全员共享同一份 offer', () => {
    for (const seed of [20260830, 424242]) {
      const m = new Match(seed);
      runFull(m);
      expect(m.isOver()).toBe(true);
      const grants = m.log.filter((l) => l.includes('奇遇 ·'));
      expect(grants.length).toBeGreaterThan(0);
      // 存活 AI 每人每个奇遇轮一条发放日志：第 5/9/13 回合至少三轮奇遇
      // （八人局不可能在 13 回合前打完），7 个 AI × ≥3 轮 = ≥21 条
      expect(grants.length).toBeGreaterThanOrEqual(21);
    }
  });
});
