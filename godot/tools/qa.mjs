// 夜宴 Godot 版质量门禁（qa）：M0 版本 = 导入刷新 → 规格导出幂等 → RNG 对拍 → 编解码往返。
// 用法：node tools/qa.mjs   （npm run qa）
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run as runRngParity } from './parity_check.mjs';

const GODOT_EXE = 'C:/WORKSPACE/game/Godot_v4.7.1-stable_win64.exe';
// 注意：URL('..') 以 / 结尾，dirname 会再剥一层指到仓库根（实机事故根源），必须 resolve
const GODOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url))).replaceAll('\\', '/');

function extractTag(text, tag) {
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.indexOf(`${tag} `);
    if (i >= 0) {
      try {
        return JSON.parse(line.slice(i + tag.length + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const steps = [];
function step(name, ok, detail = '') {
  steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`);
}

// 1. 刷新全局类缓存（新增/改动 class_name 后 --script 探针依赖它，两轮实机教训）。
//    个别启动会僵死：限时 + 重试一次，两次超时判 FAIL 而不是挂死整个门禁。
{
  let ok = false;
  for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
    const r = spawnSync(GODOT_EXE, ['--headless', '--path', GODOT_DIR, '--import'], { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
    ok = r.status === 0;
  }
  step('import 刷新', ok);
}

// 1b. 全树脚本加载（--import 与 GdUnit4 都不深检未引用的渲染层：战斗场景曾带
//     Parse Error 过全部门禁，窗口实机冒烟才暴露——2026-09-29 教训，常设防线）
{
  const r = spawnSync(GODOT_EXE, ['--headless', '--path', GODOT_DIR, '--script', 'res://headless/parse_check.gd'], { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  step('全树 parse', r.status === 0 && /PARSE_ALL_OK/.test(String(r.stdout)), (String(r.stdout).match(/PARSE_FAIL \S+/g) ?? []).join(' '));
}

// 2. 规格导出 + 幂等（同源必同产物）
{
  const run1 = spawnSync(process.execPath, ['--import', 'tsx', 'tools/export_spec.mjs'], { cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  const spec1 = readFileSync(path.join(GODOT_DIR, 'data', 'spec.json'));
  const run2 = spawnSync(process.execPath, ['--import', 'tsx', 'tools/export_spec.mjs'], { cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  const spec2 = readFileSync(path.join(GODOT_DIR, 'data', 'spec.json'));
  step('spec 导出+对账', run1.status === 0 && run2.status === 0, String(run1.stdout).trim());
  step('spec 幂等', Buffer.compare(spec1, spec2) === 0);
}

// 3. GdUnit4 单元测试（纯逻辑，无 UI 输入，须 --ignoreHeadlessMode）
{
  const r = spawnSync(GODOT_EXE, ['--headless', '--path', GODOT_DIR, '-s', 'res://addons/gdUnit4/bin/GdUnitCmdTool.gd', '-a', 'tests', '--ignoreHeadlessMode'], { cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: 180_000 });
  const m = String(r.stdout).match(/(\d+) test cases \| (\d+) errors \| (\d+) failures/);
  step('GdUnit4 单测', r.status === 0, m ? m[0] : String(r.stderr).split('\n')[0] ?? '');
}

// 4. RNG 跨引擎对拍（默认百万抽样；--quick 时降为十万）
{
  const quick = process.argv.includes('--quick');
  const { rows, failed } = runRngParity(quick ? 100_000 : 1_000_000);
  step('rng 对拍', failed === 0, `${rows.length - failed}/${rows.length} 组合`);
}

// 5. 战斗跨引擎对拍（夹具重生成 → GDScript 逐事件重演比对）
{
  const gen = spawnSync(process.execPath, ['--import', 'tsx', 'tools/battle_parity.mjs', '--', '--n=6'], { cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: 300_000 });
  const probe = spawnSync(GODOT_EXE, ['--headless', '--path', GODOT_DIR, '--script', 'res://headless/battle_probe.gd'], { cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: 300_000 });
  const r = extractTag(probe.stdout, 'BATTLE_JSON');
  step('battle 对拍', gen.status === 0 && probe.status === 0 && r?.ok === true,
    r ? `${r.passed}/${r.cases} 局逐事件一致` : String(probe.stderr).split('\n')[0] ?? '');
}

// 6. 编解码往返（夹具重生成 → GDScript 重编码比对）
{
  const gen = spawnSync(process.execPath, ['--import', 'tsx', 'tools/parity_codec.mjs'], { cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  const probe = spawnSync(GODOT_EXE, ['--headless', '--path', GODOT_DIR, '--script', 'res://headless/codec_probe.gd'], { cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  const codec = extractTag(probe.stdout, 'CODEC_JSON');
  step('codec 往返', gen.status === 0 && probe.status === 0 && codec?.ok === true,
    codec ? `events=${codec.events} fnv1a32=${codec.fnv1a32}` : String(probe.stderr).split('\n')[0] ?? '');
}

// 7. 整局跨引擎对拍（夹具重生成：TS 跑真实 Match 整局（含人类操作剧本/撤销/存档
//    轮转/恩赐/每日）→ GDScript 同剧本重放逐状态行比对；--quick 时降为 2 种子）
{
  const quick = process.argv.includes('--quick');
  const seeds = quick ? '2' : '6';
  const gen = spawnSync(process.execPath, ['--import', 'tsx', 'tools/match_parity.mjs', '--', `--seeds=${seeds}`], { cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: 600_000 });
  const probe = spawnSync(GODOT_EXE, ['--headless', '--path', GODOT_DIR, '--script', 'res://headless/match_probe.gd'], { cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: 600_000 });
  const r = extractTag(probe.stdout, 'MATCH_JSON');
  step('match 对拍', gen.status === 0 && probe.status === 0 && r?.ok === true,
    r ? `${r.passed}/${r.passed + r.failed} 整局逐行一致 ${Math.round(r.ms / 100) / 10}s daily=0x${(r.dailySeed?.gd ?? 0).toString(16)}` : String(probe.stderr).split('\n')[0] ?? '');
}

// 8. 平衡工具链冒烟（M4：CRN 配对矩阵 n=2 → worker 执行 → SQLite 四表入库）
{
  const quick = process.argv.includes('--quick');
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'tools/balance.mjs', '--', '--pairs=6', '--n=2', '--db=out/balance-qa.db'], { cwd: GODOT_DIR, encoding: 'utf8', windowsHide: true, timeout: 600_000 });
  const ok = r.status === 0 && /配对=6 局=12/.test(String(r.stdout));
  const m = String(r.stdout).match(/极差 [0-9.]+%/);
  const detail = m ? m[0] : (String(r.stderr).split('\n')[0] ?? '');
  step('balance 冒烟', ok, detail);
}

const failed = steps.filter((s) => !s.ok).length;
console.log(`[qa] ${steps.length - failed}/${steps.length} 步通过`);
process.exit(failed === 0 ? 0 : 1);
