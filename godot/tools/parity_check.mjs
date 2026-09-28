// 跨引擎 RNG 对拍门禁：跑 TS 与 GDScript 双端同序列，语义比较（键序无关）。
// 用法：node tools/parity_check.mjs [--draws 1000000]
// 退出码非 0 = 存在不一致。被 qa.mjs 调用。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const GODOT_EXE = 'C:/WORKSPACE/game/Godot_v4.7.1-stable_win64.exe';
// 注意：URL('..') 以 / 结尾，dirname 会再剥一层指到仓库根（实机事故根源），必须 resolve
const GODOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url))).replaceAll('\\', '/');
/** 单次探针硬超时：防个别 Godot 启动僵死拖垮整个门禁（实机教训） */
const PROBE_TIMEOUT_MS = 180_000;
const MODES = ['rng', 'seq'];
const SEEDS = [12345, 999331, 88];

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    out[k] = v ?? '';
  }
  return out;
}

/** 从进程输出里提取 `TAG {json}` 行（双端都以此协议交付结果） */
function extractTag(text, tag) {
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.indexOf(`${tag} `);
    if (i >= 0) return JSON.parse(line.slice(i + tag.length + 1));
  }
  return null;
}

function runTs(args) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'tools/parity_rng.mjs', '--', ...args], {
    cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: PROBE_TIMEOUT_MS,
  });
  return extractTag(r.stdout, 'PARITY_JSON') ?? { __error: r.stderr };
}

function runGd(args) {
  const r = spawnSync(GODOT_EXE, ['--headless', '--path', GODOT_DIR, '--script', 'res://headless/rng_parity.gd', '--', ...args], {
    cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: PROBE_TIMEOUT_MS,
  });
  return extractTag(r.stdout, 'PARITY_JSON') ?? { __error: (r.error?.code ?? '') + String(r.stderr ?? '').slice(0, 300) };
}

const FIELDS = ['mode', 'seed', 'draws', 'fnv1a32', 'sha256', 'head', 'tail'];

export function run(draws = 1_000_000) {
  const rows = [];
  let failed = 0;
  for (const mode of MODES) {
    for (const seed of SEEDS) {
      const args = [`--seed=${seed}`, `--draws=${draws}`, `--mode=${mode}`];
      const ts = runTs(args);
      const gd = runGd(args);
      const diffs = FIELDS.filter((k) => JSON.stringify(ts[k]) !== JSON.stringify(gd[k]));
      const ok = diffs.length === 0;
      if (!ok) failed += 1;
      rows.push({ mode, seed, ok, fnv: gd.fnv1a32 ?? '?', diffs, ts, gd });
    }
  }
  return { rows, failed, draws };
}

if (process.argv[1] && process.argv[1].endsWith('parity_check.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const { rows, failed, draws } = run(Number(args.draws ?? 1_000_000));
  for (const r of rows) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} rng mode=${r.mode} seed=${r.seed} draws=${draws} fnv1a32=${r.fnv}`);
    if (!r.ok) {
      for (const d of r.diffs) console.log(`  差异字段 ${d}: TS=${JSON.stringify(r.ts[d])} GD=${JSON.stringify(r.gd[d])}`);
    }
  }
  console.log(`[parity:rng] ${rows.length - failed}/${rows.length} 通过`);
  process.exit(failed === 0 ? 0 : 1);
}
