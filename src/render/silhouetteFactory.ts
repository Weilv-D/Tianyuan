import Phaser from 'phaser';
import { CHAMPION_BY_ID } from '../data/champions';
import { drawSilhouette, makeStyle } from './silhouettes';
import { RARITY_COLOR, TEAM_COLOR, VOID, INK } from './palette';

/**
 * 把 32 名棋子 × 2 阵营的剪影在启动时烘焙成纹理。
 *
 * 为什么烘焙而不是每帧画 Graphics：
 *  - 运行期只剩 40 次 Sprite 绘制，20+ 单位同屏轻松 60FPS
 *  - 烘焙后是 Image，可以用 setTintFill 做"受击白闪"，这是打击感的关键一环
 */

export const SIL_W = 112;
export const SIL_H = 112;
/** 脚底在纹理中的 y 坐标 */
export const SIL_FOOT_Y = 96;
export const SIL_ORIGIN_Y = SIL_FOOT_Y / SIL_H;

/** 墨兽的"阵营号"。它不是真实的队伍，只是第三套配色。 */
export const BEAST_TEAM = 2;

export function silhouetteKey(defId: string, team: number, star = 3): string {
  // 三星（默认）沿用无后缀键 —— 旧调用点（天命之印、商店卡）自动拿精装版
  return star >= 3 ? `sil_${defId}_${team}` : `sil_${defId}_${team}_s${star}`;
}

// ── 内容包围盒 ──────────────────────────────────────────
// 剪影只占 112×112 纹理的中间一块，且不同原型占框差异极大
// （幡辅顶到边、影兜只占一半）。按纹理缩放会让"同是商店卡、墨迹大小差一截"。
// 烘焙时用代理记录实际落笔范围，显示层按内容高缩放 —— 可见体积由此归一。

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 键：`${defId}_s${star}`。几何与阵营无关（只换配色），同星三队共用一条。 */
const CONTENT: Record<string, Bounds> = {};

/** 按方法名解出坐标参数的几何方法表。未知方法只透传不记录（宁缺勿错）。 */
const GEO: Record<string, (a: number[]) => [number, number, number, number] | null> = {
  fillRect: (a) => [a[0], a[1], a[0] + a[2], a[1] + a[3]],
  strokeRect: (a) => [a[0], a[1], a[0] + a[2], a[1] + a[3]],
  fillRoundedRect: (a) => [a[0], a[1], a[0] + a[2], a[1] + a[3]],
  strokeRoundedRect: (a) => [a[0], a[1], a[0] + a[2], a[1] + a[3]],
  fillCircle: (a) => [a[0] - a[2], a[1] - a[2], a[0] + a[2], a[1] + a[2]],
  strokeCircle: (a) => [a[0] - a[2], a[1] - a[2], a[0] + a[2], a[1] + a[2]],
  fillEllipse: (a) => [a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2],
  strokeEllipse: (a) => [a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2],
  lineBetween: (a) => [Math.min(a[0], a[2]), Math.min(a[1], a[3]), Math.max(a[0], a[2]), Math.max(a[1], a[3])],
  moveTo: (a) => [a[0], a[1], a[0], a[1]],
  lineTo: (a) => [a[0], a[1], a[0], a[1]],
  arc: (a) => [a[0] - a[2], a[1] - a[2], a[0] + a[2], a[1] + a[2]],
  fillTriangle: (a) => [
    Math.min(a[0], a[2], a[4]),
    Math.min(a[1], a[3], a[5]),
    Math.max(a[0], a[2], a[4]),
    Math.max(a[1], a[3], a[5]),
  ],
  strokeTriangle: (a) => [
    Math.min(a[0], a[2], a[4]),
    Math.min(a[1], a[3], a[5]),
    Math.max(a[0], a[2], a[4]),
    Math.max(a[1], a[3], a[5]),
  ],
};

/** 包住 Graphics 的记录代理：绘制调用照常落到 g，同时按几何方法表累积包围盒。 */
function tracking(g: Phaser.GameObjects.Graphics, b: Bounds): Phaser.GameObjects.Graphics {
  const merge = (x0: number, y0: number, x1: number, y1: number): void => {
    b.minX = Math.min(b.minX, x0);
    b.minY = Math.min(b.minY, y0);
    b.maxX = Math.max(b.maxX, x1);
    b.maxY = Math.max(b.maxY, y1);
  };
  const handler: ProxyHandler<Phaser.GameObjects.Graphics> = {
    get(target, prop) {
      const raw = Reflect.get(target, prop, target);
      if (typeof raw !== 'function') return raw;
      const geo = GEO[prop as string];
      if (!geo) return (...args: unknown[]) => Reflect.apply(raw, target, args);
      return (...args: unknown[]) => {
        const nums = args.filter((x): x is number => typeof x === 'number');
        const box = geo(nums);
        if (box) merge(box[0], box[1], box[2], box[3]);
        if (prop === 'fillPoints' || prop === 'strokePoints') {
          for (const p of args) {
            if (Array.isArray(p)) {
              for (const pt of p as { x: number; y: number }[]) {
                if (pt && typeof pt.x === 'number') merge(pt.x, pt.y, pt.x, pt.y);
              }
            }
          }
        }
        return Reflect.apply(raw, target, args);
      };
    },
  };
  return new Proxy(g, handler) as Phaser.GameObjects.Graphics;
}

/**
 * 查一张剪影的墨迹包围盒（脚底原点局部坐标）。
 * 无记录时退回整张纹理，行为与归一之前一致。
 */
export function silContent(defId: string, star: number): Bounds {
  return CONTENT[`${defId}_s${star}`] ?? { minX: -SIL_W / 2, minY: -SIL_H + SIL_FOOT_Y, maxX: SIL_W / 2, maxY: SIL_FOOT_Y };
}

/**
 * 归一缩放：让墨迹"可见内容高"等于 targetH（必要时再按最大宽收口）。
 * 商店卡 / 棋盘肖像 / 战斗剪影共用的唯一尺寸口径。
 */
export function silContentScale(defId: string, star: number, targetH: number, maxW = Infinity): number {
  const b = silContent(defId, star);
  const h = Math.max(1, b.maxY - b.minY);
  const w = Math.max(1, b.maxX - b.minX);
  return Math.min(targetH / h, maxW / w);
}

export function bakeSilhouettes(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (const entry of Object.values(CHAMPION_BY_ID)) {
    // 三套配色：友方青瓷 / 敌方朱砂 / 墨兽青黛。
    // 墨兽复用玩家棋子的剪影轮廓，只换配色 —— 零美术成本得到一整套 PvE 内容，
    // 而且它看起来就该是"墨变成的怪物"，与世界观自洽。
    for (const team of [0, 1, BEAST_TEAM]) {
      const style =
        team === BEAST_TEAM
          ? makeStyle(INK[850], VOID.base, VOID.light)
          : makeStyle(entry.hue, TEAM_COLOR[team], RARITY_COLOR[entry.cost]);
      // 星级分层烘焙：1★ 简笔新兵 → 2★ 标准带饰 → 3★ 精装老卒。
      // 升星从此有真实的视觉进程，而不只是放大 14%。
      for (let star = 1; star <= 3; star++) {
        const key = silhouetteKey(entry.id, team, star);
        if (scene.textures.exists(key)) continue;
        // 包围盒与阵营无关：每星只在首个阵营烘焙时量一次，量完的墨迹直接复用
        if (team === 0) {
          const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
          drawSilhouette(tracking(g, b), entry.silhouette, style, star - 1, entry.id);
          if (Number.isFinite(b.minX)) CONTENT[`${entry.id}_s${star}`] = b;
        } else {
          drawSilhouette(g, entry.silhouette, style, star - 1, entry.id);
        }
        const rt = scene.add.renderTexture(0, 0, SIL_W, SIL_H);
        rt.draw(g, SIL_W / 2, SIL_FOOT_Y);
        rt.saveTexture(key);
        rt.destroy();
      }
    }
  }
  g.destroy();
}
