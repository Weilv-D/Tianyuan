import Phaser from 'phaser';
import { BOARD_COLS, BOARD_ROWS } from '../core/config';
import { CINNABAR, GILT, INK, MOON, PAPER, PAPER_TINT, SPIRIT } from './palette';
import { TEX } from './textures';

export const CELL = 96;
export const BOARD_W = CELL * BOARD_COLS;
export const BOARD_H = CELL * BOARD_ROWS;

/** 外框比棋盘大出的边距 */
const FRAME_PAD = 16;
const TEX_BOARD_CELLS = 'boardCellsBaked';
const TEX_BOARD_FRAME = 'boardFrameBaked';

/**
 * 把格子层与外框烘成两张纹理。
 *
 * 幂等是硬要求：纹理挂在 TextureManager 上，生命周期长于 Scene，
 * 而 Phaser 会复用 Scene 实例 —— 不判重就会拿到 null 或泄漏一堆同名纹理。
 */
function bakeBoardTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_BOARD_CELLS) && scene.textures.exists(TEX_BOARD_FRAME)) return;

  const cellsG = scene.make.graphics({ x: 0, y: 0 }, false);
  paintCells(cellsG);
  cellsG.generateTexture(TEX_BOARD_CELLS, BOARD_W, BOARD_H);
  cellsG.destroy();

  const frameG = scene.make.graphics({ x: 0, y: 0 }, false);
  paintFrame(frameG, FRAME_PAD, FRAME_PAD);
  frameG.generateTexture(TEX_BOARD_FRAME, BOARD_W + FRAME_PAD * 2, BOARD_H + FRAME_PAD * 2);
  frameG.destroy();
}

/** 格层：阵营分区 + 逐格 + 楚河中线。静态，只画一次。 */
function paintCells(g: Phaser.GameObjects.Graphics): void {
  g.clear();

  // 阵营分区底：敌方半场偏冷朱、我方半场偏灵青（极低饱和，只做潜意识暗示）
  g.fillStyle(CINNABAR.deep, 0.07);
  g.fillRect(0, 0, BOARD_W, (BOARD_ROWS / 2) * CELL);
  g.fillStyle(SPIRIT.deep, 0.07);
  g.fillRect(0, (BOARD_ROWS / 2) * CELL, BOARD_W, (BOARD_ROWS / 2) * CELL);

  // 逐格
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const x = c * CELL;
      const y = r * CELL;
      const dark = (c + r) % 2 === 0;
      g.fillStyle(dark ? INK[700] : INK[650], 0.9);
      g.fillRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 6);
      g.lineStyle(1, INK[500], 0.55);
      g.strokeRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 6);
      // 格内四角刻痕，让格子有"刻上去"的质感
      g.lineStyle(1.4, INK[400], 0.5);
      const k = 9;
      g.lineBetween(x + 8, y + 8, x + 8 + k, y + 8);
      g.lineBetween(x + 8, y + 8, x + 8, y + 8 + k);
      g.lineBetween(x + CELL - 8, y + CELL - 8, x + CELL - 8 - k, y + CELL - 8);
      g.lineBetween(x + CELL - 8, y + CELL - 8, x + CELL - 8, y + CELL - 8 - k);
    }
  }

  // 楚河中线：鎏金双线 + 中央印记
  const mid = (BOARD_ROWS / 2) * CELL;
  g.fillStyle(INK[850], 0.85);
  g.fillRect(0, mid - 9, BOARD_W, 18);
  g.lineStyle(1.6, GILT.deep, 0.9);
  g.lineBetween(0, mid - 9, BOARD_W, mid - 9);
  g.lineBetween(0, mid + 9, BOARD_W, mid + 9);
  g.lineStyle(1, GILT.base, 0.5);
  g.lineBetween(0, mid, BOARD_W, mid);
}

/**
 * 外框：墨玉底板 + 鎏金双线 + 四角回纹。静态，只画一次。
 * @param ox/oy 烘焙偏移 —— 外框要画到 pad 之外的负坐标上，
 *   而 `generateTexture` 只从 (0,0) 截取，所以整体平移进正空间。
 */
function paintFrame(g: Phaser.GameObjects.Graphics, ox: number, oy: number): void {
  g.clear();
  const bx = ox - FRAME_PAD;
  const by = oy - FRAME_PAD;
  // 外框底板
  g.fillStyle(INK[850], 0.96);
  g.fillRoundedRect(bx, by, BOARD_W + FRAME_PAD * 2, BOARD_H + FRAME_PAD * 2, 14);
  g.lineStyle(2.5, GILT.deep, 0.95);
  g.strokeRoundedRect(bx, by, BOARD_W + FRAME_PAD * 2, BOARD_H + FRAME_PAD * 2, 14);
  g.lineStyle(1, GILT.base, 0.35);
  g.strokeRoundedRect(bx + 5, by + 5, BOARD_W + FRAME_PAD * 2 - 10, BOARD_H + FRAME_PAD * 2 - 10, 10);
  g.lineStyle(1.2, INK[500], 0.9);
  g.strokeRoundedRect(ox - 2, oy - 2, BOARD_W + 4, BOARD_H + 4, 8);

  // 四角云纹（简笔回纹，强化东方属性）
  const corner = (cx: number, cy: number, sx: number, sy: number) => {
    g.lineStyle(1.8, GILT.deep, 0.8);
    g.beginPath();
    g.moveTo(cx + 26 * sx, cy + 4 * sy);
    g.lineTo(cx + 4 * sx, cy + 4 * sy);
    g.lineTo(cx + 4 * sx, cy + 26 * sy);
    g.strokePath();
    g.lineStyle(1.2, GILT.base, 0.5);
    g.beginPath();
    g.moveTo(cx + 20 * sx, cy + 10 * sy);
    g.lineTo(cx + 10 * sx, cy + 10 * sy);
    g.lineTo(cx + 10 * sx, cy + 20 * sy);
    g.strokePath();
  };
  corner(bx + 6, by + 6, 1, 1);
  corner(bx + BOARD_W + FRAME_PAD * 2 - 6, by + 6, -1, 1);
  corner(bx + 6, by + BOARD_H + FRAME_PAD * 2 - 6, 1, -1);
  corner(bx + BOARD_W + FRAME_PAD * 2 - 6, by + BOARD_H + FRAME_PAD * 2 - 6, -1, -1);
}

/**
 * 棋盘 —— 一方有氛围的战场，而不是方格贴图。
 *
 * 构成（自下而上）：
 *   外框（墨玉 + 鎏金双线） → 宣纸底纹 → 阵营色分区 → 格线 → 楚河中线 → 环境灵尘
 *
 * **静态层一律烘焙成纹理。**
 * 这不是优化洁癖，是必须：格子层画了 96 个圆角矩形 + 384 段刻痕，
 * 合计约 9800 条 Graphics 指令，而 Phaser 的 WebGL Graphics 每帧都要
 * 重新三角化整个命令缓冲、不做缓存 —— 实测这一层独占 8.6ms，占满帧预算的
 * 一半以上，把 22 单位同屏的帧率压到 67 FPS 上限。烘焙后降到 0.3ms。
 * 只有会变的悬停/范围高亮（`overlay`）才保留为实时 Graphics。
 */
export class BoardView extends Phaser.GameObjects.Container {
  private readonly frame: Phaser.GameObjects.Image;
  private readonly cells: Phaser.GameObjects.Image;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly paper: Phaser.GameObjects.TileSprite;
  private readonly motes: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly embers: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);

    // 宣纸底纹（平铺，避免大图内存）
    this.paper = scene.add.tileSprite(0, 0, BOARD_W, BOARD_H, TEX.paper).setOrigin(0).setAlpha(0.5);
    this.paper.setTint(PAPER_TINT);

    bakeBoardTextures(scene);
    this.cells = scene.add.image(0, 0, TEX_BOARD_CELLS).setOrigin(0);
    // 外框自带 pad，所以定位要回退 -FRAME_PAD
    this.frame = scene.add.image(-FRAME_PAD, -FRAME_PAD, TEX_BOARD_FRAME).setOrigin(0);
    this.overlay = scene.add.graphics();

    // 层序：外框在最底（它是不透明底板），其上宣纸 → 格线 → 悬停高亮。
    // 原先把 frame 加在最后，等于用一块不透明面板把整张棋盘盖住了。
    this.add([this.frame, this.paper, this.cells, this.overlay]);

    // 环境粒子：缓慢上浮的灵尘（准备阶段）/ 余烬（战斗阶段）
    this.motes = scene.add.particles(0, 0, TEX.glow, {
      x: { min: 0, max: BOARD_W },
      y: BOARD_H + 10,
      lifespan: 9000,
      speedY: { min: -16, max: -6 },
      speedX: { min: -5, max: 5 },
      scale: { start: 0.06, end: 0.02 },
      alpha: { start: 0.35, end: 0 },
      tint: [MOON.base, SPIRIT.light, PAPER[200]],
      frequency: 260,
      quantity: 1,
      blendMode: Phaser.BlendModes.ADD,
    });

    this.embers = scene.add.particles(0, 0, TEX.inkDot, {
      x: { min: 0, max: BOARD_W },
      y: { min: 0, max: BOARD_H },
      lifespan: 2600,
      speedY: { min: -26, max: -10 },
      speedX: { min: -8, max: 8 },
      scale: { start: 0.09, end: 0 },
      alpha: { start: 0.5, end: 0 },
      tint: [CINNABAR.base, GILT.base, CINNABAR.light],
      frequency: 320,
      quantity: 1,
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    });
    this.embers.stop();

    this.add(this.motes);
    this.add(this.embers);

    scene.add.existing(this);
  }

  cellToXY(c: number, r: number): { x: number; y: number } {
    return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 + 14 };
  }

  xyToCell(x: number, y: number): { c: number; r: number } | null {
    const c = Math.floor(x / CELL);
    const r = Math.floor((y - 14) / CELL);
    if (c < 0 || c >= BOARD_COLS || r < 0 || r >= BOARD_ROWS) return null;
    return { c, r };
  }

  setHover(cell: { c: number; r: number } | null): void {
    const g = this.overlay;
    g.clear();
    if (!cell) return;
    const x = cell.c * CELL;
    const y = cell.r * CELL;
    g.lineStyle(2, GILT.light, 0.9);
    g.strokeRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 6);
    g.fillStyle(GILT.base, 0.1);
    g.fillRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 6);
  }

  /** 高亮若干格（用于技能范围预览 / 可放置提示） */
  markCells(cells: { c: number; r: number }[], color: number, alpha = 0.18): void {
    const g = this.overlay;
    for (const cell of cells) {
      const x = cell.c * CELL;
      const y = cell.r * CELL;
      g.fillStyle(color, alpha);
      g.fillRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 6);
      g.lineStyle(1.6, color, 0.7);
      g.strokeRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 6);
    }
  }

  clearMarks(): void {
    this.overlay.clear();
  }

  /** 阶段切换：准备 / 战斗 的光照与粒子氛围差异 */
  setPhase(phase: 'prep' | 'battle' | 'final'): void {
    if (phase === 'prep') {
      this.motes.start();
      this.embers.stop();
      this.paper.setAlpha(0.5);
      this.cells.setAlpha(1);
      return;
    }
    this.motes.start();
    this.embers.start();
    this.paper.setAlpha(0.34);
    if (phase === 'final') {
      // 决赛圈：余烬加密、色转朱砂亮
      this.embers.setParticleTint([CINNABAR.light, GILT.light, CINNABAR.base]);
      this.embers.setFrequency(140);
    } else {
      // 普通战斗必须把决赛圈的频率/配色复位，否则它会残留到之后每一场
      this.embers.setParticleTint([CINNABAR.base, GILT.base, CINNABAR.light]);
      this.embers.setFrequency(320);
    }
  }

}
