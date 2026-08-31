/** 职责：玩家淘汰「道 消」终局覆盖层——名次/战绩展示与「快进到终局」「再来一局」两个出口。 */
import Phaser from 'phaser';
import { FONT, Button } from '../../ui/kit';
import { audio } from '../../audio/AudioEngine';
import { INK, GILT, CINNABAR, PAPER, SHADE, css } from '../view/palette';
import { W, H } from '../view/layout';
import type { PlayerState } from '../../game/state';

/**
 * 淘汰覆盖层（原 GameScene.showEliminated 原样搬移）。
 * show() 收人类玩家状态、当前回合数与两个出口回调（快进 / 重开），场景委托调用。
 */
export class EliminatedOverlay {
  constructor(private scene: Phaser.Scene) {}

  show(p: PlayerState, round: number, onFastForward: () => void, onRestart: () => void): void {
    const panel = this.scene.add.container(W / 2, H / 2).setDepth(700);
    const shade = this.scene.add.graphics();
    shade.fillStyle(SHADE, 0.78);
    shade.fillRect(-W / 2, -H / 2, W, H);
    shade.setInteractive(new Phaser.Geom.Rectangle(-W / 2, -H / 2, W, H), Phaser.Geom.Rectangle.Contains);
    panel.add(shade);

    // 墨迹扩散：一滴墨落进宣纸，由中心洇开 —— 淘汰的视觉隐喻
    const ink = this.scene.add.graphics().setAlpha(0);
    panel.add(ink);
    const drawInk = (v: number) => {
      ink.clear();
      const r = 40 + v * 620;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + v * 1.4;
        ink.fillStyle(CINNABAR.deep, 0.1 * (1 - v));
        ink.fillEllipse(Math.cos(a) * r * 0.16, Math.sin(a) * r * 0.09, r * 1.5, r * 0.86);
      }
      ink.fillStyle(INK[900], 0.55 * (1 - v * 0.35));
      ink.fillEllipse(0, 0, r * 1.9, r * 1.1);
    };
    drawInk(0);
    this.scene.tweens.addCounter({
      from: 0, to: 100, duration: 760, ease: 'Cubic.easeOut',
      onUpdate: (tw) => drawInk((tw.getValue() ?? 0) / 100),
    });
    ink.setAlpha(1);
    this.scene.tweens.add({ targets: ink, alpha: 0, duration: 620, delay: 520 });

    const bw = 560;
    const bh = 344;
    const g = this.scene.add.graphics();
    g.fillStyle(INK[800], 0.98);
    g.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 12);
    g.lineStyle(2, CINNABAR.base, 0.9);
    g.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, 12);
    panel.add(g);

    const title = this.scene.add
      .text(0, -bh / 2 + 38, '道 消', { fontFamily: FONT.title, fontSize: '56px', color: css(CINNABAR.light) })
      .setOrigin(0.5, 0)
      .setShadow(0, 0, css(CINNABAR.deep), 26, false, true);
    panel.add(title);

    const line1 = this.scene.add
      .text(0, -bh / 2 + 122, `你在第 ${round} 回合被淘汰`, {
        fontFamily: FONT.body, fontSize: '15px', color: css(PAPER[200]),
      })
      .setOrigin(0.5, 0);
    panel.add(line1);

    const rankTxt = this.scene.add
      .text(0, -bh / 2 + 156, `最终名次　第 ${p.rank} 名 / 8`, {
        fontFamily: FONT.title, fontSize: '26px', color: css(GILT.light),
      })
      .setOrigin(0.5, 0);
    panel.add(rankTxt);

    panel.add(
      this.scene.add
        .text(0, -bh / 2 + 200, `战绩 ${p.wins} 胜 ${p.losses} 负　最佳连胜 ${p.bestStreak}　胜局累计输出 ${Math.round(p.totalDamage)}`, {
          fontFamily: FONT.body, fontSize: '13px', color: css(PAPER[400]),
        })
        .setOrigin(0.5, 0)
    );

    panel.add(
      new Button(this.scene, -220, bh / 2 - 64, '快进到终局', () => {
        panel.destroy();
        onFastForward();
      }, { width: 200, height: 44 })
    );
    panel.add(
      new Button(this.scene, 20, bh / 2 - 64, '再来一局', () => {
        panel.destroy();
        onRestart();
      }, { width: 200, height: 44, variant: 'primary' })
    );

    // 入场：面板由下滑入，标题顿帧
    panel.setY(H / 2 + 40).setAlpha(0);
    this.scene.tweens.add({ targets: panel, y: H / 2, alpha: 1, duration: 420, ease: 'Cubic.easeOut' });
    title.setScale(1.6).setAlpha(0);
    this.scene.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 460, delay: 180, ease: 'Back.easeOut' });
    for (const [t, d] of [[line1, 420], [rankTxt, 520]] as [Phaser.GameObjects.Text, number][]) {
      t.setAlpha(0).setY(t.y + 12);
      this.scene.tweens.add({ targets: t, alpha: 1, y: t.y - 12, duration: 300, delay: d });
    }
    audio.play('defeat');
  }
}
