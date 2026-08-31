/**
 * 装备图切分：design/items/item-sheet.png（8 列 × 3 行，透明底）
 *  → src/render/art/item/ai/<itemId>.png（22 张；row1 = 8 组件，row2/3 = 成装 14 选 16）
 *
 * 映射按"外观语义 ↔ 装备机制"定（装备名已随图更名，见 data/items.ts）：
 *  r1: 翠玦(moren) 玉卷轴(fafu) 轻羽(yunlv) 灵珠(lingzhu)
 *      紫晶(quantao) 金锭(xuanjia) 赤绳(doupeng) 青莲(xueyu)
 *  r2: 断魂刃(duanhun) 疾风弓(jifeng) 破甲杖(pojia) 血饮(xueyin)
 *      血魂珠(xuehun) 玄冥衣(xuanming) 鹤龄镜(buxiu)
 *  r3: 影袭(yingxi) [凤翼·未用] 混元珠(hunyuan) 回天灯(huitian)
 *      巨灵冠(juling) 不动明王(budong) 玄武(xuanwu) 太虚经(taixu)
 * 运行：node scripts/slice-item-sheet.mjs
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = 'design/items/item-sheet.png';
const OUT = 'src/render/art/item/ai';
const COLS = 8;
const ROWS = 3;
const PAD = 3;

/** 22 件的格位（行列从 1 起）。r2c8 / r3c2 两格不入库。 */
const MAP = {
  moren: [1, 1],
  fafu: [1, 2],
  yunlv: [1, 3],
  lingzhu: [1, 4],
  quantao: [1, 5],
  xuanjia: [1, 6],
  doupeng: [1, 7],
  xueyu: [1, 8],
  duanhun: [2, 1],
  jifeng: [2, 2],
  pojia: [2, 3],
  xueyin: [2, 4],
  xuehun: [2, 5],
  xuanming: [2, 6],
  buxiu: [2, 7],
  yingxi: [3, 1],
  hunyuan: [3, 3],
  huitian: [3, 4],
  juling: [3, 5],
  budong: [3, 6],
  xuanwu: [3, 7],
  taixu: [3, 8],
};

const png = PNG.sync.read(readFileSync(SRC));
const cellW = png.width / COLS;
const cellH = png.height / ROWS;

mkdirSync(OUT, { recursive: true });

let ok = 0;
const empty = [];
for (const [id, [r, c]] of Object.entries(MAP)) {
  const x0 = Math.round((c - 1) * cellW);
  const y0 = Math.round((r - 1) * cellH);
  const x1 = Math.round(c * cellW);
  const y1 = Math.round(r * cellH);

  // 内容包围盒（alpha > 16）
  let minX = x1, minY = y1, maxX = x0 - 1, maxY = y0 - 1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) {
    empty.push(`${id}@r${r}c${c}`);
    continue;
  }
  minX = Math.max(0, minX - PAD);
  minY = Math.max(0, minY - PAD);
  maxX = Math.min(png.width - 1, maxX + PAD);
  maxY = Math.min(png.height - 1, maxY + PAD);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y + minY) * png.width + (x + minX)) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  writeFileSync(`${OUT}/${id}.png`, PNG.sync.write(out));
  ok++;
  console.log(`${id}.png  ${w}x${h}`);
}
console.log(`入库 ${ok}/22；空格：${empty.length ? empty.join(' ') : '无'}`);
