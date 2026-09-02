/** 职责：回合结算覆盖层——胜负/生命条/战绩的展示与「继续」按钮、6 秒自动推进，纯展示不改对局数据。 */
import Phaser from 'phaser';
import { PLAYER_START_HP } from '../../core/config';
import { FONT, Button } from '../../ui/kit';
import { audio } from '../../audio/AudioEngine';
import { INK, GILT, CINNABAR, SPIRIT, PAPER, SHADE, css } from '../view/palette';
import { W, H } from '../view/layout';
import type { PlayerState } from '../../game/state';

/**
 * 回合结算面板（原 GameScene.showRoundResult 原样搬移）。
 * show() 收当回合的人类玩家状态与「继续后做什么」回调，场景在战斗结算后委托调用。
 */
export class RoundResultOverlay {
  constructor(private scene: Phaser.Scene) {}

  show(p: PlayerState, next: () => void): void {
    const won = p.lastOutcome === 'win';
    const isDraw = p.lastOutcome === 'draw';
    const isBye = p.lastOutcome === 'bye';
    const panel = this.scene.add.container(W / 2, H / 2).setDepth(600);
    const shade = this.scene.add.graphics();
    shade.fillStyle(SHADE, 0.55);
    shade.fillRect(-W / 2, -H / 2, W, H);
    shade.setInteractive(new Phaser.Geom.Rectangle(-W / 2, -H / 2, W, H), Phaser.Geom.Rectangle.Contains);
    panel.add(shade);

    // 面板锚到中心，方便做「从 0.94 弹到 1」的入场
    const bw = 460;
    const bh = 288;
    const g = this.scene.add.graphics();
    g.fillStyle(INK[800], 0.97);
    g.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 12);
    g.lineStyle(2, won ? GILT.base : isBye || isDraw ? INK[500] : CINNABAR.base, 0.9);
    g.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, 12);
    panel.add(g);

    const accent: { base: number; light: number } = won ? GILT : isBye || isDraw ? { base: INK[500], light: PAPER[300] } : CINNABAR;
    // 顶部一道结果色带：胜负在 200ms 内就已经传达，不必读字
    const band = this.scene.add.graphics();
    band.fillStyle(accent.base, 0.85);
    band.fillRect(-bw / 2, -bh / 2, bw, 4);
    panel.add(band);

    const glyph = this.scene.add
      .text(0, -bh / 2 + 30, won ? '胜' : isDraw ? '和' : isBye ? '休' : '败', {
        fontFamily: FONT.title,
        fontSize: '52px',
        color: css(accent.light),
      })
      .setOrigin(0.5, 0)
      .setShadow(0, 0, css(accent.base), 22, false, true);
    panel.add(glyph);

    // 生命条：把"还剩多少"变成一个看得见的量，而不是一个数字
    const barW = bw - 96;
    const barX = -barW / 2;
    const barY = -bh / 2 + 106;
    const hpG = this.scene.add.graphics();
    const hpRatio = Phaser.Math.Clamp(p.hp / PLAYER_START_HP, 0, 1);
    const drawHp = (v: number) => {
      hpG.clear();
      hpG.fillStyle(INK[900], 1);
      hpG.fillRoundedRect(barX, barY, barW, 10, 5);
      if (v > 0.005) {
        hpG.fillStyle(v > 0.5 ? SPIRIT.base : v > 0.22 ? GILT.base : CINNABAR.base, 1);
        hpG.fillRoundedRect(barX, barY, Math.max(2, barW * v), 10, 5);
      }
      hpG.lineStyle(1, INK[500], 1);
      hpG.strokeRoundedRect(barX, barY, barW, 10, 5);
    };
    drawHp(0);
    panel.add(hpG);
    this.scene.tweens.addCounter({
      from: 0,
      to: hpRatio * 100,
      duration: 520,
      delay: 220,
      ease: 'Cubic.easeOut',
      onUpdate: (tw) => drawHp((tw.getValue() ?? 0) / 100),
    });

    panel.add(
      this.scene.add
        .text(barX, barY - 22, p.lastDamage > 0 ? `损失 ${p.lastDamage} 点生命` : `本轮无伤`, {
          fontFamily: FONT.body,
          fontSize: '15px',
          color: css(PAPER[200]),
        })
        .setOrigin(0, 0)
    );
    panel.add(
      this.scene.add
        .text(barX + barW, barY - 22, `剩余 ${p.hp}`, {
          fontFamily: FONT.title,
          fontSize: '17px',
          color: css(PAPER[100]),
        })
        .setOrigin(1, 0)
    );

    const streakPart = p.streak === 0 ? '' : `连${p.streak > 0 ? '胜' : '败'} ${Math.abs(p.streak)}　`;
    panel.add(
      this.scene.add
        .text(0, barY + 26, `${streakPart}战绩 ${p.wins}胜 ${p.losses}负`, {
          fontFamily: FONT.body,
          fontSize: '13px',
          color: css(PAPER[400]),
        })
        .setOrigin(0.5, 0)
    );

    const btn = new Button(this.scene, -90, bh / 2 - 62, '继续', () => {
      panel.destroy();
      next();
    }, { width: 180, height: 44, variant: 'primary' });
    panel.add(btn);

    // 入场：遮罩淡入 + 面板弹入 + 结果字顿一下
    shade.setAlpha(0);
    this.scene.tweens.add({ targets: shade, alpha: 1, duration: 200 });
    panel.setScale(0.9);
    this.scene.tweens.add({ targets: panel, scale: 1, duration: 280, ease: 'Back.easeOut' });
    glyph.setScale(1.9).setAlpha(0);
    this.scene.tweens.add({ targets: glyph, scale: 1, alpha: 1, duration: 320, delay: 90, ease: 'Back.easeOut' });
    // 回合胜负是常态，不值得 full fanfare —— 高光留给连胜/三星/终局
    if (won) audio.play('uiBig');
    else if (p.lastOutcome === 'loss') audio.play('warn');

    // 6 秒后自动继续，不打断心流
    this.scene.time.delayedCall(6000, () => {
      if (panel.active) {
        panel.destroy();
        next();
      }
    });
  }
}
