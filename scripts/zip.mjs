// 跨平台 zip 打包（E3）—— 取代 release 里的 PowerShell Compress-Archive（Windows-only）。
//
// 用法：node scripts/zip.mjs <out.zip> <输入路径1> [输入路径2 ...]
// 文件以 basename 入包；目录递归、保留相对结构。UTF-8 文件名（fflate 自动置标志位）。
// 已压缩内容（png/ogg）占大头，用 level 1：速度优先，压缩率损失可忽略。
import { zipSync } from 'fflate';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length === 0) {
  console.error('用法: node scripts/zip.mjs <out.zip> <输入路径...>');
  process.exit(1);
}

/** 收集一个路径（文件或目录）下的全部条目：zip 内路径 → 本地绝对路径 */
function* walk(abs, zipPrefix) {
  const st = statSync(abs);
  if (st.isFile()) {
    yield [zipPrefix, abs];
    return;
  }
  for (const name of readdirSync(abs)) {
    yield* walk(join(abs, name), zipPrefix === '' ? name : `${zipPrefix}/${name}`);
  }
}

// 目录自身也产出占位条目：fflate 只为出现的键建条目，空目录不占位解压后即丢失
function* walkDirs(abs, dirPrefix) {
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    const zp = dirPrefix === '' ? name : `${dirPrefix}/${name}`;
    if (statSync(p).isDirectory()) {
      yield zp;
      yield* walkDirs(p, zp);
    }
  }
}

const entries = {};
for (const input of inputs) {
  const abs = resolve(root, input);
  if (!existsSync(abs)) {
    console.error(`✗ 打包输入不存在: ${input}`);
    process.exit(1);
  }
  for (const [zipPath, file] of walk(abs, basename(abs))) {
    entries[zipPath] = new Uint8Array(readFileSync(file));
  }
  if (statSync(abs).isDirectory()) {
    for (const dir of walkDirs(abs, basename(abs))) {
      entries[`${dir}/`] = new Uint8Array(0);
    }
  }
}

const zipped = zipSync(entries, { level: 1 });
const outAbs = resolve(root, out);
mkdirSync(dirname(outAbs), { recursive: true });
writeFileSync(outAbs, zipped);
const mb = (zipped.length / 1024 / 1024).toFixed(1);
console.log(`zip 完成 → ${out}（${Object.keys(entries).length} 个条目，${mb} MB）`);
