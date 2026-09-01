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
// 门禁：版本三处一致 + 类型检查（--skip-typecheck 可跳过）+ 全量测试 + 音乐审计（sha256）。
// 构建全程写临时目录，成功后才原子替换 dist/ 与 release/ —— 中途失败时上一版产物完好。
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit', shell: true });
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

// 版本一致性门禁：version.ts（界面落款/金种子元信息）与 package.json 必须同值，
// 否则会出现"zip 是 1.4.0、界面显示 1.4.1"的错版分发
const verTs = readFileSync(path.join(root, 'src/version.ts'), 'utf8');
const gameVersion = /GAME_VERSION = '([^']+)'/.exec(verTs)?.[1];
if (gameVersion !== version) {
  console.error(`✗ 版本三处不一致：package.json=${version}，src/version.ts=${gameVersion}。发版前请同步两处。`);
  process.exit(1);
}

const DIST = path.join(root, 'dist');
const RELEASE = path.join(root, 'release');
const distTmp = path.join(root, 'dist.tmp');
const relTmp = path.join(root, 'release.tmp');

console.log(`\n[1/5] 类型检查 + 全量测试（v${version}）`);
// --skip-typecheck：并行线未收敛时的发布通道（产物走 esbuild 不查类型，仅跳过整仓卫生门，单测照跑）
if (process.argv.includes('--skip-typecheck')) {
  console.log('  (--skip-typecheck: skip repo-wide typecheck)');
} else {
  run('npx tsc --noEmit');
}
run('npx vitest run');

console.log(`\n[2/5] 音乐审计（文件存在 + sha256 + CC0 口径）+ 静态托管构建 → dist.tmp/`);
mkdirSync(relTmp, { recursive: true });
run('node scripts/audit-music.mjs release.tmp/THIRD_PARTY_LICENSES.txt');
run('npx vite build --outDir dist.tmp --emptyOutDir');

console.log(`\n[3/5] 单文件构建 → release.tmp/百战天元.html`);
run('npx vite build --mode singlefile --outDir release.tmp/single --emptyOutDir');
renameSync(path.join(relTmp, 'single/index.html'), path.join(relTmp, '百战天元.html'));
rmSync(path.join(relTmp, 'single'), { recursive: true, force: true });
cpSync(distTmp, path.join(relTmp, 'dist-web'), { recursive: true });

// 使用说明必须在打包【之前】落盘：zip 里的说明才是本次构建的说明（E2）
const html = readFileSync(path.join(relTmp, '百战天元.html'), 'utf8');
const sizeMB = (Buffer.byteLength(html) / 1024 / 1024).toFixed(1);
writeFileSync(
  path.join(relTmp, '使用说明.txt'),
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

console.log(`\n[4/5] 打包 zip`);
const zip = `百战天元-${version}-web.zip`;
run(`node scripts/zip.mjs "release.tmp/${zip}" "release.tmp/百战天元.html" "release.tmp/dist-web" "release.tmp/使用说明.txt" "release.tmp/THIRD_PARTY_LICENSES.txt"`);

// 产物体检：单文件不得残留任何外链资源（src=/href= 指向文件的引用，
// 单双引号都查；再扫 CSS url() 与 srcset —— 漏一种写法就漏一类资源）
const external = [
  html.match(/<(script|link|img|audio|source|video|track)[^>]+(src|href|srcset)\s*=\s*"(?!https?:|data:)[^"]+"/gi) ?? [],
  html.match(/<(script|link|img|audio|source|video|track)[^>]+(src|href|srcset)\s*=\s*'(?!https?:|data:)[^']+'/gi) ?? [],
  // url() 只认小写（打包器产出的 CSS 恒为小写）、内容含路径特征（. 或 /），
  // 且排除 JS 拼接特征（+ $ {）—— 宽松版会被压缩 JS 的 URL(i)/URL(Q) 与
  // url("+this.src+') 之类动态串误杀（实测分别 27 处与 1 处）
  html.match(/url\(\s*['"]?(?!data:|https?:|blob:)[^)'"+${}]*[./][^)'"+${}]*['"]?\s*\)/g) ?? [],
].flat();
if (external.length) {
  console.error('✗ 单文件仍引用外部资源：', external);
  process.exit(1);
}

console.log(`\n[5/5] 原子替换 dist/ 与 release/`);
// 全部构建成功才走到这里：旧产物此刻才被替换，中途任何失败都不损上一版。
// 替换走「旧→.bak → 新落位 → 删 .bak」三步：rm+rename 两步版若 rename 被
// 占用/跨盘打断，旧产物已删新产物未落位，发布损坏且不可回滚。
for (const [tmp, dest] of [[distTmp, DIST], [relTmp, RELEASE]]) {
  const bak = `${dest}.bak`;
  const hadOld = existsSync(dest);
  if (hadOld) renameSync(dest, bak);
  try {
    renameSync(tmp, dest);
  } catch (err) {
    if (hadOld) renameSync(bak, dest); // 新版落位失败：旧版回滚复位
    throw err;
  }
  if (hadOld) rmSync(bak, { recursive: true, force: true });
}

console.log(`
发布完成 → release/
  百战天元.html        ${sizeMB} MB（双击即玩）
  dist-web/            静态托管版
  THIRD_PARTY_LICENSES.txt  音乐出处
  ${zip}     分发归档（含使用说明）
`);
