// 典藏音乐审计（D4 门禁）—— 随 npm run release 执行，失败即停发布。
//
// 校验 src/music/tracks.json（清单单一真源）：
//   1. 每个曲目文件存在且 sha256 与清单一致（防替换/截断）
//   2. id 唯一
//   3. menu / prep / battle / final 四个心境全覆盖
//   4. 授权恒为 CC0-1.0（ADR D1：禁 CC-BY / 自定义授权）
// 并生成 release/THIRD_PARTY_LICENSES.txt 随包分发（零署名义务下的自愿出处）。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'src/music/tracks.json');
const outPath = process.argv[2]
  ? join(root, process.argv[2])
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
  writeFileSync(outPath, lines.join('\r\n'), 'utf8');
  console.log(`✓ 授权清单已生成 → ${process.argv[2] ?? 'release/THIRD_PARTY_LICENSES.txt'}`);
}

if (failed) {
  console.error('音乐审计未通过，发布中止。');
  process.exit(1);
}
console.log('音乐审计通过。');
