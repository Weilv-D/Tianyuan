// 影子目录导出（防外部工具注入）：拷工程到临时目录（排除 out/.git/node_modules/.tmp*）
// → 在影子内导出 → 校验导出日志零 mcp_interaction/零 error → exe 拷回 godot/out/。
// 背景：环境里的 godot MCP 会在编辑器进程运行期间向工程注入 mcp_interaction_server.gd
// （TCP 9090 监听）并改写 project.godot autoload——直接导出会把监听打进发布包。
// 2026-09-29 两次实证；本脚本是常设防线。
import { cpSync, mkdirSync, existsSync, rmSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GODOT = 'C:/WORKSPACE/game/Godot_v4.7.1-stable_win64.exe';
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHADOW = path.join(tmpdir(), 'bzt-godot-export');

rmSync(SHADOW, { recursive: true, force: true });
mkdirSync(SHADOW, { recursive: true });
for (const ent of ['assets', 'audio', 'core', 'data', 'game', 'render', 'ui', 'addons', 'redist', '.godot']) {
  const src = path.join(HERE, ent);
  if (existsSync(src)) cpSync(src, path.join(SHADOW, ent), { recursive: true });
}
for (const f of ['project.godot', 'export_presets.cfg']) {
  cpSync(path.join(HERE, f), path.join(SHADOW, f));
}
if (!existsSync(path.join(SHADOW, '.godot'))) {
  // 影子无导入缓存时先 --import 一次（有缓存则直接导出）
  spawnSync(GODOT, ['--headless', '--path', SHADOW, '--import'], { timeout: 600_000 });
}
mkdirSync(path.join(SHADOW, 'out'), { recursive: true });
const r = spawnSync(GODOT, ['--headless', '--path', SHADOW, '--export-release', 'Windows Desktop'], {
  timeout: 600_000, encoding: 'utf8',
});
const log = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
const mcp = (log.match(/mcp_interaction/g) ?? []).length;
const errs = (log.match(/^ERROR/gm) ?? []).length;
console.log(`[export] status=${r.status} errors=${errs} mcp_entries=${mcp}`);
if (r.status !== 0 || errs > 0 || mcp > 0) {
  console.error('[export] 影子导出异常——中止拷回');
  process.exit(1);
}
const exe = path.join(SHADOW, 'out', 'BaiZhanTianYuan.exe');
mkdirSync(path.join(HERE, 'out'), { recursive: true });
cpSync(exe, path.join(HERE, 'out', 'BaiZhanTianYuan.exe'));
console.log('[export] exe 已拷回 godot/out/BaiZhanTianYuan.exe', statSync(exe).size, 'bytes');
rmSync(SHADOW, { recursive: true, force: true });
