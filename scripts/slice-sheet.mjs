/**
 * 8×8 棋子原图切分器。
 *
 * 用法：node scripts/slice-sheet.mjs
 * 输入：design/pieces/sheet-8x8.png（透明底，行优先 64 格）
 * 输出：src/render/art/piece/ai/<defId>.png × 64（按内容包围盒裁边，保留 alpha）
 *
 * 分配表按"立绘气质 ↔ 棋子称号/职业"对位（如九尾狐→青丘、白翼→应龙、
 * 塔盾武士→镇岳、红幡→九原、龟蛇缠矛→玄武），行优先读格。
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** 行优先 8×8 → defId */
const GRID = [
  'lingxiao', 'kutong', 'yunchu', 'jinghong', 'guicheng', 'yingsha', 'bainiang', 'zhechong',
  'moyu', 'lingque', 'zhenfeng', 'xinhuan', 'taozhu', 'taibu', 'wujiu', 'xuanji',
  'haotian', 'moyan', 'qingqiu', 'dasiming', 'hanxing', 'chitong', 'qingming', 'budong',
  'ajiu', 'duanyue', 'baitao', 'wangxiang', 'zhuyan', 'zhenyue', 'jingyu', 'mozhai',
  'yeyou', 'qinghe', 'muji', 'yuansu', 'shidian', 'canglan', 'jiuyuan', 'gongshu',
  'wuhuo', 'guzhen', 'moliu', 'yusuan', 'baopu', 'muyuan', 'podu', 'shihu',
  'canghao', 'zhaoye', 'ruijin', 'yinglong', 'paoche', 'jingbo', 'aoyin', 'xijue',
  'xuanwu', 'yaoguang', 'jiaohan', 'gouchen', 'chiji', 'pan', 'chaoji', 'jiuying',
];

// ── 与 champions.ts 的名单对账 ──
const champsSrc = readFileSync(join(root, 'src/data/champions.ts'), 'utf8');
const roster = [...champsSrc.matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]);
if (roster.length !== 64) throw new Error(`champions.ts 棋子数 ${roster.length} ≠ 64`);
const sortedA = [...GRID].sort();
const sortedB = [...roster].sort();
for (let i = 0; i < 64; i++) {
  if (sortedA[i] !== sortedB[i]) throw new Error(`分配表与名单不一致：${sortedA[i]} ≠ ${sortedB[i]}`);
}

// ── 读图 ──
const SHEET = join(root, 'design/pieces/sheet-8x8.png');
if (!existsSync(SHEET)) {
  console.error(`源图不存在: ${SHEET}`);
  process.exit(1);
}
const sheet = PNG.sync.read(readFileSync(SHEET));
const { width: W, height: H, data } = sheet;
const alphaAt = (x, y) => data[(y * W + x) * 4 + 3];

const outDir = join(root, 'src/render/art/piece/ai');
mkdirSync(outDir, { recursive: true });

const cellW = W / 8;
const cellH = H / 8;
const report = [];

for (let i = 0; i < 64; i++) {
  const row = Math.floor(i / 8);
  const col = i % 8;
  const x0 = Math.round(col * cellW);
  const y0 = Math.round(row * cellH);
  const x1 = Math.round((col + 1) * cellW);
  const y1 = Math.round((row + 1) * cellH);

  // 内容包围盒（alpha > 8）
  let minX = x1, minY = y1, maxX = x0 - 1, maxY = y0 - 1;
  let opaque = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (alphaAt(x, y) > 8) {
        opaque++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) throw new Error(`格 (${row + 1},${col + 1}) 无内容`);
  const coverage = opaque / ((x1 - x0) * (y1 - y0));

  // 裁边 + 3px 余量（钳制在格内，避免切进邻格）
  const pad = 3;
  const cx0 = Math.max(x0, minX - pad);
  const cy0 = Math.max(y0, minY - pad);
  const cx1 = Math.min(x1 - 1, maxX + pad);
  const cy1 = Math.min(y1 - 1, maxY + pad);
  const w = cx1 - cx0 + 1;
  const h = cy1 - cy0 + 1;

  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const srcStart = ((cy0 + y) * W + cx0) * 4;
    data.copy(out.data, y * w * 4, srcStart, srcStart + w * 4);
  }
  atomicWrite(join(outDir, `${GRID[i]}.png`), PNG.sync.write(out));
  report.push(`${GRID[i].padEnd(10)} (${row + 1},${col + 1}) ${w}x${h} 覆盖率${(coverage * 100).toFixed(0)}%`);
}

console.log(report.join('\n'));
console.log(`\n已切分 64 张 → ${outDir}`);

/** 原子写：先落临时文件再改名，进程被杀不会留下半截 PNG */
function atomicWrite(dest, data) {
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, data);
  // rename 同盘覆盖目标，先 rm 是有害的：两步之间崩溃会丢掉原 art 文件
  renameSync(tmp, dest);
}
