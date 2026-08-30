/* 路线 B · 体素（Voxel）等距预渲染
 * 体素模型用盒子 DSL 定义，逐体素三面着色（顶亮 / 右中 / 左暗），画家算法排序，
 * 隐藏面剔除。接入时可离线烘焙成 PNG 精灵图，运行期零开销。 */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/** 盒子填充：[x0,y0,z0,x1,y1,z1,color]（闭区间） */
function fillBox(map, b) {
  const [x0, y0, z0, x1, y1, z1, color] = b;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        map.set(`${x},${y},${z}`, color);
}

/** 生成体素贴地图层 */
function plate(map, x0, x1, z0, z1, y, color) {
  fillBox(map, [x0, y, z0, x1, y, z1, color]);
}

const FACE_SHADE = { top: 1.28, px: 0.68, pz: 0.96 };
const COLOR_LIFT = 1.3;

function renderVoxel(canvas, boxes, opts = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width / dpr, H = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const map = new Map();
  for (const b of boxes) fillBox(map, b);
  const voxels = [...map.entries()].map(([k, color]) => {
    const [x, y, z] = k.split(',').map(Number);
    return { x, y, z, color };
  });

  // 包围盒只算棋子本体（y>=0），底座不参与拟合 —— 否则底座把比例压小
  let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
  for (const v of voxels) {
    if (v.y < 0) continue;
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x + 1);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y + 1);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z + 1);
  }
  const modelW = ((maxX - minX) + (maxZ - minZ)) * 0.55;
  const modelH = (maxY - minY) * 0.92 + ((maxX - minX) + (maxZ - minZ)) * 0.22;
  const s = Math.min((W - 24) / modelW, (H - 16) / modelH);
  const cx = W / 2 + 2;
  const baseY = H - 10;

  const proj = (x, y, z) => [cx + (x - z) * s * 0.5, baseY - ((x + z) * s * 0.22 + (y - minY) * s * 0.9)];

  const has = (x, y, z) => map.has(`${x},${y},${z}`);
  const rnd = mulberry32(7);

  // 画家算法：x+y+z 升序
  voxels.sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z));

  for (const v of voxels) {
    const { x, y, z } = v;
    const jit = 0.97 + rnd() * 0.06;
    const face = (pts, f) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [px, py] = proj(p[0], p[1], p[2]);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = shade(v.color, f * jit * COLOR_LIFT);
      ctx.fill();
      ctx.strokeStyle = shade(v.color, f * 0.45);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    if (!has(x, y + 1, z)) face([[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], FACE_SHADE.top);
    if (!has(x + 1, y, z)) face([[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]], FACE_SHADE.px);
    if (!has(x, y, z + 1)) face([[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], FACE_SHADE.pz);
  }
}

/* ── 模型：断岳 ── */
function voxelWarriorModel() {
  const P = (x0, y0, z0, x1, y1, z1, c) => [x0, y0, z0, x1, y1, z1, c];
  return [
    P(0, -1, 0, 15, -1, 9, '#2a303a'),
    // 靴 / 腿
    P(4, 0, 3, 6, 2, 6, '#3d4454'), P(9, 0, 3, 11, 2, 6, '#3d4454'),
    // 战裙 + 躯干
    P(3, 3, 2, 12, 4, 7, '#556048'),
    P(4, 5, 3, 11, 9, 6, '#5a6478'),
    P(4, 5, 6, 11, 8, 6, '#68748c'),
    P(4, 8, 6, 11, 8, 6, '#a04a38'),
    // 护肩
    P(2, 9, 2, 4, 11, 6, '#78859c'), P(11, 9, 2, 13, 11, 6, '#78859c'),
    // 臂 + 拳
    P(2, 6, 3, 3, 8, 5, '#4a5262'), P(12, 11, 3, 13, 13, 5, '#4a5262'),
    P(2, 5, 3, 3, 5, 5, '#d8c4a2'), P(12, 14, 3, 13, 14, 5, '#d8c4a2'),
    // 头盔 + 盔缨
    P(6, 12, 3, 9, 14, 6, '#7e8ba4'),
    P(6, 13, 6, 8, 13, 6, '#12151c'),
    P(9, 13, 6, 9, 13, 6, '#8fa0bd'),
    P(7, 15, 4, 8, 15, 5, '#a04a38'), P(7, 16, 4, 7, 16, 5, '#b85a42'),
    // 长刀（右侧立刃，亮钢）
    P(14, 2, 4, 15, 15, 5, '#a8b6c8'),
    P(14, 16, 4, 15, 16, 5, '#8a97ab'),
    P(13, 0, 4, 13, 3, 5, '#4e4028'),
  ];
}

/* ── 模型：磐 ── */
function voxelGolemModel() {
  const P = (x0, y0, z0, x1, y1, z1, c) => [x0, y0, z0, x1, y1, z1, c];
  return [
    P(0, -1, 0, 15, -1, 9, '#2a303a'),
    // 巨岩躯干
    P(3, 0, 2, 12, 1, 7, '#5e6878'),
    P(3, 2, 2, 12, 5, 7, '#6e7888'),
    P(4, 6, 3, 11, 6, 6, '#7a8494'),
    // 双拳拄地
    P(0, 0, 2, 3, 3, 6, '#5e6878'),
    P(12, 0, 2, 15, 3, 6, '#5e6878'),
    // 抬起的右拳
    P(13, 6, 3, 14, 8, 6, '#6e7888'),
    P(12, 5, 3, 13, 5, 5, '#5e6878'),
    // 头 + 琥珀目
    P(5, 7, 3, 9, 10, 6, '#8a94a4'),
    P(5, 10, 6, 9, 10, 6, '#7a8494'),
    P(5, 8, 6, 5, 8, 6, '#f0b84e'), P(9, 8, 6, 9, 8, 6, '#f0b84e'),
    // 苔衣
    P(5, 11, 4, 7, 11, 5, '#6e8a5e'),
    P(3, 6, 2, 4, 6, 3, '#5e7a52'),
    P(11, 6, 5, 12, 6, 6, '#5e7a52'),
    P(13, 9, 4, 14, 9, 4, '#6e8a5e'),
    // 碎石
    P(0, 0, 7, 1, 0, 8, '#565e6c'),
    P(14, 0, 7, 15, 0, 8, '#565e6c'),
  ];
}

/* ── 模型：朱炎 ── */
function voxelMageModel() {
  const P = (x0, y0, z0, x1, y1, z1, c) => [x0, y0, z0, x1, y1, z1, c];
  return [
    P(0, -1, 0, 15, -1, 9, '#2a303a'),
    // 长袍三段
    P(3, 0, 2, 12, 2, 7, '#3a4050'),
    P(4, 3, 3, 11, 6, 6, '#464c60'),
    P(4, 7, 3, 11, 9, 6, '#525a72'),
    P(7, 0, 7, 8, 8, 7, '#a04838'),
    // 腰绦
    P(4, 6, 6, 11, 6, 6, '#c9a96a'),
    // 左垂袖
    P(2, 6, 4, 3, 8, 5, '#464c60'),
    P(2, 5, 4, 3, 5, 5, '#7a3428'),
    // 右臂扬袖 + 手
    P(10, 8, 4, 11, 9, 5, '#464c60'),
    P(11, 10, 4, 12, 10, 5, '#464c60'),
    P(12, 11, 4, 13, 11, 5, '#525a72'),
    P(13, 12, 4, 14, 12, 5, '#d8c4a2'),
    // 火团 + 浮烬
    P(14, 13, 4, 15, 14, 5, '#e8883e'),
    P(14, 15, 4, 15, 16, 5, '#f2b44e'),
    P(14, 17, 4, 15, 17, 5, '#f7e3a0'),
    P(16, 18, 4, 16, 18, 4, '#e8883e'),
    P(12, 18, 4, 12, 18, 4, '#f2b44e'),
    // 兜帽 + 鹤喙 + 目
    P(6, 10, 3, 9, 12, 6, '#3a4050'),
    P(6, 11, 6, 9, 11, 6, '#2c3040'),
    P(7, 11, 7, 8, 11, 8, '#d8ccae'),
    P(6, 11, 6, 6, 11, 6, '#f0b84e'),
    // 冠羽
    P(7, 13, 4, 8, 13, 5, '#a04838'),
    P(8, 14, 4, 8, 14, 5, '#7a3428'),
  ];
}

/* ── 模型：惊羽 ── */
function voxelArcherModel() {
  const P = (x0, y0, z0, x1, y1, z1, c) => [x0, y0, z0, x1, y1, z1, c];
  return [
    P(0, -1, 0, 15, -1, 9, '#2a303a'),
    // 腿
    P(5, 0, 3, 6, 2, 5, '#3a4232'), P(9, 0, 3, 10, 2, 5, '#46503c'),
    // 猎装
    P(4, 3, 3, 11, 4, 6, '#5c6848'),
    P(4, 4, 6, 11, 4, 6, '#6a7854'),
    P(5, 5, 3, 10, 7, 6, '#5c6848'),
    P(5, 5, 6, 10, 6, 6, '#6a7854'),
    // 斜带（细，避免胸口糊块）
    P(7, 5, 6, 7, 7, 6, '#7a5a38'),
    // 箭袋（背）
    P(9, 6, 2, 10, 8, 2, '#6a4e34'),
    P(9, 9, 2, 9, 10, 2, '#8a7a5c'), P(10, 9, 2, 10, 10, 2, '#d0c8a8'),
    // 左臂持弓 + 右臂
    P(4, 5, 4, 4, 6, 5, '#5c6848'), P(3, 5, 4, 3, 6, 5, '#d8c8ae'),
    P(10, 5, 4, 11, 6, 5, '#525e42'),
    // 大弓 + 弦
    P(1, 1, 4, 2, 13, 5, '#a08050'),
    P(0, 2, 4, 0, 12, 4, '#d0d4da'),
    // 头 + 束发 + 翎羽
    P(6, 8, 3, 9, 10, 6, '#d8c8ae'),
    P(6, 10, 3, 9, 10, 6, '#4a4034'),
    P(7, 9, 6, 8, 9, 6, '#2c2620'),
    P(5, 11, 4, 6, 12, 5, '#8a9a5e'),
    P(6, 13, 4, 6, 13, 5, '#6a7a4a'),
  ];
}

window.VOXEL_UNITS = {
  duanyue: { name: '断岳', render: () => voxelWarriorModel() },
  pan:     { name: '磐',   render: () => voxelGolemModel() },
  zhuyan:  { name: '朱炎', render: () => voxelMageModel() },
  jingyu:  { name: '惊羽', render: () => voxelArcherModel() },
  draw: renderVoxel,
};
