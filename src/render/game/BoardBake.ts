/** 职责：己方棋盘与备战席的底座构建——外框/格子/槽位一次烘焙成纹理，运行期只换贴图不重画。 */
import Phaser from 'phaser';
import { FONT } from '../../ui/kit';
import { UnitPortrait } from '../../ui/cards';
import { bakedImage, bakedTexture } from '../bake';
import { INK, GILT, PAPER, css } from '../palette';
import {
  BENCH_CELL,
  BENCH_N,
  BENCH_W,
  BENCH_X,
  BENCH_Y,
  BOARD_H,
  BOARD_W,
  BOARD_X,
  BOARD_Y,
  CELL,
  HALF_ROWS,
} from '../layout';
import type { GameScene } from '../scenes/GameScene';

/**
 * 棋盘/备战席烘焙层（原 GameScene.buildBoard/drawBoardCells/buildBench/drawBenchSlots 原样搬移）。
 * 产出的格子与头像数组挂在本模块上，场景经 scene.boardBake.* 读取。
 */
export class BoardBake {
  /** 棋盘格与备战席槽位：底座是烘焙纹理，用 Image 复用同一张图 */
  readonly boardCells: Phaser.GameObjects.Image[] = [];
  readonly boardPortraits: UnitPortrait[] = [];
  readonly benchSlots: Phaser.GameObjects.Image[] = [];
  readonly benchPortraits: UnitPortrait[] = [];
  /** 拖拽落点高亮。唯一保留为实时 Graphics 的格子层元素。 */
  boardHover!: Phaser.GameObjects.Graphics;

  constructor(private scene: GameScene) {}

  // ══════════════ 己方棋盘 ══════════════

  buildBoard(): void {
    // 外框（静态，烘焙；画布四边留 2px 给 2px 宽描边）
    const fox = BOARD_X - 12;
    const foy = BOARD_Y - 12;
    bakedImage(this.scene, fox, foy, 'boardFrame', BOARD_W + 24, BOARD_H + 24, (g) => {
      g.translateCanvas(-fox, -foy);
      g.fillStyle(INK[850], 0.92);
      g.fillRoundedRect(BOARD_X - 10, BOARD_Y - 10, BOARD_W + 20, BOARD_H + 20, 10);
      g.lineStyle(2, GILT.deep, 0.55);
      g.strokeRoundedRect(BOARD_X - 10, BOARD_Y - 10, BOARD_W + 20, BOARD_H + 20, 10);
      g.lineStyle(1, GILT.base, 0.16);
      g.strokeRoundedRect(BOARD_X - 6, BOARD_Y - 6, BOARD_W + 12, BOARD_H + 12, 8);
    });

    for (let r = 0; r < HALF_ROWS; r++) {
      for (let c = 0; c < 8; c++) {
        const g = this.scene.add.image(BOARD_X + c * CELL, BOARD_Y + r * CELL, '__cell').setOrigin(0);
        this.boardCells.push(g);
        const p = new UnitPortrait(this.scene, BOARD_X + c * CELL + 3, BOARD_Y + r * CELL + 3, CELL - 6);
        this.boardPortraits.push(p);
      }
    }
    this.boardHover = this.scene.add.graphics();
  }

  /**
   * 棋盘格底座。
   *
   * 32 个格子每个都是「2 个圆角矩形 + 2 段刻痕」≈ 137 条命令，合计 4384 条 ——
   * 这是准备阶段最大的单项开销，而它**画完之后一次都不会变**。
   * 所以底座烤成两张纹理（只有前排/后排两种底色），32 个格子变成 32 个 Image；
   * 真正会变的拖拽高亮交给单独一层 `boardHover`。
   */
  drawBoardCells(): void {
    const size = CELL;
    for (let r = 0; r < HALF_ROWS; r++) {
      // 前排在下方（r=0 是最靠近中线的一行），用底色深浅暗示纵深
      const depth = (HALF_ROWS - 1 - r) / (HALF_ROWS - 1);
      const near = depth > 0.6;
      const key = near ? 'cellNear' : 'cellFar';
      bakedTexture(this.scene, key, size, size, (g) => {
        g.fillStyle(near ? INK[800] : INK[700], 0.9);
        g.fillRoundedRect(2, 2, size - 4, size - 4, 6);
        g.lineStyle(1, INK[500], 0.7);
        g.strokeRoundedRect(2, 2, size - 4, size - 4, 6);
        // 四角刻痕
        g.lineStyle(1.5, GILT.deep, 0.25);
        const k = 8;
        g.lineBetween(2, 2 + k, 2, 2);
        g.lineBetween(2, 2, 2 + k, 2);
      });
      for (let c = 0; c < 8; c++) {
        const i = r * 8 + c;
        const cell = this.boardCells[i];
        if (!cell || !cell.setTexture) continue;
        cell.setTexture(key);
        cell.setPosition(BOARD_X + c * CELL, BOARD_Y + r * CELL);
      }
    }
    this.boardHover.clear();
  }

  // ══════════════ 备战席 ══════════════

  buildBench(): void {
    // 框架 + 签条（静态，烘焙；原点取签条左上再外扩 2px）
    const box = BENCH_X - 10;
    const boy = BENCH_Y - 26;
    bakedImage(this.scene, box, boy, 'benchFrame', BENCH_W + 20, BENCH_CELL + 36, (g) => {
      g.translateCanvas(-box, -boy);
      g.fillStyle(INK[850], 0.85);
      g.fillRoundedRect(BENCH_X - 8, BENCH_Y - 8, BENCH_W + 16, BENCH_CELL + 16, 8);
      g.lineStyle(1.4, INK[500], 0.8);
      g.strokeRoundedRect(BENCH_X - 8, BENCH_Y - 8, BENCH_W + 16, BENCH_CELL + 16, 8);
      // 签条：标明这一行是什么（棋盘与备战席之间只隔 4px，压框角做界格签）
      g.fillStyle(INK[850], 0.96);
      g.fillRect(BENCH_X - 8, BENCH_Y - 24, 84, 20);
      g.lineStyle(1, INK[500], 0.7);
      g.strokeRect(BENCH_X - 8, BENCH_Y - 24, 84, 20);
    });
    this.scene.add
      .text(BENCH_X + 34, BENCH_Y - 14, '备战席', {
        fontFamily: FONT.title,
        fontSize: '12px',
        color: css(PAPER[300]),
        letterSpacing: 3,
      })
      .setOrigin(0.5);

    for (let i = 0; i < BENCH_N; i++) {
      const g = this.scene.add.image(BENCH_X + i * BENCH_CELL, BENCH_Y, '__slot').setOrigin(0);
      this.benchSlots.push(g);
      const p = new UnitPortrait(this.scene, BENCH_X + i * BENCH_CELL + 3, BENCH_Y + 3, BENCH_CELL - 6);
      this.benchPortraits.push(p);
    }
  }

  /** 备战席槽位：同样是烤一次就再也不变的东西 */
  drawBenchSlots(): void {
    bakedTexture(this.scene, 'benchSlot', BENCH_CELL, BENCH_CELL, (g) => {
      g.fillStyle(INK[800], 0.85);
      g.fillRoundedRect(2, 2, BENCH_CELL - 4, BENCH_CELL - 4, 6);
      g.lineStyle(1, INK[500], 0.6);
      g.strokeRoundedRect(2, 2, BENCH_CELL - 4, BENCH_CELL - 4, 6);
    });
    for (let i = 0; i < BENCH_N; i++) {
      const slot = this.benchSlots[i];
      if (!slot || !slot.setTexture) continue;
      slot.setTexture('benchSlot');
      slot.setPosition(BENCH_X + i * BENCH_CELL, BENCH_Y);
    }
  }
}
