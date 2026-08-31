// 百战天元 · 一键发布（node scripts/release.mjs 或 npm run release）
//
// 产物（release/ 目录）：
//   百战天元.html          —— 单文件版：双击即玩（file:// 下内联脚本照常执行），
//                             微信/U盘/邮件直发，接收方无需安装任何东西。
//   dist-web/              —— 静态托管版：丢到任意静态服务器 / GitHub Pages /
//                             局域网共享即可，多块产物 + 相对路径（base './'）。
//   THIRD_PARTY_LICENSES.txt —— 典藏音乐出处清单（CC0，自愿署名）
//   百战天元-<版本>-web.zip —— 上述全部打包，便于分发归档。
//
// 门禁：类型检查（--skip-typecheck 可跳过）+ 全量测试 + 音乐审计（sha256）。
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit', shell: true });
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

console.log(`\n[1/5] 类型检查 + 全量测试`);
// --skip-typecheck：并行线未收敛时的发布通道（产物走 esbuild 不查类型，仅跳过整仓卫生门，单测照跑）
if (process.argv.includes('--skip-typecheck')) {
  console.log('  (--skip-typecheck: skip repo-wide typecheck)');
} else {
  run('npx tsc --noEmit');
}
run('npx vitest run');

console.log(`\n[2/5] 清理旧产物`);
for (const d of ['dist', 'release']) {
  if (existsSync(path.join(root, d))) rmSync(path.join(root, d), { recursive: true, force: true });
}
mkdirSync(path.join(root, 'release'), { recursive: true });

console.log(`\n[3/5] 音乐审计（文件存在 + sha256 + CC0 口径）+ 静态托管构建 → dist/`);
// 审计须在清理【之后】：它把 THIRD_PARTY_LICENSES.txt 写进 release/，
// 先审计后清理会把授权清单删掉
run('node scripts/audit-music.mjs');
run('npx vite build');

console.log(`\n[4/5] 单文件构建 → release/百战天元.html`);
run('npx vite build --mode singlefile --outDir release/single --emptyOutDir');
renameSync(path.join(root, 'release/single/index.html'), path.join(root, 'release/百战天元.html'));
rmSync(path.join(root, 'release/single'), { recursive: true, force: true });
cpSync(path.join(root, 'dist'), path.join(root, 'release/dist-web'), { recursive: true });

// 使用说明必须在打包【之前】落盘：zip 里的说明才是本次构建的说明（E2）
const html = readFileSync(path.join(root, 'release/百战天元.html'), 'utf8');
const sizeMB = (Buffer.byteLength(html) / 1024 / 1024).toFixed(1);
writeFileSync(
  path.join(root, 'release/使用说明.txt'),
  [
    '百战天元 · 分发包使用说明',
    '',
    '【方式一 · 双击即玩】',
    '  百战天元.html —— 用 Chrome / Edge / Firefox 打开即可游玩。',
    '  单文件零依赖零安装，存档保存在本机浏览器里；换电脑请用游戏内「继续对局」前的存档习惯（存档在本机，不随文件走）。',
    '',
    '【方式二 · 网页托管】',
    '  dist-web/ 文件夹整体上传到任意静态托管（GitHub Pages / 云 OSS / 公司内网服务器）。',
    '  局域网试玩：任意机器执行  npx serve dist-web  后分享地址即可。',
    '',
    '【音乐出处】',
    '  见 THIRD_PARTY_LICENSES.txt（四曲 CC0，作者 Kevin MacLeod，源自 FreePD）。',
    '',
    `版本 ${version} · 构建产物由 npm run release 生成`,
    '',
  ].join('\r\n'),
);

console.log(`\n[5/5] 打包 zip`);
const zip = `百战天元-${version}-web.zip`;
run(`node scripts/zip.mjs "release/${zip}" "release/百战天元.html" "release/dist-web" "release/使用说明.txt" "release/THIRD_PARTY_LICENSES.txt"`);

// 产物体检：单文件不得残留任何外链资源（src=/href= 指向文件的引用）
const external = html.match(/<(script|link)[^>]+(src|href)="(?!https?:|data:)[^"]+"/g) ?? [];
if (external.length) {
  console.error('✗ 单文件仍引用外部资源：', external);
  process.exit(1);
}

console.log(`
发布完成 → release/
  百战天元.html        ${sizeMB} MB（双击即玩）
  dist-web/            静态托管版
  THIRD_PARTY_LICENSES.txt  音乐出处
  ${zip}     分发归档（含使用说明）
`);
