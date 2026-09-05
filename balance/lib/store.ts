/**
 * 实验工件库 —— 平衡工具链的持久层（node:sqlite，Node ≥ 22.5 内置，零新依赖）。
 *
 * 定位（决策记录见 balance/README.md）：
 *  - 存的是**实验历史**（runs/configs/配对结果/逐单位统计/装备边际/羁绊贡献），
 *    供跨版本趋势查询与任意回溯复算 —— 取代旧 sweep-out/*.json 散落工件形态；
 *  - 游戏真源仍是 src/data 的 TS 常量（编译进发布物、单文件离线可玩）。
 *    数据库**只进不出**：没有任何代码路径从 DB 读数回灌游戏 —— 分离是单向的。
 */
// node:sqlite 经 createRequire 加载而非静态 import：vitest 的 vite 解析器
// （5.4）尚未收录该内置模块，静态 import 会在收集阶段直接失败；类型仍走
// type-only import 完整保留。
type SqliteModule = typeof import('node:sqlite');
const loadSqlite = (): SqliteModule => createRequire(import.meta.url)('node:sqlite') as SqliteModule;
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { GAME_VERSION } from '../../src/version';
import type { Overrides } from './patch';
import type { UnitRow } from './matrix';

/** 工件目录（balance/out，gitignored）—— 从模块位置推导，不依赖 cwd。
 *  注意必须经 dirname 的「父目录」再拼 balance：fileURLToPath(new URL('.', …))
 *  自带尾部分隔符，直接 dirname 它会把 balance 目录本身当文件名剥掉，落到
 *  `<repo>/out`（该路径未被 ignore、曾被整体提交入库 —— 见 2026-09-02 修复）。 */
export const OUT_DIR = resolve(dirname(fileURLToPath(new URL('.', import.meta.url))), '..', 'balance', 'out');
export const DB_PATH = resolve(OUT_DIR, 'balance.db');

const DDL = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  command TEXT NOT NULL,
  label TEXT,
  game_version TEXT NOT NULL,
  git_head TEXT,
  n_per_pair INTEGER NOT NULL,
  seed_base INTEGER NOT NULL,
  workers INTEGER NOT NULL,
  params_json TEXT NOT NULL,
  summary_json TEXT
);
CREATE TABLE IF NOT EXISTS configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  idx INTEGER NOT NULL,
  label TEXT NOT NULL,
  overrides_json TEXT NOT NULL,
  UNIQUE (run_id, idx)
);
CREATE TABLE IF NOT EXISTS pair_results (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  config_id INTEGER NOT NULL REFERENCES configs(id),
  top_idx INTEGER NOT NULL,
  bottom_idx INTEGER NOT NULL,
  n INTEGER NOT NULL,
  top_wins INTEGER NOT NULL,
  bottom_wins INTEGER NOT NULL,
  draws INTEGER NOT NULL,
  avg_ticks REAL NOT NULL,
  timeouts INTEGER NOT NULL,
  PRIMARY KEY (run_id, config_id, top_idx, bottom_idx)
);
CREATE TABLE IF NOT EXISTS unit_stats (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  config_id INTEGER NOT NULL REFERENCES configs(id),
  comp_idx INTEGER NOT NULL,
  def_id TEXT NOT NULL,
  star INTEGER NOT NULL,
  battles INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  dealt REAL NOT NULL,
  taken REAL NOT NULL,
  healed REAL NOT NULL,
  absorbed REAL NOT NULL,
  casts INTEGER NOT NULL,
  dealt_p REAL NOT NULL,
  dealt_m REAL NOT NULL,
  dealt_t REAL NOT NULL,
  taken_p REAL NOT NULL,
  taken_m REAL NOT NULL,
  taken_t REAL NOT NULL,
  PRIMARY KEY (run_id, config_id, comp_idx, def_id)
);
CREATE TABLE IF NOT EXISTS item_results (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  item_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  baseline_rate REAL NOT NULL,
  item_rate REAL NOT NULL,
  delta REAL NOT NULL,
  PRIMARY KEY (run_id, item_id)
);
CREATE TABLE IF NOT EXISTS trait_results (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  comp_idx INTEGER NOT NULL,
  trait_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  base_rate REAL NOT NULL,
  suppressed_rate REAL NOT NULL,
  delta REAL NOT NULL,
  PRIMARY KEY (run_id, comp_idx, trait_id)
);
CREATE INDEX IF NOT EXISTS idx_runs_command ON runs (command, id);
-- 注：pair/unit/item/trait 四表对 runs/configs 的外键随上面 CREATE 建全；
-- 本地旧 balance.db 是丢弃式工件，下次跑任意写库命令重建即带 FK。
`;

export interface RunHeader {
  command: string;
  label: string;
  nPerPair: number;
  seedBase: number;
  workers: number;
  params: unknown;
}

export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  command: string;
  label: string | null;
  game_version: string;
  git_head: string | null;
  n_per_pair: number;
  seed_base: number;
  workers: number;
  params_json: string;
  summary_json: string | null;
}

function gitHead(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export class Store {
  private db: InstanceType<SqliteModule["DatabaseSync"]>;

  constructor(path: string = DB_PATH) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new (loadSqlite().DatabaseSync)(path);
    try {
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA foreign_keys = ON');
      this.db.exec('PRAGMA busy_timeout = 5000');
      this.db.exec(DDL);
    } catch (e) {
      // 初始化半途失败必须关句柄：文件库留着一个打开的坏连接会锁住重建
      try { this.db.close(); } catch { /* 已断开 */ }
      throw new Error(`工件库初始化失败（${path}）：${e instanceof Error ? e.message : String(e)}`);
    }
    // 断尾 run 清理：pair/unit/item/trait 行先落库、summary 后写，进程中途
    // 崩掉会留下永远不进 recentRuns 的孤儿行。查询面已过滤（读数不受污染），
    // 这里负责不让死行只进不出地堆积。外键无级联（旧库 DDL 已定型），
    // 按子表 → configs → runs 顺序显式删除。
    try {
      this.db.exec(`
        DELETE FROM pair_results  WHERE run_id IN (SELECT id FROM runs WHERE summary_json IS NULL);
        DELETE FROM unit_stats    WHERE run_id IN (SELECT id FROM runs WHERE summary_json IS NULL);
        DELETE FROM item_results  WHERE run_id IN (SELECT id FROM runs WHERE summary_json IS NULL);
        DELETE FROM trait_results WHERE run_id IN (SELECT id FROM runs WHERE summary_json IS NULL);
        DELETE FROM configs       WHERE run_id IN (SELECT id FROM runs WHERE summary_json IS NULL);
        DELETE FROM runs          WHERE summary_json IS NULL;
      `);
    } catch {
      // 清理失败不阻塞使用（只读路径本就过滤孤儿行）
    }
  }

  beginRun(h: RunHeader): number {
    const info = this.db
      .prepare('INSERT INTO runs (started_at, command, label, game_version, git_head, n_per_pair, seed_base, workers, params_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), h.command, h.label, GAME_VERSION, gitHead(), h.nPerPair, h.seedBase, h.workers, JSON.stringify(h.params ?? {})) as { lastInsertRowid: number | bigint };
    return Number(info.lastInsertRowid);
  }

  addConfig(runId: number, idx: number, label: string, overrides: Overrides): number {
    const info = this.db
      .prepare('INSERT INTO configs (run_id, idx, label, overrides_json) VALUES (?, ?, ?, ?)')
      .run(runId, idx, label, JSON.stringify(overrides ?? {})) as { lastInsertRowid: number | bigint };
    return Number(info.lastInsertRowid);
  }

  addPairs(runId: number, configId: number, rows: { i: number; j: number; n: number; topWins: number; bottomWins: number; draws: number; totalTicks: number; timeouts: number }[]): void {
    this.db.exec('BEGIN');
    try {
      const stmt = this.db.prepare('INSERT OR REPLACE INTO pair_results (run_id, config_id, top_idx, bottom_idx, n, top_wins, bottom_wins, draws, avg_ticks, timeouts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of rows) {
        stmt.run(runId, configId, r.i, r.j, r.n, r.topWins, r.bottomWins, r.draws, r.n > 0 ? r.totalTicks / r.n : 0, r.timeouts);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  addUnits(runId: number, configId: number, rows: UnitRow[]): void {
    this.db.exec('BEGIN');
    try {
      const stmt = this.db.prepare('INSERT OR REPLACE INTO unit_stats (run_id, config_id, comp_idx, def_id, star, battles, deaths, dealt, taken, healed, absorbed, casts, dealt_p, dealt_m, dealt_t, taken_p, taken_m, taken_t) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of rows) {
        stmt.run(runId, configId, r.compIdx, r.defId, r.star, r.battles, r.deaths, r.dealt, r.taken, r.healed, r.absorbed, r.casts, r.dealtPhys, r.dealtMagic, r.dealtTrue, r.takenPhys, r.takenMagic, r.takenTrue);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  addItemResults(runId: number, rows: { itemId: string; n: number; baselineRate: number; itemRate: number }[]): void {
    this.db.exec('BEGIN');
    try {
      const stmt = this.db.prepare('INSERT OR REPLACE INTO item_results (run_id, item_id, n, baseline_rate, item_rate, delta) VALUES (?, ?, ?, ?, ?, ?)');
      for (const r of rows) stmt.run(runId, r.itemId, r.n, r.baselineRate, r.itemRate, r.itemRate - r.baselineRate);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  addTraitResults(runId: number, rows: { compIdx: number; traitId: string; n: number; baseRate: number; suppressedRate: number }[]): void {
    this.db.exec('BEGIN');
    try {
      const stmt = this.db.prepare('INSERT OR REPLACE INTO trait_results (run_id, comp_idx, trait_id, n, base_rate, suppressed_rate, delta) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const r of rows) stmt.run(runId, r.compIdx, r.traitId, r.n, r.baseRate, r.suppressedRate, r.suppressedRate - r.baseRate);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  finishRun(runId: number, summary: unknown): void {
    this.db.prepare('UPDATE runs SET finished_at = ?, summary_json = ? WHERE id = ?')
      .run(new Date().toISOString(), JSON.stringify(summary ?? {}), runId);
  }

  // ── 查询面 ────────────────────────────────────────────
  recentRuns(command: string | null, limit: number): RunRow[] {
    const sql = command
      ? 'SELECT * FROM runs WHERE command = ? AND summary_json IS NOT NULL ORDER BY id DESC LIMIT ?'
      : 'SELECT * FROM runs WHERE summary_json IS NOT NULL ORDER BY id DESC LIMIT ?';
    const rows = command
      ? this.db.prepare(sql).all(command, limit)
      : this.db.prepare(sql).all(limit);
    return rows as unknown as RunRow[];
  }

  runById(id: number): RunRow | null {
    return (this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as unknown as RunRow | undefined) ?? null;
  }

  /** 某次 run 里指定配置标签的逐单位行（棋子维分析的数据源） */
  unitRows(runId: number, configLabel: string): (UnitRow & { config_label: string })[] {
    const rows = this.db
      .prepare(`
        SELECT u.*, c.label AS config_label FROM unit_stats u
        JOIN configs c ON c.id = u.config_id
        WHERE u.run_id = ? AND c.label = ?`)
      .all(runId, configLabel) as unknown as (Record<string, number | string>)[];
    return rows.map((r) => ({
      compIdx: Number(r.comp_idx), defId: String(r.def_id), star: Number(r.star),
      battles: Number(r.battles), deaths: Number(r.deaths),
      dealt: Number(r.dealt), taken: Number(r.taken), healed: Number(r.healed), absorbed: Number(r.absorbed), casts: Number(r.casts),
      dealtPhys: Number(r.dealt_p), dealtMagic: Number(r.dealt_m), dealtTrue: Number(r.dealt_t),
      takenPhys: Number(r.taken_p), takenMagic: Number(r.taken_m), takenTrue: Number(r.taken_t),
      config_label: String(r.config_label),
    }));
  }

  itemRows(runId: number): { itemId: string; n: number; baselineRate: number; itemRate: number; delta: number }[] {
    const rows = this.db.prepare('SELECT item_id, n, baseline_rate, item_rate, delta FROM item_results WHERE run_id = ? ORDER BY delta DESC').all(runId) as unknown as Record<string, number | string>[];
    return rows.map((r) => ({
      itemId: String(r.item_id), n: Number(r.n),
      baselineRate: Number(r.baseline_rate), itemRate: Number(r.item_rate), delta: Number(r.delta),
    }));
  }

  traitRows(runId: number): { compIdx: number; traitId: string; n: number; baseRate: number; suppressedRate: number; delta: number }[] {
    const rows = this.db.prepare('SELECT comp_idx, trait_id, n, base_rate, suppressed_rate, delta FROM trait_results WHERE run_id = ? ORDER BY delta').all(runId) as unknown as Record<string, number | string>[];
    return rows.map((r) => ({
      compIdx: Number(r.comp_idx), traitId: String(r.trait_id), n: Number(r.n),
      baseRate: Number(r.base_rate), suppressedRate: Number(r.suppressed_rate), delta: Number(r.delta),
    }));
  }

  close(): void {
    this.db.close();
  }
}
