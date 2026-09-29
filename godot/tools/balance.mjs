// 平衡工具链（Godot 版）· Node 编排：PRESET_COMPS 经 TS buildTeam 组装配置（只读 import
// 冻结仓——配置组装不是战斗内核，无双实现纪律不破），战斗执行全部走 godot --headless
// 批次 worker（headless/balance_worker.gd）。CRN 金锁公式与 balance/lib/seeds.ts 逐位一致。
// SQLite 同表结构（runs/configs/pair_results/unit_stats），node:sqlite 内置。
// 用法：node --import tsx tools/balance.mjs [--n 50] [--seed-base 20260829] [--workers N] [--db out/balance-gd.db]
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { writeFileSync, mkdirSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PRESET_COMPS, buildTeam } from '../../src/game/comp.ts';
import { GAME_VERSION } from '../../src/version.ts';

const GODOT_EXE = 'C:/WORKSPACE/game/Godot_v4.7.1-stable_win64.exe';
const GODOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url))).replaceAll('\\', '/');

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    out[k] = v ?? '';
  }
  return out;
}

// ── CRN 金锁（seeds.ts 原值复刻；改动 = 与全部历史工件失去可比性）──
const DEFAULT_SEED_BASE = 20260829;
const pairSeed = (seedBase, pairIdx, k) => (seedBase + pairIdx * 104729 + k * 7919) >>> 0;
const pairIndex = (i, j, compCount) => i * compCount + j;

// ── SQLite 同表结构（store.ts DDL 原样）──
const DDL = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT,
  command TEXT NOT NULL, label TEXT, game_version TEXT NOT NULL, git_head TEXT,
  n_per_pair INTEGER NOT NULL, seed_base INTEGER NOT NULL, workers INTEGER NOT NULL,
  params_json TEXT NOT NULL, summary_json TEXT);
CREATE TABLE IF NOT EXISTS configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES runs(id),
  idx INTEGER NOT NULL, label TEXT NOT NULL, overrides_json TEXT NOT NULL, UNIQUE (run_id, idx));
CREATE TABLE IF NOT EXISTS pair_results (
  run_id INTEGER NOT NULL REFERENCES runs(id), config_id INTEGER NOT NULL REFERENCES configs(id),
  top_idx INTEGER NOT NULL, bottom_idx INTEGER NOT NULL, n INTEGER NOT NULL,
  top_wins INTEGER NOT NULL, bottom_wins INTEGER NOT NULL, draws INTEGER NOT NULL,
  avg_ticks REAL NOT NULL, timeouts INTEGER NOT NULL,
  PRIMARY KEY (run_id, config_id, top_idx, bottom_idx));
CREATE TABLE IF NOT EXISTS unit_stats (
  run_id INTEGER NOT NULL REFERENCES runs(id), config_id INTEGER NOT NULL REFERENCES configs(id),
  comp_idx INTEGER NOT NULL, def_id TEXT NOT NULL, star INTEGER NOT NULL, battles INTEGER NOT NULL,
  deaths INTEGER NOT NULL, dealt REAL NOT NULL, taken REAL NOT NULL, healed REAL NOT NULL,
  absorbed REAL NOT NULL, casts INTEGER NOT NULL, dealt_p REAL NOT NULL, dealt_m REAL NOT NULL,
  dealt_t REAL NOT NULL, taken_p REAL NOT NULL, taken_m REAL NOT NULL, taken_t REAL NOT NULL,
  PRIMARY KEY (run_id, config_id, comp_idx, def_id));
`;

// ── 主流程 ──
const args = parseArgs(process.argv.slice(2));
const nPerPair = parseInt(args.n ?? '50', 10);
const seedBase = parseInt(args['seed-base'] ?? String(DEFAULT_SEED_BASE), 10);
// 单进程默认：M1 实测单进程 ~38 局/s（72 对 × 50 局 ≈ 95s）；多进程冷启动会抢 .godot 缓存锁
// （4 进程并行实测互相挂死），需要时 --workers=N 错峰拉起
const maxWorkers = parseInt(args.workers ?? '1', 10);
const dbPath = args.db ?? 'out/balance-gd.db';  // 相对 godot/（隔离铁律：不得写仓库根）

// 配置组装：TS buildTeam（uid 基与站位推导与金锁工件可比的口径一致）。
// engine.ts 原口径：i 队 buildTeam(spec, 0, 1)、j 队 buildTeam(spec, 1, 200)——
// 两队必须各自构建（team 号 + uid 基不同），复用同一份会让 team1 空阵秒判。
const teams = PRESET_COMPS.map((spec) => ({
  label: spec.name,
  ...buildTeam(spec, 0, 1),
}));
const teamsBottom = PRESET_COMPS.map((spec) => buildTeam(spec, 1, 200));
const compCount = teams.length;

// 作业切分：每 (i,j) 配对一个作业，按 worker 数分批。
// --pairs=N 只跑前 N 对（冒烟用：个别配对是超时局长局，全矩阵 GDScript 最坏小时级）
const pairLimit = parseInt(args.pairs ?? '0', 10);
const jobs = [];
for (let i = 0; i < compCount; i++) {
  for (let j = 0; j < compCount; j++) {
    if (i === j) continue;
    if (pairLimit > 0 && jobs.length >= pairLimit) break;
    jobs.push({
      pairIdx: pairIndex(i, j, compCount),
      k0: 0,
      n: nPerPair,
      cfg: { units: [...teams[i].inputs, ...teamsBottom[j].inputs], traits: { 0: teams[i].traits, 1: teamsBottom[j].traits } },
      meta: { i, j },
    });
  }
}

// 分批派发（每批一个 godot 进程；批次文件在 godot/.tmp）
mkdirSync(path.join(GODOT_DIR, '.tmp'), { recursive: true });
const batches = [];
const perBatch = Math.ceil(jobs.length / maxWorkers);
for (let b = 0; b < maxWorkers; b++) {
  const slice = jobs.slice(b * perBatch, (b + 1) * perBatch);
  if (slice.length) batches.push(slice);
}

const t0 = Date.now();
const jobMeta = new Map();
batches.forEach((slice, bi) => {
  for (const job of slice) jobMeta.set(job.pairIdx, job.meta);
  writeFileSync(path.join(GODOT_DIR, `.tmp/balance_jobs_${bi}.json`), JSON.stringify({ seedBase, jobs: slice }));
});
// 批次临时文件：exit 钩子统一清理（worker 失败走 process.exit 的路径同样覆盖）——
// 必须在 worker 循环前注册，失败退出时才已挂上
process.on('exit', () => {
  for (let bi = 0; bi < batches.length; bi++) {
    const p2 = path.join(GODOT_DIR, `.tmp/balance_jobs_${bi}.json`);
    if (existsSync(p2)) unlinkSync(p2);
  }
});

// spawnSync：worker 退出后全量收 stdout（异步管道在 Windows 下 godot print 不逐行 flush，实测挂死；
// 同步路径与 shell 直跑行为一致 —— 心跳/结果都在退出时一次性可得）
const results = new Map();
let gdMs = 0;
for (let bi = 0; bi < batches.length; bi++) {
  const r = spawnSync(GODOT_EXE, ['--headless', '--path', GODOT_DIR, '--script', 'res://headless/balance_worker.gd', '--', `--jobs=${GODOT_DIR}/.tmp/balance_jobs_${bi}.json`], { encoding: 'utf8', windowsHide: true, timeout: 3_600_000, maxBuffer: 64 * 1024 * 1024 });
  const NL = String.fromCharCode(10);
  const line = String(r.stdout || '').split(NL).find((l) => l.startsWith('BALANCE_JSON '));
  if (!line) {
    console.error('[balance] worker 无输出 exit=' + r.status, String(r.stderr || '').slice(0, 300));
    process.exit(1);
  }
  const parsed = JSON.parse(line.slice('BALANCE_JSON '.length));
  gdMs += parsed.ms ?? 0;
  results.set(bi, parsed);
  process.stderr.write(`[balance] 批 ${bi + 1}/${batches.length} 完成（${Math.round((parsed.ms ?? 0) / 100) / 10}s）
`);
}

// 归拢（worker 无输出 = 启动/挂死失败，必须报错而不是 0 配对假成功）
if (results.size === 0) {
  console.error('[balance] worker 无输出（启动失败或挂死）');
  process.exit(1);
}
const allResults = [];
const unitAgg = new Map();
for (const r of results.values()) {
  if (!r.ok) {
    console.error('[balance] worker 失败:', JSON.stringify(r).slice(0, 200));
    process.exit(1);
  }
  for (const res of r.results) allResults.push(res);
  for (const u of r.units) {
    const key = `${u.compIdx}|${u.defId}|${u.star}`;
    const cur = unitAgg.get(key) ?? { ...u, battles: 0, deaths: 0, dealt: 0, taken: 0, healed: 0, absorbed: 0, casts: 0, dealtP: 0, dealtM: 0, dealtT: 0, takenP: 0, takenM: 0, takenT: 0 };
    for (const f of ['battles', 'deaths', 'casts']) cur[f] += u[f];
    for (const f of ['dealt', 'taken', 'healed', 'absorbed', 'dealtP', 'dealtM', 'dealtT', 'takenP', 'takenM', 'takenT']) cur[f] += u[f];
    unitAgg.set(key, cur);
  }
}

// ── 胜率矩阵与综合榜（口径对齐 matrix.ts：每 comp 对全部对手的平均胜率）──
const wins = Array.from({ length: compCount }, () => Array(compCount).fill(null));
for (const res of allResults) {
  const meta = jobMeta.get(res.pairIdx);
  if (!meta) continue;
  const { i, j } = meta;
  const total = res.wins0 + res.wins1 + res.draws;
  wins[i][j] = { rate: res.wins0 / total, n: total, draws: res.draws, avgTicks: res.ticksTotal / total, timeouts: res.timeouts };
}
const rates = teams.map((_, i) => {
  const row = wins[i].filter(Boolean);
  return row.reduce((a, w) => a + w.rate, 0) / row.length;
});
const standings = teams.map((t, i) => ({ i, label: t.label, rate: rates[i] })).sort((a, b) => b.rate - a.rate);
const spread = (standings[0].rate - standings[standings.length - 1].rate) * 100;

// ── 入库 ──
mkdirSync(path.dirname(path.resolve(GODOT_DIR, dbPath)), { recursive: true });
const db = new DatabaseSync(path.resolve(GODOT_DIR, dbPath));
db.exec(DDL);
const insRun = db.prepare('INSERT INTO runs (git_head, started_at, finished_at, command, label, game_version, n_per_pair, seed_base, workers, params_json, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const info = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.join(GODOT_DIR, '..'), encoding: 'utf8' });
const gitHead = String(info.stdout ?? '').trim();
const now = new Date().toISOString();
const runId = Number(insRun.run(gitHead, now, now, 'pair', 'godot-2.0.1', `${GAME_VERSION}/godot`, nPerPair, seedBase, batches.length, JSON.stringify({ engine: 'godot' }), JSON.stringify({ spread: spread.toFixed(1) + '%', standings: standings.map((s) => `${s.label}=${(s.rate * 100).toFixed(1)}%`) })).lastInsertRowid);
const insCfg = db.prepare('INSERT INTO configs (run_id, idx, label, overrides_json) VALUES (?, ?, ?, ?)');
const cfgIds = [];
teams.forEach((t, i) => {
  cfgIds.push(Number(insCfg.run(runId, i, t.label, '{}').lastInsertRowid));
});
const insPair = db.prepare('INSERT OR REPLACE INTO pair_results (run_id, config_id, top_idx, bottom_idx, n, top_wins, bottom_wins, draws, avg_ticks, timeouts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
for (const res of allResults) {
  const meta = jobMeta.get(res.pairIdx);
  if (!meta) continue;
  const total = res.wins0 + res.wins1 + res.draws;
  insPair.run(runId, cfgIds[meta.i], meta.i, meta.j, total, res.wins0, res.wins1, res.draws, res.ticksTotal / total, res.timeouts);
}
const insUnit = db.prepare('INSERT OR REPLACE INTO unit_stats (run_id, config_id, comp_idx, def_id, star, battles, deaths, dealt, taken, healed, absorbed, casts, dealt_p, dealt_m, dealt_t, taken_p, taken_m, taken_t) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
for (const u of unitAgg.values()) {
  insUnit.run(runId, cfgIds[u.compIdx], u.compIdx, u.defId, u.star, u.battles, u.deaths, u.dealt, u.taken, u.healed, u.absorbed, u.casts, u.dealtP, u.dealtM, u.dealtT, u.takenP, u.takenM, u.takenT);
}
db.close();

// ── 报告 ──
const totalBattles = allResults.reduce((a, r) => a + r.wins0 + r.wins1 + r.draws, 0);
console.log(`[balance] engine=godot 配对=${allResults.length} 局=${totalBattles} n/对=${nPerPair} seedBase=${seedBase}`);
console.log(`[balance] godot 计算耗时 ${Math.round(gdMs)}ms（${Math.round(totalBattles / (gdMs / 1000))} 局/秒）· 总墙钟 ${((Date.now() - t0) / 1000).toFixed(1)}s · ${batches.length} 进程`);
console.log(`[balance] 九套胜率极差 ${spread.toFixed(1)}%`);
for (const s of standings) {
  console.log(`  ${(s.rate * 100).toFixed(1)}%  ${s.label}`);
}
console.log(`[balance] 已入库 ${path.resolve(GODOT_DIR, dbPath)}（runs/configs/pair_results/unit_stats 四表）`);
