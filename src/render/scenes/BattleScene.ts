import Phaser from 'phaser';
import { Battle } from '../../core/battle';
import { DT } from '../../core/config';
import type { BattleEvent } from '../../core/events';
import { effArmor, effAspd, effAtk, effMr } from '../../core/unit';
import { CHAMPION_BY_ID, formatSkillDesc } from '../../data/champions';
import { TRAIT_BY_ID } from '../../data/traits';
import { SHADE, TRAIT_TIER_COLOR_HEX, CINNABAR, GILT, INK, MOON, PAPER, RARITY_COLOR, SPIRIT, VOID, css } from '../view/palette';
import { buildTextures, grainOverlay, TEX } from '../view/textures';
import { bakeSilhouettes } from '../board/silhouetteFactory';
import { BoardView, CELL } from '../board/BoardView';
import { UnitView, setFriendlyTeam } from '../board/UnitView';
import { bakeItemIcons } from '../board/itemIcons';
import { baseZoom, battleWorldToLayer, BATTLE_BOARD_LX, BATTLE_BOARD_LY, BATTLE_BOARD_SCALE, BATTLE_BOARD_SIZE, screenToWorld } from '../view/viewScale';
import { EffectsLayer } from '../board/EffectsLayer';
import { DamageTextLayer, type DamageTier } from '../board/DamageText';
import { motion } from '../view/motion';
import { audio } from '../../audio/AudioEngine';
import { Button, enableScroll, FONT, makeChip, makePanel, resetCursorOnShutdown, type ScrollHandle } from '../../ui/kit';
import { PRESET_COMPS, buildTeam, type CompSpec } from '../../game/comp';
import type { Match, Pairing } from '../../game/match';
import { saveMatch } from '../../game/save';
import type { Unit } from '../../core/unit';
import type { ActiveTrait, BattleConfig } from '../../core/types';

const W = 1920;
const H = 1080;
// 棋盘层的位置 / 缩放真源在 viewScale（BATTLE_BOARD_*），此处不另立常量——
// 指针逆变换 battleWorldToLayer 与布局必须同一出处，测试才能断言同一契约。
/** 悬停单位卡尺寸（updateHoverCard 与 makeUnitCard 共用）；高度容纳两行技能描述 */
const UNIT_CARD_W = 268;
const UNIT_CARD_H = 184;

interface Projectile {
  img: Phaser.GameObjects.Image;
  t: number;
  dur: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  uid: number;
  targetUid: number;
}

/**
 * 战斗场景。
 *
 * 职责边界：只做"把内核事件翻译成音画"，不做任何战斗判定。
 * 逻辑与渲染通过事件流单向解耦 —— 渲染永远不可能影响战斗结果。
 */
export class BattleScene extends Phaser.Scene {
  private board!: BoardView;
  private boardLayer!: Phaser.GameObjects.Container;
  private fx!: EffectsLayer;
  private dmgText!: DamageTextLayer;
  private views = new Map<number, UnitView>();
  private battle: Battle | null = null;

  private acc = 0;
  private speed = 1;
  private paused = false;
  private running = false;
  /** 真·快进进行中：update 循环按 240× 速排水，步数上限同步放开 */
  private ff = false;
  private seed = 20260829;

  private compA: CompSpec = PRESET_COMPS[1];
  private compB: CompSpec = PRESET_COMPS[0];

  /**
   * 对局模式：由 GameScene 传入正在进行的对局与本场配对。
   * 为空则是 M1 的"阵容对拍"演示模式。
   */
  private matchCtx: { match: Match; pair: Pairing } | null = null;
  /** 墨兽的 uid 集合（渲染层据此换用墨色剪影） */
  private monsterUids = new Set<number>();
  /** 观众（人类玩家）所在队号。演示模式固定为 0。 */
  private viewerTeam: 0 | 1 = 0;

  // HUD
  private phaseText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private topSub!: Phaser.GameObjects.Text;
  private traitPanelA!: Phaser.GameObjects.Container;
  private traitPanelB!: Phaser.GameObjects.Container;
  private scrollA: ScrollHandle | null = null;
  private scrollB: ScrollHandle | null = null;
  private speedBtns: Button[] = [];
  private resultPanel: Phaser.GameObjects.Container | null = null;
  private hoverCard: Phaser.GameObjects.Container | null = null;

  private projectiles: Projectile[] = [];
  private lastBars = new Map<number, number>();
  private lastShake = 0;
  private creatingBattle = false;
  /**
   * 本场战斗挂起的全部延时回调。重开/重播必须整体取消 ——
   * 否则旧战斗的"1.6s 转交战"与远程射击音效会落进下一场战斗。
   */
  private pendingTimers = new Set<Phaser.Time.TimerEvent>();
  /** 场景级特效对象（如 burstInk 的粒子），随 clearBattle 一并销毁 */
  private strays = new Set<Phaser.GameObjects.GameObject>();

  /** 登记一个随 clearBattle 统一取消的延时回调 */
  private after(ms: number, fn: () => void): void {
    const ev = this.time.delayedCall(ms, () => {
      this.pendingTimers.delete(ev);
      fn();
    });
    this.pendingTimers.add(ev);
  }

  /** 登记一个场景级特效对象；对象自毁时自动出列 */
  private trackStray<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.strays.add(obj);
    obj.once('destroy', () => this.strays.delete(obj));
    return obj;
  }

  constructor() {
    super({ key: 'Battle' });
  }

  init(data: { match?: Match; pair?: Pairing }): void {
    this.matchCtx = data.match && data.pair ? { match: data.match, pair: data.pair } : null;
  }

  create(): void {
    baseZoom(this);
    resetCursorOnShutdown(this);
    buildTextures(this);
    bakeSilhouettes(this);
    bakeItemIcons(this);
    grainOverlay(this);

    // Scene 实例被复用，上次进入场景时登记的按钮引用必须清掉，否则会越积越多
    this.speedBtns = [];

    // 侧栏滚动句柄与战斗残留随 SHUTDOWN 统一清理：scroll 的遮罩 Graphics
    // 不在显示列表，场景关闭不回收（C4）。战斗中关页/切场景的语义：
    // 开战前 flushSave 落的是结算前快照，回来后整回合确定性重放，无数据损坏。
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearBattle();
      this.scrollA?.destroy();
      this.scrollB?.destroy();
      this.scrollA = null;
      this.scrollB = null;
    });

    // 背景：夜色山海由 index.html 的 #bg 承担（透明画布），此处不再铺底

    this.boardLayer = this.add.container(BATTLE_BOARD_LX, BATTLE_BOARD_LY).setScale(BATTLE_BOARD_SCALE);
    this.board = new BoardView(this, 0, 0);
    this.boardLayer.add(this.board);
    this.fx = new EffectsLayer(this, this.boardLayer);
    this.dmgText = new DamageTextLayer(this, this.boardLayer);

    this.buildTopBar();
    this.buildSidePanels();
    this.buildBottomBar();

    // 交互：悬停查看棋子详情（p.x/y 是画布像素，先换算到 1920×1080 世界系 —— A1）
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const { x, y } = screenToWorld(p.x, p.y, this.cameras.main.zoom);
      // 逆变换到棋盘层局部系（层被放大 BOARD_SCALE，指针世界坐标要先平移再除缩放）
      const local = battleWorldToLayer(x, y);
      const cell = this.board.xyToCell(local.x, local.y);
      this.board.setHover(cell);
      this.updateHoverCard(x, y, cell);
    });

    this.input.on('pointerdown', () => audio.unlock());

    this.startBattle();
  }

  // ══════════════ HUD ══════════════

  private buildTopBar(): void {
    // 与对局同语的顶栏：发丝底线 + 楷体品牌 + 阶段条 + mono 倒计时（无面板底）
    const hair = this.add.graphics();
    hair.lineStyle(1, INK[600], 0.9);
    hair.lineBetween(48, 84, W - 48, 84);
    hair.lineStyle(1, GILT.base, 0.25);
    hair.lineBetween(W / 2 - 200, 84, W / 2 + 200, 84);

    const title = this.add
      .text(48, 24, '百 战 天 元', {
        fontFamily: FONT.kai,
        fontSize: '19px',
        color: css(PAPER[100]),
        letterSpacing: 8,
      })
      .setOrigin(0, 0);
    title.setShadow(0, 0, css(GILT.base), 10, false, true);
    this.add
      .text(48, 56, 'NIGHT FEAST', {
        fontFamily: FONT.mono,
        fontSize: '10px',
        color: css(INK[300]),
        letterSpacing: 6,
      })
      .setOrigin(0, 0);

    this.phaseText = this.add
      .text(W / 2, 18, '备  战', {
        fontFamily: FONT.title,
        fontSize: '24px',
        color: css(PAPER[100]),
        letterSpacing: 6,
      })
      .setOrigin(0.5, 0);
    this.topSub = this.add
      .text(W / 2, 56, '', {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(PAPER[400]),
        letterSpacing: 2,
      })
      .setOrigin(0.5, 0);

    this.timerText = this.add
      .text(W - 48, 28, '00.0"', {
        fontFamily: FONT.mono,
        fontSize: '17px',
        color: css(GILT.base),
      })
      .setOrigin(1, 0);
  }

  private buildSidePanels(): void {
    // 左：我方（下方阵营）
    makePanel(this, 24, 116, 320, 560, { title: '我 方 阵 容', accent: SPIRIT.base });
    this.traitPanelA = this.add.container(40, 156);
    this.scrollA = enableScroll(this, this.traitPanelA, 26, 152, 316, 516);
    // 右：敌方
    makePanel(this, W - 344, 116, 320, 560, { title: '敌 方 阵 容', accent: CINNABAR.base });
    this.traitPanelB = this.add.container(W - 324, 156);
    this.scrollB = enableScroll(this, this.traitPanelB, W - 342, 152, 316, 516);
  }

  private buildBottomBar(): void {
    // 控制条对齐放大后的棋盘层（层真源见 viewScale.BATTLE_BOARD_*）
    const y = BATTLE_BOARD_LY + BATTLE_BOARD_SIZE + 24;
    const pw = BATTLE_BOARD_SIZE;
    const px = BATTLE_BOARD_LX;
    makePanel(this, px, y, pw, 76, { alpha: 0.85 });

    const mk = (label: string, x: number, w: number, onClick: () => void, variant: 'primary' | 'ghost' = 'ghost') => {
      const b = new Button(this, px + x, y + 20, label, onClick, { width: w, height: 36, variant });
      this.add.existing(b);
      return b;
    };

    if (this.matchCtx) {
      // 对局模式：只保留观战相关控制，避免玩家误触把对局重开。
      // 「快进到底」是真快进（把剩余战斗按 tick 序排到终局），不是切 4× 速 ——
      // 仅设倍速时，后台标签页的 rAF 节流配上 8 步/帧上限会让战斗永远爬不完。
      mk('暂 停', 24, 96, () => this.togglePause());
      mk('快进到底', 132, 116, () => this.fastForward());
    } else {
      mk('重开对局', 24, 110, () => this.restart(), 'primary');
      mk('暂 停', 142, 80, () => this.togglePause());
      mk('重 播', 230, 80, () => this.replay());
      // 阵容切换
      mk('我方换阵', 318, 100, () => this.cycleComp('A'));
      mk('敌方换阵', 426, 100, () => this.cycleComp('B'));
    }

    // 速度（最右钮右缘对齐 pw-24；向左 44 步进）
    const speeds = [1, 2, 4];
    speeds.forEach((s, i) => {
      const b = new Button(this, px + pw - 42 - (2 - i) * 44, y + 20, `${s}×`, () => this.setSpeed(s), {
        width: 36,
        height: 36,
        variant: s === 1 ? 'primary' : 'ghost',
      });
      this.speedBtns.push(b);
      this.add.existing(b);
    });
  }

  private setSpeed(s: number): void {
    this.speed = s;
    this.ff = false; // 显式选速即收回快进：控制权还给玩家
    this.speedBtns.forEach((b, i) => {
      const on = [1, 2, 4][i] === s;
      b.setDisabled(false);
      b.setText(`${[1, 2, 4][i]}×`);
      b.setAlpha(on ? 1 : 0.55);
    });
    audio.play('ui');
  }

  /** 真·快进：标志位交给 update 循环按 240× 排水。战斗结果与无头重放逐位
   *  同源（同一 config + 种子），这里只是把演出压缩 —— 渲染层不改变结果。 */
  private fastForward(): void {
    if (!this.battle || !this.running || this.paused) return;
    this.ff = true;
    this.speed = 4;
    this.speedBtns.forEach((b, i) => b.setAlpha(i === 2 ? 1 : 0.55));
    audio.play('ui');
  }

  private togglePause(): void {
    this.paused = !this.paused;
    audio.play('ui');
  }

  private cycleComp(side: 'A' | 'B'): void {
    const list = PRESET_COMPS;
    const cur = side === 'A' ? this.compA : this.compB;
    const i = list.indexOf(cur);
    const next = list[(i + 1) % list.length];
    if (side === 'A') this.compA = next;
    else this.compB = next;
    audio.play('uiBig');
    this.restart();
  }

  private restart(): void {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    audio.play('uiBig');
    this.startBattle();
  }

  private replay(): void {
    audio.play('uiBig');
    this.startBattle();
  }

  // ══════════════ 战斗装配 ══════════════

  private startBattle(): void {
    this.clearBattle();

    let cfg: BattleConfig;
    if (this.matchCtx) {
      // 对局模式：配置直接来自 Match，与无头模拟用的是同一份东西 ——
      // 所以模拟出来的平衡数据就是玩家实际看到的战斗。
      cfg = this.matchCtx.match.buildBattleConfig(this.matchCtx.pair, this.matchCtx.pair.swap);
    } else {
      const a = buildTeam(this.compA, 0, 1);
      const b = buildTeam(this.compB, 1, 200);
      cfg = { seed: this.seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } };
    }
    const cfgTraits: Record<number, ActiveTrait[]> = cfg.traits;
    this.monsterUids = new Set(cfg.units.filter((u) => u.monster).map((u) => u.uid));
    // "我方"由观众的队号决定，不是写死的 0 —— 玩家永远打下半场，
    // 但下半场的队号取决于配对时是否发生了交换。
    this.viewerTeam = this.matchCtx
      ? this.matchCtx.match.playerIdxOfTeam(this.matchCtx.pair, 1) === 0
        ? 1
        : 0
      : 0;
    setFriendlyTeam(this.viewerTeam);

    // 构造期间内核会派发 'start'/'blink'（如刺客跳后排），此时视图尚未建立，必须跳过
    this.creatingBattle = true;
    this.battle = new Battle(cfg, (e) => this.onEvent(e), false);
    this.creatingBattle = false;

    // 生成可视对象（挂进棋盘层，随层放大）
    for (const u of this.battle.units) {
      const p = this.cellWorld(u.cell.c, u.cell.r);
      const v = new UnitView(this, u.entry.id, u.team, u.star, p.x, p.y, this.monsterUids.has(u.uid));
      v.setDepth(30 + u.cell.r * 2);
      v.setItems(u.itemIds);
      this.boardLayer.add(v);
      this.views.set(u.uid, v);
      v.syncBars(u.hp, u.maxHp, u.shield, u.mp, u.maxMp);
    }

    if (this.matchCtx) {
      const m = this.matchCtx.match;
      const pr = this.matchCtx.pair;
      const foe: 0 | 1 = this.viewerTeam === 0 ? 1 : 0;
      const ha = this.renderMatchTraitPanel(this.traitPanelA, cfgTraits[this.viewerTeam] ?? [], '我 方', SPIRIT.base, m.displayNameOfTeam(pr, this.viewerTeam));
      const hb = this.renderMatchTraitPanel(this.traitPanelB, cfgTraits[foe] ?? [], '敌 方', CINNABAR.base, m.displayNameOfTeam(pr, foe));
      this.scrollA?.setHeight(ha);
      this.scrollB?.setHeight(hb);
      this.topSub.setText(`第 ${m.round} 回合　${m.displayNameOfTeam(pr, this.viewerTeam)}　VS　${m.displayNameOfTeam(pr, foe)}`);
    } else {
      const ha = this.renderTraitPanel(this.traitPanelA, this.compA, cfgTraits[0] ?? [], 0);
      const hb = this.renderTraitPanel(this.traitPanelB, this.compB, cfgTraits[1] ?? [], 1);
      this.scrollA?.setHeight(ha);
      this.scrollB?.setHeight(hb);
      this.topSub.setText(`${this.compA.name}　VS　${this.compB.name}`);
    }

    this.acc = 0;
    this.running = true;
    this.paused = false;
    this.ff = false;
    this.board.setPhase('prep');
    this.phaseText.setText('备 战');
    this.phaseText.setColor(css(SPIRIT.light));

    audio.unlock();
    audio.startBgm('prep');

    // 准备阶段：给玩家 1.6 秒读阵，再开打
    this.after(1600, () => {
      if (!this.running) return;
      this.board.setPhase('battle');
      this.phaseText.setText('交 战');
      this.phaseText.setColor(css(CINNABAR.light));
      audio.startBgm('battle');
      audio.play('warn');
      if (!motion.calm) this.cameras.main.flash(220, 0xc6, 0x5a, 0x45); // 朱砂 CINNABAR.base（静观关闭）
    });
  }

  private clearBattle(): void {
    for (const ev of this.pendingTimers) ev.remove(false);
    this.pendingTimers.clear();
    // 先杀挂在每个视图上的补间再销毁：hopTo/playAttack/playHit 的补间回调
    // 会碰视图子对象，拖着补间销毁等于对尸体发后事
    for (const v of this.views.values()) {
      this.tweens.killTweensOf(v);
      if (v.scene) v.destroy();
    }
    this.views.clear();
    this.dmgText.clear();
    this.fx.clear();
    for (const s of this.strays) s.destroy();
    this.strays.clear();
    for (const p of this.projectiles) p.img.destroy();
    this.projectiles = [];
    this.lastBars.clear();
    if (this.hoverCard) {
      this.hoverCard.destroy();
      this.hoverCard = null;
      this.hoverStatTexts = [];
    }
    this.hoverKey = '';
    if (this.resultPanel) {
      this.resultPanel.destroy();
      this.resultPanel = null;
    }
    this.battle = null;
    this.running = false;
  }

  private renderTraitPanel(
    container: Phaser.GameObjects.Container,
    spec: CompSpec,
    traits: { id: string; count: number; tier: number }[],
    team: number,
  ): number {
    container.removeAll(true);
    let y = 0;
    const name = this.add
      .text(0, y, spec.name, { fontFamily: FONT.title, fontSize: '17px', color: css(PAPER[100]) })
      .setOrigin(0, 0);
    container.add(name);
    y += 26;
    const desc = this.add
      .text(0, y, spec.desc, {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(PAPER[500]),
        wordWrap: { useAdvancedWrap: true, width: 280 },
      })
      .setOrigin(0, 0);
    container.add(desc);
    y += desc.height + 14;

    const g = this.add.graphics();
    g.lineStyle(1, INK[500], 0.8);
    g.lineBetween(0, 0, 276, 0);
    g.setY(y);
    container.add(g);
    y += 12;

    container.add(
      this.add.text(0, y, '羁绊', { fontFamily: FONT.title, fontSize: '14px', color: css(PAPER[400]) }).setOrigin(0, 0),
    );
    y += 22;

    for (const t of traits) {
      const active = t.tier >= 0;
      const color = active ? TRAIT_TIER_COLOR_HEX[Math.min(t.tier, 3)] : INK[500];
      const tname = TRAIT_BY_ID[t.id]?.name ?? t.id;
      const chip = makeChip(this, 0, y, tname, color, active);
      container.add(chip);
      const label = this.add
        .text(60, y, `${t.count}　${active ? `第${t.tier + 1}档` : '未激活'}`, {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: active ? css(PAPER[100]) : css(PAPER[500]),
        })
        .setOrigin(0, 0.5);
      container.add(label);
      y += 28;
    }

    y += 10;
    container.add(
      this.add.text(0, y, '出战', { fontFamily: FONT.title, fontSize: '14px', color: css(PAPER[400]) }).setOrigin(0, 0),
    );
    y += 22;
    for (const [id, star] of Object.entries(spec.units)) {
      const e = CHAMPION_BY_ID[id];
      if (!e) continue;
      const row = this.add.container(0, y);
      const dot = this.add.graphics();
      dot.fillStyle(RARITY_COLOR[e.cost], 0.95);
      dot.fillRoundedRect(0, -7, 14, 14, 3);
      row.add(dot);
      const txt = this.add
        .text(22, 0, `${e.name}·${e.title}`, { fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[200]) })
        .setOrigin(0, 0.5);
      row.add(txt);
      const stars = this.add
        .text(196, 0, '★'.repeat(star), { fontFamily: FONT.body, fontSize: '12px', color: css(GILT.light) })
        .setOrigin(0, 0.5);
      row.add(stars);
      const cost = this.add
        .text(276, 0, `${e.cost}`, { fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[500]) })
        .setOrigin(1, 0.5);
      row.add(cost);
      container.add(row);
      y += 22;
    }
    void team;
    return y;
  }

  /** 对局模式的阵容面板：直接用内核拿到的激活羁绊，不经过 CompSpec */
  private renderMatchTraitPanel(
    container: Phaser.GameObjects.Container,
    traits: readonly ActiveTrait[],
    title: string,
    accent: number,
    who: string
  ): number {
    container.removeAll(true);
    let y = 0;
    container.add(this.add.text(0, y, title, { fontFamily: FONT.title, fontSize: '17px', color: css(PAPER[100]) }).setOrigin(0, 0));
    container.add(
      this.add
        .text(72, y + 4, who, { fontFamily: FONT.body, fontSize: '12px', color: css(accent) })
        .setOrigin(0, 0)
    );
    y += 34;

    const active = traits.filter((t) => t.tier >= 0).sort((a, b) => b.tier - a.tier);
    const inactive = traits.filter((t) => t.tier < 0);

    if (active.length === 0) {
      container.add(
        this.add.text(0, y, '（未激活任何羁绊）', { fontFamily: FONT.body, fontSize: '12px', color: css(INK[300]) }).setOrigin(0, 0)
      );
      y += 26;
    }
    for (const t of active) {
      const def = TRAIT_BY_ID[t.id];
      const color = TRAIT_TIER_COLOR_HEX[Math.min(t.tier, 3)];
      // 节奏：徽章行（22px 高）→ 效果行 → 14px 空隙 → 下一徽章。
      // 行间留白必须大于元素自身的半高，否则相邻行在视觉上粘连。
      const chip = makeChip(this, 0, y, `${def?.name ?? t.id}`, color, true);
      container.add(chip);
      const label = this.add
        .text(70, y, `${t.count}　第${t.tier + 1}档`, {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[100]),
        })
        .setOrigin(0, 0.5);
      container.add(label);
      y += 28;
      // 效果文字独立成行：逐字换行（useAdvancedWrap，中文无空格可断），
      // 宽度收在面板内容区内，绝不出血到棋盘
      const effect = this.add
        .text(10, y, def?.effectText[Math.min(t.tier, def.effectText.length - 1)] ?? '', {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[300]),
          wordWrap: { useAdvancedWrap: true, width: 272 },
          lineSpacing: 4,
        })
        .setOrigin(0, 0);
      container.add(effect);
      y += effect.height + 14;
    }
    if (inactive.length > 0) {
      y += 8;
      container.add(
        this.add.text(0, y, '未满', { fontFamily: FONT.body, fontSize: '12px', color: css(INK[300]) }).setOrigin(0, 0)
      );
      y += 24;
      for (const t of inactive) {
        const def = TRAIT_BY_ID[t.id];
        // 已超过全部断点时回退显示最后断点（此前会显示成 9/0）
        const bps = def?.breakpoints ?? [];
        const next = bps.find((b) => b > t.count) ?? bps[bps.length - 1] ?? t.count;
        container.add(
          this.add
            .text(0, y, `${def?.name ?? t.id}　${t.count}/${next}`, {
              fontFamily: FONT.body,
              fontSize: '12px',
              color: css(INK[300]),
            })
            .setOrigin(0, 0)
        );
        y += 21;
      }
    }
    return y;
  }

  // ══════════════ 坐标 ══════════════

  private cellWorld(c: number, r: number): { x: number; y: number } {
    // 棋盘层局部坐标：层内对象（棋子/特效/飘字/投射物）直接使用，
    // 层自身的位置与缩放由 boardLayer 统一承担
    return this.board.cellToXY(c, r);
  }

  private unitAnchor(uid: number): { x: number; y: number } | null {
    const v = this.views.get(uid);
    if (!v) return null;
    return { x: v.x, y: v.y - 34 };
  }

  // ══════════════ 事件 → 音画 ══════════════

  /**
   * 内核事件流的唯一渲染入口：按 BattleEvent 类型分发到视图/特效/飘字/音效。
   * 事件在 battle.step() 内同步派发，顺序即 tick 顺序 —— 快进（ff）排水时
   * 全部事件被压缩进少数几帧，本函数是唯一的顺序保证点，不重排不合并。
   */
  private onEvent(e: BattleEvent): void {
    if (this.creatingBattle) return;
    switch (e.t) {
      case 'start':
        for (const s of e.units) {
          if (this.views.has(s.uid)) continue;
          const p = this.cellWorld(s.cell.c, s.cell.r);
          const v = new UnitView(this, s.defId, s.team, s.star, p.x, p.y, this.monsterUids.has(s.uid));
          v.setDepth(30 + s.cell.r * 2);
          this.boardLayer.add(v);
          this.views.set(s.uid, v);
          v.syncBars(s.hp, s.maxHp, 0, 0, 0);
          // 召唤物登场演出：先记下星级体量，缩小后补间回去
          this.fx.play({ kind: 'summon', x: p.x, y: p.y });
          const fullScale = v.scaleX;
          v.setScale(0.2);
          this.tweens.add({ targets: v, scale: fullScale, duration: 320, ease: 'Back.easeOut' });
        }
        break;

      case 'move': {
        const v = this.views.get(e.uid);
        if (!v) break;
        const p = this.cellWorld(e.to.c, e.to.r);
        v.hopTo(p.x, p.y, e.dur);
        v.setDepth(30 + e.to.r * 2);
        break;
      }

      case 'blink': {
        const v = this.views.get(e.uid);
        if (!v) break;
        const p = this.cellWorld(e.to.c, e.to.r);
        v.blinkTo(p.x, p.y, e.dur);
        v.setDepth(30 + e.to.r * 2);
        break;
      }

      case 'attackStart': {
        const a = this.unitAnchor(e.uid);
        const t = this.unitAnchor(e.targetUid);
        const v = this.views.get(e.uid);
        if (!a || !t || !v) break;
        v.playAttack(t.x - a.x, t.y - a.y, e.windup);
        if (e.isRanged) {
          // 弹道音贴着"命中瞬间"而不是"起手瞬间"，打击感才成立
          this.after(Math.max(0, e.windup * 1000), () => {
            if (v.scene && this.running && !this.ff) audio.play('shoot');
          });
        }
        break;
      }

      case 'projectile': {
        const from = this.unitAnchor(e.uid);
        const to = this.unitAnchor(e.targetUid);
        if (!from || !to) break;
        const img = this.add
          .image(from.x, from.y, TEX.spark)
          .setTint(e.kind === 'arrow' ? MOON.light : SPIRIT.light)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(55);
        this.boardLayer.add(img); // 投射物随棋盘层缩放（坐标为层内局部）
        img.setRotation(Math.atan2(to.y - from.y, to.x - from.x));
        img.setDisplaySize(28, 5);
        this.projectiles.push({
          img,
          t: 0,
          dur: Math.max(0.08, e.dur),
          from,
          to,
          uid: e.uid,
          targetUid: e.targetUid,
        });
        break;
      }

      case 'damage': {
        const t = this.unitAnchor(e.dstUid);
        const src = this.unitAnchor(e.srcUid);
        if (!t) break;
        const view = this.views.get(e.dstUid);
        if (e.amount > 0) view?.playHit(src?.x ?? t.x, src?.y ?? t.y);

        let tier: DamageTier = 'normal';
        if (e.source === 'dot') tier = 'dot';
        else if (e.source === 'skill') tier = e.type === 'true' ? 'true' : 'skill';
        if (e.crit && e.source === 'attack') tier = 'crit';
        if (e.kill && e.amount > 0) tier = 'execute';

        if (e.amount > 0) {
          this.dmgText.spawn(t.x, t.y, e.amount, tier, e.crit ? '' : '');
          if (!this.ff) audio.play(e.crit && e.source === 'attack' ? 'crit' : 'hit');
        }
        break;
      }

      case 'heal': {
        const t = this.unitAnchor(e.dstUid);
        if (!t) break;
        this.dmgText.spawn(t.x, t.y, e.amount, 'heal', '+');
        if (!this.ff) audio.play('heal');
        break;
      }

      case 'shield': {
        if (e.amount <= 0) break;
        const t = this.unitAnchor(e.uid);
        if (!t) break;
        this.dmgText.spawn(t.x, t.y, e.amount, 'shield', '+');
        if (!this.ff) audio.play('shield');
        break;
      }

      case 'castStart': {
        const v = this.views.get(e.uid);
        if (!v) break;
        v.playCast(e.windup);
        const a = this.unitAnchor(e.uid);
        if (a) this.fx.play({ kind: 'castRing', x: a.x, y: a.y + 34 });
        if (!this.ff) audio.play('cast');
        break;
      }

      case 'cast': {
        const v = this.views.get(e.uid);
        v?.endCast();
        const u = this.battle?.unitByUid(e.uid);
        if (u && u.entry.cost >= 5) {
          audio.play('skillBig');
          this.fx.fullscreenFlash(VOID.base, 0.6);
        } else {
          audio.play('cast');
        }
        break;
      }

      case 'death': {
        const v = this.views.get(e.uid);
        if (!v) break;
        const p = { x: v.x, y: v.y - 30 };
        this.fx.play({ kind: 'burst', x: p.x, y: p.y, radius: 0.6, tint: INK[300] });
        this.burstInk(p.x, p.y);
        if (!this.ff) audio.play('death');
        v.playDeath(() => {
          if (v.scene) v.destroy();
          this.views.delete(e.uid);
        });
        break;
      }

      case 'fx': {
        let x = 0;
        let y = 0;
        let tx: number | undefined;
        let ty: number | undefined;
        if (e.uid !== undefined) {
          const a = this.unitAnchor(e.uid);
          if (!a) break;
          x = a.x;
          y = a.y;
        } else if (e.cell) {
          const p = this.cellWorld(e.cell.c, e.cell.r);
          x = p.x;
          y = p.y;
        } else break;
        if (e.targetUid !== undefined) {
          const t = this.unitAnchor(e.targetUid);
          if (t) {
            tx = t.x;
            ty = t.y;
          }
        }
        this.fx.play({ kind: e.kind, x, y, tx, ty, radius: e.radius, params: e.params });
        break;
      }

      case 'end':
        this.onBattleEnd(e.winner, e.timeout);
        break;

      default:
        break;
    }
  }

  private burstInk(x: number, y: number): void {
    const em = this.add.particles(x, y, TEX.inkDot, {
      lifespan: 780,
      speed: { min: 60, max: 220 },
      angle: { min: 0, max: 360 },
      gravityY: 320,
      scale: { start: 0.3, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [INK[300], INK[500], SHADE],
      quantity: 14,
      emitting: false,
    });
    em.setDepth(28);
    em.explode(14);
    this.trackStray(em);
    this.time.delayedCall(1000, () => {
      if (em.active) em.destroy();
    });
  }

  private onBattleEnd(winner: number | null, timeout: boolean): void {
    this.running = false;
    audio.stopBgm();
    // 胜负以观众队号为准（演示模式观众在 0 队），不能写死 1
    const won = winner !== null && winner === this.viewerTeam;
    if (winner !== null) audio.play(won ? 'victory' : 'defeat');

    // 对局模式：把结果交回 Match，然后回主场景走结算。
    // 判定发生在内核，这里只是搬运 —— 渲染层永远不改变战斗结果。
    this.finalizeRound();

    const panel = this.add.container(0, 0).setDepth(200);
    const shade = this.add.graphics();
    shade.fillStyle(SHADE, 0.62);
    shade.fillRect(0, 0, W, H);
    panel.add(shade);

    // 战报：伤害 / 承伤 / 治疗 排行。行数先取 —— 面板高、按钮位都从它推导，
    // 纵向只有一条依赖链（战报带 → 按钮顶 → 面板高）。定高 340 的旧制里
    // 按钮顶 by+278 压住末行文字底 by+280，五级战报必与「返回」相撞。
    const shown = this.buildScoreboard().slice(0, 5);
    const ROW_PITCH = 24;
    const BTN_H = 42;
    const listBottom = 166 + shown.length * ROW_PITCH; // 战报带底（ry 终值，已含一行空距）
    const btnTopRel = listBottom + 10; // 末行行箱残余下延 ~6px + 净距
    const bh = btnTopRel + BTN_H + 24; // 按钮底到面板底衬 24

    const bw = 620;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;
    const card = this.add.graphics();
    card.fillStyle(INK[800], 0.97);
    card.fillRoundedRect(bx, by, bw, bh, 12);
    card.lineStyle(2, winner === null ? INK[400] : won ? GILT.base : CINNABAR.base, 0.95);
    card.strokeRoundedRect(bx, by, bw, bh, 12);
    card.lineStyle(1, GILT.base, 0.2);
    card.strokeRoundedRect(bx + 5, by + 5, bw - 10, bh - 10, 9);
    panel.add(card);

    const titleTxt = winner === null ? '和  局' : won ? '胜' : '败';
    const title = this.add
      .text(W / 2, by + 46, titleTxt, {
        fontFamily: FONT.title,
        fontSize: '64px',
        color: winner === null ? css(PAPER[200]) : won ? css(GILT.light) : css(CINNABAR.light),
      })
      .setOrigin(0.5, 0);
    title.setShadow(0, 0, winner === null ? css(INK[300]) : won ? css(GILT.base) : css(CINNABAR.base), 26, false, true);
    panel.add(title);

    const sub = this.add
      .text(
        W / 2,
        by + 126,
        timeout
          ? '战斗超时 · 按剩余兵力裁定'
          : winner === null
            ? '双方战至力竭 · 不分胜负'
            : won
              ? '我方棋子存活'
              : '我方全军覆没',
        { fontFamily: FONT.body, fontSize: '14px', color: css(PAPER[400]) },
      )
      .setOrigin(0.5, 0);
    panel.add(sub);

    // 战报行（行距 24，最多 5 行）
    let ry = by + 166;
    for (const r of shown) {
      const t = this.add
        .text(bx + 60, ry, `${r.name}`, { fontFamily: FONT.body, fontSize: '13px', color: css(PAPER[200]) })
        .setOrigin(0, 0);
      const d = this.add
        .text(bx + 250, ry, `${Math.round(r.dmg)}`, { fontFamily: FONT.body, fontSize: '13px', color: css(CINNABAR.light) })
        .setOrigin(1, 0);
      const k = this.add
        .text(bx + 340, ry, `承 ${Math.round(r.taken)}`, { fontFamily: FONT.body, fontSize: '13px', color: css(PAPER[400]) })
        .setOrigin(1, 0);
      const h = this.add
        .text(bx + 450, ry, `治 ${Math.round(r.heal)}`, { fontFamily: FONT.body, fontSize: '13px', color: css(SPIRIT.light) })
        .setOrigin(1, 0);
      panel.add([t, d, k, h]);
      ry += ROW_PITCH;
    }

    const isMatch = !!this.matchCtx;
    const btnLabel = isMatch ? '返 回' : '再 来 一 局';
    const btn = new Button(this, W / 2 - 90, by + btnTopRel, btnLabel, () => {
      if (this.matchCtx) {
        this.returnToGame();
      } else {
        panel.destroy();
        this.restart();
      }
    }, { width: 180, height: BTN_H, variant: 'primary' });
    panel.add(btn);

    panel.setAlpha(0);
    this.tweens.add({ targets: panel, alpha: 1, duration: 320, ease: 'Quad.easeOut' });
    this.tweens.add({
      targets: title,
      scale: 1.12,
      duration: 420,
      ease: 'Back.easeOut',
    });
    this.resultPanel = panel;

    // 对局模式：3.5 秒后自动返回，不打断心流
    if (isMatch) {
      this.after(3500, () => {
        if (this.matchCtx) this.returnToGame();
      });
    }
  }

  /**
   * 回合收尾（A3）。结算（掉血、连胜连败、淘汰、快照）已由 Match.settleRound
   * 在开战时刻按配对顺序统一完成 —— 人类场结果是同一 config + 种子的无头重放，
   * 与本场景演出逐位同源。这里只推进阶段与落盘，绝不二次 applyBattleResult。
   */
  private finalizeRound(): void {
    if (!this.matchCtx) return;
    const match = this.matchCtx.match;
    match.endRound();
    saveMatch(match);
  }

  private returnToGame(): void {
    if (!this.matchCtx) return;
    const match = this.matchCtx.match;
    this.matchCtx = null;
    this.cameras.main.fadeOut(220, 7, 9, 12);
    this.time.delayedCall(240, () => {
      this.scene.start('Game', { match, resultPending: true });
    });
  }

  private buildScoreboard(): { name: string; dmg: number; taken: number; heal: number }[] {
    if (!this.battle) return [];
    return [...this.battle.units]
      .filter((u) => !u.isMinion)
      .map((u) => ({
        name: `${u.team === this.viewerTeam ? '我' : '敌'} ${u.entry.name}${'★'.repeat(u.star)}`,
        dmg: u.dealtDamage,
        taken: u.takenDamage,
        heal: u.healed,
      }))
      .sort((a, b) => b.dmg - a.dmg);
  }

  // ══════════════ 悬停详情 ══════════════

  private hoverKey = '';
  /** 悬停卡的四行数值 Text，用于悬停期间原地刷新（不重建卡片） */
  private hoverStatTexts: Phaser.GameObjects.Text[] = [];

  private updateHoverCard(px: number, py: number, cell: { c: number; r: number } | null): void {
    let key = '';
    let unit: Unit | null = null;
    if (cell && this.battle) {
      const u = this.battle.units.find((x) => x.alive && x.cell.c === cell.c && x.cell.r === cell.r);
      if (u) {
        unit = u;
        // key 不含 hp：此前掺入 Math.round(u.hp) 导致战斗中悬停卡每帧销毁重建
        key = `${u.uid}`;
      }
    }
    if (key !== this.hoverKey) {
      if (this.hoverCard) {
        this.hoverCard.destroy();
        this.hoverCard = null;
        this.hoverStatTexts = [];
      }
      this.hoverKey = key;
      if (unit) this.hoverCard = this.makeUnitCard(unit, px, py);
      return;
    }
    // 同一枚棋子：只跟随指针挪位 + 数值行实时刷新（整卡十余个文本对象，随移动重建是热路径灾难）
    if (this.hoverCard && unit) {
      this.syncHoverStats(unit);
      const x = Math.min(px + 22, W - UNIT_CARD_W - 24);
      const y = Math.min(py + 16, H - UNIT_CARD_H - 24);
      this.hoverCard.setPosition(x, y);
    }
  }

  /** 悬停期间的数值行：有效值与基础值并列，buff/debuff 实时可感（M1） */
  private syncHoverStats(u: Unit): void {
    if (this.hoverStatTexts.length !== 4) return;
    const atk = Math.round(effAtk(u));
    const armor = Math.round(effArmor(u));
    const mr = Math.round(effMr(u));
    const aspd = effAspd(u).toFixed(2);
    const atkLine = atk !== u.atk ? `攻击 ${atk}（${u.atk}）` : `攻击 ${u.atk}`;
    const armorLine = armor !== Math.round(u.baseArmor) ? `护甲 ${armor}（${Math.round(u.baseArmor)}）` : `护甲 ${Math.round(u.baseArmor)}`;
    const mrLine = mr !== Math.round(u.baseMr) ? `魔抗 ${mr}（${Math.round(u.baseMr)}）` : `魔抗 ${Math.round(u.baseMr)}`;
    const baseAspdStr = (u.baseAspd * (1 + u.permAspdPct)).toFixed(2);
    const aspdLine = aspd !== baseAspdStr ? `攻速 ${aspd}（${baseAspdStr}）` : `攻速 ${aspd}`;
    const stats = [
      `生命 ${Math.round(u.hp)} / ${u.maxHp}`,
      `${atkLine}　法强 ${Math.round(u.sp)}`,
      `${armorLine}　${mrLine}`,
      `${aspdLine}　射程 ${u.range}`,
    ];
    for (let i = 0; i < 4; i++) {
      if (this.hoverStatTexts[i].text !== stats[i]) this.hoverStatTexts[i].setText(stats[i]);
    }
  }

  private makeUnitCard(u: Unit, px: number, py: number): Phaser.GameObjects.Container {
    const e = u.entry;
    const w = UNIT_CARD_W;
    const h = UNIT_CARD_H;
    const x = Math.min(px + 22, W - w - 24);
    const y = Math.min(py + 16, H - h - 24);
    const c = this.add.container(x, y).setDepth(150);

    const g = this.add.graphics();
    g.fillStyle(INK[900], 0.96);
    g.fillRoundedRect(0, 0, w, h, 8);
    g.lineStyle(1.5, RARITY_COLOR[e.cost], 0.95);
    g.strokeRoundedRect(0, 0, w, h, 8);
    g.fillStyle(RARITY_COLOR[e.cost], 0.1);
    g.fillRoundedRect(0, 0, w, 4, 2);
    c.add(g);

    c.add(
      this.add
        .text(14, 12, `${e.name}`, { fontFamily: FONT.title, fontSize: '20px', color: css(PAPER[100]) })
        .setOrigin(0, 0),
    );
    c.add(
      this.add
        .text(14, 38, `${e.title}　${'★'.repeat(u.star)}`, { fontFamily: FONT.body, fontSize: '12px', color: css(GILT.light) })
        .setOrigin(0, 0),
    );
    c.add(
      this.add
        .text(w - 14, 14, `${e.cost} 费`, { fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[400]) })
        .setOrigin(1, 0),
    );

    {
      const atk0 = Math.round(effAtk(u));
      const armor0 = Math.round(effArmor(u));
      const mr0 = Math.round(effMr(u));
      const aspd0 = effAspd(u).toFixed(2);
      const atkLine0 = atk0 !== u.atk ? `攻击 ${atk0}（${u.atk}）` : `攻击 ${u.atk}`;
      const armorLine0 = armor0 !== Math.round(u.baseArmor) ? `护甲 ${armor0}（${Math.round(u.baseArmor)}）` : `护甲 ${Math.round(u.baseArmor)}`;
      const mrLine0 = mr0 !== Math.round(u.baseMr) ? `魔抗 ${mr0}（${Math.round(u.baseMr)}）` : `魔抗 ${Math.round(u.baseMr)}`;
      const baseAspdStr0 = (u.baseAspd * (1 + u.permAspdPct)).toFixed(2);
      const aspdLine0 = aspd0 !== baseAspdStr0 ? `攻速 ${aspd0}（${baseAspdStr0}）` : `攻速 ${aspd0}`;
      const stats0 = [
        `生命 ${Math.round(u.hp)} / ${u.maxHp}`,
        `${atkLine0}　法强 ${Math.round(u.sp)}`,
        `${armorLine0}　${mrLine0}`,
        `${aspdLine0}　射程 ${u.range}`,
      ];
      stats0.forEach((s, i) => {
        const t = this.add
          .text(14, 62 + i * 18, s, { fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[300]) })
          .setOrigin(0, 0);
        c.add(t);
        this.hoverStatTexts.push(t);
      });
    }

    const sk = e.skillSpec;
    c.add(
      this.add
        .text(14, 134, `${sk.name}`, { fontFamily: FONT.title, fontSize: '14px', color: css(VOID.light) })
        .setOrigin(0, 0),
    );
    const desc = this.add
      .text(14, 152, formatSkillDesc(sk.desc, sk.params), {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(PAPER[400]),
        wordWrap: { useAdvancedWrap: true, width: w - 28 },
      })
      .setOrigin(0, 0);
    // 技能描述钳在两行内：宁可省略号收尾，不许溢出卡底
    while (desc.height > 30 && desc.text.length > 4) {
      desc.setText(desc.text.slice(0, -2).trimEnd() + '…');
    }
    c.add(desc);
    return c;
  }

  // ══════════════ 主循环 ══════════════

  override update(_time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);

    // 1) 推进战斗（固定步长，与渲染帧率解耦）。
    //    快进中 240× 排水 + 步数上限放开到 400：每帧 ≥4 个模拟秒，
    //    40s 封顶的战斗在数帧内到达终局；事件仍按 tick 序同步派发。
    if (this.battle && this.running && !this.paused) {
      this.acc += this.ff ? Math.min(0.05, 1 / 60) * 240 : dt * this.speed;
      const cap = this.ff ? 400 : 8;
      let steps = 0;
      while (this.acc >= DT && steps < cap) {
        this.battle.step();
        this.acc -= DT;
        steps++;
        if (this.battle.finished) {
          this.running = false;
          break;
        }
      }
    }

    // 2) 单位表现：以内核单位为遍历主体，避免 O(n²) 反查
    if (this.battle) {
      for (const u of this.battle.units) {
        const v = this.views.get(u.uid);
        if (!v) continue;
        v.update(dt);
        this.syncUnitBars(v, u);
      }
    }

    // 3) 弹道
    this.updateProjectiles(dt);

    // 4) 屏幕震动（按特效累计强度分级，不做无差别抖动）。
    //    边沿触发：此前 fx.shake>0 期间每帧重调 shake() 会不断重置震动计时，
    //    表现为持续微抖 —— 只在强度从无到有的那一刻触发一次。
    const shake = motion.calm ? 0 : this.fx.shake;
    if (shake > 0 && this.lastShake <= 0) {
      this.cameras.main.shake(Math.min(320, 90 + shake * 90), Math.min(0.012, 0.0022 * shake));
    }
    this.lastShake = shake;

    // 5) HUD
    if (this.battle) {
      const label = `${(this.battle.tick / 30).toFixed(1)}"`;
      if (label !== this.timerText.text) this.timerText.setText(label);
    }
  }

  private syncUnitBars(v: UnitView, u: Unit): void {
    // 三值打包成单个数字比较（hp/shield ≤ 9999、mp ≤ 999，各占 14bit 足够），
    // 避免每帧每单位拼模板串 —— 22 单位 × 60fps 的纯 GC 噪声。
    // 注意：必须用乘法打包而非位移 —— `hp << 28` 走 32 位截断，
    // 只留低 4 位，血条会永远判不出变化（曾经整个冻住）。
    const key = (Math.round(u.hp) * 16384 + Math.round(u.shield)) * 1024 + Math.round(u.mp);
    const prev = this.lastBars.get(u.uid);
    if (prev !== key) {
      this.lastBars.set(u.uid, key);
      v.syncBars(u.hp, u.maxHp, u.shield, u.mp, u.maxMp);
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      p.img.x = Phaser.Math.Linear(p.from.x, p.to.x, k);
      p.img.y = Phaser.Math.Linear(p.from.y, p.to.y, k);
      if (k >= 1) {
        p.img.destroy();
        this.projectiles.splice(i, 1);
      }
    }
  }
}

export const SCENE_W = W;
export const SCENE_H = H;
export const SCENE_BOARD_CELL = CELL;
export const SCENE_PAPER = PAPER;
