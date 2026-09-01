/** 职责：对局场景静态 HUD 的构建——顶栏导航/阶段条/商肆/器匣/操作列/朱印/羁绊轨/敌情/记事/战报，只建不改。 */
import Phaser from 'phaser';
import { REROLL_COST } from '../../core/config';
import { Bar, Button, FONT, enableScroll, makePanel } from '../../ui/kit';
import { ItemChip, ShopCard, TraitRow } from '../../ui/cards';
import { bakedImage } from '../view/bake';
import { INK, GILT, CINNABAR, SPIRIT, PAPER, VOID, TRAIT_TIER_COLOR_HEX, css } from '../view/palette';
import {
  ACT_BTN_H,
  ACT_BTN_W,
  ACT_X,
  ACT_Y,
  BENCH_W,
  BENCH_X,
  BENCH_Y,
  HEADER_H,
  ITEM_BAR_SLOTS,
  ITEM_BAR_W,
  ITEM_BAR_X,
  ITEM_BAR_Y,
  ITEM_COLS,
  ITEM_GAP,
  ITEM_ROWS,
  ITEM_SIZE,
  LOG_W,
  LOG_X,
  LOG_Y,
  NAV_GAP,
  NAV_X,
  PANEL_TITLE_H,
  PHASE_Y,
  REPORT_X,
  REPORT_Y,
  RAIL_X,
  RAIL_Y,
  SELL_SIZE,
  SELL_X,
  SELL_Y,
  SHOP_CH,
  SHOP_CW,
  SHOP_FOOT_Y,
  SHOP_GAP,
  SHOP_W,
  SHOP_X,
  SHOP_Y,
  UNLOAD_BTN_DY,
  H,
  W,
} from '../view/layout';
import { screenToWorld } from '../view/viewScale';
import { TRAIT_BY_ID } from '../../data/traits';
import { RAIL_VIEW_H, RAIL_VIEW_W } from '../view/hudLayout';
import type { GameScene } from '../scenes/GameScene';

/**
 * 夜宴 HUD。左轨羁绊、右栏敌情/八方/战报、中央大漆盘 + 盘下阶段条 + 底部牌铺。
 * 创建顺序由场景 create() 保持；产出的控件挂在本模块上，场景经 scene.hud.* 读取。
 */
export class HudPanels {
  // 顶栏
  roundText!: Phaser.GameObjects.Text;
  phaseText!: Phaser.GameObjects.Text;
  timerText!: Phaser.GameObjects.Text;
  timerBar!: Bar;
  streakText!: Phaser.GameObjects.Text;
  streakLabel!: Phaser.GameObjects.Text;

  // 状态数值（顶栏 stats）
  goldText!: Phaser.GameObjects.Text;
  hpBar!: Bar;
  hpText!: Phaser.GameObjects.Text;
  levelText!: Phaser.GameObjects.Text;
  xpText!: Phaser.GameObjects.Text;
  xpBar!: Bar;
  boardCountText!: Phaser.GameObjects.Text;

  // 操作列 / 出售
  rerollBtn!: Button;
  levelBtn!: Button;
  undoBtn!: Button;
  lockBtn!: Button;
  sellRect!: Phaser.Geom.Rectangle;

  // 商店 / 器匣
  shopCards: ShopCard[] = [];
  private unloadBtn: Button | null = null;
  itemChips: ItemChip[] = [];
  itemHint!: Phaser.GameObjects.Text;

  // 侧栏
  traitContainer!: Phaser.GameObjects.Container;
  traitScroll: ReturnType<typeof enableScroll> | null = null;
  scoreContainer!: Phaser.GameObjects.Container;
  opponentText!: Phaser.GameObjects.Text;
  intelContainer!: Phaser.GameObjects.Container;
  logText!: Phaser.GameObjects.Text;
  reportText!: Phaser.GameObjects.Text;

  /** 羁绊全览浮层（nav「羁绊」开合） */
  private traitModal: Phaser.GameObjects.Container | null = null;
  private traitModalScroll: ReturnType<typeof enableScroll> | null = null;

  constructor(private scene: GameScene) {
    // 浮层开着时切场景（如开着羁绊全览直接开战）：容器随场景销毁，
    // 但 scroll 的遮罩 Graphics 不在显示列表 —— SHUTDOWN 统一回收
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.traitModalScroll?.destroy();
      this.traitModalScroll = null;
      this.traitModal = null;
    });
  }

  // ══════════════ 背景 ══════════════

  buildBackground(): void {
    // 夜色山海由 index.html 的 #bg 承担（透明画布），此处不再铺底
  }

  // ══════════════ 顶栏（样稿 header：导航 · 品牌 · 数值） ══════════════

  buildTopBar(): void {
    // header 底缘发丝线：墨线通栏 + 中央一段金线
    const hair = this.scene.add.graphics();
    hair.lineStyle(1, INK[600], 0.9);
    hair.lineBetween(48, HEADER_H, W - 48, HEADER_H);
    hair.lineStyle(1, GILT.base, 0.22);
    hair.lineBetween(W / 2 - 200, HEADER_H, W / 2 + 200, HEADER_H);

    // ── 左导航：楷/mono 双行 + 下划线 hover（样稿 .nl） ──
    const nav: [string, string, () => void][] = [
      ['图 鉴', 'Codex', () => this.scene.scene.start('Codex', { from: 'Game', match: this.scene.match, prepLeft: this.scene.prepLeft })],
      ['羁 绊', 'Bonds', () => this.openTraitModal()],
      ['阵 容', 'Legion', () => this.scoutNextOpponent()],
    ];
    nav.forEach(([cn, en, onClick], i) => {
      const x = NAV_X + i * NAV_GAP;
      const c = this.scene.add.container(x, 26);
      const cnT = this.scene.add
        .text(0, 0, cn, { fontFamily: FONT.title, fontSize: '14px', color: css(PAPER[100]), letterSpacing: 4 })
        .setOrigin(0, 0);
      const enT = this.scene.add
        .text(0, 24, en, {
          fontFamily: FONT.mono,
          fontSize: '10px',
          color: css(INK[300]),
          letterSpacing: 3,
        })
        .setOrigin(0, 0)
        .setAlpha(0.85);
      // 悬停下划线：scaleX 展开而非重画（样稿 .nl::after）
      const underline = this.scene.add.graphics();
      underline.lineStyle(1, GILT.light, 0.95);
      underline.beginPath();
      underline.moveTo(0, 44);
      underline.lineTo(200, 44);
      underline.strokePath();
      underline.setScale(0.36, 1); // 200×0.36 = 72px 覆盖字宽
      underline.setAlpha(0);
      c.add([cnT, enT, underline]);
      c.setInteractive(new Phaser.Geom.Rectangle(0, -6, 88, 56), Phaser.Geom.Rectangle.Contains);
      c.on('pointerover', () => {
        enT.setColor(css(GILT.light));
        this.scene.tweens.add({ targets: underline, alpha: 1, scaleX: 0.36, duration: 260, ease: 'Quad.easeOut' });
        this.scene.input.setDefaultCursor('pointer');
      });
      c.on('pointerout', () => {
        enT.setColor(css(INK[300]));
        this.scene.tweens.add({ targets: underline, alpha: 0, duration: 200 });
        this.scene.input.setDefaultCursor('default');
      });
      c.on('pointerdown', () => this.scene.tweens.add({ targets: c, scale: 0.96, duration: 70, yoyo: true }));
      c.on('pointerup', onClick);
    });

    // ── 中央品牌：楷体 + 引线 + 英文微注（样稿 .brand） ──
    this.scene.add
      .text(W / 2, 22, '百 战 天 元', {
        fontFamily: FONT.kai,
        fontSize: '21px',
        color: css(PAPER[100]),
        letterSpacing: 10,
      })
      .setOrigin(0.5, 0);
    this.scene.add
      .text(W / 2, 54, 'NIGHT FEAST', {
        fontFamily: FONT.mono,
        fontSize: '9px',
        color: css(INK[300]),
        letterSpacing: 8,
      })
      .setOrigin(0.5, 0)
      .setAlpha(0.9);
    const brandLine = this.scene.add.graphics();
    brandLine.lineStyle(1, GILT.base, 0.3);
    brandLine.lineBetween(W / 2 - 104, 38, W / 2 - 70, 38);
    brandLine.lineBetween(W / 2 + 70, 38, W / 2 + 104, 38);

    // ── 右侧数值（样稿 .stats：mono 值 + 小注）：回合 / 来金 / 生命 / 等级 ──
    const stat = (rightX: number, labelText: string): Phaser.GameObjects.Text => {
      // 有动态小注的数值（来金）传空串，避免静态小注与动态小注同位重叠
      if (labelText) {
        this.scene.add
          .text(rightX - 24, 56, labelText, {
            fontFamily: FONT.body,
            fontSize: '10px',
            color: css(INK[300]),
            letterSpacing: 4,
          })
          .setOrigin(0.5, 0);
      }
      return this.scene.add.text(rightX, 22, '', { fontFamily: FONT.mono, fontSize: '17px', color: css(PAPER[100]) }).setOrigin(1, 0);
    };
    this.roundText = stat(W - 580, '回 合');
    this.goldText = stat(W - 470, '金');
    this.goldText.setColor(css(GILT.light));
    this.streakText = stat(W - 360, '');
    this.streakText.setColor(css(GILT.base));
    this.streakLabel = this.scene.add
      .text(W - 360 - 24, 56, '来 金', {
        fontFamily: FONT.body,
        fontSize: '10px',
        color: css(INK[300]),
        letterSpacing: 4,
      })
      .setOrigin(0.5, 0);
    this.hpText = stat(W - 250, '生 命');
    this.hpText.setColor(css(SPIRIT.base));
    this.levelText = stat(W - 140, '等 级');

    this.hpBar = new Bar(this.scene, W - 250 - 56, 80, 56, 3, SPIRIT.base);
    this.xpBar = new Bar(this.scene, W - 140 - 56, 80, 56, 3, VOID.base);
    this.xpText = this.scene.add
      .text(W - 140 - 64, 80, '', { fontFamily: FONT.mono, fontSize: '10px', color: css(INK[300]) })
      .setOrigin(1, 0.5);

    // 设置入口
    new Button(this.scene, W - 88, 26, '⚙', () => this.scene.openSettings(), { width: 40, height: 34 });
  }

  // ══════════════ 阶段条（盘下：— 备 战 — 开战 · 空格 00:30 —） ══════════════

  buildPhaseStrip(): void {
    const cx = W / 2;
    const line = this.scene.add.graphics();
    line.lineStyle(1, GILT.base, 0.25);
    line.lineBetween(cx - 380, PHASE_Y, cx - 250, PHASE_Y);
    line.lineBetween(cx + 290, PHASE_Y, cx + 420, PHASE_Y);

    this.phaseText = this.scene.add
      .text(cx - 150, PHASE_Y, '', {
        fontFamily: FONT.title,
        fontSize: '15px',
        color: css(PAPER[100]),
        letterSpacing: 7,
      })
      .setOrigin(0.5);

    new Button(this.scene, cx + 20, PHASE_Y - 12, '开 战 · 空格', () => this.scene.startBattlePhase(), {
      width: 140,
      height: 32,
      variant: 'primary',
      fontSize: 12,
    });

    this.timerText = this.scene.add
      .text(cx + 180, PHASE_Y, '', { fontFamily: FONT.mono, fontSize: '13px', color: css(GILT.base) })
      .setOrigin(0, 0.5);
    this.timerBar = new Bar(this.scene, cx + 180, PHASE_Y + 12, 120, 2, GILT.base);
  }

  // ══════════════ 商肆（样稿 .scard 窄卡 × 5） ══════════════

  buildShop(): void {
    // 注脚放卡下一行：卡上方紧贴备战席框底，旧「卡上标题」压进框底带是备战区视觉混乱的一处根因
    // 行顶坐标走 SHOP_FOOT_Y（layout 单一真源）：13px@1.12 行高 ~19px，底缘收在 1080 之内
    this.scene.add
      .text(SHOP_X, SHOP_FOOT_Y, '商 肆', {
        fontFamily: FONT.title,
        fontSize: '13px',
        color: css(PAPER[300]),
        letterSpacing: 4,
      })
      .setOrigin(0, 0);
    this.scene.add
      .text(SHOP_X + SHOP_W, SHOP_FOOT_Y, `刷新 · ${REROLL_COST} 金`, {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(PAPER[400]),
      })
      .setOrigin(0, 0);

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

  // ══════════════ 器匣（2×5 网格） ══════════════

  buildItemBar(): void {
    const gw = ITEM_BAR_W;
    const gh = ITEM_ROWS * (ITEM_SIZE + ITEM_GAP) - ITEM_GAP;
    bakedImage(this.scene, ITEM_BAR_X - 10, ITEM_BAR_Y - 24, 'itemFrame_v3', gw + 20, gh + 34, (g) => {
      g.translateCanvas(-(ITEM_BAR_X - 10), -(ITEM_BAR_Y - 24));
      g.fillStyle(INK[900], 0.66);
      g.fillRect(ITEM_BAR_X - 8, ITEM_BAR_Y - 8, gw + 16, gh + 16);
      g.lineStyle(1, INK[500], 0.6);
      g.strokeRect(ITEM_BAR_X - 8, ITEM_BAR_Y - 8, gw + 16, gh + 16);
      // 界格签
      g.fillStyle(INK[900], 0.95);
      g.fillRect(ITEM_BAR_X - 8, ITEM_BAR_Y - 22, 70, 18);
      g.lineStyle(1, INK[500], 0.55);
      g.strokeRect(ITEM_BAR_X - 8, ITEM_BAR_Y - 22, 70, 18);
    });
    this.scene.add
      .text(ITEM_BAR_X + 27, ITEM_BAR_Y - 13, '器 匣', {
        fontFamily: FONT.title,
        fontSize: '13px',
        color: css(PAPER[300]),
        letterSpacing: 3,
      })
      .setOrigin(0.5);

    for (let i = 0; i < ITEM_BAR_SLOTS; i++) {
      const col = i % ITEM_COLS;
      const row = Math.floor(i / ITEM_COLS);
      const chip = new ItemChip(
        this.scene,
        ITEM_BAR_X + col * (ITEM_SIZE + ITEM_GAP),
        ITEM_BAR_Y + row * (ITEM_SIZE + ITEM_GAP),
        ITEM_SIZE,
        () => this.scene.onItemChipClick(i)
      );
      this.itemChips.push(chip);
    }

    // 卸载器（开局可用）：点选 → 点棋子 → 全身装备回器匣。
    // 挂器匣框顶上方的独立行（UNLOAD_BTN_DY），不叠框线——
    // 旧位 y-26 压在框顶线上，且按钮命中区（kit 外扩 5px）侵入首行格 5px。
    this.unloadBtn = new Button(
      this.scene,
      ITEM_BAR_X + ITEM_BAR_W - 84,
      ITEM_BAR_Y + UNLOAD_BTN_DY,
      '卸 载',
      () => this.scene.onToggleUnload(),
      { width: 84, height: 26 },
    );
    this.unloadBtn.setDepth(5);

    this.itemHint = this.scene.add
      .text(ITEM_BAR_X - 8, ITEM_BAR_Y + gh + 22, '', {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(PAPER[400]),
        wordWrap: { useAdvancedWrap: true, width: gw + 16 },
        lineSpacing: 3,
      })
      .setOrigin(0, 0);
  }

  // ══════════════ 操作列（2×3） ══════════════

  buildActionBar(): void {
    const gx = ACT_X;
    const gy = ACT_Y;
    const step = ACT_BTN_W + 10;
    const rowStep = ACT_BTN_H + 10;
    this.rerollBtn = new Button(this.scene, gx, gy, `刷新 · D`, () => this.scene.onReroll(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
    });
    this.levelBtn = new Button(this.scene, gx + step, gy, `升级 · F`, () => this.scene.onBuyXp(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
      variant: 'primary',
    });
    new Button(this.scene, gx, gy + rowStep, '布阵 · E', () => this.scene.onAutoArrange(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
    });
    this.undoBtn = new Button(this.scene, gx + step, gy + rowStep, '撤销 · Z', () => this.scene.onUndo(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
    });
    new Button(this.scene, gx, gy + rowStep * 2, '一键装备', () => this.scene.onAutoEquip(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
    });
    this.lockBtn = new Button(this.scene, gx + step, gy + rowStep * 2, '锁定商店', () => this.scene.onToggleLock(), {
      width: ACT_BTN_W,
      height: ACT_BTN_H,
    });
  }

  // ══════════════ 出售朱印（拖入出售） ══════════════

  buildSell(): void {
    bakedImage(this.scene, SELL_X, SELL_Y, 'sellSeal_v3', SELL_SIZE, SELL_SIZE, (g) => {
      g.fillStyle(CINNABAR.deep, 0.96);
      g.fillRect(0, 0, SELL_SIZE, SELL_SIZE);
      g.lineStyle(1.5, CINNABAR.light, 0.8);
      g.strokeRect(4, 4, SELL_SIZE - 8, SELL_SIZE - 8);
    });
    this.scene.add
      .text(SELL_X + SELL_SIZE / 2, SELL_Y + SELL_SIZE / 2, '出售', {
        fontFamily: FONT.kai,
        fontSize: '15px',
        color: css(PAPER[50]),
        letterSpacing: 5,
      })
      .setOrigin(0.5);
    // 朱印自带「出售」二字，操作自明 —— 不再加说明行（曾与操作列首行按钮叠压）
    this.sellRect = new Phaser.Geom.Rectangle(SELL_X, SELL_Y, SELL_SIZE, SELL_SIZE);
  }

  // ══════════════ 羁绊轨（左） ══════════════

  buildTraitRail(): void {
    // 竖排帽「羁 绊」：底缘（102+20+15=137）与首圆上缘（RAIL_Y−16=142）净距 5px
    ['羁', '绊'].forEach((ch, i) => {
      this.scene.add
        .text(RAIL_X, 102 + i * 20, ch, {
          fontFamily: FONT.kai,
          fontSize: '13px',
          color: css(PAPER[400]),
        })
        .setOrigin(0.5, 0);
    });
    this.traitContainer = this.scene.add.container(RAIL_X, RAIL_Y);
    // 视口一窗收全「徽章 40 + 右侧计数」；旧宽 48 只罩圆环，计数被遮罩裁成半截
    this.traitScroll = enableScroll(this.scene, this.traitContainer, RAIL_X - 24, RAIL_Y - 20, RAIL_VIEW_W, RAIL_VIEW_H);
  }

  // ══════════════ 敌情（右上） ══════════════

  buildIntel(): void {
    this.scene.add
      .text(REPORT_X + 0, 140, '敌 情', {
        fontFamily: FONT.body,
        fontSize: '11px',
        color: css(INK[300]),
        letterSpacing: 4,
      })
      .setOrigin(0, 0);
    this.opponentText = this.scene.add
      .text(REPORT_X, 160, '', { fontFamily: FONT.title, fontSize: '14px', color: css(PAPER[100]), letterSpacing: 2 })
      .setOrigin(0, 0);
    this.intelContainer = this.scene.add.container(REPORT_X, 188);
  }

  // ══════════════ 八方诸侯（右中，紧凑行） ══════════════

  buildScoreboard(): void {
    this.scene.add
      .text(REPORT_X, 316, '八 方 诸 侯', {
        fontFamily: FONT.body,
        fontSize: '11px',
        color: css(INK[300]),
        letterSpacing: 4,
      })
      .setOrigin(0, 0);
    this.scoreContainer = this.scene.add.container(REPORT_X, 338);
  }

  // ══════════════ 记事（左下）/ 战报（右下） ══════════════

  buildLogPanel(): void {
    const hair = this.scene.add.graphics();
    hair.lineStyle(1, INK[500], 0.7);
    hair.lineBetween(LOG_X, LOG_Y, LOG_X + LOG_W, LOG_Y);
    this.scene.add
      .text(LOG_X, LOG_Y + 12, '对 局 记 事', {
        fontFamily: FONT.body,
        fontSize: '11px',
        color: css(INK[300]),
        letterSpacing: 4,
      })
      .setOrigin(0, 0);
    this.logText = this.scene.add
      .text(LOG_X, LOG_Y + 34, '', {
        fontFamily: FONT.body,
        fontSize: '13px',
        color: css(PAPER[300]),
        wordWrap: { useAdvancedWrap: true, width: LOG_W },
        lineSpacing: 4,
      })
      .setOrigin(0, 0);
  }

  buildReportPanel(): void {
    const hair = this.scene.add.graphics();
    hair.lineStyle(1, INK[500], 0.7);
    hair.lineBetween(REPORT_X, REPORT_Y, REPORT_X + 282, REPORT_Y);
    this.scene.add
      .text(REPORT_X, REPORT_Y + 12, '上 回 合 战 报', {
        fontFamily: FONT.body,
        fontSize: '11px',
        color: css(INK[300]),
        letterSpacing: 4,
      })
      .setOrigin(0, 0);
    this.reportText = this.scene.add
      .text(REPORT_X, REPORT_Y + 34, '', {
        fontFamily: FONT.body,
        fontSize: '13px',
        color: css(PAPER[300]),
        wordWrap: { useAdvancedWrap: true, width: 282 },
        lineSpacing: 5,
      })
      .setOrigin(0, 0);
  }

  // ══════════════ 场上计数（备战席签条同带右端） ══════════════

  buildBoardCount(): void {
    // 与「备 战 席」签同带两端分布：旧位（棋盘右缘下、y=BENCH_Y+32）撞进
    // 卸载按钮行——器匣上方那条窄带只够放一个东西。
    this.boardCountText = this.scene.add
      .text(BENCH_X + BENCH_W - 6, BENCH_Y - 13, '', {
        fontFamily: FONT.mono,
        fontSize: '12px',
        color: css(PAPER[400]),
      })
      .setOrigin(1, 0.5);
  }

  /** 卸载器按钮态（GameScene.onToggleUnload 驱动） */
  setUnloadMode(on: boolean): void {
    if (!this.unloadBtn) return;
    this.unloadBtn.setText(on ? '卸载中…' : '卸 载');
    this.unloadBtn.setAlpha(on ? 1 : 0.85);
  }

  // ══════════════ 羁绊全览浮层（nav「羁绊」） ══════════════

  openTraitModal(): void {
    if (this.traitModal) {
      this.traitModal.destroy();
      this.traitModal = null;
      // 先销毁滚轮句柄再置空：scroll 的遮罩 Graphics 不在显示列表，
      // 不 destroy 会随每次开关累积一枚（C2）
      this.traitModalScroll?.destroy();
      this.traitModalScroll = null;
      return;
    }
    const shade = this.scene.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0).setDepth(560).setInteractive();
    const panelW = 640;
    const panelH = 720;
    const px = (W - panelW) / 2;
    const py = (H - panelH) / 2;
    const modal = makePanel(this.scene, px, py, panelW, panelH, { title: '羁 绊 全 览', accent: SPIRIT.base, alpha: 0.98 });
    modal.setDepth(561);
    // 遮罩点击关闭（点浮层本体不关）：shade 一直 setInteractive 却无响应，
    // 玩家本能的点空白处关闭从未生效。坐标换算走 screenToWorld —— 与
    // hitTest/enableScroll 同一真源，勿再手写 px/zoom。
    shade.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const { x: wx, y: wy } = screenToWorld(p.x, p.y, this.scene.cameras.main.zoom);
      if (wx < px || wx > px + panelW || wy < py || wy > py + panelH) this.openTraitModal();
    });

    const bodyX = px + 20;
    const bodyY = py + PANEL_TITLE_H + 8;
    const content = this.scene.add.container(bodyX, bodyY).setDepth(562);
    const traits = this.scene.match.traitsOf(this.scene.match.human.board);
    const countOf = new Map(traits.map((t) => [t.id, t] as const));
    let y = 0;
    for (const def of Object.values(TRAIT_BY_ID)) {
      const t = countOf.get(def.id);
      const count = t?.count ?? 0;
      const tier = t?.tier ?? -1;
      const nextBreak = def.breakpoints.find((b) => b > count) ?? def.breakpoints[def.breakpoints.length - 1];
      const color = tier >= 0 ? TRAIT_TIER_COLOR_HEX[Math.min(tier, 3)] : INK[500];
      const desc = tier >= 0 ? def.effectText[Math.min(tier, def.effectText.length - 1)] : def.description;
      const row = new TraitRow(this.scene, 0, y, panelW - 40);
      row.set(def.id, count, tier, nextBreak, color, desc);
      content.add(row);
      y += row.rowHeight + 8;
    }
    // 视口收到 600：底缘 828 与关闭键顶缘 850 之间留 22px，键不再贴住滚动区
    this.traitModalScroll = enableScroll(this.scene, content, bodyX, bodyY, panelW - 40, panelH - PANEL_TITLE_H - 80);
    this.traitModalScroll.setHeight(y);

    const close = new Button(this.scene, px + panelW / 2, py + panelH - 30, '关 闭', () => this.closeTraitModal(), {
      width: 140,
      height: 40,
      variant: 'primary',
    });
    close.setDepth(562);

    this.traitModal = this.scene.add.container(0, 0).setDepth(560);
    this.traitModal.add([shade, modal, content, close]);
  }

  closeTraitModal(): void {
    this.traitModalScroll?.destroy();
    this.traitModal?.destroy();
    this.traitModal = null;
    this.traitModalScroll = null;
  }

  /** 羁绊浮层是否打开（输入层用它守卫棋盘交互与 ESC 链） */
  get traitModalOpen(): boolean {
    return this.traitModal !== null;
  }

  /** nav「阵容」：直接侦查本轮对手（墨兽轮提示无可侦） */
  private scoutNextOpponent(): void {
    const pr = this.scene.match.pairings.find((x) => x.a === 0 || x.b === 0);
    if (!pr) {
      this.scene.showToast('配对未定 · 开战后自动更新');
      return;
    }
    const other = pr.a === 0 ? pr.b : pr.a;
    if (pr.beast || other < 0) {
      this.scene.showToast(pr.beast ? '墨兽轮 · 无阵可侦' : '本轮无对手可侦查');
      return;
    }
    this.scene.pauseScout.showOpponentBoard(other);
  }
}
