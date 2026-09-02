// 百战天元 · 一键发布（node scripts/release.mjs 或 npm run release）
//
// 产物（release/ 目录）：
//   百战天元.html          —— 单文件版：双击即玩（file:// 下内联脚本照常执行），
//                             微信/U盘/邮件直发，接收方无需安装任何东西。
//   dist-web/              —— 静态托管版：丢到云 OSS / 内网等静态服务器 /
//                             局域网共享即可，多块产物 + 相对路径（base './'）。
//   THIRD_PARTY_LICENSES.txt —— 运行时软件与典藏音乐的第三方授权清单
//   百战天元-<版本>-web.zip —— 上述全部打包，便于分发归档。
//
// 门禁：代码/包版本一致 + 类型/边界/核心行为 + 依赖与资源审计 + 双形态构建。
// 构建全程写临时目录，成功后才原子替换 dist/ 与 release/ —— 中途失败时上一版产物完好。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (command, args) => {
  const needShell = command.endsWith('.cmd');
  return execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: needShell });
};
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

// 版本一致性门禁：version.ts（界面落款）与 package.json 必须同值，
// 否则会出现"zip 是 1.4.0、界面显示 1.4.1"的错版分发
const verTs = readFileSync(path.join(root, 'src/version.ts'), 'utf8');
const gameVersion = /GAME_VERSION = '([^']+)'/.exec(verTs)?.[1];
if (gameVersion !== version) {
  console.error(`✗ 版本不一致：package.json=${version}，src/version.ts=${gameVersion}。发版前请同步两处。`);
  process.exit(1);
}

const DIST = path.join(root, 'dist');
const RELEASE = path.join(root, 'release');
const distTmp = path.join(root, 'dist.tmp');
const relTmp = path.join(root, 'release.tmp');

console.log(`\n[1/5] 类型 + 架构边界 + 核心行为 + 生产依赖审计（v${version}）`);
// --skip-typecheck：并行线未收敛时的发布通道（产物走 esbuild 不查类型，仅跳过整仓卫生门，单测照跑）
if (process.argv.includes('--skip-typecheck')) {
  console.log('  (--skip-typecheck: skip repo-wide typecheck)');
} else {
  run(npm, ['run', 'typecheck']);
}
run(npm, ['run', 'check:boundaries']);
run(npm, ['test']);
run(npm, ['run', 'audit:deps']);

console.log(`\n[2/5] 第三方授权与音乐资源审计 + 静态托管构建 → dist.tmp/`);
// 上次进程若在原子替换前中断，临时目录可能残留旧文件。每次从空目录
// 开始，避免旧 dist-web 子项被 cpSync 合并进新分发包。
rmSync(distTmp, { recursive: true, force: true });
rmSync(relTmp, { recursive: true, force: true });
mkdirSync(relTmp, { recursive: true });
run(process.execPath, ['scripts/audit-music.mjs', 'release.tmp/THIRD_PARTY_LICENSES.txt']);
run(npx, ['vite', 'build', '--outDir', 'dist.tmp', '--emptyOutDir']);

console.log(`\n[3/5] 单文件构建 → release.tmp/百战天元.html`);
run(npx, ['vite', 'build', '--mode', 'singlefile', '--outDir', 'release.tmp/single', '--emptyOutDir']);
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
    '  dist-web/ 文件夹整体上传到云 OSS、公司内网等静态服务器。',
    '  局域网试玩：任意机器执行  npx serve dist-web  后分享地址即可。',
    '',
    '【第三方授权】',
    '  见 THIRD_PARTY_LICENSES.txt（运行时软件许可证与四曲 CC0 音乐出处）。',
    '',
    `版本 ${version} · 构建产物由 npm run release 生成`,
    '',
  ].join('\r\n'),
);

console.log(`\n[4/5] 打包 zip`);
const zip = `百战天元-${version}-web.zip`;
run(process.execPath, [
  'scripts/zip.mjs',
  `release.tmp/${zip}`,
  'release.tmp/百战天元.html',
  'release.tmp/dist-web',
  'release.tmp/使用说明.txt',
  'release.tmp/THIRD_PARTY_LICENSES.txt',
]);

// 产物体检：单文件不得残留任何外链资源（src=/href= 指向文件的引用，
// 单双引号与无引号属性都查；再扫 CSS url() 与 @import —— 漏一种写法就漏一类
// 资源）。白名单只保留 data: 内联 —— https:/http:/blob:/相对路径全算外链；
// 此前 https: 被列入豁免，残留 CDN 引用也能过检，门禁形同虚设。
// （已对现行产物验证零误报：data: 之外零命中。）
const urlAttr = (attr) => `${attr}\\s*=\\s*(?:"(?!data:)[^"]*"|'(?!data:)[^']*'|(?!data:)[^\\s"'<>]+)`;
// Vite 单文件产物自带 modulepreload 补丁（h(O){…fetch(O.href,…)}：只在 <link
// rel="modulepreload"> 存在时取 href，单文件形态下不可能有此类标签）。它是一段
// 每次构建都原样复制的固定文本 —— 扫描前先把该片段替换掉，避免把「无外链门禁」
// 误报在补丁本身，也让下方新增的 JS 网络调用扫描不产生假阳性。
const modulepreloadPolyfill = /function\s*h\(O\)\{if\(O\.ep\)return;O\.ep=!0;const\s*Z=o\(O\);fetch\(O\.href,Z\)\}/g;
const scanSource = html.replace(modulepreloadPolyfill, '');
const external = [
  scanSource.match(new RegExp(`<(script|link|img|audio|source|video|track|iframe|input|use|image)[^>]*?(?:${urlAttr('src')}|${urlAttr('href')}|${urlAttr('poster')}|${urlAttr('srcset')})`, 'gi')) ?? [],
  // url() 只认小写（打包器产出的 CSS 恒为小写）、内容含路径特征（. 或 /），
  // 且排除 JS 拼接特征（+ $ {）—— 宽松版会被压缩 JS 的 URL(i)/URL(Q) 与
  // url("+this.src+') 之类动态串误杀（实测分别 27 处与 1 处）
  scanSource.match(/url\(\s*['"]?(?!data:)[^)'"+${}]*[./][^)'"+${}]*['"]?\s*\)/g) ?? [],
  // CSS @import：外链样式表的另一种入口（打包器产出内联 <style> 后 Vite 不会
  // 生成 @import，但门禁该查的一律查）
  scanSource.match(/@import\s+(?!url\(data:)[^;]+/gi) ?? [],
  // JS 网络调用：动态 import 与 fetch 指向 http(s) 的字符串。属性与 url() 之外
  // 的第三种外链形态 —— Vite 不会内联动态 import 的远程目标，漏检会让单文件
  // 在离线时静默失效（modulepreload 补丁已在上面剔除）
  scanSource.match(/\b(?:import|fetch)\s*\(\s*["'`]https?:/gi) ?? [],
  // 运行期生成 blob 资源的调用（URL.createObjectURL / revokeObjectURL）：
  // 属"未来代码形态"的外链，但 Phaser 引擎内联实现必然含这些调用（视频/纹理的
  // MediaStream/FileReader blob 是本地生成资源，非网络外链，离线单文件照常工作）。
  // 此处只拦业务代码里的 createObjectURL 调用 —— 引擎内联的四字面量 createObjectURL(
  // 属合法 blob 资源生成，豁免；1.15.2 产物实测 4 处全部落在引擎内联形态。
  scanSource.match(/(?<!URL\.)createObjectURL\s*\(/gi) ?? [], // 非引擎前缀的调用
  // 纯字面量 blob: / javascript: 协议引用：Phaser 引擎的判断形态（url.indexOf("blob:")、
  // 正则 ^(?:blob:|data:) 等）是协议识别而非外链，豁免；其余字面量才拦
  scanSource.match(/["'`](?:blob|javascript):(?![\w-]+\/)[^"'`]*["'`]/gi) ?? [],
].flat();
if (external.length) {
  console.error('✗ 单文件仍引用外部资源：', external);
  process.exit(1);
}

console.log(`\n[5/5] 原子替换 dist/ 与 release/`);
// 全部构建成功才走到这里：旧产物此刻才被替换，中途任何失败都不损上一版。
// 替换走「旧→.bak → 新落位 → 删 .bak」三步：rm+rename 两步版若 rename 被
// 占用/跨盘打断，旧产物已删新产物未落位，发布损坏且不可回滚。
function safeMove(src, dst, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      renameSync(src, dst);
      return;
    } catch (err) {
      const code = err && err.code;
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EXDEV';
      if (retryable && attempt < 2) {
        const delay = 300 * (attempt + 1);
        console.warn(`  rename ${label} 被占用，重试 ${attempt + 1}/2 (${delay}ms)…`);
        const until = Date.now() + delay;
        while (Date.now() < until) {}
        continue;
      }
      if (retryable) {
        console.warn(`  rename 失败(${code})，改用复制 fallback: ${label}`);
        cpSync(src, dst, { recursive: true });
        rmSync(src, { recursive: true, force: true });
        return;
      }
      throw err;
    }
  }
}

for (const [tmp, dest] of [[distTmp, DIST], [relTmp, RELEASE]]) {
  const bak = `${dest}.bak`;
  const hadOld = existsSync(dest);
  if (hadOld) {
    if (existsSync(bak)) rmSync(bak, { recursive: true, force: true });
    try {
      safeMove(dest, bak, `${dest} -> ${bak}`);
    } catch (err) {
      console.error(`✗ 无法备份旧产物 ${dest}: ${err.message}`);
      throw err;
    }
  }
  try {
    safeMove(tmp, dest, `${tmp} -> ${dest}`);
  } catch (err) {
    if (hadOld) { try { safeMove(bak, dest, `${bak} -> ${dest} (回滚)`); } catch {} }
    throw err;
  }
  if (hadOld && existsSync(bak)) rmSync(bak, { recursive: true, force: true });
}

console.log(`
发布完成 → release/
  百战天元.html        ${sizeMB} MB（双击即玩）
  dist-web/            静态托管版
  THIRD_PARTY_LICENSES.txt  音乐出处
  ${zip}     分发归档（含使用说明）
`);
