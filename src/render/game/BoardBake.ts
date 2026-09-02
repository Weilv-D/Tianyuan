/** 职责：准备阶段的大漆盘与备战席底座——与战斗共用同一烘焙盘，运行期只换贴图不重画。 */
import Phaser from 'phaser';
import { FONT } from '../../ui/kit';
import { UnitPortrait } from '../../ui/cards';
import { bakedImage, bakedTexture } from '../view/bake';
import { bakeLacquerBoard, bakeLacquerGrid } from '../board/BoardView';
import { INK, PAPER, css } from '../view/palette';
import {
  BENCH_CELL,
  BENCH_N,
  BENCH_W,
  BENCH_X,
  BENCH_Y,
  BOARD_X,
  BOARD_Y,
  CELL,
  GRID_X,
  GRID_Y,
  HALF_ROWS,
} from '../view/layout';
import type { GameScene } from '../scenes/GameScene';

/**
 * 准备场景的盘面层：与战斗 BoardView 共用 `lacquerBoard_v3`/`lacquerGrid_v3`
 * 两张烘焙纹理，另加敌营纱幕（上半 4 行仅染色不可放置）与 32 个己方格头像。
 */
export class BoardBake {
  /** 己方半场格与备战席槽位：底座是烘焙纹理，用 Image 复用同一张图 */
  readonly boardCells: Phaser.GameObjects.Image[] = [];
  readonly boardPortraits: UnitPortrait[] = [];
  readonly benchSlots: Phaser.GameObjects.Image[] = [];
  readonly benchPortraits: UnitPortrait[] = [];
  /** 拖拽落点高亮。唯一保留为实时 Graphics 的格子层元素。 */
  boardHover!: Phaser.GameObjects.Graphics;

  constructor(private scene: GameScene) {}

  // ══════════════ 大漆盘（全 8 行可见） ══════════════

  buildBoard(): void {
    bakeLacquerBoard(this.scene);
    bakeLacquerGrid(this.scene);

    // 盘体与格线：与战斗同一张图 —— 两处永不走样
    this.scene.add.image(BOARD_X, BOARD_Y, 'lacquerBoard_v3').setOrigin(0);
    const gridImg = this.scene.add.image(GRID_X, GRID_Y, 'lacquerGrid_v3').setOrigin(0);
    // 入场：格线次第浮现（与 BoardView 同款 stagger 淡入）。
    // 补间句柄随场景 SHUTDOWN 取消（同 BoardView 纪律）：场景复用重入 create() 时，
    // 若旧淡入仍以已销毁 gridImg 为目标会触发对尸体的二次补间
    gridImg.setAlpha(0);
    const gridTween = this.scene.tweens.add({ targets: gridImg, alpha: 1, delay: 120, duration: 460, ease: 'Quad.easeOut' });
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (gridTween.isPlaying()) gridTween.remove();
    });

    // 敌营纱幕：上半 4 行压暗 —— "敌营"与"我方阵地"的层级一眼可读，
    // 放置规则（canPlace）照旧在数据层兜底，纱幕只是那层视觉的"位"通道
    bakedImage(this.scene, GRID_X, GRID_Y, 'enemyVeil_v3', CELL * 8, CELL * HALF_ROWS, (g) => {
      g.fillStyle(INK[950], 0.34);
      g.fillRect(0, 0, CELL * 8, CELL * HALF_ROWS);
    });

    for (let r = 0; r < HALF_ROWS; r++) {
      for (let c = 0; c < 8; c++) {
        const x = GRID_X + c * CELL;
        const y = GRID_Y + (r + HALF_ROWS) * CELL; // 数据行 r 挂在下 4 行
        this.boardCells.push(this.scene.add.image(x, y, '__cell').setOrigin(0));
        this.boardPortraits.push(new UnitPortrait(this.scene, x + 3, y + 3, CELL - 6));
      }
    }
    this.boardHover = this.scene.add.graphics().setDepth(296);
  }

  /**
   * 己方格底座：烤一张纹理，32 个格子是 32 个 Image。
   * 真正会变的拖拽高亮交给单独一层 `boardHover`。
   */
  drawBoardCells(): void {
    const size = CELL;
    bakedTexture(this.scene, 'prepCell_v3', size, size, (g) => {
      g.fillStyle(INK[700], 0.7);
      g.fillRect(2, 2, size - 4, size - 4);
      g.lineStyle(1, INK[500], 0.6);
      g.strokeRect(2, 2, size - 4, size - 4);
      // 四角刻痕
      g.lineStyle(1.2, INK[500], 0.45);
      const k = 7;
      g.lineBetween(6, 6, 6 + k, 6);
      g.lineBetween(6, 6, 6, 6 + k);
      g.lineBetween(size - 6, size - 6, size - 6 - k, size - 6);
      g.lineBetween(size - 6, size - 6, size - 6, size - 6 - k);
    });
    for (let i = 0; i < this.boardCells.length; i++) {
      const cell = this.boardCells[i];
      if (!cell || !cell.setTexture) continue;
      cell.setTexture('prepCell_v3');
      const c = i % 8;
      const r = Math.floor(i / 8);
      cell.setPosition(GRID_X + c * CELL, GRID_Y + (r + HALF_ROWS) * CELL);
    }
    this.boardHover.clear();
  }

  // ══════════════ 备战席 ══════════════

  buildBench(): void {
    // 发丝细条框架 + 签条（静态，烘焙）
    const box = BENCH_X - 8;
    const boy = BENCH_Y - 24;
    bakedImage(this.scene, box, boy, 'benchFrame_v3', BENCH_W + 16, BENCH_CELL + 32, (g) => {
      g.translateCanvas(-box, -boy);
      g.fillStyle(INK[900], 0.72);
      g.fillRect(BENCH_X - 6, BENCH_Y - 6, BENCH_W + 12, BENCH_CELL + 12);
      g.lineStyle(1, INK[500], 0.7);
      g.strokeRect(BENCH_X - 6, BENCH_Y - 6, BENCH_W + 12, BENCH_CELL + 12);
      // 签条：压在框线上沿
      g.fillStyle(INK[900], 0.95);
      g.fillRect(BENCH_X - 6, BENCH_Y - 22, 78, 18);
      g.lineStyle(1, INK[500], 0.6);
      g.strokeRect(BENCH_X - 6, BENCH_Y - 22, 78, 18);
    });
    this.scene.add
      .text(BENCH_X + 33, BENCH_Y - 13, '备 战 席', {
        fontFamily: FONT.title,
        fontSize: '12px',
        color: css(PAPER[300]),
        letterSpacing: 2,
      })
      .setOrigin(0.5);

    for (let i = 0; i < BENCH_N; i++) {
      const g = this.scene.add.image(BENCH_X + i * BENCH_CELL, BENCH_Y, '__slot').setOrigin(0);
      this.benchSlots.push(g);
      this.benchPortraits.push(new UnitPortrait(this.scene, BENCH_X + i * BENCH_CELL + 3, BENCH_Y + 3, BENCH_CELL - 6));
    }
  }

  /** 备战席槽位：烤一次就再也不变 */
  drawBenchSlots(): void {
    bakedTexture(this.scene, 'benchSlot_v3', BENCH_CELL, BENCH_CELL, (g) => {
      g.fillStyle(INK[800], 0.66);
      g.fillRect(2, 2, BENCH_CELL - 4, BENCH_CELL - 4);
      g.lineStyle(1, INK[500], 0.55);
      g.strokeRect(2, 2, BENCH_CELL - 4, BENCH_CELL - 4);
    });
    for (let i = 0; i < BENCH_N; i++) {
      const slot = this.benchSlots[i];
      if (!slot || !slot.setTexture) continue;
      slot.setTexture('benchSlot_v3');
      slot.setPosition(BENCH_X + i * BENCH_CELL, BENCH_Y);
    }
  }
}
