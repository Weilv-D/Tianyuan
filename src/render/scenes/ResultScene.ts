import Phaser from 'phaser';
import type { Match } from '../../game/match';
import { clearSave } from '../../game/save';
import { loadDailyBest, recordDailyResult } from '../../game/daily';
import { audio } from '../../audio/AudioEngine';
import { Button, FONT } from '../../ui/kit';
import { GILT, INK, PAPER, SHADE, SPIRIT, TRAIT_TIER_COLOR_HEX, css } from '../palette';
import { buildTextures, grainOverlay, TEX } from '../textures';
import { H, W } from '../layout';

/**
 * 终局结算场景。
 *
 * 此前是 GameScene 内的覆盖层 —— 独立成场景后，对局场景可以彻底关闭，
 * "再来一局 / 回主菜单"也不再背负旧场景的残留状态。
 */
export class ResultScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Result' });
  }

  create(data: { match?: Match }): void {
    buildTextures(this);
    grainOverlay(this);
    const match = data.match;
    if (!match) {
      this.scene.start('Menu', {});
      return;
    }
    clearSave();
    audio.stopBgm();

    const order = match.standings();
    const human = match.human;
    const humanPlace = order.findIndex((x) => x.idx === 0) + 1;
    const champion = humanPlace === 1;

    // 每日挑战成绩（M4）：仅 daily 模式记账，normal 模式零变化。
    // daily.ts 由并行线实现 —— 桩会 throw，一切调用 try/catch，失败即整行隐藏。
    let dailyLine = '';
    if (match.mode === 'daily') {
      try {
        const isNew = recordDailyResult(new Date(), humanPlace);
        let bestRank = humanPlace;
        try {
          const best = loadDailyBest();
          if (best && Number.isFinite(best.rank) && best.rank >= 1) bestRank = best.rank;
        } catch {
          /* 沿用本次名次 */
        }
        dailyLine = `今日最佳 · 第 ${bestRank} 名${isNew ? ' · 新纪录' : ''}`;
      } catch {
        /* 记账失败：不显示成绩行 */
      }
    }

    const bg = this.add.graphics();
    bg.fillStyle(SHADE, 0.94);
    bg.fillRect(0, 0, W, H);

    const panel = this.add.container(W / 2, H / 2).setDepth(800);
    const bw = 660;
    const bh = 680;
    const bx = -bw / 2;
    const by = -bh / 2;
    const g = this.add.graphics();
    g.fillStyle(INK[800], 0.98);
    g.fillRect(bx, by, bw, bh);
    g.lineStyle(2, GILT.base, 0.9);
    g.strokeRect(bx, by, bw, bh);
    panel.add(g);

    const title = this.add
      .text(0, by + 26, '终 局', { fontFamily: FONT.title, fontSize: '42px', color: css(GILT.light) })
      .setOrigin(0.5, 0);
    title.setShadow(0, 0, css(GILT.base), 24, false, true);
    panel.add(title);

    // 名次带：玩家自己排第几，是这一屏最该先看到的信息
    const placeColor = champion ? GILT.light : humanPlace <= 4 ? SPIRIT.light : PAPER[200];
    const placeTxt = this.add
      .text(0, by + 76, `你　第 ${humanPlace} 名`, {
        fontFamily: FONT.title, fontSize: '22px', color: css(placeColor),
      })
      .setOrigin(0.5, 0);
    panel.add(placeTxt);
    panel.add(
      this.add
        .text(0, by + 106, `${human.wins} 胜 ${human.losses} 负　最佳连胜 ${human.bestStreak}　累计输出 ${Math.round(human.totalDamage)}　终局 ${human.level} 级`, {
          fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[400]),
        })
        .setOrigin(0.5, 0)
    );
    panel.add(
      this.add.graphics()
        .lineStyle(1, INK[500], 0.9)
        .lineBetween(bx + 40, by + 132, bx + bw - 40, by + 132)
    );

    // 冠位光柱：只给第一名，让"赢"这件事有物理存在感
    const beam = this.add.graphics().setAlpha(0);
    beam.fillStyle(GILT.base, 0.14);
    beam.fillRect(bx + 40, by + 150, bw - 80, 40);
    beam.fillStyle(GILT.light, 0.5);
    beam.fillRect(bx + 40, by + 150, bw - 80, 2);
    beam.fillRect(bx + 40, by + 188, bw - 80, 2);
    panel.add(beam);

    // 由末位向冠位逐行揭示 —— 悬念留到最后一行
    const rowY0 = by + 152;
    const rowH = 46;
    order.forEach((p, i) => {
      const row = this.add.container(bx + 44, rowY0 + i * rowH);
      const medal = i === 0 ? GILT.light : i === 1 ? PAPER[200] : i === 2 ? TRAIT_TIER_COLOR_HEX[0] : PAPER[500];
      row.add(
        this.add
          .text(0, 0, `第 ${i + 1} 名`, { fontFamily: FONT.title, fontSize: '17px', color: css(medal) })
          .setOrigin(0, 0)
      );
      const isHuman = p.idx === 0;
      row.add(
        this.add
          .text(92, 1, p.name, {
            fontFamily: FONT.body, fontSize: '15px',
            color: css(isHuman ? GILT.light : PAPER[100]),
          })
          .setOrigin(0, 0)
      );
      row.add(
        this.add
          .text(300, 3, `${p.ai ? p.ai.label : '玩家'}`, {
            fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[500]),
          })
          .setOrigin(0, 0)
      );
      row.add(
        this.add
          .text(bw - 88, 3, p.alive ? `存活 ${p.hp}` : `${p.wins} 胜`, {
            fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[400]),
          })
          .setOrigin(1, 0)
      );
      if (isHuman) {
        // 玩家行：一道鎏金下划线，扫一眼就能找到自己
        row.add(
          this.add.graphics()
            .lineStyle(1.5, GILT.base, 0.8)
            .lineBetween(0, 26, bw - 88, 26)
        );
      }
      panel.add(row);

      row.setAlpha(0).setX(row.x - 26);
      this.tweens.add({
        targets: row, alpha: 1, x: row.x + 26,
        duration: 300, delay: 420 + (order.length - 1 - i) * 110, ease: 'Cubic.easeOut',
      });
    });

    // 每日成绩行：夹在名次带与按钮之间（名次带末行止于 by+500，按钮起于 by+595）
    if (dailyLine) {
      panel.add(
        this.add
          .text(0, by + 548, dailyLine, {
            fontFamily: FONT.body,
            fontSize: '15px',
            color: css(GILT.light),
            letterSpacing: 1,
          })
          .setOrigin(0.5, 0)
      );
    }

    panel.add(
      new Button(this, -220, by + bh - 62, '回 主 菜 单', () => {
        this.scene.start('Menu', {});
      }, { width: 200, height: 46 })
    );
    panel.add(
      new Button(this, 20, by + bh - 62, '再来一局', () => {
        this.scene.start('Game', { fresh: true });
      }, { width: 200, height: 46, variant: 'primary' })
    );

    // 入场 + 冠位揭晓
    panel.setScale(0.94).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 380, ease: 'Cubic.easeOut' });
    title.setScale(1.5).setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 420, delay: 120, ease: 'Back.easeOut' });
    placeTxt.setAlpha(0);
    this.tweens.add({ targets: placeTxt, alpha: 1, duration: 320, delay: 300 });

    if (champion) {
      audio.play('victory');
      this.tweens.add({ targets: beam, alpha: 1, duration: 420, delay: 1250 });
      // 冠位撒金：一次性粒子，不做常驻
      this.time.delayedCall(1250, () => {
        const em = this.add.particles(W / 2, H / 2 - 140, TEX.glow, {
          lifespan: 1400, speed: { min: 60, max: 260 }, angle: { min: 200, max: 340 },
          gravityY: 220, scale: { start: 0.16, end: 0 }, alpha: { start: 0.95, end: 0 },
          tint: [GILT.light, GILT.base, GILT.glow], quantity: 46, emitting: false,
          blendMode: Phaser.BlendModes.ADD,
        });
        em.setDepth(810);
        em.explode(46);
        this.time.delayedCall(1800, () => em.destroy());
      });
    } else {
      audio.play(humanPlace <= 4 ? 'uiBig' : 'defeat');
    }
  }
}
