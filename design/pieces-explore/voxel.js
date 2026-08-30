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

const FACE_SHADE = { top: 1.2, px: 0.84, pz: 0.55 };

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
  const modelW = (maxX - minZ), modelH = (maxY - minY) + (maxX - minX + maxZ - minZ) * 0.5;
  const s = Math.min((W - 24) / modelW, (H - 16) / modelH);
  const cx = W / 2 + 2;
  const baseY = H - 10;

  const proj = (x, y, z) => [cx + (x - z) * s * 0.5, baseY - ((x + z) * s * 0.25 + (y - minY) * s * 0.72)];

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
      ctx.fillStyle = shade(v.color, f * jit);
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
  const plateC = '#1a1e24';
  return [
    P(0, -1, 0, 15, -1, 9, plateC),
    // 靴 / 腿
    P(4, 0, 3, 6, 1, 5, '#23262e'), P(9, 0, 3, 11, 1, 5, '#23262e'),
    P(4, 2, 3, 6, 3, 5, '#2f3540'), P(9, 2, 3, 11, 3, 5, '#2f3540'),
    // 战裙
    P(3, 4, 2, 12, 5, 6, '#3a4150'),
    P(6, 4, 6, 9, 5, 6, '#4a5262'),
    // 躯干
    P(4, 6, 3, 11, 10, 6, '#454d5e'),
    P(4, 6, 6, 11, 8, 6, '#4d5666'),
    // 束带
    P(4, 8, 6, 11, 8, 6, '#7d3a30'),
    // 护肩
    P(2, 9, 2, 4, 11, 6, '#565f72'), P(11, 9, 2, 13, 11, 6, '#565f72'),
    // 臂
    P(2, 6, 3, 3, 8, 5, '#333947'),
    P(12, 10, 3, 13, 12, 5, '#333947'),
    P(3, 5, 3, 4, 5, 5, '#c9b696'),
    P(12, 13, 3, 13, 13, 5, '#c9b696'),
    // 头盔
    P(6, 12, 3, 9, 14, 6, '#4a5262'),
    P(6, 13, 6, 9, 13, 6, '#101319'),
    P(7, 15, 4, 8, 15, 5, '#7d3a30'), P(7, 16, 4, 7, 16, 5, '#8a4034'),
    // 长刀（右侧立刃）
    P(14, 2, 3, 14, 16, 4, '#9aa6b8'),
    P(15, 3, 3, 15, 14, 4, '#7a8698'),
    P(13, 2, 3, 13, 4, 4, '#3b414d'),
  ];
}

/* ── 模型：磐 ── */
function voxelGolemModel() {
  const P = (x0, y0, z0, x1, y1, z1, c) => [x0, y0, z0, x1, y1, z1, c];
  return [
    P(0, -1, 0, 15, -1, 9, '#1a1e24'),
    // 蹲踞巨岩主体
    P(4, 0, 2, 11, 1, 7, '#4a505a'),
    P(3, 2, 2, 12, 5, 7, '#565d68'),
    P(4, 6, 3, 11, 7, 6, '#5e6672'),
    // 双拳拄地
    P(1, 0, 2, 3, 4, 6, '#4a505a'),
    P(12, 0, 2, 14, 4, 6, '#4a505a'),
    // 抬起的右拳
    P(13, 6, 3, 14, 8, 6, '#565d68'),
    P(12, 5, 3, 13, 5, 5, '#4a505a'),
    // 头
    P(6, 8, 3, 9, 10, 6, '#767e8c'),
    P(6, 10, 6, 9, 10, 6, '#6a7280'),
    // 琥珀目
    P(6, 9, 6, 6, 9, 6, '#e8b34a'), P(9, 9, 6, 9, 9, 6, '#e8b34a'),
    // 苔衣
    P(5, 8, 3, 7, 8, 4, '#5a7050'),
    P(4, 6, 3, 5, 6, 4, '#4e6448'),
    P(8, 11, 4, 9, 11, 4, '#5a7050'),
    P(2, 5, 2, 3, 5, 3, '#4e6448'),
    // 碎石
    P(0, 0, 7, 1, 0, 8, '#454b55'),
    P(14, 0, 7, 15, 0, 8, '#454b55'),
  ];
}

/* ── 模型：朱炎 ── */
function voxelMageModel() {
  const P = (x0, y0, z0, x1, y1, z1, c) => [x0, y0, z0, x1, y1, z1, c];
  return [
    P(0, -1, 0, 15, -1, 9, '#1a1e24'),
    // 长袍（下摆外放）
    P(4, 0, 2, 11, 2, 7, '#262a33'),
    P(5, 3, 3, 10, 5, 6, '#2b2f3a'),
    P(5, 6, 3, 10, 8, 6, '#31353f'),
    // 前襟朱里
    P(7, 0, 7, 8, 7, 7, '#7d2f24'),
    // 腰绦玉扣
    P(6, 5, 6, 6, 5, 6, '#c9a96a'), P(9, 5, 6, 9, 5, 6, '#c9a96a'),
    // 左垂袖
    P(3, 6, 4, 4, 8, 5, '#2b2f3a'),
    P(3, 5, 4, 4, 5, 5, '#6a2f26'),
    // 右臂扬袖
    P(10, 8, 4, 11, 9, 5, '#2b2f3a'),
    P(11, 10, 4, 12, 10, 5, '#2b2f3a'),
    P(12, 11, 4, 13, 11, 5, '#2b2f3a'),
    P(13, 12, 4, 14, 12, 5, '#6a2f26'),
    P(14, 13, 4, 15, 13, 5, '#cbb89a'),
    // 火团
    P(14, 14, 4, 15, 15, 5, '#e8722e'),
    P(14, 16, 4, 15, 17, 5, '#f2994a'),
    P(14, 18, 4, 15, 18, 5, '#f7e3a0'),
    P(16, 19, 4, 16, 19, 4, '#e8722e'),
    P(12, 19, 4, 12, 19, 4, '#f2c14a'),
    // 兜帽
    P(6, 9, 3, 9, 11, 6, '#262a33'),
    P(6, 10, 6, 9, 10, 6, '#1c1f27'),
    // 鹤喙（前伸）
    P(7, 10, 7, 8, 10, 8, '#cfc3a6'),
    P(7, 10, 8, 8, 10, 8, '#cfc3a6'),
    // 目
    P(6, 10, 6, 6, 10, 6, '#e8b34a'),
    // 冠羽
    P(7, 12, 4, 8, 12, 5, '#8a3226'),
    P(8, 13, 4, 8, 14, 5, '#6a2f26'),
  ];
}

/* ── 模型：惊羽 ── */
function voxelArcherModel() {
  const P = (x0, y0, z0, x1, y1, z1, c) => [x0, y0, z0, x1, y1, z1, c];
  return [
    P(0, -1, 0, 15, -1, 9, '#1a1e24'),
    // 腿
    P(5, 0, 3, 6, 2, 5, '#2e3428'), P(9, 0, 3, 10, 2, 5, '#39412f'),
    // 猎装下摆
    P(4, 3, 3, 11, 4, 6, '#4a5238'),
    // 躯干
    P(5, 5, 3, 10, 8, 6, '#525c3e'),
    // 皮斜带
    P(6, 5, 6, 6, 8, 6, '#6a4a30'),
    // 箭袋（背）
    P(9, 6, 2, 10, 8, 2, '#5a4430'),
    P(9, 9, 2, 9, 10, 2, '#8a7a5c'), P(10, 9, 2, 10, 10, 2, '#c9b696'),
    // 左臂前伸持弓
    P(4, 6, 4, 4, 7, 5, '#4a5238'),
    P(3, 6, 4, 3, 7, 5, '#c9b696'),
    // 右臂
    P(10, 6, 4, 11, 7, 5, '#44503a'),
    // 大弓（左侧立）
    P(1, 1, 4, 1, 13, 5, '#4a4034'),
    P(2, 2, 4, 2, 12, 5, '#5a4e3e'),
    // 弦
    P(0, 3, 4, 0, 11, 4, '#c9b696'),
    // 头
    P(6, 9, 3, 9, 11, 6, '#d8c8b0'),
    P(6, 11, 3, 9, 11, 6, '#2e2a24'),
    P(7, 10, 6, 8, 10, 6, '#20242c'),
    // 翎羽
    P(5, 12, 4, 6, 13, 5, '#7d8a5a'),
    P(6, 14, 4, 6, 14, 5, '#6a7a4a'),
  ];
}

window.VOXEL_UNITS = {
  duanyue: { name: '断岳', render: () => voxelWarriorModel() },
  pan:     { name: '磐',   render: () => voxelGolemModel() },
  zhuyan:  { name: '朱炎', render: () => voxelMageModel() },
  jingyu:  { name: '惊羽', render: () => voxelArcherModel() },
  draw: renderVoxel,
};
