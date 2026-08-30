/* 路线 C · 像素画
 * 字符串位图 + 字符调色板，整数倍放大，最近邻。接入时离线烘焙 PNG 精灵图即可。 */

function renderPixel(canvas, sprite) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width / dpr, H = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const rows = sprite.rows;
  const gw = Math.max(...rows.map((r) => r.length));
  const gh = rows.length;
  const scale = Math.max(2, Math.floor(Math.min((W - 20) / gw, (H - 22) / gh)));
  const ox = Math.round((W - gw * scale) / 2);
  const oy = Math.round((H - gh * scale) / 2) + 4;

  // 地面投影
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.ellipse(W / 2, oy + gh * scale - 2, gw * scale * 0.36, scale * 1.4, 0, 0, Math.PI * 2);
  ctx.fill();

  for (let y = 0; y < gh; y++) {
    const row = rows[y].padEnd(gw, '.');
    for (let x = 0; x < gw; x++) {
      const c = row[x];
      if (c === '.') continue;
      const col = sprite.pal[c];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}

/* ── 断岳 · 墨刀卫 ── */
const pixelWarrior = {
  pal: {
    o: '#14161c', A: '#262b34', B: '#3d4452', C: '#566074',
    S: '#a7b2c2', s: '#7a8698', R: '#7d3a30', r: '#94402f',
    h: '#c9b696', v: '#0c0e12', k: '#1b1f26',
  },
  rows: [
    '...................S',
    '..................sS',
    '.............R..sSSs',
    '............rR..sSSs',
    '............rR..sSSs',
    '..........ooooo.sSSs',
    '.........oCCCCCo.sSSs',
    '.........oCCBBo.sSSs',
    '.........ovvvvo.sSSs',
    '..........ooooo.sSSs',
    '......oCCookkooCC.sSSs',
    '......oBBoCBBBoBB.sSSs',
    '......oBBoCRBBoBhsSSs',
    '......oBBoCRRBoBosSSs',
    '......ohhoCRBBooosSSs',
    '.......hhoRBBBo.sSSs',
    '........okkRkko..sSSs',
    '.......oBBCCCBBBosSSs',
    '.......oBBCCCBBBosSSs',
    '.......oBBCCCBBBosSSs',
    '.......oAAAAAAAAo.sSSs',
    '................kkkkkk',
    '........oAAooAAo..oAAo',
    '........oAAooAAo..oAAo',
    '........oAAooAAo..oAAo',
    '........oAAooAAo..oAAo',
    '.......oAAAooAAAo.oAAo',
    '.......oAAAooAAAo.oAAo',
    '.......oooooooooooo',
  ],
};

/* ── 磐 · 石灵 ── */
const pixelGolem = {
  pal: {
    o: '#1a1e24', M: '#5a626e', L: '#78808e', D: '#42474f',
    e: '#e8b34a', m: '#5a7050', c: '#2a2f36',
  },
  rows: [
    '..........ooooo',
    '.........oLLLLLo',
    '.........oLLLLLo',
    '.........oLeLeLo',
    '.........oLLLLLo',
    '..........ooooo',
    '...oMMoomMMMMMMMoMMo',
    '...oMMooLLMMMMMMoMMo',
    '...oMMooLLMMMMMMoMMo',
    '...oMMooLMMMccMMoMMo',
    '...oooooLLMMMMMMoMMo',
    '...oMMooLMMMMcMMoMMo',
    '...oMMooLMMMMMMMoMMo',
    '...oMMooMMMMMMMMoooo',
    '...oMMooDMMMMMMDo',
    '...oMMooDMMMMMMDo',
    '...oMMooDDMMMMDDo',
    '....ooooDDDDDDDDo',
    '......oDDDooDDDo',
    '......oDDDooDDDo',
    '......ooooooooooo',
  ],
};

/* ── 朱炎 · 毕方 ── */
const pixelMage = {
  pal: {
    o: '#101318', R: '#2b2f3a', Q: '#3a3f4c', r: '#1e222b',
    B: '#cfc3a6', b: '#a89a7e', F: '#e8822e', f: '#f2c14a', x: '#f7e3a0',
    E: '#d95f2a', e: '#e8b34a', K: '#7d2f24', k: '#1b1f26', G: '#c9a96a',
  },
  rows: [
    '.................xf',
    '................fFf',
    '.......oooo......FfF',
    '......oRRRRRRo..EFf',
    '......oQRRRRRo..EFf',
    '......oQReRRooBBBBF',
    '......oQRRRRoobBBBF',
    '.......ooooooo.obF',
    '.....oRRRRRRRRRoQE',
    '.....oRRRRRRRRRo',
    '...oRRooRRRRRRRo',
    '...oRRooRRKRRRRo',
    '...oRRooRRKKRRRo',
    '...ooooookGGkkoo',
    '....oRRRKKRRo',
    '....oRRRKKRRo',
    '....oRRRKKRRRo',
    '...oRRRRKKRRRo',
    '...oRRRRKKRRRRo',
    '...oRRRRKKRRRRo',
    '..oRRRRRKKRRRRo',
    '..oRRRRRKKRRRRo',
    '..orRRRRKKRRRRro',
    '.oorRRRKKRRRroo',
    '.orRRRRKKRRRRro',
    '.oorrRRKKRRrroo',
    '..ooooooooooooo',
  ],
};

/* ── 惊羽 · 弓手 ── */
const pixelArcher = {
  pal: {
    o: '#14161c', G: '#4a5238', g: '#5a6444', D: '#2e3428', d: '#39412f',
    h: '#d8c8b0', k: '#2e2a24', R: '#7d8a5a', Q: '#5a4430', B: '#6a4a30',
    w: '#8a7a5c', S: '#cfd4da', A: '#aab4c4',
  },
  rows: [
    '............RR',
    '............RRR',
    '....G....okkkko',
    '....GS....ohhhko',
    '....GS....ohako',
    '....GS....ohhhko',
    '....GS....ohhhko',
    '....GS....oGGGGo..w',
    '....GS...oGGGGGGGQW',
    '....GS..h.oGGGGGGGQQ',
    '....GS..AAWWWWWWWWoQ',
    '....GS...oBGGGGGoQ',
    '....GS...oBGGGGGoQ',
    '....GS...oGkkkkGo',
    '....GS...oGGGGGo',
    '....G....oDDooDDo',
    '....G....oDDooDDo',
    '....G....oDDooDDo',
    '....G....oDDooDDo',
    '...G.....oDDDoDDDo',
    '...G.....oDDDoDDDo',
    '.........ooooo ooooo',
  ],
};

window.PIXEL_UNITS = {
  duanyue: { name: '断岳', sprite: pixelWarrior },
  pan:     { name: '磐',   sprite: pixelGolem },
  zhuyan:  { name: '朱炎', sprite: pixelMage },
  jingyu:  { name: '惊羽', sprite: pixelArcher },
  draw: renderPixel,
};
