/**
 * 金种子确定性快照（M2 锁版基建）。
 *
 * 这是锁版基准：固定若干组 seed / 阵容 / 羁绊配置，把战斗结果（胜负、
 * 时长、双方承伤合计、事件流长度与序列化摘要）钉进 tests/__golden__/battle-golden.json。
 * 任何对 core / 数据表的改动若改变了这些终值，此测试立刻报警 ——
 * 若为有意变更（平衡调参等），按下方再生命令重建基准后再锁版。
 *
 * 双层断言：
 *   1. 同一进程内连跑两次，逐字段相等（同 seed ⇒ 逐帧一致，防随机源泄漏）；
 *   2. 结果与金种子快照逐字段一致（防"悄悄改了终值"）。
 *
 * 再生快照：
 *   UPDATE_GOLDEN=1 npx vitest run tests/golden-determinism.test.ts
 *   （Windows PowerShell：先 `$env:UPDATE_GOLDEN='1'` 再运行，跑完记得清掉）
 *
 * 契约提醒：战斗内核不会自动算羁绊，BattleConfig.traits 必须显式传入
 * `{ 0: ActiveTrait[], 1: ActiveTrait[] }`（tier 为 0-based，-1 表示未激活）；
 * 构造 `new Battle(cfg, sink|null, recordEvents)`，第三参为 true 才记录 events。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import type { ActiveTrait, BattleConfig, BattleUnitInput, Cell, Star, TeamId } from '../src/core/types';
import { computeTraits } from '../src/game/comp';
import { GAME_BUILD, GAME_VERSION } from '../src/version';

// ───────────────────────── 快照文件 ─────────────────────────

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__golden__');
const GOLDEN_PATH = join(GOLDEN_DIR, 'battle-golden.json');
const REGEN_HINT =
  '再生方法：UPDATE_GOLDEN=1 npx vitest run tests/golden-determinism.test.ts'
  + '（PowerShell：$env:UPDATE_GOLDEN=\'1\' 后运行同一命令，跑完删除该环境变量）';

/** 单个用例锁定的终值集合 */
interface GoldenMetrics {
  winner: TeamId | null;
  ticks: number;
  timeout: boolean;
  /** 各队全部单位（含召唤物）的被击总伤 */
  takenDamage: Record<TeamId, number>;
  takenDamageTotal: number;
  /** 终局各队存活棋子数（不含召唤物） */
  survivorCount: Record<TeamId, number>;
  eventCount: number;
  /** events JSON.stringify 的 sha256 摘要 —— 钉死整条事件流 */
  eventsDigest: string;
}

interface GoldenFile {
  $meta: {
    description: string;
    regenerate: string;
    gameVersion: string;
    build: string;
  };
  cases: Record<string, GoldenMetrics>;
}

// ───────────────────────── 用例构造 ─────────────────────────

/** 手摆一个入场单位（uid 必须全局唯一） */
const U = (uid: number, defId: string, team: TeamId, cell: Cell, star: Star = 1): BattleUnitInput => ({
  uid,
  defId,
  team,
  star,
  cell,
});

interface CaseSpec {
  key: string;
  desc: string;
  /** 每次调用都返回全新配置，保证两次运行互不共享状态 */
  build: () => BattleConfig;
}

const CASES: CaseSpec[] = [
  {
    key: 'jianzong-vs-longyuan',
    desc: '剑宗刺客 vs 龙渊方士（M1 重平衡后的两大流派对撞，含 2/3 星）',
    build: () => ({
      seed: 20260830,
      units: [
        U(1, 'duanyue', 0, { c: 1, r: 3 }, 3),
        U(2, 'yingsha', 0, { c: 2, r: 3 }, 2),
        U(3, 'wujiu', 0, { c: 3, r: 2 }, 2),
        U(4, 'qingming', 0, { c: 4, r: 2 }, 2),
        U(5, 'canghao', 0, { c: 0, r: 3 }, 2),
        U(6, 'chitong', 0, { c: 5, r: 3 }, 2),
        U(7, 'ajiu', 0, { c: 6, r: 1 }, 2),
        U(201, 'yuansu', 1, { c: 1, r: 4 }, 2),
        U(202, 'aoyin', 1, { c: 2, r: 4 }, 2),
        U(203, 'moyu', 1, { c: 3, r: 5 }, 2),
        U(204, 'yinglong', 1, { c: 4, r: 6 }, 1),
        U(205, 'canglan', 1, { c: 5, r: 4 }, 2),
        U(206, 'pan', 1, { c: 0, r: 4 }, 2),
        U(207, 'zhenyue', 1, { c: 6, r: 4 }, 2),
      ],
      traits: {
        0: computeTraits(['duanyue', 'yingsha', 'wujiu', 'qingming', 'canghao', 'chitong', 'ajiu']),
        1: computeTraits(['yuansu', 'aoyin', 'moyu', 'yinglong', 'canglan', 'pan', 'zhenyue']),
      },
    }),
  },
  {
    key: 'guard-grind-vs-youming',
    desc: '护卫荆棘磨血 vs 幽冥亡语（极端边之一：荆棘/亡语口径钉住）',
    build: () => ({
      seed: 777,
      units: [
        U(1, 'pan', 0, { c: 2, r: 3 }, 2),
        U(2, 'lingxiao', 0, { c: 3, r: 3 }, 2),
        U(3, 'xuanwu', 0, { c: 4, r: 3 }, 2),
        U(4, 'budong', 0, { c: 5, r: 2 }, 2),
        U(5, 'zhenyue', 0, { c: 3, r: 2 }, 2),
        U(101, 'yeyou', 1, { c: 2, r: 4 }, 2),
        U(102, 'moyu', 1, { c: 3, r: 5 }, 2),
        U(103, 'dasiming', 1, { c: 4, r: 4 }, 2),
        U(104, 'shidian', 1, { c: 5, r: 5 }, 2),
        U(105, 'jiuying', 1, { c: 3, r: 6 }, 2),
        U(106, 'xuanwu', 1, { c: 4, r: 4 }, 2),
      ],
      traits: {
        0: computeTraits(['pan', 'lingxiao', 'xuanwu', 'budong', 'zhenyue']),
        1: computeTraits(['yeyou', 'moyu', 'dasiming', 'shidian', 'jiuying', 'xuanwu']),
      },
    }),
  },
  {
    key: 'mirror-danding-trio',
    desc: '镜像内战：双方同一套丹鼎三人组（平局/对称路径也在基准内）',
    build: () => ({
      seed: 42424,
      units: [
        U(1, 'qinghe', 0, { c: 1, r: 3 }, 2),
        U(2, 'kutong', 0, { c: 3, r: 3 }, 2),
        U(3, 'ajiu', 0, { c: 5, r: 2 }, 3),
        U(101, 'qinghe', 1, { c: 1, r: 4 }, 2),
        U(102, 'kutong', 1, { c: 3, r: 4 }, 2),
        U(103, 'ajiu', 1, { c: 5, r: 5 }, 3),
      ],
      traits: {
        0: computeTraits(['qinghe', 'kutong', 'ajiu']),
        1: computeTraits(['qinghe', 'kutong', 'ajiu']),
      },
    }),
  },
  {
    key: 'manual-traits-explicit',
    desc: '手写 ActiveTrait 契约用例：traits 由调用方显式传入（tier 0-based），不走 computeTraits',
    build: () => ({
      seed: 11,
      units: [
        U(1, 'duanyue', 0, { c: 0, r: 3 }, 2),
        U(2, 'yingsha', 0, { c: 1, r: 3 }, 2),
        U(3, 'wujiu', 0, { c: 2, r: 3 }, 2),
        U(4, 'qingming', 0, { c: 3, r: 3 }, 2),
        U(5, 'pan', 0, { c: 4, r: 3 }, 2),
        U(101, 'jingyu', 1, { c: 1, r: 6 }, 3),
        U(102, 'lingque', 1, { c: 3, r: 6 }, 2),
        U(103, 'hanxing', 1, { c: 5, r: 6 }, 2),
      ],
      traits: {
        0: [{ id: 'jianzong', count: 4, tier: 1 }] satisfies ActiveTrait[],
        1: computeTraits(['jingyu', 'lingque', 'hanxing']),
      },
    }),
  },
  {
    key: 'timeout-attrition',
    desc: '超时裁定用例：双坦互磨 + maxTicks 压顶，钉住 timeout 分支与按血量比例判胜',
    build: () => ({
      seed: 314159,
      maxTicks: 180,
      units: [
        U(1, 'pan', 0, { c: 2, r: 3 }, 2),
        U(2, 'budong', 0, { c: 4, r: 3 }, 2),
        U(3, 'baopu', 0, { c: 5, r: 2 }, 2),
        U(101, 'xuanwu', 1, { c: 2, r: 4 }, 2),
        U(102, 'lingxiao', 1, { c: 4, r: 4 }, 2),
        U(103, 'qinghe', 1, { c: 5, r: 5 }, 2),
      ],
      traits: {
        0: computeTraits(['pan', 'budong', 'baopu']),
        1: computeTraits(['xuanwu', 'lingxiao', 'qinghe']),
      },
    }),
  },
];

// ───────────────────────── 运行与度量 ─────────────────────────

/** 跑一场战斗并提取金种子度量值（recordEvents = true，全量事件入库） */
function runCase(spec: CaseSpec): GoldenMetrics {
  const battle = new Battle(spec.build(), null, true);
  const result = battle.run();
  if (!result) throw new Error(`用例 ${spec.key} 未产出结果`);

  const takenDamage: Record<TeamId, number> = {};
  for (const u of battle.units) {
    takenDamage[u.team] = (takenDamage[u.team] ?? 0) + u.takenDamage;
  }
  const survivorCount: Record<TeamId, number> = {};
  for (const team of Object.keys(result.survivors).map(Number)) {
    survivorCount[team] = result.survivors[team].length;
  }

  const eventsJson = JSON.stringify(battle.events);
  return {
    winner: result.winner,
    ticks: result.ticks,
    timeout: result.timeout,
    takenDamage,
    takenDamageTotal: Object.values(takenDamage).reduce((s, v) => s + v, 0),
    survivorCount,
    eventCount: battle.events.length,
    eventsDigest: `sha256:${createHash('sha256').update(eventsJson).digest('hex')}`,
  };
}

/** 断言两份度量值逐字段相等（浮点为同进程同序运算，允许 toBe 精确比较） */
function expectMetricsEqual(a: GoldenMetrics, b: GoldenMetrics): void {
  expect(b.winner).toBe(a.winner);
  expect(b.ticks).toBe(a.ticks);
  expect(b.timeout).toBe(a.timeout);
  expect(b.takenDamage[0]).toBe(a.takenDamage[0]);
  expect(b.takenDamage[1]).toBe(a.takenDamage[1]);
  expect(b.takenDamageTotal).toBe(a.takenDamageTotal);
  expect(b.survivorCount[0]).toBe(a.survivorCount[0]);
  expect(b.survivorCount[1]).toBe(a.survivorCount[1]);
  expect(b.eventCount).toBe(a.eventCount);
  expect(b.eventsDigest).toBe(a.eventsDigest);
}

function readGolden(): GoldenFile | null {
  if (!existsSync(GOLDEN_PATH)) return null;
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFile;
}

function writeGolden(metrics: Record<string, GoldenMetrics>): void {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  const file: GoldenFile = {
    $meta: {
      description:
        '百战天元 · M2 锁版金种子快照。由 tests/golden-determinism.test.ts 生成与消费；'
        + '只比对 cases 字段，$meta 仅供参考。',
      regenerate: `UPDATE_GOLDEN=1 npx vitest run tests/golden-determinism.test.ts`,
      gameVersion: GAME_VERSION,
      build: GAME_BUILD,
    },
    cases: metrics,
  };
  writeFileSync(GOLDEN_PATH, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

// ───────────────────────── 测试 ─────────────────────────

describe('金种子确定性（同进程双跑逐字段一致）', () => {
  for (const spec of CASES) {
    it(`${spec.key}：${spec.desc}`, () => {
      expectMetricsEqual(runCase(spec), runCase(spec));
    });
  }

  it('不同种子必须产生分歧（随机源真的在工作）', () => {
    const base = CASES[0]!;
    const cfgA = base.build();
    const cfgB = { ...base.build(), seed: cfgA.seed + 1 };
    const digestOf = (cfg: BattleConfig) => {
      const battle = new Battle(cfg, null, true);
      battle.run();
      return JSON.stringify(battle.events);
    };
    expect(digestOf(cfgB)).not.toBe(digestOf(cfgA));
  });
});

describe('金种子快照比对（tests/__golden__/battle-golden.json）', () => {
  it('全部用例的终值与快照逐字段一致', () => {
    const fresh: Record<string, GoldenMetrics> = {};
    for (const spec of CASES) fresh[spec.key] = runCase(spec);

    if (process.env.UPDATE_GOLDEN === '1') {
      writeGolden(fresh);
      return; // 本轮负责再生基准，不再自比
    }

    const golden = readGolden();
    expect(golden, `金种子快照不存在（${GOLDEN_PATH}）。${REGEN_HINT}`).not.toBeNull();

    for (const spec of CASES) {
      const actual = fresh[spec.key];
      const expected = golden!.cases[spec.key];
      expect(
        expected,
        `快照缺少用例「${spec.key}」。${REGEN_HINT}`,
      ).toBeDefined();
      const mismatch =
        `用例「${spec.key}」的终值与金种子快照不一致 —— 若为有意变更请再生基准：${REGEN_HINT}`;
      expect(actual.winner, mismatch).toBe(expected!.winner);
      expect(actual.ticks, mismatch).toBe(expected!.ticks);
      expect(actual.timeout, mismatch).toBe(expected!.timeout);
      expect(actual.takenDamage, mismatch).toEqual(expected!.takenDamage);
      expect(actual.takenDamageTotal, mismatch).toBe(expected!.takenDamageTotal);
      expect(actual.survivorCount, mismatch).toEqual(expected!.survivorCount);
      expect(actual.eventCount, mismatch).toBe(expected!.eventCount);
      expect(actual.eventsDigest, mismatch).toBe(expected!.eventsDigest);
    }
  });
});
