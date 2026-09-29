// 影子目录导出（防外部工具注入）：拷工程到临时目录（排除 out/.git/node_modules/.tmp*
// 与三份对拍夹具）→ 在影子内导出 → 校验导出日志零 mcp_interaction/零 error → exe 拷回
// godot/out/。任何退出路径（含异常）都经 finally 清掉影子目录。
// 背景：环境里的 godot MCP 会在编辑器进程运行期间向工程注入 mcp_interaction_server.gd
// （TCP 9090 监听）并改写 project.godot autoload——直接导出会把监听打进发布包。
// 2026-09-29 两次实证；本脚本是常设防线。
import { cpSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GODOT_EXE as GODOT } from './godot_exe.mjs';
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHADOW = path.join(tmpdir(), 'bzt-godot-export');

function fail(msg) {
  // 经 finally 收尾的失败路径：process.exit() 不走异常展开（finally 不执行），
  // 影子目录会残留数百 MB——2.4.1 审查修复。exitCode + throw 让 finally 清场
  console.error(msg);
  process.exitCode = 1;
  throw new Error(msg);
}

try {
  try {
    rmSync(SHADOW, { recursive: true, force: true });
  } catch (e) {
    // 残留句柄/杀软扫描可令 rmSync 抛 EBUSY/EPERM：如实失败并提示手动删除，
    // 而不是把旧影子目录留在原地让每次运行重复失败
    console.error(`[export] 旧影子目录删除失败（${e.code ?? e.message}）——请手动删除 ${SHADOW} 后重试`);
    process.exitCode = 1;
    throw e;
  }
  mkdirSync(SHADOW, { recursive: true });
  for (const ent of ['assets', 'audio', 'core', 'game', 'render', 'ui', 'addons', 'redist', '.godot']) {
    const src = path.join(HERE, ent);
    if (existsSync(src)) cpSync(src, path.join(SHADOW, ent), { recursive: true });
  }
  // data 只拷运行时真源 spec.json：battle/match/codec 三份对拍夹具共约 4.5MB，
  // 整目录拷贝会打进发布 PCK（cpSync 不看 .gitignore）
  mkdirSync(path.join(SHADOW, 'data'), { recursive: true });
  cpSync(path.join(HERE, 'data', 'spec.json'), path.join(SHADOW, 'data', 'spec.json'));
  for (const f of ['project.godot', 'export_presets.cfg']) {
    cpSync(path.join(HERE, f), path.join(SHADOW, f));
  }
  if (!existsSync(path.join(SHADOW, '.godot'))) {
    // .godot 导入缓存必拷（缺失时全新 import 会崩 0xC0000005）；到这里说明源端就没有，
    // 如实报错退出而不是静默重 import（旧兜底分支既永不触发也无状态检查）
    fail('[export] 源工程缺少 .godot 导入缓存——先在编辑器/headless --import 生成');
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
    fail('[export] 影子导出异常——中止拷回');
  }
  const exe = path.join(SHADOW, 'out', 'BaiZhanTianYuan.exe');
  mkdirSync(path.join(HERE, 'out'), { recursive: true });
  cpSync(exe, path.join(HERE, 'out', 'BaiZhanTianYuan.exe'));
  console.log('[export] exe 已拷回 godot/out/BaiZhanTianYuan.exe', statSync(exe).size, 'bytes');
} finally {
  rmSync(SHADOW, { recursive: true, force: true });
}
