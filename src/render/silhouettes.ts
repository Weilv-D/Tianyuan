import Phaser from 'phaser';
import type { SilhouetteKey } from '../core/types';
import { GILT, INK, PAPER, VOID, mix } from './palette';

/**
 * 程序化棋子剪影。
 *
 * 美术立场：这不是"没有立绘所以画几何图形"，而是刻意选择的美术语言 ——
 *   「夜墨剪影 + 阵营色边缘光 + 稀有度底座」
 * 好处：
 *   1. 剪影差异 > 配色差异，玩家靠轮廓和体型就能认人（自走棋最需要的能力）
 *   2. 墨色剪影是暗底上可读性最高的形态，20+ 单位同屏也不糊
 *   3. 边缘光让"谁是我的人"永远一眼可辨
 *
 * 坐标系：脚底为 y=0，头顶约 y=-64，左右各 ±32。
 */

export interface SilhouetteStyle {
  /** 墨色本体（已混入棋子色相） */
  body: number;
  /** 更深的阴影层 */
  shade: number;
  /** 阵营边缘光 */
  rim: number;
  /** 强调色（武器 / 法器 / 饰品） */
  accent: number;
  /** 边缘光强度 */
  rimWidth: number;
}

export function makeStyle(hue: number, rim: number, accent: number): SilhouetteStyle {
  // 墨体占绝对主导（色相只掺 0.32）—— 阵营识别交给边缘光，稀有度交给饰件，
  // 本体越接近纯墨，整体越像"一批版画"而不是"一队彩塑"
  const body = mix(INK[700], hue, 0.32);
  const shade = mix(INK[900], hue, 0.14);
  return { body, shade, rim, accent, rimWidth: 1.4 };
}

type Pt = [number, number];

/** 主入口：按 key 绘制剪影（不含底座、血条、星级）。
 *  variant = 棋子 defId —— 共用剪影的棋子靠"身份件"区分（ART_BIBLE §6.1）。 */
export function drawSilhouette(
  g: Phaser.GameObjects.Graphics,
  key: SilhouetteKey,
  s: SilhouetteStyle,
  detail: number,
  variant?: string,
): void {
  g.clear();
  DRAWERS[key]?.(g, s, detail, variant) ?? DRAWERS.bladeGeneral(g, s, detail, variant);
  drawExtraIdentity(g, s, variant);
}

// ══════════════════════════════════════════════════════════
//  16 套剪影。detail: 0=简笔(一星/远景) 1=标准 2=精装(三星/特写)
//  身份件（variant 分支）恒显 —— 它回答"这是哪张卡"，与星级无关。
// ══════════════════════════════════════════════════════════

type Drawer = (g: Phaser.GameObjects.Graphics, s: SilhouetteStyle, d: number, v?: string) => void;

function polyPath(g: Phaser.GameObjects.Graphics, pts: Pt[]): void {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

function fillStroke(
  g: Phaser.GameObjects.Graphics,
  fill: number,
  fillAlpha: number,
  stroke: number,
  lw: number,
  strokeAlpha = 1,
): void {
  if (fillAlpha > 0) {
    g.fillStyle(fill, fillAlpha);
    g.fillPath();
  }
  if (lw > 0) {
    g.lineStyle(lw, stroke, strokeAlpha);
    g.strokePath();
  }
}

function shape(g: Phaser.GameObjects.Graphics, s: SilhouetteStyle, pts: Pt[], alpha = 1, shade = false): void {
  polyPath(g, pts);
  fillStroke(g, shade ? s.shade : s.body, alpha, s.rim, s.rimWidth, 0.85);
}

function blob(g: Phaser.GameObjects.Graphics, s: SilhouetteStyle, x: number, y: number, r: number, shade = false): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.closePath();
  fillStroke(g, shade ? s.shade : s.body, 1, s.rim, s.rimWidth, 0.85);
}

function accentDot(g: Phaser.GameObjects.Graphics, s: SilhouetteStyle, x: number, y: number, r: number): void {
  g.fillStyle(s.accent, 0.95);
  g.fillCircle(x, y, r);
  g.fillStyle(PAPER[50], 0.6);
  g.fillCircle(x - r * 0.3, y - r * 0.3, r * 0.4);
}

function limb(g: Phaser.GameObjects.Graphics, s: SilhouetteStyle, x1: number, y1: number, x2: number, y2: number, w: number): void {
  g.lineStyle(w + s.rimWidth * 2, s.rim, 0.35);
  g.lineBetween(x1, y1, x2, y2);
  g.lineStyle(w, s.body, 1);
  g.lineBetween(x1, y1, x2, y2);
}

/**
 * 四期扩军棋子的身份件 —— 画在基础剪影之上，与各抽屉内部的 variant 分支同责：
 * 回答"这是哪张卡"。坐标同剪影局部系（脚底 y=0，向上为负，左右 ±32）。
 * 集中成一张扁平表而不是散进 16 个抽屉：扩军棋子共用全部剪影，集中登记一眼可查。
 */
function drawExtraIdentity(g: Phaser.GameObjects.Graphics, s: SilhouetteStyle, v?: string): void {
  if (!v) return;
  switch (v) {
    // ── 墨门 ──
    case 'moyan': // 石匠：额上墨方印
      g.fillStyle(s.accent, 0.9);
      g.fillRect(-3, -53, 6, 6);
      g.lineStyle(1, s.rim, 0.5);
      g.lineBetween(-7, -18, 7, -18);
      break;
    case 'yunchu': // 织机师：肩后飞梭与垂丝
      shape(g, s, [[14, -42], [27, -37], [22, -30], [12, -35]], 1);
      g.lineStyle(1, s.accent, 0.85);
      g.lineBetween(24, -34, 28, -12);
      g.lineBetween(20, -33, 22, -14);
      break;
    case 'chiji': // 机士：轮纹圆盾
      g.lineStyle(1.6, s.accent, 0.9);
      g.strokeCircle(15, -26, 8);
      g.lineBetween(15, -34, 15, -18);
      g.lineBetween(7, -26, 23, -26);
      break;
    case 'guicheng': // 筑城吏：城垛三齿
      g.fillStyle(s.body, 1);
      g.fillRect(-13, -60, 5, 5);
      g.fillRect(-2, -61, 5, 6);
      g.fillRect(9, -60, 5, 5);
      g.lineStyle(1, s.rim, 0.6);
      g.lineBetween(-13, -55, 14, -55);
      break;
    case 'xuanji': // 玑衡师：玑衡环
      g.lineStyle(1.5, s.accent, 0.95);
      g.strokeCircle(0, -51, 8);
      g.lineBetween(-8, -51, 8, -51);
      g.lineBetween(0, -59, 0, -43);
      break;
    case 'baitao': // 陶正：陶轮与钧环
      g.fillStyle(s.accent, 0.85);
      g.fillEllipse(0, -3, 22, 5);
      g.lineStyle(1.4, s.accent, 0.8);
      g.strokeCircle(-12, -34, 4);
      break;
    case 'yusuan': // 算家：算筹束与筹筒
      g.lineStyle(1.6, s.accent, 0.9);
      g.lineBetween(12, -34, 20, -46);
      g.lineBetween(13, -33, 23, -42);
      g.lineBetween(14, -32, 25, -38);
      g.fillStyle(s.body, 1);
      g.fillRect(11, -37, 5, 7);
      break;
    case 'moliu': // 墨骑：顶鳍马鬃与面甲
      shape(g, s, [[-2, -58], [4, -66], [8, -56], [2, -52]], 1);
      g.lineStyle(1.2, s.accent, 0.9);
      g.lineBetween(-6, -50, 6, -50);
      break;
    case 'mozhai': // 巨子：背后兼爱短旗
      limb(g, s, -16, -58, -16, -28, 1.4);
      shape(g, s, [[-16, -58], [-3, -55], [-16, -49]], 1);
      g.fillStyle(s.accent, 0.95);
      g.fillCircle(-9, -53, 1.6);
      break;
    // ── 兵家 ──
    case 'zhenfeng': // 磨刀叟：磨石与亮刃
      g.fillStyle(s.shade, 1);
      g.fillRect(-18, -14, 7, 5);
      g.lineStyle(1.2, s.accent, 0.95);
      g.lineBetween(20, -52, 26, -34);
      break;
    case 'jinghong': // 猎手：三羽冠
      shape(g, s, [[-2, -58], [1, -66], [4, -58]], 1);
      shape(g, s, [[3, -57], [7, -64], [9, -55]], 1);
      shape(g, s, [[-6, -57], [-4, -64], [-1, -57]], 1);
      break;
    case 'xijue': // 袭位者：双蔓爵冠
      limb(g, s, -4, -56, -7, -64, 1.6);
      limb(g, s, 4, -56, 7, -64, 1.6);
      g.fillStyle(s.accent, 0.9);
      g.fillCircle(-7, -65, 1.5);
      g.fillCircle(7, -65, 1.5);
      break;
    case 'paoche': // 车兵：抛石臂
      limb(g, s, -8, -40, -22, -56, 2.6);
      blob(g, s, -23, -58, 2.6);
      break;
    case 'guzhen': // 鼓吏：背负战鼓
      blob(g, s, -15, -36, 6.5);
      g.lineStyle(1.2, s.accent, 0.85);
      g.lineBetween(-15, -42, -15, -30);
      g.lineBetween(-21, -36, -9, -36);
      break;
    case 'podu': // 度朔：桃枝
      limb(g, s, 10, -44, 22, -58, 1.6);
      blob(g, s, 24, -60, 2.2);
      blob(g, s, 19, -61, 1.8);
      break;
    case 'zhechong': // 折冲郎：交叉双钺
      limb(g, s, -6, -46, -18, -66, 2);
      limb(g, s, 6, -46, 18, -66, 2);
      g.lineStyle(1.4, s.accent, 0.9);
      g.lineBetween(-21, -62, -15, -70);
      g.lineBetween(21, -62, 15, -70);
      break;
    case 'taibu': // 卜帅：腰间龟卜片
      g.fillStyle(s.accent, 0.9);
      g.fillRect(-14, -30, 6, 9);
      g.lineStyle(1, PAPER[50], 0.7);
      g.lineBetween(-12, -29, -10, -23);
      break;
    // ── 扩军 · 现有羁绊 ──
    case 'jiuyuan': // 巫祝：酹爵与祭纹
      shape(g, s, [[10, -36], [16, -36], [15, -30], [11, -30]], 1);
      g.lineStyle(1, s.accent, 0.7);
      g.lineBetween(-8, -12, -8, -4);
      g.lineBetween(-4, -13, -4, -4);
      g.lineBetween(0, -14, 0, -4);
      break;
    case 'lingque': // 雀衣：双雀羽
      shape(g, s, [[-9, -52], [-14, -58], [-8, -57]], 1);
      shape(g, s, [[9, -52], [14, -58], [8, -57]], 1);
      break;
    case 'hanxing': // 星官：头顶星环
      g.lineStyle(1.4, s.accent, 0.9);
      g.strokeCircle(0, -62, 4.5);
      accentDot(g, s, 0, -62, 1.4);
      break;
    case 'yaoguang': // 星使：三芒星冠
      g.lineStyle(1.5, s.accent, 0.95);
      g.lineBetween(0, -56, 0, -68);
      g.lineBetween(-6, -54, -11, -63);
      g.lineBetween(6, -54, 11, -63);
      break;
    case 'jiaohan': // 蛟卒：背鳍鬃
      shape(g, s, [[-6, -50], [-2, -62], [3, -50], [0, -46]], 1);
      shape(g, s, [[3, -48], [8, -56], [10, -46]], 1);
      break;
    case 'chaoji': // 海弩手：胸前潮纹
      g.lineStyle(1.1, s.accent, 0.85);
      g.lineBetween(-8, -34, -4, -37);
      g.lineBetween(-4, -37, 0, -34);
      g.lineBetween(0, -34, 4, -37);
      g.lineBetween(4, -37, 8, -34);
      break;
    case 'wuhuo': // 火祝：骷髅火冠
      shape(g, s, [[-4, -58], [0, -70], [4, -58], [0, -54]], 1);
      g.fillStyle(s.accent, 0.85);
      g.fillCircle(0, -60, 1.6);
      break;
    case 'ruijin': // 金锋：错金刃纹
      g.lineStyle(1.2, s.accent, 0.95);
      g.lineBetween(14, -44, 24, -30);
      g.lineBetween(17, -47, 27, -33);
      break;
    case 'taozhu': // 货殖翁：腰间钱串
      blob(g, s, -13, -24, 2.4);
      blob(g, s, -11, -19, 2.4);
      g.lineStyle(1, s.accent, 0.8);
      g.lineBetween(-13, -27, -11, -17);
      break;
    case 'jingbo': // 鲸巫：鲸须弧
      g.lineStyle(1.2, s.accent, 0.85);
      g.beginPath();
      g.arc(-12, -44, 7, Math.PI * 0.2, Math.PI * 0.9);
      g.strokePath();
      g.beginPath();
      g.arc(-12, -48, 5, Math.PI * 0.2, Math.PI * 0.9);
      g.strokePath();
      break;
    case 'shihu': // 虎贲：圆耳与虎纹肩
      blob(g, s, -7, -54, 2.6);
      blob(g, s, 7, -54, 2.6);
      g.lineStyle(1.1, s.accent, 0.85);
      g.lineBetween(-10, -40, -2, -43);
      g.lineBetween(2, -43, 10, -40);
      break;
    case 'gouchen': // 勾陈帝：双层帝冕
      g.fillStyle(s.body, 1);
      g.fillRect(-6, -60, 12, 4);
      g.fillRect(-4, -65, 8, 5);
      g.lineStyle(1, s.accent, 0.9);
      g.strokeRect(-4, -65, 8, 5);
      break;
    case 'wangxiang': // 望乡人：归乡包袱
      blob(g, s, -14, -30, 4.5);
      g.lineStyle(1.2, s.accent, 0.85);
      g.lineBetween(-17, -33, -11, -27);
      break;
    case 'zhaoye': // 照夜白：额前白缨
      limb(g, s, 0, -58, 0, -70, 1.8);
      accentDot(g, s, 0, -71, 1.8);
      break;
    case 'muyuan': // 木鸢：背后木翼
      shape(g, s, [[-8, -44], [-24, -56], [-20, -42], [-8, -38]], 1);
      shape(g, s, [[8, -44], [24, -56], [20, -42], [8, -38]], 1);
      break;
    default:
      break;
  }
}

const DRAWERS: Record<SilhouetteKey, Drawer> = {
  // ── 刀将：宽肩甲 + 长柄大刀，压迫感 ──
  bladeGeneral: (g, s, d, v) => {
    shape(g, s, [[-14, -24], [-10, 0], [-3, 0], [-4, -24]], 1, true);
    shape(g, s, [[4, -24], [3, 0], [10, 0], [14, -24]], 1, true);
    shape(g, s, [[-16, -26], [16, -26], [19, 0], [-19, 0]], 1); // 战袍
    shape(g, s, [[-11, -44], [11, -44], [15, -24], [-15, -24]], 1); // 躯干
    shape(g, s, [[-20, -46], [-11, -53], [11, -53], [20, -46], [13, -39], [-13, -39]], 1); // 肩甲
    blob(g, s, 0, -57, 7);
    shape(g, s, [[-8, -62], [8, -62], [6, -50], [-6, -50]], 1, true); // 兜鍪
    // 长柄大刀
    limb(g, s, 15, -40, 27, 4, 3.2);
    shape(g, s, [[24, -6], [31, -18], [35, -15], [28, -1]], 1); // 刀身
    g.lineStyle(1.4, s.accent, 0.9);
    g.lineBetween(26, -14, 33, -6);
    if (d >= 1) {
      g.lineStyle(1, GILT.base, 0.5);
      g.lineBetween(-13, -39, 13, -39); // 胸甲束带
      accentDot(g, s, 0, -40, 1.8);
    }
    if (d >= 2) {
      shape(g, s, [[-9, -68], [9, -68], [7, -60], [-7, -60]], 1, true); // 盔缨座
      g.lineStyle(2, s.accent, 0.8);
      g.lineBetween(0, -68, 0, -74);
      g.lineBetween(-4, -71, 4, -71);
    }
    // 身份件：断岳 = 那杆宽刀本体（默认像）；无咎 = 背负剑匣；昊天 = 冕旒 + 披风
    if (v === 'wujiu') {
      shape(g, s, [[-24, -58], [-14, -50], [-11, -40], [-19, -40], [-26, -48]], 1, true); // 剑匣
      limb(g, s, -22, -58, -26, -70, 1.8); // 匣中双剑柄
      limb(g, s, -18, -56, -20, -66, 1.8);
      accentDot(g, s, -23, -71, 1.2);
      accentDot(g, s, -19, -67, 1.2);
    } else if (v === 'haotian') {
      shape(g, s, [[-15, -46], [-24, -10], [-17, -2], [-10, -42]], 1, true); // 披风
      g.lineStyle(1.6, GILT.base, 0.85);
      g.lineBetween(-6, -62, 6, -62); // 冕板
      for (let i = -1; i <= 1; i++) accentDot(g, s, i * 5, -59, 1.1); // 冕旒
    }
  },

  // ── 枪先锋：长枪 + 高缨，纵向线条最强 ──
  spearVanguard: (g, s, d, v) => {
    shape(g, s, [[-13, -22], [-9, 0], [-2, 0], [-3, -22]], 1, true);
    shape(g, s, [[3, -22], [2, 0], [9, 0], [13, -22]], 1, true);
    shape(g, s, [[-15, -24], [15, -24], [18, 0], [-18, 0]], 1);
    shape(g, s, [[-10, -42], [10, -42], [14, -22], [-14, -22]], 1);
    shape(g, s, [[-18, -44], [-10, -51], [10, -51], [18, -44], [12, -37], [-12, -37]], 1);
    blob(g, s, 0, -55, 6.8);
    shape(g, s, [[-8, -60], [8, -60], [6, -48], [-6, -48]], 1, true);
    // 长枪
    limb(g, s, 20, -68, 20, 6, 3);
    shape(g, s, [[17, -76], [23, -76], [20, -64]], 1); // 枪尖
    g.lineStyle(2.4, s.accent, 0.9);
    g.lineBetween(20, -72, 20, -66); // 红缨
    if (d >= 1) {
      g.lineStyle(1, GILT.base, 0.45);
      g.lineBetween(-12, -37, 12, -37);
      accentDot(g, s, -8, -40, 1.6);
      accentDot(g, s, 8, -40, 1.6);
    }
    if (d >= 2) {
      shape(g, s, [[-16, -30], [-22, -18], [-16, -12], [-12, -22]], 1, true); // 披膊
    }
    // 身份件：凌霄 = 云纹枪头 + 飘带；镇岳 = 半身塔盾
    if (v === 'lingxiao') {
      g.lineStyle(1.4, mix(PAPER[200], s.rim, 0.4), 0.6);
      g.beginPath();
      g.arc(20, -80, 5, Math.PI * 0.5, Math.PI * 1.5); // 云纹
      g.strokePath();
      g.beginPath();
      g.moveTo(-14, -48);
      g.lineTo(-30, -60);
      g.moveTo(-14, -44);
      g.lineTo(-28, -50);
      g.strokePath(); // 飘带
    } else if (v === 'zhenyue') {
      shape(g, s, [[-30, -46], [-18, -50], [-15, -6], [-27, -4]], 1, true); // 塔盾
      g.lineStyle(1.2, s.accent, 0.7);
      g.lineBetween(-23, -42, -21, -10);
      g.lineBetween(-28, -30, -17, -32); // 盾脊
    }
  },

  // ── 石卫：最厚重的剪影，一面巨盾占掉半边 ──
  stoneGuard: (g, s, d, v) => {
    shape(g, s, [[-15, -20], [-12, 0], [-4, 0], [-5, -20]], 1, true);
    shape(g, s, [[5, -20], [4, 0], [12, 0], [15, -20]], 1, true);
    shape(g, s, [[-19, -42], [19, -42], [23, 0], [-23, 0]], 1); // 厚重躯干
    shape(g, s, [[-13, -50], [13, -50], [19, -38], [-19, -38]], 1); // 石肩
    blob(g, s, 0, -55, 6.2);
    // 巨盾
    shape(g, s, [[-31, -44], [-16, -48], [-13, -30], [-18, -6], [-28, -10], [-32, -28]], 1, true);
    g.lineStyle(1.6, s.accent, 0.8);
    g.lineBetween(-22, -46, -22, -9);
    g.lineBetween(-30, -32, -15, -30);
    if (d >= 1) {
      g.lineStyle(1.2, mix(INK[400], s.body, 0.5), 0.7);
      g.lineBetween(-14, -30, 14, -30);
      g.lineBetween(-16, -20, 16, -20);
      g.lineBetween(-18, -10, 18, -10); // 岩层
    }
    if (d >= 2) {
      accentDot(g, s, -22, -27, 2.4);
      g.lineStyle(1.4, GILT.base, 0.6);
      g.strokeCircle(-22, -27, 5);
    }
    // 身份件：磐 = 岩层本体（默认像）；玄武 = 龟甲纹 + 蛇探首；不动 = 背光 + 结印
    if (v === 'xuanwu') {
      g.lineStyle(1.1, mix(INK[400], s.body, 0.4), 0.75);
      g.beginPath();
      g.moveTo(-30, -38);
      g.lineTo(-15, -34);
      g.moveTo(-28, -24);
      g.lineTo(-14, -22);
      g.moveTo(-26, -12);
      g.lineTo(-16, -12);
      g.moveTo(-26, -38);
      g.lineTo(-25, -12);
      g.moveTo(-20, -36);
      g.lineTo(-18, -12);
      g.strokePath(); // 龟甲格
      blob(g, s, 14, -56, 3.4, true); // 蛇首
      g.lineStyle(1, s.accent, 0.8);
      g.lineBetween(16, -55, 20, -54); // 蛇信
    } else if (v === 'budong') {
      g.lineStyle(2, GILT.base, 0.55);
      g.beginPath();
      g.arc(0, -52, 15, Math.PI * 0.9, Math.PI * 2.1);
      g.strokePath(); // 背光
      blob(g, s, 10, -34, 3, true); // 结印双手
      blob(g, s, -10, -34, 3, true);
    }
  },

  // ── 铁牛：牛角 + 宽躯，横向张力 ──
  ironBull: (g, s, d, v) => {
    shape(g, s, [[-15, -18], [-12, 0], [-4, 0], [-5, -18]], 1, true);
    shape(g, s, [[5, -18], [4, 0], [12, 0], [15, -18]], 1, true);
    shape(g, s, [[-17, -40], [17, -40], [20, 0], [-20, 0]], 1);
    shape(g, s, [[-21, -34], [-13, -40], [13, -40], [21, -34], [17, -28], [-17, -28]], 1); // 宽肩
    blob(g, s, 0, -48, 9);
    // 牛角
    limb(g, s, -8, -54, -22, -62, 3.4);
    limb(g, s, 8, -54, 22, -62, 3.4);
    if (d >= 1) {
      g.fillStyle(s.accent, 0.9);
      g.fillCircle(0, -46, 2.2); // 鼻环
      g.lineStyle(1, PAPER[300], 0.5);
      g.lineBetween(-6, -50, -3, -50);
      g.lineBetween(6, -50, 3, -50);
    }
    if (d >= 2) {
      limb(g, s, -18, -30, -26, -14, 3); // 前蹄护甲
      limb(g, s, 18, -30, 26, -14, 3);
    }
    // 身份件：苍嗥 = 狼耳竖立 + 肩鬃；苦童 = 背药篓；赤瞳 = 额上独目 + 长角后掠
    if (v === 'canghao') {
      shape(g, s, [[-8, -55], [-5, -70], [-1, -54]], 1, true); // 狼耳
      shape(g, s, [[8, -55], [5, -70], [1, -54]], 1, true);
      g.lineStyle(1.6, mix(s.shade, s.rim, 0.35), 0.8);
      g.beginPath();
      g.moveTo(-19, -38);
      g.lineTo(-14, -42);
      g.lineTo(-10, -36);
      g.lineTo(-6, -40);
      g.moveTo(19, -38);
      g.lineTo(14, -42);
      g.lineTo(10, -36);
      g.lineTo(6, -40);
      g.strokePath(); // 肩鬃
    } else if (v === 'kutong') {
      shape(g, s, [[-28, -50], [-17, -46], [-14, -30], [-25, -28]], 1, true); // 药篓
      g.lineStyle(1.2, s.accent, 0.8);
      g.lineBetween(-17, -30, -14, -30);
      g.lineBetween(-25, -46, -22, -46);
      limb(g, s, -21, -50, -23, -58, 1.2); // 篓中药材
      limb(g, s, -18, -49, -17, -57, 1.2);
    } else if (v === 'chitong') {
      accentDot(g, s, 0, -52, 3.4); // 额上独目
      limb(g, s, -22, -62, -32, -74, 2.4); // 长角后掠
      limb(g, s, 22, -62, 32, -74, 2.4);
    }
  },

  // ── 影兜：尖顶兜帽 + 瘦削身形，最小的剪影 ──
  shadowHood: (g, s, d) => {
    shape(g, s, [[-8, -20], [-6, 0], [-1, 0], [-2, -20]], 1, true);
    shape(g, s, [[2, -20], [1, 0], [6, 0], [8, -20]], 1, true);
    shape(g, s, [[-10, -44], [10, -44], [13, 0], [-13, 0]], 1);
    shape(g, s, [[-11, -46], [0, -68], [11, -46]], 1); // 尖兜帽
    blob(g, s, 0, -48, 6, true);
    g.fillStyle(INK[900], 0.85);
    g.fillEllipse(0, -49, 8, 6); // 面部阴影
    // 狐尾
    g.lineStyle(2.6, s.accent, 0.75);
    g.beginPath();
    g.arc(0, -20, 16, Math.PI * 0.62, Math.PI * 1.05);
    g.strokePath();
    if (d >= 1) {
      limb(g, s, 10, -34, 19, -28, 2.4); // 匕首
      limb(g, s, -10, -34, -19, -28, 2.4);
      accentDot(g, s, 1, -50, 1.4);
    }
    if (d >= 2) {
      g.lineStyle(1.6, s.accent, 0.5);
      g.beginPath();
      g.arc(0, -20, 21, Math.PI * 0.66, Math.PI * 1.02);
      g.strokePath();
    }
  },

  // ── 双刃：双匕上扬 + 飘带，动势最强 ──
  twinDagger: (g, s, d, v) => {
    shape(g, s, [[-9, -22], [-7, 0], [-1, 0], [-2, -22]], 1, true);
    shape(g, s, [[2, -22], [1, 0], [7, 0], [9, -22]], 1, true);
    shape(g, s, [[-10, -44], [10, -44], [13, 0], [-13, 0]], 1);
    shape(g, s, [[-11, -46], [-2, -64], [10, -46]], 1); // 兜帽（后倾）
    blob(g, s, 1, -47, 6.2);
    g.fillStyle(INK[900], 0.85);
    g.fillEllipse(2, -48, 7.5, 5.5);
    // 双匕
    limb(g, s, -11, -32, -22, -44, 2.6);
    limb(g, s, 11, -32, 22, -42, 2.6);
    g.lineStyle(1.6, s.accent, 0.9);
    g.lineBetween(-22, -44, -26, -50);
    g.lineBetween(22, -42, 26, -48);
    if (d >= 1) {
      g.lineStyle(1.4, mix(PAPER[200], s.rim, 0.4), 0.45);
      g.beginPath();
      g.moveTo(-12, -40);
      g.lineTo(-24, -20);
      g.lineTo(-16, -14);
      g.strokePath(); // 飘带
    }
    if (d >= 2) {
      g.lineStyle(1.8, GILT.base, 0.55);
      g.strokeCircle(0, -24, 22);
    }
    // 身份件：影刹 = 面巾；青冥 = 腰间长剑 + 白绫
    if (v === 'yingsha') {
      g.fillStyle(INK[900], 0.8);
      g.fillRect(-5, -49, 10, 4); // 面巾
      g.lineStyle(1, s.rim, 0.5);
      g.lineBetween(-5, -47, 5, -47);
    } else if (v === 'qingming') {
      limb(g, s, -13, -22, -15, -2, 2.6); // 腰间长剑
      g.lineStyle(1.2, s.accent, 0.85);
      g.lineBetween(-17, -18, -11, -16); // 剑格
      g.lineStyle(1.4, mix(PAPER[200], s.rim, 0.4), 0.55);
      g.beginPath();
      g.moveTo(-12, -44);
      g.lineTo(-22, -36);
      g.lineTo(-26, -24);
      g.lineTo(-24, -8);
      g.strokePath(); // 白绫
    }
  },

  // ── 弓狙：一张大弓构成辨识符号 ──
  bowSniper: (g, s, d) => {
    shape(g, s, [[-11, -22], [-8, 0], [-2, 0], [-3, -22]], 1, true);
    shape(g, s, [[3, -22], [2, 0], [8, 0], [11, -22]], 1, true);
    shape(g, s, [[-12, -42], [12, -42], [15, 0], [-15, 0]], 1);
    shape(g, s, [[-14, -46], [-6, -52], [6, -52], [14, -46], [10, -40], [-10, -40]], 1);
    blob(g, s, 0, -55, 6.4);
    shape(g, s, [[-7, -60], [7, -60], [5, -49], [-5, -49]], 1, true);
    // 弓
    g.lineStyle(3, s.rim, 0.4);
    g.beginPath();
    g.arc(17, -28, 22, Math.PI * 0.62, Math.PI * 1.38);
    g.strokePath();
    g.lineStyle(2.4, s.body, 1);
    g.beginPath();
    g.arc(17, -28, 22, Math.PI * 0.62, Math.PI * 1.38);
    g.strokePath();
    g.lineStyle(1, PAPER[300], 0.6);
    g.lineBetween(15, -49, 15, -7); // 弓弦
    if (d >= 1) {
      shape(g, s, [[-16, -34], [-22, -26], [-18, -20], [-12, -26]], 1, true); // 箭袋
      g.lineStyle(1.4, s.accent, 0.8);
      g.lineBetween(-20, -32, -14, -32);
      g.lineBetween(-21, -29, -15, -29);
    }
    if (d >= 2) {
      limb(g, s, 15, -28, 30, -28, 1.8); // 搭箭
      accentDot(g, s, 30, -28, 1.6);
    }
  },

  // ── 弩机：横平竖直的机械感 ──
  crossbowGunner: (g, s, d, v) => {
    shape(g, s, [[-11, -20], [-9, 0], [-3, 0], [-4, -20]], 1, true);
    shape(g, s, [[3, -20], [2, 0], [9, 0], [11, -20]], 1, true);
    shape(g, s, [[-12, -40], [12, -40], [15, 0], [-15, 0]], 1);
    shape(g, s, [[-14, -44], [-7, -50], [7, -50], [14, -44], [10, -38], [-10, -38]], 1);
    blob(g, s, 0, -53, 6.2);
    // 横弩
    shape(g, s, [[-18, -32], [22, -32], [22, -26], [-18, -26]], 1, true); // 弩身
    g.lineStyle(2.6, s.body, 1);
    g.beginPath();
    g.arc(16, -29, 15, Math.PI * 0.72, Math.PI * 1.28);
    g.strokePath();
    g.lineStyle(4, s.rim, 0.3);
    g.beginPath();
    g.arc(16, -29, 15, Math.PI * 0.72, Math.PI * 1.28);
    g.strokePath();
    g.lineStyle(1.2, s.accent, 0.85);
    g.lineBetween(4, -29, 24, -29); // 弩矢
    if (d >= 1) {
      g.lineStyle(1, GILT.base, 0.45);
      g.strokeRect(-13, -38, 8, 8); // 机械铆钉框
      g.strokeRect(6, -38, 8, 8);
    }
    if (d >= 2) {
      g.lineStyle(1.4, s.accent, 0.6);
      g.lineBetween(-18, -14, -26, -6);
      g.lineBetween(18, -14, 26, -6); // 支架
    }
    // 身份件：木机 = 木躯纹 + 铆钉；公输 = 肘部齿轮 + 机簧烟囱
    if (v === 'muji') {
      g.lineStyle(1, mix(INK[400], s.body, 0.5), 0.6);
      g.beginPath();
      g.moveTo(-10, -36);
      g.lineTo(8, -30);
      g.moveTo(-8, -24);
      g.lineTo(10, -18);
      g.strokePath(); // 木纹
      accentDot(g, s, -10, -40, 1.2); // 铆钉
      accentDot(g, s, 10, -40, 1.2);
    } else if (v === 'gongshu') {
      g.lineStyle(1.3, s.accent, 0.85);
      g.strokeCircle(-16, -30, 4.2); // 齿轮
      g.strokeCircle(16, -30, 4.2);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.lineBetween(
          -16 + Math.cos(a) * 4.2, -30 + Math.sin(a) * 4.2,
          -16 + Math.cos(a) * 6.4, -30 + Math.sin(a) * 6.4,
        );
      }
      shape(g, s, [[12, -56], [17, -56], [17, -46], [12, -46]], 1, true); // 机簧烟囱
    }
  },

  // ── 符法师：长袍 + 浮游符箓 ──
  talismanMage: (g, s, d, v) => {
    shape(g, s, [[-15, -40], [15, -40], [21, 0], [-21, 0]], 1); // 长袍
    shape(g, s, [[-10, -50], [10, -50], [14, -38], [-14, -38]], 1);
    blob(g, s, 0, -55, 6.6);
    shape(g, s, [[-9, -60], [9, -60], [7, -50], [-7, -50]], 1, true); // 道冠
    // 法杖
    limb(g, s, -19, -50, -23, 2, 2.6);
    g.lineStyle(2, s.accent, 0.9);
    g.strokeRect(-27, -58, 8, 8);
    if (d >= 1) {
      // 浮游符箓
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const fx = Math.cos(a) * 22;
        const fy = -44 + Math.sin(a) * 16;
        g.fillStyle(s.accent, 0.55 + 0.15 * i);
        g.fillRect(fx - 3, fy - 4, 6, 8);
        g.lineStyle(0.8, PAPER[50], 0.4);
        g.strokeRect(fx - 3, fy - 4, 6, 8);
      }
    }
    if (d >= 2) {
      g.lineStyle(1.4, GILT.base, 0.5);
      g.beginPath();
      g.arc(0, -44, 26, 0, Math.PI * 2);
      g.strokePath();
    }
    // 身份件：元素 = 浮游符（默认像）；敖姻 = 龙角雏 + 水袖；朱炎 = 火羽冠；辛环 = 雷环
    if (v === 'aoyin') {
      limb(g, s, -4, -62, -9, -72, 1.8); // 龙角雏
      limb(g, s, 4, -62, 9, -72, 1.8);
      shape(g, s, [[-19, -46], [-27, -36], [-21, -28], [-16, -40]], 1, true); // 水袖
      shape(g, s, [[19, -46], [27, -36], [21, -28], [16, -40]], 1, true);
    } else if (v === 'zhuyan') {
      for (let i = -1; i <= 1; i++) {
        const fh = 11 - Math.abs(i) * 3.5;
        g.fillStyle(i === 0 ? s.accent : GILT.deep, 0.9);
        g.fillTriangle(i * 5 - 2.6, -62, i * 5 + 2.6, -62, i * 5, -62 - fh); // 火羽冠
      }
    } else if (v === 'xinhuan') {
      g.lineStyle(1.4, s.accent, 0.85);
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI * 2;
        const x0 = Math.cos(a0) * 12;
        const y0 = -58 + Math.sin(a0) * 8;
        const x1 = Math.cos(a0 + 0.7) * 12;
        const y1 = -58 + Math.sin(a0 + 0.7) * 8;
        const mx = (x0 + x1) / 2 + Math.cos(a0 + 0.35) * 3.5;
        const my = (y0 + y1) / 2 + Math.sin(a0 + 0.35) * 3.5;
        g.moveTo(x0, y0);
        g.lineTo(mx, my);
        g.lineTo(x1, y1);
      }
      g.strokePath(); // 雷环
    }
  },

  // ── 灯仙：一盏灯是唯一光源感 ──
  lanternSage: (g, s, d) => {
    shape(g, s, [[-14, -38], [14, -38], [19, 0], [-19, 0]], 1);
    shape(g, s, [[-9, -48], [9, -48], [13, -36], [-13, -36]], 1);
    blob(g, s, 0, -53, 6.4);
    shape(g, s, [[-8, -58], [8, -58], [6, -48], [-6, -48]], 1, true);
    // 灯笼
    limb(g, s, 17, -50, 17, -40, 1.6);
    g.fillStyle(s.accent, 0.9);
    g.fillEllipse(17, -33, 12, 15);
    g.lineStyle(1.2, GILT.base, 0.8);
    g.strokeEllipse(17, -33, 12, 15);
    g.lineStyle(0.8, PAPER[50], 0.6);
    g.lineBetween(11, -33, 23, -33);
    if (d >= 1) {
      g.fillStyle(s.accent, 0.16);
      g.fillCircle(17, -33, 18); // 光晕
    }
    if (d >= 2) {
      g.fillStyle(s.accent, 0.08);
      g.fillCircle(17, -33, 30);
    }
  },

  // ── 咒术士：骨杖 + 环绕符文 + 大斗篷 ──
  hexWarlock: (g, s, d, v) => {
    shape(g, s, [[-19, -44], [19, -44], [24, 0], [-24, 0]], 1); // 大斗篷
    shape(g, s, [[-11, -52], [11, -52], [15, -42], [-15, -42]], 1);
    blob(g, s, 0, -58, 6.4);
    shape(g, s, [[-10, -64], [10, -64], [8, -52], [-8, -52]], 1, true); // 尖帽
    // 骨杖
    limb(g, s, -21, -54, -25, 4, 2.4);
    g.beginPath();
    g.arc(-25, -58, 5, 0, Math.PI * 2);
    g.closePath();
    fillStroke(g, s.body, 1, s.accent, 1.4, 0.9);
    g.fillStyle(INK[900], 0.9);
    g.fillCircle(-27, -59, 1.5);
    g.fillCircle(-23, -59, 1.5);
    if (d >= 1) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        accentDot(g, s, Math.cos(a) * 24, -40 + Math.sin(a) * 14, 2);
      }
    }
    if (d >= 2) {
      g.lineStyle(1.2, VOID.light, 0.5);
      g.beginPath();
      g.arc(0, -38, 28, 0, Math.PI * 2);
      g.strokePath();
    }
    // 身份件：墨羽 = 鸦喙面具 + 肩羽；九婴 = 环首八枚小蛇头
    if (v === 'moyu') {
      g.fillStyle(INK[900], 0.9);
      g.fillTriangle(-3.6, -62, 3.6, -62, 0, -55); // 鸦喙
      g.lineStyle(1.2, mix(s.body, s.rim, 0.5), 0.8);
      g.beginPath();
      g.moveTo(-14, -48);
      g.lineTo(-20, -40);
      g.moveTo(14, -48);
      g.lineTo(20, -40);
      g.strokePath(); // 肩羽
    } else if (v === 'jiuying') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        blob(g, s, Math.cos(a) * 13, -60 + Math.sin(a) * 7, 2.6, true);
      }
    }
  },

  // ── 骨偶：骷髅 + 肋骨，唯一"非人"轮廓 ──
  bonePuppet: (g, s, d, v) => {
    shape(g, s, [[-9, -18], [-7, 0], [-2, 0], [-3, -18]], 1, true);
    shape(g, s, [[2, -18], [1, 0], [7, 0], [9, -18]], 1, true);
    shape(g, s, [[-8, -42], [8, -42], [11, -16], [-11, -16]], 1); // 细躯干
    g.lineStyle(2.2, s.body, 1);
    for (let i = 0; i < 3; i++) g.lineBetween(-8, -36 + i * 6, 8, -36 + i * 6); // 肋骨
    g.lineStyle(1.2, s.rim, 0.5);
    for (let i = 0; i < 3; i++) g.lineBetween(-8, -37 + i * 6, 8, -37 + i * 6);
    // 破布下摆
    polyPath(g, [
      [-13, -16], [-9, -22], [-4, -14], [0, -22], [4, -14], [9, -22], [13, -16], [11, 0], [-11, 0],
    ] as Pt[]);
    fillStroke(g, s.shade, 1, s.rim, s.rimWidth, 0.7);
    // 骷髅头
    blob(g, s, 0, -49, 7.5);
    g.fillStyle(INK[900], 0.95);
    g.fillEllipse(-3, -50, 3.4, 4.2);
    g.fillEllipse(3, -50, 3.4, 4.2);
    g.fillRect(-1.6, -45, 3.2, 2.4);
    if (d >= 1) {
      g.lineStyle(1, s.accent, 0.6);
      g.lineBetween(-3, -50, -3, -46);
      g.lineBetween(3, -50, 3, -46);
    }
    if (d >= 2) {
      limb(g, s, -12, -40, -22, -30, 2.2); // 骨爪
      limb(g, s, 12, -40, 22, -30, 2.2);
    }
    // 身份件：夜游 = 乌纱帽 + 拷魂链；十殿 = 冕旒 + 判官笔
    if (v === 'yeyou') {
      g.fillStyle(INK[900], 0.92);
      g.fillRect(-7, -60, 14, 4); // 乌纱
      g.fillRect(-11, -59, 3, 2);
      g.fillRect(8, -59, 3, 2); // 帽翅
      g.lineStyle(1.1, s.rim, 0.7);
      for (let i = 0; i < 4; i++) g.strokeCircle(-20 + i * 2.6, -30 + i * 6, 1.6); // 拷魂链
    } else if (v === 'shidian') {
      g.lineStyle(1.6, GILT.base, 0.9);
      g.lineBetween(-7, -60, 7, -60); // 冕板
      for (let i = -2; i <= 2; i++) accentDot(g, s, i * 3.2, -57, 0.9); // 冕旒
      limb(g, s, 13, -36, 22, -46, 1.8); // 判官笔
      accentDot(g, s, 22.6, -47, 1.1);
    }
  },

  // ── 葫芦医：一只葫芦占半边身 ──
  gourdHealer: (g, s, d) => {
    shape(g, s, [[-11, -36], [11, -36], [14, 0], [-14, 0]], 1);
    shape(g, s, [[-8, -44], [8, -44], [11, -34], [-11, -34]], 1);
    blob(g, s, 0, -50, 6.2);
    shape(g, s, [[-8, -55], [8, -55], [6, -45], [-6, -45]], 1, true); // 斗笠
    // 葫芦
    g.beginPath();
    g.arc(16, -34, 6, 0, Math.PI * 2);
    g.closePath();
    fillStroke(g, s.accent, 0.95, GILT.base, 1.4, 0.8);
    g.beginPath();
    g.arc(16, -23, 8, 0, Math.PI * 2);
    g.closePath();
    fillStroke(g, s.accent, 0.95, GILT.base, 1.4, 0.8);
    g.lineStyle(1, PAPER[50], 0.5);
    g.lineBetween(16, -28, 16, -27);
    if (d >= 1) {
      accentDot(g, s, 16, -34, 1.6);
      g.lineStyle(1.2, mix(s.body, PAPER[200], 0.3), 0.5);
      g.lineBetween(-10, -28, 10, -28); // 腰带
    }
    if (d >= 2) {
      g.fillStyle(s.accent, 0.12);
      g.fillCircle(16, -28, 20);
    }
  },

  // ── 幡辅：一杆高幡，最高也是最瘦 ──
  bannerSupport: (g, s, d) => {
    shape(g, s, [[-13, -38], [13, -38], [17, 0], [-17, 0]], 1);
    shape(g, s, [[-9, -46], [9, -46], [12, -36], [-12, -36]], 1);
    blob(g, s, 0, -52, 6.2);
    // 面具
    shape(g, s, [[-6, -56], [6, -56], [5, -46], [-5, -46]], 1, true);
    g.fillStyle(s.accent, 0.8);
    g.fillRect(-4, -53, 8, 2.4);
    // 幡
    limb(g, s, 21, -76, 21, 4, 2.4);
    shape(g, s, [[21, -74], [33, -70], [30, -58], [21, -56]], 1, true); // 幡面
    g.lineStyle(1.4, s.accent, 0.85);
    g.lineBetween(23, -68, 31, -66);
    g.lineBetween(23, -63, 31, -61);
    if (d >= 1) {
      g.lineStyle(1.6, s.accent, 0.5);
      g.lineBetween(21, -78, 21, -74);
    }
    if (d >= 2) {
      shape(g, s, [[33, -70], [38, -64], [30, -58]], 1, true); // 幡尾飘带
    }
  },

  // ── 龙君：龙角 + 龙须 + 龙尾，最宽的剪影 ──
  dragonSovereign: (g, s, d, v) => {
    // 龙尾
    g.lineStyle(4, s.rim, 0.3);
    g.beginPath();
    g.arc(-4, -18, 24, Math.PI * 0.15, Math.PI * 0.85);
    g.strokePath();
    g.lineStyle(3, s.body, 0.9);
    g.beginPath();
    g.arc(-4, -18, 24, Math.PI * 0.15, Math.PI * 0.85);
    g.strokePath();
    shape(g, s, [[-16, -44], [16, -44], [21, 0], [-21, 0]], 1);
    shape(g, s, [[-19, -50], [-9, -56], [9, -56], [19, -50], [14, -42], [-14, -42]], 1); // 龙鳞肩
    blob(g, s, 0, -60, 7);
    // 龙角
    limb(g, s, -5, -66, -13, -78, 2.6);
    limb(g, s, 5, -66, 13, -78, 2.6);
    // 龙须
    g.lineStyle(1.4, s.accent, 0.75);
    g.beginPath();
    g.arc(-9, -58, 8, Math.PI * 1.5, Math.PI * 0.65);
    g.strokePath();
    g.beginPath();
    g.arc(9, -58, 8, Math.PI * 1.5, Math.PI * 0.35, true);
    g.strokePath();
    if (d >= 1) {
      g.lineStyle(1, GILT.base, 0.5);
      for (let i = 0; i < 3; i++) g.lineBetween(-14 + i * 2, -38 + i * 8, 14 - i * 2, -38 + i * 8); // 鳞纹
    }
    if (d >= 2) {
      accentDot(g, s, 0, -62, 2.2); // 额珠
      g.fillStyle(s.accent, 0.14);
      g.fillCircle(0, -40, 30);
    }
    // 身份件：沧澜 = 三叉龙冠 + 袍摆潮纹；应龙 = 展开的双翼
    if (v === 'canglan') {
      g.lineStyle(2, GILT.base, 0.9);
      g.lineBetween(0, -70, 0, -78); // 中叉
      g.lineBetween(-4, -69, -7, -75);
      g.lineBetween(4, -69, 7, -75); // 三叉龙冠
      g.lineStyle(1.1, mix(INK[400], s.body, 0.4), 0.6);
      g.beginPath();
      g.moveTo(-16, -8);
      g.lineTo(-10, -13);
      g.lineTo(0, -8);
      g.lineTo(10, -13);
      g.lineTo(16, -8);
      g.strokePath(); // 潮纹袍摆
    } else if (v === 'yinglong') {
      shape(g, s, [[-20, -50], [-38, -62], [-34, -46], [-42, -44], [-32, -34], [-20, -38]], 1, true); // 左翼
      shape(g, s, [[20, -50], [38, -62], [34, -46], [42, -44], [32, -34], [20, -38]], 1, true); // 右翼
      g.lineStyle(1.1, s.rim, 0.4);
      g.lineBetween(-24, -48, -38, -58);
      g.lineBetween(-22, -42, -36, -42);
      g.lineBetween(24, -48, 38, -58);
      g.lineBetween(22, -42, 36, -42); // 翼骨
    }
  },

  // ── 狐仙：狐耳 + 三尾 ──
  foxSpirit: (g, s, d, v) => {
    // 三尾
    for (let i = 0; i < 3; i++) {
      g.lineStyle(3.4 - i * 0.4, s.rim, 0.28);
      g.beginPath();
      g.arc(-6, -22, 22 + i * 4, Math.PI * 0.1 + i * 0.12, Math.PI * 0.9 - i * 0.1);
      g.strokePath();
      g.lineStyle(2.4 - i * 0.3, mix(s.body, s.accent, 0.35), 0.85);
      g.beginPath();
      g.arc(-6, -22, 22 + i * 4, Math.PI * 0.1 + i * 0.12, Math.PI * 0.9 - i * 0.1);
      g.strokePath();
    }
    shape(g, s, [[-13, -40], [13, -40], [17, 0], [-17, 0]], 1);
    shape(g, s, [[-9, -48], [9, -48], [12, -38], [-12, -38]], 1);
    blob(g, s, 0, -54, 6.6);
    // 狐耳
    shape(g, s, [[-9, -58], [-3, -72], [-1, -57]], 1, true);
    shape(g, s, [[9, -58], [3, -72], [1, -57]], 1, true);
    g.fillStyle(s.accent, 0.75);
    g.fillTriangle(-7.5, -60, -3.6, -68, -3, -59);
    g.fillTriangle(7.5, -60, 3.6, -68, 3, -59);
    if (d >= 1) {
      g.fillStyle(INK[900], 0.7);
      g.fillEllipse(-3, -55, 2, 2.6);
      g.fillEllipse(3, -55, 2, 2.6);
      accentDot(g, s, 0, -50, 1.4);
    }
    if (d >= 2) {
      g.fillStyle(s.accent, 0.12);
      g.fillCircle(0, -46, 28);
    }
    // 身份件：白娘 = 蛇盘髻 + 素带；青丘 = 九尾尽展
    if (v === 'bainiang') {
      g.lineStyle(1.6, mix(s.body, PAPER[200], 0.45), 0.85);
      g.beginPath();
      g.arc(0, -60, 4.5, Math.PI * 0.2, Math.PI * 1.9);
      g.strokePath(); // 蛇盘髻
      accentDot(g, s, 4.4, -60, 1); // 蛇目
      g.lineStyle(1.2, PAPER[200], 0.5);
      g.lineBetween(-11, -34, 11, -34); // 素带
    } else if (v === 'qingqiu') {
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * 0.06 + i * 0.13;
        const rr = 26 + (i % 2) * 5;
        g.lineStyle(2 - (i % 3) * 0.4, mix(s.body, s.accent, 0.35), 0.8);
        g.beginPath();
        g.arc(-6, -22, rr, a, a + 0.62);
        g.strokePath();
      }
    }
  },
};
