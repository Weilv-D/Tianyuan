import { GILT, MOON, css } from '../palette';
import { AI_PIECE_URL as AI_PIECE_URL_MAP } from './aiSource';

/**
 * AI 生成棋子图 · 合成管线
 *
 * 一张中立的角色 PNG（透明底）在烘焙期合成为游戏纹理，星级/墨兽程序派生：
 *  - 星级描边：1★ 无描边，2★ 银色，3★ 金色；
 *    体积放大交给 UnitView 的 STAR_SCALE（0.90 / 1.02 / 1.16）；
 *    敌我归属不靠描边 —— 由血条颜色承担（我方玉青恒色，敌方朱砂）；
 *  - 墨兽：青黛色罩染 —— 零美术成本得到第三阵营；
 *  - 三个星级键烘同一张画，供商店卡 / 图鉴 / 天命之印复用。
 *
 * 两段式：启动咽喉 `preloadAiPieces()` 先把全部 PNG 解码进缓存（异步只发生在这一步），
 * 场景烘焙 `drawAiPiece()` 此后完全同步 —— 与 Phaser 场景的生命周期零冲突。
 */

/**
 * 烘焙画布：208×208、脚底 y=184。
 *
 * 源图内容（~150px 高）按**原生分辨率**落位，烘焙期零重采样 ——
 * 显示端按内容高归一（棋盘 62 逻辑 px = 62 设备 px）时正好 1:1 取样，
 * 清晰度上限即源图上限（不超分，透明通道原样）。
 * 预算：最高内容 157 + 描边柔光 ~22 ≤ 184（顶部余量），脚底留 24。
 */
const SIZE = 208;
const FOOT = 184;

const cache = new Map<string, HTMLImageElement>();

/** 星级描边：1★ 无，2★ 银，3★ 金 */
function starRim(star: number): string | null {
  if (star >= 3) return css(GILT.light, 0.95);
  if (star === 2) return css(MOON.light, 0.92);
  return null;
}

/** 启动时预解码全部已就位的 AI 棋子图，返回成功张数 */
export async function preloadAiPieces(): Promise<number> {
  const urls = Object.entries(AI_PIECE_URL_MAP);
  await Promise.all(
    urls.map(([id, url]) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          cache.set(id, img);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      }),
    ),
  );
  return cache.size;
}

export function hasAiPiece(defId: string): boolean {
  return cache.has(defId);
}

/** 源图不透明包围盒（256 缩样上量，足够定位用） */
interface SrcBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const boundsCache = new Map<string, SrcBounds | null>();

function sourceBounds(img: HTMLImageElement): SrcBounds | null {
  const hit = boundsCache.get(img.src);
  if (hit !== undefined) return hit;
  const W = 256;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const r = maxX < 0 ? null : { minX, minY, maxX, maxY };
  boundsCache.set(img.src, r);
  return r;
}

/**
 * 把 AI 图原生分辨率合成进烘焙画布（调用方传"未平移"的 ctx，本函数自带落位）。
 * star：1/2/3，决定描边色。返回 false 表示无 AI 图。
 */
export function drawAiPiece(
  ctx: CanvasRenderingContext2D,
  defId: string,
  team: number,
  star: number,
): boolean {
  const img = cache.get(defId);
  if (!img) return false;
  const b = sourceBounds(img);
  if (!b) return false;

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const bw = (b.maxX - b.minX + 1) * (srcW / 256);
  const bh = (b.maxY - b.minY + 1) * (srcH / 256);
  // 原生落位；源图异常超预算（>157px 内容）时等比收进画布兜底
  const k = Math.min(1, (FOOT - 26) / Math.max(1, bh), (SIZE - 26) / Math.max(1, bw));
  const dw = bw * k;
  const dh = bh * k;
  const dx = SIZE / 2 - dw / 2;
  const dy = FOOT - dh;

  const sx = b.minX * (srcW / 256);
  const sy = b.minY * (srcH / 256);
  const sw = bw;
  const sh = bh;

  // 墨兽：先落到临时画布罩染青黛，再当普通图用
  let art: CanvasImageSource = img;
  let ax = sx;
  let ay = sy;
  let aw = sw;
  let ah = sh;
  if (team === 2) {
    const t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(sw));
    t.height = Math.max(1, Math.round(sh));
    const tc = t.getContext('2d');
    if (tc) {
      tc.drawImage(img, sx, sy, sw, sh, 0, 0, t.width, t.height);
      tc.globalCompositeOperation = 'source-atop';
      tc.fillStyle = 'rgba(58,86,134,0.38)';
      tc.fillRect(0, 0, t.width, t.height);
      art = t;
      ax = 0;
      ay = 0;
      aw = t.width;
      ah = t.height;
    }
  }

  // 星级描边：沿 alpha 轮廓向外的柔光；1★ 无描边。
  // 柔光半径随内容尺寸等比（旧 86px 归一基线的 6/5 px），屏上观感与体量同步。
  const rim = starRim(star);
  if (rim) {
    const blur = (star >= 3 ? 6 : 5) * (dh / 86);
    ctx.save();
    ctx.shadowColor = rim;
    ctx.shadowBlur = blur;
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < 3; i++) ctx.drawImage(art, ax, ay, aw, ah, dx, dy, dw, dh);
    ctx.restore();
  }

  // 本体
  ctx.drawImage(art, ax, ay, aw, ah, dx, dy, dw, dh);
  return true;
}

/** 烘焙画布尺寸常量（与 silhouetteFactory 的 SIL_W/H/FOOT 对齐） */
export const AI_BAKE = { SIZE, FOOT };
