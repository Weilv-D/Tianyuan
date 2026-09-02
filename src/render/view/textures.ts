import Phaser from 'phaser';
import { PAPER, css } from './palette';
import { W, H } from './layout';

/**
 * 程序化材质工厂。
 *
 * 全部纹理在启动时一次性烘焙到 GPU，运行期零绘制开销。
 * 材质语言（见 ART_BIBLE）：宣纸纤维、墨点晕染、鎏金描边、灵光渐隐。
 */

export const TEX = {
  paper: 'tex_paper',
  glow: 'tex_glow',
  inkDot: 'tex_inkdot',
  ring: 'tex_ring',
  spark: 'tex_spark',
  slash: 'tex_slash',
  hex: 'tex_hex',
  vignette: 'tex_vignette',
  grain: 'tex_grain',
} as const;

/** 全屏纸面颗粒：极低透明度叠在一切之上 —— 数码感的天敌，一次烘焙全场景复用 */
export function grainOverlay(scene: Phaser.Scene): Phaser.GameObjects.Image {
  // 逻辑分辨率 +8 出血：scene.scale.width 是物理像素（1920K），会被额外放大 K 倍
  return scene.add
    .image(0, 0, TEX.grain)
    .setOrigin(0)
    .setDisplaySize(W + 8, H + 8)
    .setAlpha(0.02)
    .setScrollFactor(0)
    .setDepth(2000);
}

/** 值噪声（可平铺），用于纸纤维 */
function makeNoise(w: number, h: number, scale: number, seed = 1): Float32Array {
  const out = new Float32Array(w * h);
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const gw = Math.ceil(w / scale) + 1;
  const gh = Math.ceil(h / scale) + 1;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / scale;
      const gy = y / scale;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = smooth(gx - x0);
      const ty = smooth(gy - y0);
      const a = grid[y0 * gw + x0];
      const b = grid[y0 * gw + x0 + 1];
      const c = grid[(y0 + 1) * gw + x0];
      const d = grid[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

function canvas(scene: Phaser.Scene, key: string, w: number, h: number): { ctx: CanvasRenderingContext2D; tex: Phaser.Textures.CanvasTexture } {
  const existing = scene.textures.get(key);
  if (existing && existing.key === key) {
    // 场景切换时纹理是全局共享的，重复创建会让 createCanvas 返回 null
    return { ctx: (existing as Phaser.Textures.CanvasTexture).getContext(), tex: existing as Phaser.Textures.CanvasTexture };
  }
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) throw new Error(`纹理创建失败: ${key}`);
  return { ctx: tex.getContext(), tex };
}

/**
 * 烘焙全部材质。
 *
 * 必须幂等 —— 场景切换（准备 → 战斗 → 准备）会重复调用它，
 * 而纹理在 Phaser 里是全局共享的，第二次创建同名 key 只会得到 null。
 */
export function buildTextures(scene: Phaser.Scene): void {
  // 幂等哨兵：以最后一张（vignette）是否已建代表"本组九张纹理原子建成"。
  // 前提：本函数内纹理键固定且任一张创建失败即 throw（canvas() 内），
  // 不存在"建到一半静默返回"的路径 —— 若未来纹理清单可配置化，须改逐键守卫
  if (scene.textures.exists(TEX.vignette)) return;
  // ── 宣纸纤维：细腻的明暗颗粒，叠在棋盘上当底纹 ──
  {
    const size = 256;
    const { ctx, tex } = canvas(scene, TEX.paper, size, size);
    const n1 = makeNoise(size, size, 2.2, 7);
    const n2 = makeNoise(size, size, 13, 31);
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = n1[i] * 0.55 + n2[i] * 0.45;
      const c = 18 + v * 34;
      // 暖偏：红 > 绿 > 蓝 —— 宣纸的底色是米黄，纤维也必须跟着暖
      img.data[i * 4] = c * 1.06;
      img.data[i * 4 + 1] = c * 1.0;
      img.data[i * 4 + 2] = c * 0.92;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // 长纤维丝。用固定种子的 PRNG：材质虽然不影响战斗结果，但"源码里没有 Math.random()"
    // 这条规则越干净越好维护 —— 一旦开了口子，后面就有人说"我这里也不影响战斗"。
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = css(PAPER[200]);
    let fs = 0x1a2b3c4d;
    const frnd = () => {
      fs = (Math.imul(fs, 1664525) + 1013904223) >>> 0;
      return fs / 4294967296;
    };
    for (let i = 0; i < 160; i++) {
      const y = frnd() * size;
      ctx.lineWidth = frnd() * 0.8 + 0.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + (frnd() - 0.5) * 6, size * 0.7, y + (frnd() - 0.5) * 6, size, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    tex.refresh();
  }

  // ── 纸面颗粒：细密单像素噪声，全屏叠加用 ──
  {
    const size = 160;
    const { ctx, tex } = canvas(scene, TEX.grain, size, size);
    const n = makeNoise(size, size, 1.1, 99);
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = n[i];
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 252;
      img.data[i * 4 + 2] = 244;
      img.data[i * 4 + 3] = Math.round(v * 255);
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  }

  // ── 灵光：径向渐变，粒子 / 高光通用 ──
  {
    const size = 128;
    const { ctx, tex } = canvas(scene, TEX.glow, size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }

  // ── 墨点：中心浓、边缘晕开的飞溅粒子 ──
  {
    const size = 64;
    const { ctx, tex } = canvas(scene, TEX.inkDot, size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    // 让边缘不规则，模拟墨迹晕散
    const cx = size / 2;
    const cy = size / 2;
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const r = size / 2 * (0.78 + 0.22 * Math.sin(a * 5) * 0.5 + 0.1 * Math.sin(a * 11));
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    tex.refresh();
  }

  // ── 法环：中空圆环，用于蓄力阵 / 环爆 ──
  {
    const size = 128;
    const { ctx, tex } = canvas(scene, TEX.ring, size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }

  // ── 火星 / 弹道拖尾 ──
  {
    const w = 64;
    const h = 16;
    const { ctx, tex } = canvas(scene, TEX.spark, w, h);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2 * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    tex.refresh();
  }

  // ── 斩击弧：一头尖一头宽的月牙 ──
  {
    const size = 256;
    const { ctx, tex } = canvas(scene, TEX.slash, size, size);
    ctx.translate(size / 2, size / 2);
    const g = ctx.createRadialGradient(0, 0, size * 0.1, 0, 0, size * 0.48);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.46, -Math.PI * 0.42, Math.PI * 0.42);
    ctx.arc(0, 0, size * 0.2, Math.PI * 0.42, -Math.PI * 0.42, true);
    ctx.closePath();
    ctx.fill();
    tex.refresh();
  }

  // ── 六边形底座：棋子的"身份牌" ──
  {
    const size = 128;
    const { ctx, tex } = canvas(scene, TEX.hex, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * size * 0.44;
      const y = Math.sin(a) * size * 0.44;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0.55)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.stroke();
    tex.refresh();
  }

  // ── 暗角：把视线压回战场中心 ──
  {
    const w = 512;
    const h = 512;
    const { ctx, tex } = canvas(scene, TEX.vignette, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.72, 'rgba(0,0,0,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    tex.refresh();
  }
}
