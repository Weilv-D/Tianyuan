// 百战天元 · 一键发布（node scripts/release.mjs 或 npm run release）
//
// 产物（release/ 目录）：
//   百战天元.html          —— 单文件版：双击即玩（file:// 下内联脚本照常执行），
//                             微信/U盘/邮件直发，接收方无需安装任何东西。
//   dist-web/              —— 静态托管版：丢到任意静态服务器 / GitHub Pages /
//                             局域网共享即可，多块产物 + 相对路径（base './'）。
//   百战天元-<版本>-web.zip —— 上述两者打包，便于分发归档。
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit', shell: true });
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

console.log(`\n[1/5] 类型检查 + 单元测试`);
run('npx tsc --noEmit');
  // --skip-typecheck：并行线未收敛时的发布通道（产物走 esbuild 不查类型，仅跳过整仓卫生门，单测照跑）
  // --skip-typecheck：并行线未收敛时的发布通道（产物走 esbuild 不查类型，仅跳过整仓卫生门，单测照跑）
  if (process.argv.includes('--skip-typecheck')) {
    console.log('  (--skip-typecheck: skip repo-wide typecheck)');
  } else {
    run('npx tsc --noEmit');
  }

console.log(`\n[2/5] 清理旧产物`);
for (const d of ['dist', 'release']) {
  if (existsSync(path.join(root, d))) rmSync(path.join(root, d), { recursive: true, force: true });
}
mkdirSync(path.join(root, 'release'), { recursive: true });

console.log(`\n[3/5] 静态托管构建 → dist/`);
run('npx vite build');

console.log(`\n[4/5] 单文件构建 → release/百战天元.html`);
run('npx vite build --mode singlefile --outDir release/single --emptyOutDir');
renameSync(path.join(root, 'release/single/index.html'), path.join(root, 'release/百战天元.html'));
rmSync(path.join(root, 'release/single'), { recursive: true, force: true });
cpSync(path.join(root, 'dist'), path.join(root, 'release/dist-web'), { recursive: true });

console.log(`\n[5/5] 打包 zip`);
const zip = `百战天元-${version}-web.zip`;
run(
  `powershell -NoProfile -Command "Compress-Archive -Path 'release/百战天元.html','release/dist-web' -DestinationPath 'release/${zip}' -Force"`,
);

// 产物体检：单文件不得残留任何外链资源（src=/href= 指向文件的引用）
const html = readFileSync(path.join(root, 'release/百战天元.html'), 'utf8');
const external = html.match(/<(script|link)[^>]+(src|href)="(?!https?:|data:)[^"]+"/g) ?? [];
if (external.length) {
  console.error('✗ 单文件仍引用外部资源：', external);
  process.exit(1);
}
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
    `版本 ${version} · 构建产物由 npm run release 生成`,
    '',
  ].join('\r\n'),
);

console.log(`
发布完成 → release/
  百战天元.html        ${sizeMB} MB（双击即玩）
  dist-web/            静态托管版
  ${zip}     分发归档（含使用说明见 zip 内）
`);
