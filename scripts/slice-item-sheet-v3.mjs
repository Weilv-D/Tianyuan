/**
 * 装备图切分 v3 —— 格点定界 + 组件级归属 + 分水岭晕光（像素级所有权）。
 *
 * 矩形互斥裁切对互相穿插的装备（飘带跨框、晕光相连、体块相触）做不到完美。
 * 本版不再要求矩形互斥，改为**像素级所有权**：裁剪框允许重叠，框内只写归属
 * 本件的像素，邻件部分擦成透明。
 *
 * 三层规则：
 *   1. **格点定界**（xy-cut）：y/x 墨迹投影的谷线把整图切成格点 —— 谷线是
 *      装备间天然间隙，粘连处从最细的脖子切开。每行件数已知（旧 8/7/7、新
 *      6/6/6/4），谷线只取内部 10% 区间，贴边留白的假谷不参与。
 *   2. **组件级归属**：整图低阈值（alpha>45）连通域 = 完整部件（弩箭、飘带
 *      不会半路被格线裁断）。每个连通域归「像素重叠最大的格」；只有**显著
 *      横跨 ≥2 格**的大域（粘连体块）按格线逐像素劈给两格。
 *   3. **分水岭晕光**：淡光晕（alpha 12~45）从全部已归属像素做多源 BFS，
 *      每个晕光像素归最近的件 —— 相邻装备的光晕在分水岭上逐像素劈开。
 *
 * 运行：node scripts/slice-item-sheet-v3.mjs
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 输出锚到仓库根：脚本从任意 cwd 运行都落同一位（与 slice-sheet.mjs 同口径）
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, 'src/render/art/item/ai');
const T_BODY = 45;    // 组件阈值（低：部件保持完整）
const T_GLOW = 12;    // 晕光阈值
const MIN_PART = 150; // 组件最小面积（更小的是碎屑，交给 BFS 归属）
const FUSED_SHARE = 0.25; // 组件在第二个格的占比 ≥ 此值视为跨格粘连体

const SHEETS = [
  {
    src: 'design/items/item-sheet.png',
    rows: 3, maxCols: 8, bandCounts: [8, 7, 7],
    ids: [
      'moren', 'fafu', 'yunlv', 'lingzhu', 'quantao', 'xuanjia', 'doupeng', 'xueyu',
      'duanhun', 'jifeng', 'pojia', 'xueyin', 'xuehun', 'xuanming', 'buxiu',
      'yingxi', 'hunyuan', 'huitian', 'juling', 'budong', 'xuanwu', 'taixu',
    ],
  },
  {
    src: 'design/items/item-sheet-v2.png',
    rows: 4, maxCols: 6, bandCounts: [6, 6, 6, 4],
    ids: [
      'guanri', 'qinggui', 'hanyuan', 'jinglei', 'chilian', 'liuxing',
      'fuchen', 'zidian', 'shuangling', 'shixin', 'yinhun', 'shehun',
      'zijin', 'jiaowei', 'molongqi', 'jiuwei', 'chuitian', 'xuantie',
      'fulong', 'zhuifeng', 'cuidai', 'zixiaozhu',
    ],
  },
];

/** 谷底检测：平滑投影的窗口局部最小，按深度排序、最小间距约束、排除贴边 10% */
function findValleys(ink, from, to, count, length) {
  const w = Math.max(6, Math.round(length * 0.02));
  const sep = Math.max(24, Math.round(length * 0.06));
  const m = Math.round(length * 0.1);
  from += m;
  to -= m;
  const sm = new Array(to - from);
  for (let i = from; i < to; i++) {
    let s = 0, n = 0;
    for (let d = -2; d <= 2; d++) {
      const j = i + d;
      if (j < from || j >= to) continue;
      s += ink[j];
      n++;
    }
    sm[i - from] = s / Math.max(1, n);
  }
  const cand = [];
  for (let i = from + 2; i < to - 2; i++) {
    const v = sm[i - from];
    let isMin = true;
    for (let j = Math.max(from, i - w); j <= Math.min(to - 1, i + w); j++) {
      if (sm[j - from] < v) { isMin = false; break; }
    }
    if (isMin) cand.push(i);
  }
  cand.sort((a, b) => sm[a - from] - sm[b - from]);
  const picked = [];
  for (const c of cand) {
    if (picked.every((p) => Math.abs(p - c) >= sep)) picked.push(c);
    if (picked.length >= count) break;
  }
  if (picked.length < count) {
    for (const c of cand) {
      if (picked.includes(c)) continue;
      if (picked.every((p) => Math.abs(p - c) >= sep / 2)) picked.push(c);
      if (picked.length >= count) break;
    }
  }
  picked.sort((a, b) => a - b);
  if (picked.length < count) {
    console.error(`  ✗ 谷线不足：需要 ${count}，找到 ${picked.length}`);
    process.exit(1);
  }
  return picked;
}

/** 格点：行按谷线切，行内列按谷线切，全图连续铺满 */
function buildLattice(png, sheet) {
  const W = png.width, H = png.height, N = W * H;
  const ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (png.data[i * 4 + 3] > T_GLOW) ink[i] = 1;
  const rowInk = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    let r = 0;
    for (let x = 0; x < W; x++) if (ink[y * W + x]) r++;
    rowInk[y] = r;
  }
  const rowValleys = findValleys(rowInk, 0, H, sheet.rows - 1, H);
  const cells = [];
  let prev = 0;
  const bandBounds = [...rowValleys, H];
  bandBounds.forEach((y1, bandIdx) => {
    const y0 = prev;
    prev = y1;
    const colInk = new Array(W).fill(0);
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < W; x++) if (ink[y * W + x]) colInk[x]++;
    }
    const target = sheet.bandCounts[bandIdx];
    const colValleys = findValleys(colInk, 0, W, target - 1, W);
    let x0 = 0;
    for (const xv of [...colValleys, W]) {
      cells.push({ x0, x1: xv, y0, y1 });
      x0 = xv;
    }
  });
  if (cells.length !== sheet.ids.length) {
    console.error(`✗ ${sheet.src}: 格数 ${cells.length} ≠ 期望 ${sheet.ids.length}`);
    process.exit(1);
  }
  // 每像素格号（格连续铺满全图）
  const cellOf = new Int16Array(N);
  let k = 0;
  for (const c of cells) {
    for (let y = c.y0; y < c.y1; y++) {
      for (let x = c.x0; x < c.x1; x++) cellOf[y * W + x] = k;
    }
    k++;
  }
  return { cells, cellOf };
}

function sliceSheet(png, sheet) {
  const W = png.width, H = png.height, N = W * H;
  const { cells, cellOf } = buildLattice(png, sheet);

  const maskBody = new Uint8Array(N);
  const maskGlow = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const a = png.data[i * 4 + 3];
    if (a > T_BODY) maskBody[i] = 1;
    if (a > T_GLOW) maskGlow[i] = 1;
  }

  // ── 主体连通域 + 组件级归属 ──
  const label = new Int32Array(N).fill(-1);
  const comps = [];
  {
    const stack = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (!maskBody[s] || label[s] >= 0) continue;
      const cid = comps.length;
      let top = 0, area = 0;
      const perCell = new Map();
      stack[top++] = s;
      label[s] = cid;
      while (top > 0) {
        const p = stack[--top];
        area++;
        const cell = cellOf[p];
        perCell.set(cell, (perCell.get(cell) || 0) + 1);
        const px = p % W, py = (p - px) / W;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            if (nx < 0 || nx >= W) continue;
            const q = ny * W + nx;
            if (maskBody[q] && label[q] < 0) { label[q] = cid; stack[top++] = q; }
          }
        }
      }
      comps.push({ cid, area, perCell });
    }
  }
  // comp → 件（格号即件号）：重叠最大的格；显著跨 ≥2 格的粘连体标记为 fused
  const compCell = new Int32Array(comps.length).fill(-1);
  const compFused = new Uint8Array(comps.length);
  for (const c of comps) {
    if (c.area < MIN_PART) continue;
    let bestCell = -1, bestN = 0, total = 0, secondN = 0;
    for (const [cell, n] of c.perCell) {
      total += n;
      if (n > bestN) { secondN = bestN; bestN = n; bestCell = cell; }
      else if (n > secondN) secondN = n;
    }
    compCell[c.cid] = bestCell;
    if (bestN / total < 1 - FUSED_SHARE && secondN / total >= FUSED_SHARE) compFused[c.cid] = 1;
  }

  // ── 像素归属：普通域整域归件；fused 域按格线逐像素劈开 ──
  const itemOf = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    const c = label[i];
    if (c < 0 || compCell[c] < 0) continue;
    itemOf[i] = compFused[c] ? cellOf[i] : compCell[c];
  }

  // ── 分水岭晕光：从已归属像素多源 BFS，晕光像素归最近件 ──
  const q = new Int32Array(N);
  let head = 0, tail = 0;
  for (let i = 0; i < N; i++) if (itemOf[i] >= 0) q[tail++] = i;
  while (head < tail) {
    const p = q[head++];
    const px = p % W, py = (p - px) / W;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = py + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx;
        if (nx < 0 || nx >= W) continue;
        const qq = ny * W + nx;
        if (maskGlow[qq] && itemOf[qq] < 0) { itemOf[qq] = itemOf[p]; q[tail++] = qq; }
      }
    }
  }
  return { itemOf };
}

mkdirSync(OUT, { recursive: true });
for (const sheet of SHEETS) {
  if (!existsSync(sheet.src)) {
    console.error(`✗ 源图不存在: ${sheet.src}`);
    process.exit(1);
  }
  const png = PNG.sync.read(readFileSync(sheet.src));
  const { itemOf } = sliceSheet(png, sheet);
  const W = png.width, H = png.height;
  const boxes = sheet.ids.map(() => ({ minX: W, minY: H, maxX: -1, maxY: -1 }));
  for (let i = 0; i < W * H; i++) {
    const k = itemOf[i];
    if (k < 0) continue;
    const x = i % W, y = (i - x) / W;
    const b = boxes[k];
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  }
  if (boxes.some((b) => b.maxX < 0)) {
    console.error(`✗ ${sheet.src}: 有空件`);
    process.exit(1);
  }
  const rowH = H / sheet.rows;
  const order = boxes.map((b, k) => ({ k, cx: (b.minX + b.maxX) / 2, row: Math.min(sheet.rows - 1, Math.floor(((b.minY + b.maxY) / 2) / rowH)) }));
  order.sort((a, b) => a.row - b.row || a.cx - b.cx);
  order.forEach((o, idx) => {
    const id = sheet.ids[idx];
    const b = boxes[o.k];
    const w = b.maxX - b.minX + 1, h = b.maxY - b.minY + 1;
    const img = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gi = (b.minY + y) * W + (b.minX + x);
        if (itemOf[gi] !== o.k) continue; // 非本件像素透明（邻件部分在此擦除）
        const si = gi * 4;
        const di = (y * w + x) * 4;
        img.data[di] = png.data[si];
        img.data[di + 1] = png.data[si + 1];
        img.data[di + 2] = png.data[si + 2];
        img.data[di + 3] = png.data[si + 3];
      }
    }
    const dest = `${OUT}/${id}.png`;
    const tmp = `${dest}.tmp`;
    writeFileSync(tmp, PNG.sync.write(img));
    rmSync(dest, { force: true });
    renameSync(tmp, dest);
    console.log(`${id}.png  ${w}x${h}  @(${b.minX},${b.minY})`);
  });
}
console.log('完成。');
