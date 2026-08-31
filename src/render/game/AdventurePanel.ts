/** 职责：准备阶段「奇遇 · 择一」非阻塞面板——offer 轮询刷新、卡片构建、命中区拦截与选择提交（resolveAdventure 防御性调用）。 */
import Phaser from 'phaser';
import type { AdventureOffer } from '../../game/adventure';
import { cornerTicks, FONT, TRACK } from '../../ui/kit';
import { audio } from '../../audio/AudioEngine';
import { INK, GILT, MOON, SPIRIT, VOID, PAPER, css } from '../palette';
import { W } from '../layout';
import type { GameScene } from '../scenes/GameScene';

/**
 * 奇遇面板（原 GameScene.refreshAdventure/hideAdventure/buildAdventure/onAdventurePick 原样搬移）。
 * 场景在 refreshAll 尾部委托 refresh()；指针路径经 contains(x,y) 转发命中拦截；
 * startBattlePhase 里先清 match.adventureOffer 再委托 hide()。
 */
export class AdventurePanel {
  private panel: Phaser.GameObjects.Container | null = null;
  /** 面板命中区（世界坐标）：拦截落在其上的棋盘拖拽/悬停 */
  private rect: Phaser.Geom.Rectangle | null = null;
  private sig = '';
  /** 本回合人类已择过（即使内核尚未清空 offer 也不再重开面板） */
  private resolvedRound = -1;

  constructor(private scene: GameScene) {}

  /** 面板命中区判定（原 this.adventureRect?.contains 的模块化转发；无面板时恒 false） */
  contains(x: number, y: number): boolean {
    return this.rect?.contains(x, y) ?? false;
  }

  /**
   * 奇遇「择一」面板：只在准备阶段且 match.adventureOffer 非 null 时出现。
   *
   * 非阻塞是硬约束 —— 不暂停倒计时、不拦空格开战，玩家不选就过期（无惩罚）。
   * 展示只含机制标签「奇遇 · 择一」与选项文案本身，不写引导性长文。
   * 签名守卫保证 offer 未变时不重建；refreshAll 只在动作/阶段切换时触发，
   * 不在每帧路径上，这里再多一层比对属双保险。
   */
  refresh(): void {
    let sig = 'off';
    let offer: AdventureOffer | null = null;
    try {
      offer = this.scene.match.adventureOffer ?? null;
      if (
        this.scene.phase === 'prep' &&
        offer &&
        Array.isArray(offer.options) &&
        this.resolvedRound !== this.scene.match.round
      ) {
        sig = `${this.scene.match.round}:${offer.options.map((o) => `${o?.kind}|${o?.title}|${o?.desc}`).join('#')}`;
      } else {
        offer = null;
      }
    } catch {
      offer = null;
      sig = 'off';
    }
    if (sig === this.sig) return;
    this.sig = sig;
    this.hide();
    if (offer) this.build(offer);
  }

  hide(): void {
    if (this.panel) {
      this.scene.tweens.killTweensOf(this.panel);
      this.panel.destroy();
      this.panel = null;
    }
    this.rect = null;
  }

  /**
   * 面板位置：中上、横跨棋盘上沿的窄条（board 之上、两侧面板之间的空档）。
   * 羁绊/诸侯/商店/器匣/记事/战报全部避让；只遮己方棋盘最上沿一两行，
   * 且命中区在 pointerdown/updateHover 里拦截，面板后方的棋子不会被误拖。
   */
  private build(offer: AdventureOffer): void {
    const cards = offer.options.filter(Boolean).slice(0, 3);
    if (cards.length === 0) return;
    const cardW = 232;
    const cardH = 116;
    const gap = 12;
    const padX = 16;
    const headerH = 36;
    const w = cards.length * cardW + (cards.length - 1) * gap + padX * 2;
    const h = headerH + cardH + 12;
    const x = Math.round((W - w) / 2);
    const y = 86;

    const c = this.scene.add.container(x, y).setDepth(480);
    const g = this.scene.add.graphics();
    g.fillStyle(INK[800], 0.97);
    g.fillRect(0, 0, w, h);
    g.lineStyle(1, INK[500], 1);
    g.strokeRect(0, 0, w, h);
    g.lineStyle(1, GILT.base, 0.12);
    g.strokeRect(1.5, 1.5, w - 3, h - 3);
    g.fillStyle(GILT.deep, 0.5);
    g.fillRect(0, 0, w, 2);
    cornerTicks(g, -3, -3, w + 6, h + 6, GILT.deep, 0.4);
    c.add(g);
    c.add(
      this.scene.add.text(padX, 10, '奇 遇 · 择 一', {
        fontFamily: FONT.title,
        fontSize: '16px',
        color: css(PAPER[100]),
        letterSpacing: TRACK.title,
      }).setAlpha(0.92)
    );

    // 恩赐类徽标：汉字界格印（装/金/经/援），色取自调色板既有语义色
    const badgeOf: Record<string, string> = { item: '装', gold: '金', xp: '经', reinforce: '援' };
    const colorOf: Record<string, number> = {
      item: GILT.base,
      gold: MOON.base,
      xp: SPIRIT.base,
      reinforce: VOID.base,
    };

    cards.forEach((opt, i) => {
      const cx = padX + i * (cardW + gap);
      const cy = headerH - 6;
      const card = this.scene.add.container(cx, cy);
      const bg = this.scene.add.graphics();
      const drawBg = (hover: boolean) => {
        bg.clear();
        bg.fillStyle(INK[700], 0.92);
        bg.fillRect(0, 0, cardW, cardH);
        bg.lineStyle(hover ? 1.5 : 1, hover ? GILT.light : INK[500], hover ? 1 : 0.9);
        bg.strokeRect(0, 0, cardW, cardH);
        if (hover) {
          bg.fillStyle(PAPER[100], 0.05);
          bg.fillRect(0, 0, cardW, cardH);
        }
        const col = colorOf[opt.kind] ?? GILT.deep;
        bg.fillStyle(col, 0.16);
        bg.fillRect(10, 10, 26, 26);
        bg.lineStyle(1.4, col, 0.9);
        bg.strokeRect(10, 10, 26, 26);
      };
      drawBg(false);
      card.add(bg);
      card.add(
        this.scene.add
          .text(23, 23, badgeOf[opt.kind] ?? '奇', {
            fontFamily: FONT.title,
            fontSize: '16px',
            color: css(PAPER[50]),
          })
          .setOrigin(0.5)
      );
      const title = this.scene.add.text(46, 12, opt.title, {
        fontFamily: FONT.title,
        fontSize: '15px',
        color: css(PAPER[100]),
        wordWrap: { width: cardW - 58 },
      });
      // 标题钳在两行内，描述固定从 y=52 起 —— 长标题不再压进描述带
      while (title.height > 36 && title.text.length > 4) {
        title.setText(title.text.slice(0, -2).trimEnd() + '…');
      }
      card.add(title);
      card.add(
        this.scene.add.text(12, 52, opt.desc, {
          fontFamily: FONT.body,
          fontSize: '13px',
          color: css(PAPER[300]),
          wordWrap: { width: cardW - 24 },
          lineSpacing: 3,
        })
      );
      card.setSize(cardW, cardH);
      card.setInteractive(new Phaser.Geom.Rectangle(0, 0, cardW, cardH), Phaser.Geom.Rectangle.Contains);
      card.on('pointerover', () => {
        drawBg(true);
        this.scene.input.setDefaultCursor('pointer');
      });
      card.on('pointerout', () => {
        drawBg(false);
        this.scene.input.setDefaultCursor('default');
      });
      card.on('pointerup', () => this.pick(i, opt.title));
      c.add(card);
    });

    this.panel = c;
    this.rect = new Phaser.Geom.Rectangle(x, y, w, h);
    c.setAlpha(0).setY(y - 14);
    this.scene.tweens.add({ targets: c, alpha: 1, y, duration: 260, ease: 'Quad.easeOut' });
    audio.play('uiBig');
  }

  /** 点选恩赐：resolveAdventure 是并行线契约，桩会 throw —— 必须防御性调用 */
  private pick(index: number, title: string): void {
    if (this.scene.phase !== 'prep' || this.scene.busy) return;
    try {
      this.scene.match.resolveAdventure(index);
    } catch {
      return; // 内核未落地/本回合已择：选择无效，面板保留
    }
    this.resolvedRound = this.scene.match.round;
    audio.play('uiBig');
    this.scene.showToast(`已择 · ${title}`);
    this.hide();
    this.scene.refreshAll();
    this.scene.queueSave();
  }
}
