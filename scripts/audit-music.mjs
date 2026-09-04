// 典藏音乐审计（D4 门禁）—— 随 npm run release 执行，失败即停发布。
//
// 校验 src/music/tracks.json（清单单一真源）：
//   1. 每个曲目文件存在且 sha256 与清单一致（防替换/截断）
//   2. id 唯一
//   3. menu / prep / battle / final 四个心境全覆盖
//   4. 授权恒为 CC0-1.0（ADR D1：禁 CC-BY / 自定义授权）
// 同时从 package-lock 收集生产依赖许可证，生成完整的 THIRD_PARTY_LICENSES.txt。
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'src/music/tracks.json');
const outPath = process.argv[2]
  ? resolve(root, process.argv[2])
  : join(root, 'release/THIRD_PARTY_LICENSES.txt');

if (!existsSync(manifestPath)) {
  console.error('✗ 典藏音乐清单不存在：src/music/tracks.json');
  process.exit(1);
}
const tracks = JSON.parse(readFileSync(manifestPath, 'utf8'));

const REQUIRED_MOODS = ['menu', 'prep', 'battle', 'final'];
let failed = false;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  failed = true;
};

// 打包进浏览器的生产依赖必须随包携带许可证正文。package-lock 是依赖集合真源，
// 不维护会随升级漂移的手写名单。
const lockPath = join(root, 'package-lock.json');
if (!existsSync(lockPath)) {
  console.error('✗ package-lock.json 不存在 —— 依赖许可证审计没有真源可读');
  process.exit(1);
}
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const runtimePackages = [];
for (const [location, metadata] of Object.entries(lock.packages ?? {})) {
  if (!location.startsWith('node_modules/') || metadata.dev === true) continue;
  const packageDir = join(root, location);
  const packagePath = join(packageDir, 'package.json');
  if (!existsSync(packagePath)) {
    fail(`生产依赖未安装：${location}`);
    continue;
  }
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (pkg.version !== metadata.version) {
    fail(`${pkg.name ?? location}: 已安装版本 ${pkg.version} 与锁文件 ${metadata.version} 不一致`);
    continue;
  }
  const licenseFile = readdirSync(packageDir).find((name) => /^licen[cs]e(?:\.|$)/i.test(name));
  if (!pkg.license || !licenseFile) {
    fail(`${pkg.name ?? location}: 缺少许可证元数据或正文`);
    continue;
  }
  // SPDX 表达式可能是字符串、{type} 对象或旧式 licenses 数组 —— 统一规整成字符串
  const normalizeLicense = (raw) => {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') {
      if (typeof raw.type === 'string') return raw.type;
      if (Array.isArray(raw) && raw.length > 0) {
        const first = raw[0];
        return typeof first === 'string' ? first : first?.type ?? 'UNKNOWN';
      }
    }
    return 'UNKNOWN';
  };
  runtimePackages.push({
    name: pkg.name,
    version: pkg.version,
    license: normalizeLicense(pkg.license),
    text: readFileSync(join(packageDir, licenseFile), 'utf8').trim(),
  });
}

// 1) id 唯一
const ids = tracks.map((t) => t.id);
if (new Set(ids).size !== ids.length) fail(`曲目 id 重复：${ids.join(', ')}`);

// 2) 四心境全覆盖
for (const mood of REQUIRED_MOODS) {
  if (!ids.includes(mood)) fail(`心境「${mood}」没有对应曲目`);
}

// 3) 授权口径 + 文件存在 + sha256
for (const t of tracks) {
  if (t.license !== 'CC0-1.0') fail(`${t.id}: 授权 ${t.license} 不符（只收 CC0-1.0）`);
  const file = join(root, t.file);
  // 清单路径必须落在仓库内：`../` 之类越界路径会把库外文件的内容哈希进发布清单
  if (relative(root, file).startsWith('..')) {
    fail(`${t.id}: 路径越出仓库 ${t.file}`);
    continue;
  }
  if (!existsSync(file)) {
    fail(`${t.id}: 文件缺失 ${t.file}`);
    continue;
  }
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (sha !== t.sha256) fail(`${t.id}: sha256 不一致\n    清单 ${t.sha256}\n    实际 ${sha}`);
  else console.log(`✓ ${t.id.padEnd(6)} ${t.title} · ${t.artist} · CC0 · ${t.file}`);
}

// 4) 生成授权清单（release/THIRD_PARTY_LICENSES.txt）
if (!failed) {
  const lines = [
    '百战天元 · 第三方授权清单',
    '',
    '一、运行时软件',
    '',
    ...runtimePackages.flatMap((pkg) => [
      `软件：${pkg.name} ${pkg.version}`,
      `授权：${pkg.license}`,
      `来源：https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`,
      '',
      pkg.text,
      '',
    ]),
    '二、音乐作品',
    '',
    '本包包含以下 CC0-1.0（公有领域贡献）音乐作品。CC0 不设署名义务，',
    '此清单为工程自愿记录的完整出处。',
    '',
    ...tracks.flatMap((t) => [
      `曲名：${t.title}（心境 ${t.id}）`,
      `作者：${t.artist}`,
      `授权：${t.license} · https://creativecommons.org/publicdomain/zero/1.0/`,
      `来源：${t.sourceUrl}（FreePD 已关站，经 Internet Archive 取回）`,
      `入库文件：${t.file}（sha256 ${t.sha256}）`,
      '',
    ]),
    '转码：ffmpeg -af "apad=pad_dur=0.01" -c:a libvorbis -b:a 160k -ar 44100 -ac 2',
    '完整说明见仓库 design/music/CREDITS.md。',
    '',
  ];
  mkdirSync(dirname(outPath), { recursive: true });
  // 原子落盘：中断不留半截清单 —— 半截文件会被同一发布链的 zip 原样打进分发包
  //（与 zip.mjs / subset-seal.mjs 的 .tmp → rename 纪律同口径）
  const tmpPath = `${outPath}.tmp`;
  writeFileSync(tmpPath, lines.join('\r\n'), 'utf8');
  renameSync(tmpPath, outPath);
  console.log(`✓ 授权清单已生成 → ${process.argv[2] ?? 'release/THIRD_PARTY_LICENSES.txt'}`);
}

function renameWithRetry(src, dst) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      renameSync(src, dst);
      return;
    } catch (err) {
      const retryable = err && (err.code === 'EPERM' || err.code === 'EBUSY');
      if (retryable && attempt < 2) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300 * (attempt + 1));
        continue;
      }
      if (retryable) {
        unlinkSync(dst);
        copyFileSync(src, dst);
        unlinkSync(src);
        return;
      }
      throw err;
    }
  }
}

if (failed) {
  console.error('音乐审计未通过，发布中止。');
  process.exit(1);
}
console.log('音乐审计通过。');
