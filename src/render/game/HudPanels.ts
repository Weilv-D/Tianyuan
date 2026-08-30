/** 职责：对局场景静态 HUD 的构建——背景、顶栏、商店、器匣、底部指挥台与羁绊/诸侯/记事/战报四块侧板，只建不改。 */
import Phaser from 'phaser';
import { REROLL_COST, XP_BUY_COST } from '../../core/config';
import { Bar, Button, FONT, makePanel, enableScroll } from '../../ui/kit';
import { ItemChip, ShopCard } from '../../ui/cards';
import { bakedImage } from '../bake';
import { TEX } from '../textures';
import { INK, GILT, CINNABAR, SPIRIT, PAPER, VOID, css } from '../palette';
import {
  BOTTOM,
  BOTTOM_H,
  BOTTOM_Y,
  ITEM_BAR_SLOTS,
  ITEM_BAR_W,
  ITEM_BAR_X,
  ITEM_BAR_Y,
  ITEM_SIZE,
  ITEM_GAP,
  LEFT_W,
  LEFT_X,
  LEFT_UP_H,
  LEFT_UP_Y,
  PANEL_TITLE_H,
  RIGHT_DOWN_X,
  RIGHT_X,
  SHOP_CH,
  SHOP_CW,
  SHOP_GAP,
  SHOP_W,
  SHOP_X,
  SHOP_Y,
  SIDE_DOWN_H,
  SIDE_DOWN_W,
  SIDE_DOWN_Y,
  W,
  H,
} from '../layout';
import type { GameScene } from '../scenes/GameScene';

/**
 * HUD 面板构建（原 GameScene.buildBackground/buildTopBar/buildShop/buildItemBar/
 * buildBottomBar/buildTraitPanel/buildScoreboard/buildLogPanel/buildReportPanel 原样搬移）。
 * 创建顺序由场景 create() 保持原样；产出的控件挂在本模块上，场景经 scene.hud.* 读取。
 */
export class HudPanels {
  // 顶栏
  roundText!: Phaser.GameObjects.Text;
  phaseText!: Phaser.GameObjects.Text;
  timerText!: Phaser.GameObjects.Text;
  timerBar!: Bar;

  // 底部
  goldText!: Phaser.GameObjects.Text;
  hpBar!: Bar;
  hpText!: Phaser.GameObjects.Text;
  levelText!: Phaser.GameObjects.Text;
  xpText!: Phaser.GameObjects.Text;
  xpBar!: Bar;
  boardCountText!: Phaser.GameObjects.Text;
  streakText!: Phaser.GameObjects.Text;
  rerollBtn!: Button;
  levelBtn!: Button;
  undoBtn!: Button;
  lockBtn!: Button;
  sellRect!: Phaser.Geom.Rectangle;

  // 商店 / 器匣
  shopCards: ShopCard[] = [];
  itemChips: ItemChip[] = [];
  itemHint!: Phaser.GameObjects.Text;

  // 侧面板
  traitContainer!: Phaser.GameObjects.Container;
  traitScroll: ReturnType<typeof enableScroll> | null = null;
  scoreContainer!: Phaser.GameObjects.Container;
  opponentText!: Phaser.GameObjects.Text;
  logText!: Phaser.GameObjects.Text;
  reportText!: Phaser.GameObjects.Text;

  constructor(private scene: GameScene) {}

  // ══════════════ 背景 ══════════════

  buildBackground(): void {
    const bg = this.scene.add.graphics();
    bg.fillStyle(INK[900], 1);
    bg.fillRect(0, 0, W, H);
    const grad = this.scene.add.image(W / 2, H / 2, TEX.glow).setTint(INK[700]).setAlpha(0.45);
    grad.setDisplaySize(W * 1.5, H * 1.5);
    const vign = this.scene.add.image(W / 2, H / 2, TEX.vignette).setDepth(200);
    vign.setDisplaySize(W, H);
  }

  // ══════════════ 顶栏 ══════════════

  buildTopBar(): void {
    makePanel(this.scene, 16, 8, W - 32, 50, { alpha: 0.9 });
    this.scene.add
      .text(34, 20, '百战天元', { fontFamily: FONT.title, fontSize: '26px', color: css(PAPER[100]) })
      .setOrigin(0, 0)
      .setShadow(0, 0, css(GILT.base), 12, false, true);

    this.roundText = this.scene.add
      .text(190, 22, '', { fontFamily: FONT.body, fontSize: '18px', color: css(PAPER[200]) })
      .setOrigin(0, 0);

    this.phaseText = this.scene.add
      .text(W / 2, 20, '', { fontFamily: FONT.title, fontSize: '22px', color: css(SPIRIT.light) })
      .setOrigin(0.5, 0);

    this.timerText = this.scene.add
      .text(W - 220, 20, '', { fontFamily: FONT.body, fontSize: '24px', color: css(GILT.base) })
      .setOrigin(1, 0);
    this.timerBar = new Bar(this.scene, W - 210, 30, 170, 12, GILT.base);

    // 设置入口
    new Button(this.scene, W - 60, 15, '⚙', () => this.scene.openSettings(), { width: 40, height: 32 });
  }

  // ══════════════ 商店 ══════════════

  buildShop(): void {
    makePanel(this.scene, SHOP_X - 16, SHOP_Y - 34, SHOP_W + 32, SHOP_CH + 44, { title: '商  肆' });
    this.scene.add
      .text(SHOP_X + SHOP_W - 16, SHOP_Y - 26, `刷新 ${REROLL_COST} 金 · 锁定后下回合保留`, {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(PAPER[400]),
      })
      .setOrigin(1, 0);

    for (let i = 0; i < 5; i++) {
      const card = new ShopCard(
        this.scene,
        SHOP_X + i * (SHOP_CW + SHOP_GAP),
        SHOP_Y,
        SHOP_CW,
        SHOP_CH,
        () => this.scene.onBuy(i)
      );
      this.shopCards.push(card);
    }
  }

  // ══════════════ 装备栏 ══════════════

  buildItemBar(): void {
    const iox = ITEM_BAR_X - 12;
    const ioy = ITEM_BAR_Y - 26;
    bakedImage(this.scene, iox, ioy, 'itemFrame', ITEM_BAR_W + 24, ITEM_SIZE + 38, (g) => {
      g.translateCanvas(-iox, -ioy);
      g.fillStyle(INK[850], 0.82);
      g.fillRoundedRect(ITEM_BAR_X - 10, ITEM_BAR_Y - 10, ITEM_BAR_W + 20, ITEM_SIZE + 20, 8);
      g.lineStyle(1.4, GILT.deep, 0.35);
      g.strokeRoundedRect(ITEM_BAR_X - 10, ITEM_BAR_Y - 10, ITEM_BAR_W + 20, ITEM_SIZE + 20, 8);
      // 界格签（与备战席签条同一语汇）：压在框线上沿，不与备战席格子内容相犯
      g.fillStyle(INK[850], 0.96);
      g.fillRect(ITEM_BAR_X - 10, ITEM_BAR_Y - 24, 72, 20);
      g.lineStyle(1, INK[500], 0.7);
      g.strokeRect(ITEM_BAR_X - 10, ITEM_BAR_Y - 24, 72, 20);
    });
    this.scene.add
      .text(ITEM_BAR_X + 26, ITEM_BAR_Y - 14, '器  匣', {
        fontFamily: FONT.title,
        fontSize: '12px',
        color: css(PAPER[300]),
        letterSpacing: 3,
      })
      .setOrigin(0.5);
    // 提示文字放框外右侧：此前在框上方，与备战席第 4~9 格的棋子名同带互压
    this.itemHint = this.scene.add
      .text(ITEM_BAR_X + ITEM_BAR_W + 36, ITEM_BAR_Y + ITEM_SIZE / 2, '', {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(PAPER[400]),
      })
      .setOrigin(0, 0.5);

    for (let i = 0; i < ITEM_BAR_SLOTS; i++) {
      const chip = new ItemChip(
        this.scene,
        ITEM_BAR_X + i * (ITEM_SIZE + ITEM_GAP),
        ITEM_BAR_Y,
        ITEM_SIZE,
        () => this.scene.onItemChipClick(i)
      );
      this.itemChips.push(chip);
    }
  }

  // ══════════════ 底部指挥台 ══════════════

  buildBottomBar(): void {
    makePanel(this.scene, LEFT_X, BOTTOM_Y, W - 32, BOTTOM_H, { alpha: 0.92 });
    const cy = BOTTOM.baseY;

    // ── 左：玩家状态。两列：状态列（血/收入/金币，宽 statusW）+ 等级列（levelX 起），
    // 列间 36px 空隙 —— 等级文字曾直接压在血条末端上，此空隙就是那条教训。 ──
    const stx = LEFT_X + BOTTOM.padX;
    this.scene.add
      .text(stx, cy, '状 态', { fontFamily: FONT.title, fontSize: '15px', color: css(PAPER[300]) })
      .setOrigin(0, 0);

    this.hpBar = new Bar(this.scene, stx, cy + 30, BOTTOM.statusW, 20, SPIRIT.base);
    this.hpText = this.scene.add
      .text(stx, cy + 58, '', { fontFamily: FONT.body, fontSize: '14px', color: css(PAPER[200]) })
      .setOrigin(0, 0);
    this.streakText = this.scene.add
      .text(stx, cy + 82, '', { fontFamily: FONT.body, fontSize: '13px', color: css(CINNABAR.light) })
      .setOrigin(0, 0);

    this.goldText = this.scene.add
      .text(stx, cy + 104, '', { fontFamily: FONT.title, fontSize: '30px', color: css(GILT.light) })
      .setOrigin(0, 0);
    this.scene.add
      .text(stx + 64, cy + 122, '金币', { fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[400]) })
      .setOrigin(0, 0);

    const lx = LEFT_X + BOTTOM.levelX;
    this.levelText = this.scene.add
      .text(lx, cy + 30, '', { fontFamily: FONT.title, fontSize: '22px', color: css(PAPER[100]) })
      .setOrigin(0, 0);
    this.xpBar = new Bar(this.scene, lx, cy + 66, 200, 14, VOID.base);
    this.xpText = this.scene.add
      .text(lx, cy + 84, '', { fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[400]) })
      .setOrigin(0, 0);
    this.boardCountText = this.scene.add
      .text(lx, cy + 106, '', { fontFamily: FONT.body, fontSize: '13px', color: css(PAPER[300]) })
      .setOrigin(0, 0);

    // ── 中：操作 ──
    const bx = LEFT_X + 560;
    this.scene.add
      .text(bx, cy, '操 作', { fontFamily: FONT.title, fontSize: '15px', color: css(PAPER[300]) })
      .setOrigin(0, 0);

    this.rerollBtn = new Button(this.scene, bx, cy + 26, `刷新 (${REROLL_COST})`, () => this.scene.onReroll(), {
      width: 168,
      height: 54,
      variant: 'ghost',
    });
    this.levelBtn = new Button(this.scene, bx + 180, cy + 26, `升级 (${XP_BUY_COST})`, () => this.scene.onBuyXp(), {
      width: 168,
      height: 54,
      variant: 'primary',
    });
    new Button(this.scene, bx, cy + 90, '一键布阵', () => this.scene.onAutoArrange(), { width: 168, height: 44 });
    this.undoBtn = new Button(this.scene, bx + 180, cy + 90, '撤销', () => this.scene.onUndo(), { width: 168, height: 44 });
    new Button(this.scene, bx + 360, cy + 26, '一键装备', () => this.scene.onAutoEquip(), { width: 150, height: 108, fontSize: 15 });

    // ── 右：卖出区 + 开战 ──
    const sx = W - 16 - 420;
    this.scene.add
      .text(sx, cy, '出 售', { fontFamily: FONT.title, fontSize: '15px', color: css(PAPER[300]) })
      .setOrigin(0, 0);
    // 出售区 + 朱文印章（静态，烘焙为一张）
    const zox = sx - 2;
    const zoy = cy + 24;
    bakedImage(this.scene, zox, zoy, 'sellZone', 172, 112, (g) => {
      g.translateCanvas(-zox, -zoy);
      g.fillStyle(INK[800], 0.85);
      g.fillRect(sx, cy + 26, 168, 108);
      g.lineStyle(1.5, CINNABAR.deep, 0.7);
      g.strokeRect(sx, cy + 26, 168, 108);
      // 印章：出售动作的仪式感来自"钤印"，与全局界格/直角语言同源
      g.fillStyle(CINNABAR.deep, 0.96);
      g.fillRect(sx + 56, cy + 52, 56, 56);
      g.lineStyle(2, CINNABAR.light, 0.85);
      g.strokeRect(sx + 59, cy + 55, 50, 50);
    });
    this.scene.add
      .text(sx + 84, cy + 81, '出售', {
        fontFamily: FONT.title,
        fontSize: '20px',
        color: css(PAPER[50]),
        letterSpacing: 6,
      })
      .setOrigin(0.5);
    this.sellRect = new Phaser.Geom.Rectangle(sx, cy + 26, 168, 108);

    this.lockBtn = new Button(this.scene, W - 16 - 236, cy + 26, '锁定商店', () => this.scene.onToggleLock(), {
      width: 210,
      height: 48,
    });
    new Button(this.scene, W - 16 - 236, cy + 84, '准备完毕 · 空格', () => this.scene.startBattlePhase(), {
      width: 210,
      height: 50,
      variant: 'primary',
    });
  }

  // ══════════════ 侧面板 ══════════════

  buildTraitPanel(): void {
    makePanel(this.scene, LEFT_X, LEFT_UP_Y, LEFT_W, LEFT_UP_H, { title: '阵 营 羁 绊', accent: SPIRIT.base });
    const bodyX = LEFT_X + 16;
    const bodyY = LEFT_UP_Y + PANEL_TITLE_H;
    this.traitContainer = this.scene.add.container(bodyX, bodyY);
    // 内容可超出面板（最多 17 条羁绊 × 自适应行高 > 350px 可视高）：遮罩 + 滚轮
    this.traitScroll = enableScroll(
      this.scene,
      this.traitContainer,
      bodyX,
      bodyY,
      LEFT_W - 32,
      LEFT_UP_H - PANEL_TITLE_H - 10,
    );
  }

  buildScoreboard(): void {
    makePanel(this.scene, RIGHT_X, LEFT_UP_Y, LEFT_W, LEFT_UP_H, { title: '八 方 诸 侯', accent: CINNABAR.base });
    this.scoreContainer = this.scene.add.container(RIGHT_X + 16, LEFT_UP_Y + PANEL_TITLE_H);
    // 提示与面板标题同行错位：标题「八 方 诸 侯」占 x+24~154，对手名右对齐占 x+384 起
    this.scene.add
      .text(RIGHT_X + 176, LEFT_UP_Y + 18, '点击各家名字可侦查阵容', {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(PAPER[500]),
      })
      .setOrigin(0, 0);
    this.opponentText = this.scene.add
      .text(RIGHT_X + LEFT_W - 16, LEFT_UP_Y + 16, '', {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(GILT.base),
      })
      .setOrigin(1, 0);
  }

  buildLogPanel(): void {
    makePanel(this.scene, LEFT_X, SIDE_DOWN_Y, SIDE_DOWN_W, SIDE_DOWN_H, { title: '对 局 记 事' });
    this.logText = this.scene.add
      .text(LEFT_X + 14, SIDE_DOWN_Y + 38, '', {
        fontFamily: FONT.body,
        fontSize: '13px',
        color: css(PAPER[300]),
        wordWrap: { width: SIDE_DOWN_W - 28 },
        lineSpacing: 4,
      })
      .setOrigin(0, 0);
  }

  buildReportPanel(): void {
    makePanel(this.scene, RIGHT_DOWN_X, SIDE_DOWN_Y, SIDE_DOWN_W, SIDE_DOWN_H, { title: '上 回 合 战 报' });
    this.reportText = this.scene.add
      .text(RIGHT_DOWN_X + 14, SIDE_DOWN_Y + 38, '', {
        fontFamily: FONT.body,
        fontSize: '13px',
        color: css(PAPER[300]),
        wordWrap: { width: SIDE_DOWN_W - 28 },
        lineSpacing: 5,
      })
      .setOrigin(0, 0);
  }
}
