/* 路线 D · 低模 3D（软件渲染，零依赖）
 * 锥台盒建模（taperBox：顶面可收缩 → 袍/盔/火苗都有体积），平面着色，画家算法，
 * 绕 Y 慢速自转。接入时既可整体烘焙成序列帧，也可在游戏里以极薄的自绘 3D 层实时渲染。 */

const TILT = -0.40;          // 俯视角
const LIGHT = norm3([-0.45, 0.72, 0.58]);

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
function shadeHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/** 锥台盒：底面矩形 [x0,x1]×[z0,z1]，高 y0→y1，顶面按 inset 比例向中心收缩（负值外扩） */
function taperBox(mesh, x0, z0, x1, z1, y0, y1, inset, color) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2 * (1 - inset), hz = (z1 - z0) / 2 * (1 - inset);
  const b = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
  const t = [[cx - hx, y1, cz - hz], [cx + hx, y1, cz - hz], [cx + hx, y1, cz + hz], [cx - hx, y1, cz + hz]];
  const quad = (pts) => mesh.faces.push({ pts, color });
  quad([b[0], b[1], t[1], t[0]]);              // -z 背
  quad([b[2], b[3], t[3], t[2]]);              // +z 前
  quad([b[1], b[2], t[2], t[1]]);              // +x 右
  quad([b[3], b[0], t[0], t[1]]);              // -x 左
  quad([t[0], t[1], t[2], t[3]]);              // 顶
  mesh.boxes.push({ x0, z0, x1, z1, y0, y1 });
}
const box = (mesh, x0, z0, x1, z1, y0, y1, color) => taperBox(mesh, x0, z0, x1, z1, y0, y1, 0, color);

function buildWarrior() {
  const m = { faces: [], boxes: [] };
  const armor = '#454d5e', armorD = '#333947', steel = '#8a97ab', steelD = '#5f6b7d',
    dark = '#262b34', crimson = '#7d3a30', skin = '#c9b696', helm = '#4a5262';
  box(m, -5, -2, -2, 2, 0, 4, dark);  box(m, 2, -2, 5, 2, 0, 4, dark);
  box(m, -5, -2, -2, 2, 4, 7, armorD); box(m, 2, -2, 5, 2, 4, 7, armorD);
  taperBox(m, -6, -3, 6, 3, 7, 11, 0.12, armorD);            // 战裙
  taperBox(m, -5, -3, 5, 3, 11, 18, -0.1, armor);            // 躯干（挺胸）
  box(m, -5, 2.6, 5, 3.4, 13, 14.2, crimson);                // 束带
  taperBox(m, -8.5, -3.5, -4.5, 3.5, 16, 20, 0.25, steelD);  // 护肩
  taperBox(m, 4.5, -3.5, 8.5, 3.5, 16, 20, 0.25, steelD);
  box(m, -7.5, -1.6, -5.8, 1.6, 11, 16, armorD);             // 左臂
  box(m, -7.6, -1.5, -5.6, 1.5, 8.5, 11, skin);
  box(m, 5.8, -1.6, 7.5, 1.6, 18, 23, armorD);               // 右臂上举
  box(m, 5.9, -1.5, 7.4, 1.5, 23, 25.2, skin);
  taperBox(m, -2.6, -2.2, 2.6, 2.2, 20, 26, 0.12, helm);     // 头盔
  box(m, -1.8, 2.1, 1.8, 2.45, 22.4, 23.6, '#0d0f14');       // 面甲缝
  box(m, -0.7, -0.8, 0.7, 0.8, 26, 29.5, crimson);           // 盔缨
  taperBox(m, -0.9, -0.9, 0.9, 0.9, 29.5, 31.5, 0.55, '#94402f');
  box(m, 7, -0.6, 8.6, 0.6, 4, 28, steel);                   // 长刀立刃
  box(m, 8.6, -0.5, 9.3, 0.5, 5, 26, steelD);
  box(m, 7.1, -0.5, 8.5, 0.5, 0, 5, '#3b414d');              // 刀柄
  return m;
}

function buildGolem() {
  const m = { faces: [], boxes: [] };
  const stone = '#5a626e', stoneL = '#78808e', stoneD = '#454b55', moss = '#5a7050', amber = '#e8b34a';
  box(m, -5, -3, -2, 3, 0, 3, stoneD); box(m, 2, -3, 5, 3, 0, 3, stoneD);
  taperBox(m, -7, -4, 7, 4, 3, 13, 0.14, stone);             // 巨岩躯干
  taperBox(m, -5.5, -3, 5.5, 3, 13, 17, 0.1, stoneL);
  box(m, -10, -2.5, -6.5, 2.5, 0, 7, stoneD);                // 左拳拄地
  box(m, -9.5, -2, -7, 2, 7, 10, stone);
  box(m, 6.5, -2.5, 10, 2.5, 6, 12, stone);                  // 右拳抬起
  box(m, 7, -2, 9.5, 2, 3, 6, stoneD);
  taperBox(m, -3, -2.4, 3, 2.4, 17, 22.5, 0.1, stoneL);      // 头
  box(m, -2.2, 2.3, -0.6, 2.7, 19.6, 20.6, amber);           // 琥珀目
  box(m, 0.6, 2.3, 2.2, 2.7, 19.6, 20.6, amber);
  box(m, -3, -2, 0, 0, 22.5, 23, moss);                      // 苔衣
  box(m, -8.5, -3.5, -6.5, -1.5, 10, 10.4, moss);
  box(m, 4, 3.4, 6, 4, 13.5, 14, moss);
  box(m, -12, 3, -10.5, 4.5, 0, 1.5, stoneD);                // 碎石
  box(m, 10.5, 3, 12, 4.5, 0, 1.2, stoneD);
  return m;
}

function buildMage() {
  const m = { faces: [], boxes: [] };
  const robe = '#2b2f3a', robeL = '#3a3f4c', robeD = '#1e222b', crimson = '#7d2f24',
    bone = '#cfc3a6', fire1 = '#e8822e', fire2 = '#f2c14a', fire3 = '#f7e3a0', skin = '#cbb89a';
  taperBox(m, -5.5, -3.2, 5.5, 3.2, 0, 9, 0.3, robeD);       // 袍摆（下放）
  taperBox(m, -4.8, -3, 4.8, 3, 9, 17, -0.12, robe);         // 袍身
  taperBox(m, -4.2, -2.8, 4.2, 2.8, 17, 20, 0.02, robeL);    // 胸
  box(m, -1.6, 2.9, 1.6, 3.3, 1, 18, crimson);               // 前襟朱里
  box(m, -4.2, 2.95, 4.2, 3.3, 13, 14, '#c9a96a');           // 腰绦
  box(m, -7.2, -1.6, -4.6, 1.6, 12, 17, robe);               // 左垂袖
  box(m, 4.6, -1.6, 7, 1.6, 17, 21, robe);                   // 右臂扬袖
  box(m, 6.6, -1.4, 8.8, 1.4, 21, 24, robe);
  box(m, 8.4, -1.1, 10.2, 1.1, 24, 25.6, skin);
  taperBox(m, 8.2, -1.6, 10.6, 1.6, 25.6, 28.6, 0.45, fire1); // 火团
  taperBox(m, 8.6, -1.2, 10.2, 1.2, 28.6, 31, 0.5, fire2);
  taperBox(m, 8.9, -0.8, 9.9, 0.8, 31, 33, 0.6, fire3);
  box(m, 12, -0.4, 12.7, 0.4, 33, 33.9, fire1);              // 浮烬
  box(m, 6.5, 0.5, 7.1, 1.1, 34, 34.8, fire2);
  taperBox(m, -3.4, -2.6, 3.4, 2.6, 20, 25.5, 0.18, robeD);  // 兜帽
  box(m, -2.6, 2.55, 2.6, 2.9, 22.6, 23.6, '#0d0f14');       // 帽檐影
  taperBox(m, 2.4, 0.6, 6.2, 1.7, 21.8, 23.2, 0.55, bone);   // 鹤喙
  box(m, -2.2, 2.7, -1.2, 2.95, 22.9, 23.5, '#e8b34a');      // 目
  box(m, -1.2, -0.5, 0.2, 0.5, 25.5, 28, '#8a3226');         // 冠羽
  box(m, 0.6, -0.4, 1.6, 0.4, 25.5, 27, '#6a2f26');
  return m;
}

function buildArcher() {
  const m = { faces: [], boxes: [] };
  const cloth = '#4a5238', clothL = '#5a6444', olive = '#2e3428', wood = '#6a5638',
    woodD = '#4e4028', string = '#cfd4da', skin = '#d8c8b0', hair = '#2e2a24',
    quiver = '#5a4430', strap = '#6a4a30', feather = '#7d8a5a';
  box(m, -4.5, -2, -1.5, 2, 0, 4, olive); box(m, 1.5, -2, 4.5, 2, 0, 4, olive);
  taperBox(m, -5, -2.8, 5, 2.8, 4, 8, 0.1, cloth);           // 猎装下摆
  taperBox(m, -4.2, -2.6, 4.2, 2.6, 8, 15, -0.08, cloth);
  box(m, -3.8, 2.55, 3.8, 2.9, 11, 12, strap);               // 斜带
  box(m, -4, 2.9, -3, 3.25, 11, 12, '#8a6a3a');
  box(m, -8.8, -0.5, -7.8, 0.5, 2, 24, wood);                // 大弓
  box(m, -7.85, -0.28, -7.65, 0.28, 3, 23, woodD);
  box(m, -7.78, -0.12, -7.68, 0.12, 3.5, 22.5, string);      // 弦
  box(m, -8.6, -0.55, -8, 0.55, 1.8, 3, woodD);              // 弓梢
  box(m, -8.6, -0.55, -8, 0.55, 23, 25.2, woodD);
  box(m, 3, -4.6, 5.6, -3, 9, 15, quiver);                   // 箭袋（背）
  box(m, 3.4, -4.4, 3.9, -3.9, 15, 17, '#8a7a5c');           // 箭羽
  box(m, 4.4, -4.4, 4.9, -3.9, 15, 17.6, '#c9b696');
  box(m, -7, -1.6, -4.8, 1.6, 10, 13, clothL);               // 左臂前伸
  box(m, -8.6, -1.4, -7.2, 1.4, 10.4, 12.8, skin);
  box(m, 4, -1.6, 6.2, 1.6, 10, 13, clothL);                 // 右臂
  taperBox(m, -2.6, -2.2, 2.6, 2.2, 15, 20, 0.06, skin);     // 头
  taperBox(m, -2.8, -2.4, 2.8, 2.4, 20, 21.6, 0, hair);      // 束发
  box(m, -2.7, 2.2, 2.7, 2.5, 17.6, 18.4, '#20242c');        // 眼线
  box(m, -0.6, -0.4, 0.6, 0.4, 21.6, 24.4, hair);            // 发髻
  box(m, -3.4, -0.3, -2, 0.3, 21.8, 25, feather);            // 翎羽
  box(m, -2.9, -0.25, -2.2, 0.25, 25, 26.6, '#6a7a4a');
  return m;
}

/* ── 渲染 ── */
function drawMesh(ctx, W, H, mesh, angle) {
  const cy0 = Math.cos(angle), sy0 = Math.sin(angle);
  const ct = Math.cos(TILT), st = Math.sin(TILT);
  const bounds = { minY: 1e9, maxY: -1e9, minX: 1e9, maxX: -1e9 };
  for (const b of mesh.boxes) {
    bounds.minY = Math.min(bounds.minY, b.y0); bounds.maxY = Math.max(bounds.maxY, b.y1);
    bounds.minX = Math.min(bounds.minX, b.x0); bounds.maxX = Math.max(bounds.maxX, b.x1);
  }
  const spanY = bounds.maxY - bounds.minY;
  const s = Math.min((H - 30) / spanY, (W - 26) / (spanY * 0.75));
  const cx = W / 2, cy = H - 14 - 0; // 脚底锚点
  const rotY = (p) => {
    const x = p[0] * cy0 - p[2] * sy0;
    const z = p[0] * sy0 + p[2] * cy0;
    return [x, p[1], z];
  };
  const view = (p) => {
    const y2 = p[1] * ct - p[2] * st;
    const z2 = p[1] * st + p[2] * ct;
    return [cx + p[0] * s, cy - (y2 - bounds.minY * ct) * s, z2];
  };

  // 地面投影（不随转）
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 2, 5.2 * s * 0.8, 2.1 * s * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const faces = [];
  for (const f of mesh.faces) {
    const rp = f.pts.map(rotY);
    const vp = rp.map(view);
    const depth = (vp[0][2] + vp[1][2] + vp[2][2] + vp[3][2]) / 4;
    // 视空间法线：几何法线随体旋转后，再过一次俯仰 —— 光照固定在视空间
    const ax = rp[1][0] - rp[0][0], ay = rp[1][1] - rp[0][1], az = rp[1][2] - rp[0][2];
    const bx = rp[2][0] - rp[0][0], by = rp[2][1] - rp[0][1], bz = rp[2][2] - rp[0][2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const vy = ny * ct - nz * st, vz = ny * st + nz * ct;
    const lam = 0.66 + 0.44 * Math.max(0, nx * LIGHT[0] + vy * LIGHT[1] + vz * LIGHT[2]);
    faces.push({ vp, depth, color: shadeHex(f.color, lam) });
  }
  faces.sort((a, b) => a.depth - b.depth);
  for (const f of faces) {
    ctx.beginPath();
    f.vp.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = f.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,10,14,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

const ANIM = [];
function mountPoly(canvas, build) {
  const mesh = build();
  let angle = -0.55 + Math.random() * 0.2;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  // 装配时 canvas 尚未入 DOM，clientWidth 为 0 —— 直接用已设置的像素尺寸
  const VW = canvas.width / dpr, VH = canvas.height / dpr;
  const render = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VW, VH);
    drawMesh(ctx, VW, VH, mesh, angle);
  };
  ANIM.push({ render, speed: 0.28 + Math.random() * 0.1, step: (dt) => { angle += dt; } });
  render();
}
let polyLast = 0;
function polyLoop(t) {
  const dt = Math.min(0.05, (t - polyLast) / 1000 || 0);
  polyLast = t;
  for (const a of ANIM) { a.step(dt * a.speed); a.render(); }
  requestAnimationFrame(polyLoop);
}

window.POLY_UNITS = {
  duanyue: { name: '断岳', build: buildWarrior },
  pan:     { name: '磐',   build: buildGolem },
  zhuyan:  { name: '朱炎', build: buildMage },
  jingyu:  { name: '惊羽', build: buildArcher },
  mount: mountPoly,
  start: () => requestAnimationFrame(polyLoop),
};
