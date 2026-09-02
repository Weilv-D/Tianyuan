import Phaser from 'phaser';
import { BOARD_COLS, BOARD_ROWS } from '../../core/config';
import { BOARD_PAD, BOARD_SIZE, CELL, GRID_H, GRID_W } from '../view/layout';
import { CINNABAR, GILT, INK, MOON, PAPER, PAPER_TINT, SPIRIT } from '../view/palette';
import { TEX } from '../view/textures';

/**
 * 大漆盘：准备与战斗共用同一张 640 盘（样稿 min(62vh,46vw) 的落地值）。
 * 几何常量唯一真源在 view/layout —— 此处只消费；对外转出 CELL 供
 * 棋盘系（EffectsLayer/BattleScene）引用，盘面总尺寸取 layout 的 BOARD_SIZE。
 */
export { CELL };
export const BOARD_W = BOARD_SIZE; // 640 含漆盘边
export const BOARD_H = BOARD_W;

/**
 * 棋盘格内容的视觉下沉（板层局部 px）：单位立绘贴格时在格心之下再沉 8px，
 * 让 3★ 大体积棋子的"脚"落在格下沿而非悬在格心 —— 战斗板层的纯视觉偏移，
 * 与命中数学（hitTest / xyToCell 的格心换算）解耦：命中仍按格心判定，
 * 两套坐标在此文件名常量收敛，避免散落 ±8 魔法值。
 */
export const CELL_CONTENT_DY = 8;

const TEX_LACQUER = 'lacquerBoard_v3';
const TEX_GRID = 'lacquerGrid_v3';

/**
 * 大漆盘的静态烘焙：盘底 / 鎏金双线框与四角饰 / 阵营微染 / 星位天元 / 虚线中线。
 * 盘是"一张图"——准备与战斗共用同一纹理，两处永不走样。
 *
 * 幂等是硬要求：纹理挂在 TextureManager 上，生命周期长于 Scene，
 * 而 Phaser 会复用 Scene 实例 —— 不判重就会拿到 null 或泄漏同名纹理。
 */
export function bakeLacquerBoard(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_LACQUER)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  // 盘体：内凹漆盘的底
  g.fillStyle(INK[900], 0.95);
  g.fillRect(0, 0, BOARD_W, BOARD_H);

  // 鎏金框：外细内粗 + 16px 角饰（样稿同款）
  g.lineStyle(1, GILT.base, 0.5);
  g.strokeRect(4.5, 4.5, BOARD_W - 9, BOARD_H - 9);
  g.lineStyle(1, GILT.base, 0.16);
  g.strokeRect(10.5, 10.5, BOARD_W - 21, BOARD_H - 21);
  g.lineStyle(1.6, GILT.light, 0.8);
  const tick = 16;
  const m = 4;
  const corner = (x: number, y: number, dx: number, dy: number) => {
    g.beginPath();
    g.moveTo(x, y + tick * dy);
    g.lineTo(x, y);
    g.lineTo(x + tick * dx, y);
    g.strokePath();
  };
  corner(m, m, 1, 1);
  corner(BOARD_W - m, m, -1, 1);
  corner(m, BOARD_H - m, 1, -1);
  corner(BOARD_W - m, BOARD_H - m, -1, -1);

  // 阵营微染：上敌朱 / 下我玉（极低饱和，潜意识暗示）
  g.fillStyle(CINNABAR.deep, 0.045);
  g.fillRect(BOARD_PAD, BOARD_PAD, GRID_W, GRID_H / 2);
  g.fillStyle(SPIRIT.deep, 0.045);
  g.fillRect(BOARD_PAD, BOARD_PAD + GRID_H / 2, GRID_W, GRID_H / 2);

  // 虚线中线（样稿：1.5/8 点划）
  const mid = BOARD_PAD + GRID_H / 2;
  g.lineStyle(1, GILT.light, 0.22);
  g.beginPath();
  for (let x = BOARD_PAD; x < BOARD_PAD + GRID_W; x += 9.5) {
    g.moveTo(x, mid + 0.5);
    g.lineTo(x + 1.5, mid + 0.5);
  }
  g.strokePath();

  // 星位四点 + 天元（围棋语汇：交叉点上点墨）
  const star = (sx: number, sy: number, r: number, a: number) => {
    g.fillStyle(GILT.light, a);
    g.beginPath();
    g.arc(BOARD_PAD + sx * CELL, BOARD_PAD + sy * CELL, r, 0, 7);
    g.fill();
  };
  star(2, 2, 2, 0.35);
  star(6, 2, 2, 0.35);
  star(2, 6, 2, 0.35);
  star(6, 6, 2, 0.35);
  star(4, 4, 2.6, 0.6);
  g.lineStyle(1, GILT.light, 0.3);
  g.beginPath();
  g.arc(BOARD_PAD + 4 * CELL, BOARD_PAD + 4 * CELL, 6, 0, 7);
  g.strokePath();

  g.generateTexture(TEX_LACQUER, BOARD_W, BOARD_H);
  g.destroy();
}

/**
 * 格线层烘焙：逐格棋盘格 + 发丝格线 + 四角刻痕。
 * 独立于盘体：入场时"格线次第生成"的淡入与战斗/准备的纸纹浓度都要单独调它。
 */
export function bakeLacquerGrid(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_GRID)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const x = c * CELL;
      const y = r * CELL;
      const dark = (c + r) % 2 === 0;
      g.fillStyle(dark ? INK[700] : INK[800], 0.85);
      g.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      g.lineStyle(1, INK[500], 0.55);
      g.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4);
      // 四角刻痕
      g.lineStyle(1.2, INK[500], 0.4);
      const k = 7;
      g.lineBetween(x + 6, y + 6, x + 6 + k, y + 6);
      g.lineBetween(x + 6, y + 6, x + 6, y + 6 + k);
      g.lineBetween(x + CELL - 6, y + CELL - 6, x + CELL - 6 - k, y + CELL - 6);
      g.lineBetween(x + CELL - 6, y + CELL - 6, x + CELL - 6, y + CELL - 6 - k);
    }
  }
  g.generateTexture(TEX_GRID, GRID_W, GRID_H);
  g.destroy();
}

/**
 * 大漆盘 —— 一方有氛围的战场，而不是方格贴图。
 *
 * 构成（自下而上）：漆盘（盘体+框+星位+中线） → 盘心微光 → 宣纸底纹 → 格线 → 悬停高亮。
 *
 * **静态层一律烘焙成纹理。** Graphics 每帧重新三角化整个命令缓冲，
 * 数千条格线命令曾把 22 单位同屏的帧率压到 67 FPS 上限；烘焙后归零。
 * 只有会变的悬停/范围高亮（`overlay`）保留为实时 Graphics。
 */
export class BoardView extends Phaser.GameObjects.Container {
  private readonly boardImg: Phaser.GameObjects.Image;
  private readonly sheen: Phaser.GameObjects.Image;
  private readonly gridImg: Phaser.GameObjects.Image;
  private readonly paper: Phaser.GameObjects.TileSprite;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly motes: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly embers: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);

    bakeLacquerBoard(scene);
    bakeLacquerGrid(scene);
    this.boardImg = scene.add.image(0, 0, TEX_LACQUER).setOrigin(0);
    // 盘心微光：暗色 glow 给漆面一点"包浆"的呼吸
    this.sheen = scene.add
      .image(BOARD_PAD, BOARD_PAD, TEX.glow)
      .setOrigin(0.5)
      .setPosition(BOARD_W / 2, BOARD_H / 2)
      .setTint(INK[600])
      .setAlpha(0.35)
      .setDisplaySize(BOARD_W * 1.1, BOARD_H * 1.1);
    this.paper = scene.add.tileSprite(BOARD_PAD, BOARD_PAD, GRID_W, GRID_H, TEX.paper).setOrigin(0).setAlpha(0.22);
    this.paper.setTint(PAPER_TINT);
    this.gridImg = scene.add.image(BOARD_PAD, BOARD_PAD, TEX_GRID).setOrigin(0);
    this.overlay = scene.add.graphics();

    // 层序：漆盘 → 微光 → 纸纹 → 格线 → 环境粒子 → 悬停
    // （粒子先于 overlay 收进容器：悬停描边永不被灵尘/余烬盖住）
    this.add([this.boardImg, this.sheen, this.paper, this.gridImg]);

    // 环境粒子：缓慢上浮的灵尘（准备阶段）/ 余烬（战斗阶段）
    this.motes = scene.add.particles(0, 0, TEX.glow, {
      x: { min: BOARD_PAD, max: BOARD_PAD + GRID_W },
      y: BOARD_H,
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
      x: { min: BOARD_PAD, max: BOARD_PAD + GRID_W },
      y: { min: BOARD_PAD, max: BOARD_PAD + GRID_H },
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
    this.add(this.overlay);

    // 入场：漆盘先落，格线次第浮现（烘焙纹理之间的 stagger 淡入，零重绘成本）。
    // 补间句柄随场景 SHUTDOWN 取消：场景复用重入 create() 时，若旧淡入仍以
    // 已销毁 gridImg 为目标会触发二次淡入/对已销毁对象补间。
    this.gridImg.setAlpha(0);
    const gridTween = scene.tweens.add({ targets: this.gridImg, alpha: 1, delay: 140, duration: 460, ease: 'Quad.easeOut' });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (gridTween.isPlaying()) gridTween.remove();
    });

    scene.add.existing(this);
  }

  cellToXY(c: number, r: number): { x: number; y: number } {
    return { x: BOARD_PAD + c * CELL + CELL / 2, y: BOARD_PAD + r * CELL + CELL / 2 + CELL_CONTENT_DY };
  }

  xyToCell(x: number, y: number): { c: number; r: number } | null {
    const c = Math.floor((x - BOARD_PAD) / CELL);
    const r = Math.floor((y - CELL_CONTENT_DY - BOARD_PAD) / CELL);
    if (c < 0 || c >= BOARD_COLS || r < 0 || r >= BOARD_ROWS) return null;
    return { c, r };
  }

  setHover(cell: { c: number; r: number } | null): void {
    const g = this.overlay;
    g.clear();
    if (!cell) return;
    const x = BOARD_PAD + cell.c * CELL;
    const y = BOARD_PAD + cell.r * CELL;
    g.lineStyle(1.5, GILT.light, 0.9);
    g.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
    g.fillStyle(GILT.base, 0.08);
    g.fillRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
  }

  /** 高亮若干格（用于技能范围预览 / 可放置提示） */
  markCells(cells: { c: number; r: number }[], color: number, alpha = 0.18): void {
    const g = this.overlay;
    for (const cell of cells) {
      const x = BOARD_PAD + cell.c * CELL;
      const y = BOARD_PAD + cell.r * CELL;
      g.fillStyle(color, alpha);
      g.fillRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
      g.lineStyle(1.3, color, 0.7);
      g.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
    }
  }

  clearMarks(): void {
    this.overlay.clear();
  }

  /** 阶段切换：准备 / 战斗 的氛围差异 */
  setPhase(phase: 'prep' | 'battle' | 'final'): void {
    if (phase === 'prep') {
      this.motes.start();
      this.embers.stop();
      this.paper.setAlpha(0.22);
      return;
    }
    this.motes.start();
    this.embers.start();
    this.paper.setAlpha(0.14);
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
