/** 职责：准备阶段的暂停遮罩（冻结倒计时、操作不受限）与对手侦查面板（只读快照）两块覆盖层。 */
import Phaser from 'phaser';
import { TRAIT_BY_ID } from '../../data/traits';
import { FONT, Button } from '../../ui/kit';
import { UnitPortrait } from '../../ui/cards';
import { audio } from '../../audio/AudioEngine';
import { INK, CINNABAR, GILT, PAPER, SHADE, css } from '../view/palette';
import { W, H } from '../view/layout';
import type { GameScene } from '../scenes/GameScene';

/**
 * 暂停/侦查覆盖层（原 GameScene.togglePause/setPaused/showOpponentBoard/closeScout 原样搬移）。
 * paused 标志仍归场景所有（update 主循环读它），本模块经 scene.paused 读写。
 */
export class PauseScoutOverlay {
  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  /** 侦查对手的覆盖层 */
  scoutPanel: Phaser.GameObjects.Container | null = null;

  constructor(private scene: GameScene) {}

  /** 准备阶段暂停：只冻结倒计时，操作不受限（单机对 AI，给玩家无限思考时间是纯收益） */
  togglePause(): void {
    this.setPaused(!this.scene.paused);
    audio.play('ui');
  }

  setPaused(v: boolean): void {
    this.scene.paused = v;
    if (this.pauseOverlay) {
      this.pauseOverlay.destroy();
      this.pauseOverlay = null;
    }
    if (!v) return;
    const c = this.scene.add.container(0, 0).setDepth(880);
    const shade = this.scene.add.graphics();
    shade.fillStyle(SHADE, 0.55);
    shade.fillRect(0, 0, W, H);
    c.add(shade);
    c.add(
      this.scene.add
        .text(W / 2, H / 2 - 30, '暂 停', { fontFamily: FONT.title, fontSize: '64px', color: css(PAPER[100]) })
        .setOrigin(0.5)
        .setShadow(0, 0, css(GILT.base), 26, false, true)
    );
    c.add(
      this.scene.add
        .text(W / 2, H / 2 + 40, '倒计时已冻结 · 仍可布置阵容 · 按 ESC 继续', {
          fontFamily: FONT.body,
          fontSize: '15px',
          color: css(PAPER[400]),
        })
        .setOrigin(0.5)
    );
    this.pauseOverlay = c;
  }

  /** 侦查对手：点击计分板行查看其当前棋盘与羁绊（只读快照，不影响任何判定） */
  showOpponentBoard(idx: number): void {
    this.closeScout();
    const p = this.scene.match.players[idx];
    if (!p) return;
    const panel = this.scene.add.container(0, 0).setDepth(860);
    const shade = this.scene.add.graphics();
    shade.fillStyle(SHADE, 0.66);
    shade.fillRect(0, 0, W, H);
    shade.setInteractive(new Phaser.Geom.Rectangle(0, 0, W, H), Phaser.Geom.Rectangle.Contains);
    shade.on('pointerdown', () => this.closeScout());
    panel.add(shade);

    const bw = 780;
    const bh = 600;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;
    const g = this.scene.add.graphics();
    g.fillStyle(INK[800], 0.98);
    g.fillRect(bx, by, bw, bh);
    g.lineStyle(2, CINNABAR.base, 0.85);
    g.strokeRect(bx, by, bw, bh);
    panel.add(g);
    panel.add(
      this.scene.add
        .text(bx + 28, by + 20, `${p.name} 的阵地`, { fontFamily: FONT.title, fontSize: '22px', color: css(PAPER[100]) })
        .setOrigin(0, 0)
    );
    panel.add(
      this.scene.add
        .text(bx + bw - 28, by + 30, `生命 ${p.hp}　等级 ${p.level}`, {
          fontFamily: FONT.body,
          fontSize: '13px',
          color: css(PAPER[400]),
        })
        .setOrigin(1, 0)
    );

    // 棋盘快照
    const cell = 80;
    const gridX = bx + (bw - cell * 8) / 2;
    const gridY = by + 66;
    for (let i = 0; i < p.board.length; i++) {
      const col = i % 8;
      const row = Math.floor(i / 8);
      if (row >= 4) break;
      const portrait = new UnitPortrait(this.scene, gridX + col * cell, gridY + row * cell, cell - 6);
      portrait.setUnit(p.board[i]);
      panel.add(portrait);
    }

    const ty = gridY + cell * 4 + 16;
    const active = this.scene.match.traitsOf(p.board).filter((t) => t.tier >= 0);
    panel.add(
      this.scene.add.text(bx + 28, ty, '羁 绊', { fontFamily: FONT.title, fontSize: '15px', color: css(PAPER[300]) }).setOrigin(0, 0)
    );
    panel.add(
      this.scene.add
        .text(
          bx + 90,
          ty + 2,
          active.length > 0
            ? active
                .sort((a, b) => b.tier - a.tier)
                .map((t) => `${TRAIT_BY_ID[t.id]?.name ?? t.id} ${t.count}`)
                .join(' · ')
            : '（未激活任何羁绊）',
          { fontFamily: FONT.body, fontSize: '13px', color: css(PAPER[200]), wordWrap: { width: bw - 130 } }
        )
        .setOrigin(0, 0)
    );

    panel.add(
      new Button(this.scene, bx + bw - 140, by + bh - 58, '关 闭', () => this.closeScout(), {
        width: 110,
        height: 42,
        variant: 'primary',
      })
    );
    this.scoutPanel = panel;
    audio.play('ui');
  }

  closeScout(): void {
    this.scoutPanel?.destroy();
    this.scoutPanel = null;
  }
}
