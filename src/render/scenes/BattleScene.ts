import Phaser from 'phaser';
import { Battle } from '../../core/battle';
import { DT } from '../../core/config';
import type { BattleEvent } from '../../core/events';
import { effArmor, effAspd, effAtk, effMr } from '../../core/unit';
import { CHAMPION_BY_ID, formatSkillDesc } from '../../data/champions';
import { TRAIT_BY_ID } from '../../data/traits';
import { SHADE, TRAIT_TIER_COLOR_HEX, CINNABAR, GILT, INK, MOON, PAPER, RARITY_COLOR, SPIRIT, VOID, css } from '../palette';
import { buildTextures, grainOverlay, TEX } from '../textures';
import { bakeSilhouettes } from '../silhouetteFactory';
import { BOARD_H, BOARD_W, BoardView, CELL } from '../BoardView';
import { UnitView, setFriendlyTeam } from '../UnitView';
import { bakeItemIcons } from '../itemIcons';
import { baseZoom } from '../viewScale';
import { EffectsLayer } from '../EffectsLayer';
import { DamageTextLayer, type DamageTier } from '../DamageText';
import { motion } from '../motion';
import { audio } from '../../audio/AudioEngine';
import { Button, enableScroll, FONT, makeChip, makePanel, type ScrollHandle } from '../../ui/kit';
import { PRESET_COMPS, buildTeam, type CompSpec } from '../../game/comp';
import type { Match, Pairing } from '../../game/match';
import { saveMatch } from '../../game/save';
import type { Unit } from '../../core/unit';
import type { ActiveTrait, BattleConfig } from '../../core/types';

const W = 1920;
const H = 1080;
const BOARD_X = (W - BOARD_W) / 2;
/** 悬停单位卡尺寸（updateHoverCard 与 makeUnitCard 共用）；高度容纳两行技能描述 */
const UNIT_CARD_W = 268;
const UNIT_CARD_H = 184;
const BOARD_Y = 176;

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
  private fx!: EffectsLayer;
  private dmgText!: DamageTextLayer;
  private views = new Map<number, UnitView>();
  private battle: Battle | null = null;

  private acc = 0;
  private speed = 1;
  private paused = false;
  private running = false;
  private seed = 20260829;

  private compA: CompSpec = PRESET_COMPS[1];
  private compB: CompSpec = PRESET_COMPS[0];

  /**
   * 对局模式：由 GameScene 传入正在进行的对局与本场配对。
   * 为空则是 M1 的"阵容对拍"演示模式。
   */
  private matchCtx: { match: Match; pair: Pairing } | null = null;
  /** 本场战斗的内核输入原样快照（M4 回放），settleMatch 时随结果入库 */
  private battleConfig: BattleConfig | null = null;
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

  constructor() {
    super({ key: 'Battle' });
  }

  init(data: { match?: Match; pair?: Pairing }): void {
    this.matchCtx = data.match && data.pair ? { match: data.match, pair: data.pair } : null;
  }

  create(): void {
    baseZoom(this);
    buildTextures(this);
    bakeSilhouettes(this);
    bakeItemIcons(this);
    grainOverlay(this);

    // Scene 实例被复用，上次进入场景时登记的按钮引用必须清掉，否则会越积越多
    this.speedBtns = [];

    // 背景：夜色山海由 index.html 的 #bg 承担（透明画布），此处不再铺底

    this.board = new BoardView(this, BOARD_X, BOARD_Y);
    this.fx = new EffectsLayer(this);
    this.dmgText = new DamageTextLayer(this);

    this.buildTopBar();
    this.buildSidePanels();
    this.buildBottomBar();

    // 交互：悬停查看棋子详情
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const local = { x: p.x - BOARD_X, y: p.y - BOARD_Y };
      const cell = this.board.xyToCell(local.x, local.y);
      this.board.setHover(cell);
      this.updateHoverCard(p.x, p.y, cell);
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
    const y = BOARD_Y + BOARD_H + 24;
    const pw = BOARD_W + 80;
    const px = BOARD_X - 40;
    makePanel(this, px, y, pw, 76, { alpha: 0.85 });

    const mk = (label: string, x: number, w: number, onClick: () => void, variant: 'primary' | 'ghost' = 'ghost') => {
      const b = new Button(this, px + x, y + 20, label, onClick, { width: w, height: 36, variant });
      this.add.existing(b);
      return b;
    };

    if (this.matchCtx) {
      // 对局模式：只保留观战相关控制，避免玩家误触把对局重开
      mk('暂 停', 24, 96, () => this.togglePause());
      mk('快进到底', 132, 116, () => this.setSpeed(4));
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
    this.speedBtns.forEach((b, i) => {
      const on = [1, 2, 4][i] === s;
      b.setDisabled(false);
      b.setText(`${[1, 2, 4][i]}×`);
      b.setAlpha(on ? 1 : 0.55);
    });
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
    this.battleConfig = cfg;
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

    // 生成可视对象
    for (const u of this.battle.units) {
      const p = this.cellWorld(u.cell.c, u.cell.r);
      const v = new UnitView(this, u.entry.id, u.team, u.star, p.x, p.y, this.monsterUids.has(u.uid));
      v.setDepth(30 + u.cell.r * 2);
      v.setItems(u.itemIds);
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
    this.board.setPhase('prep');
    this.phaseText.setText('备 战');
    this.phaseText.setColor(css(SPIRIT.light));

    audio.unlock();
    audio.startBgm('prep');

    // 准备阶段：给玩家 1.6 秒读阵，再开打
    this.time.delayedCall(1600, () => {
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
    for (const v of this.views.values()) {
      if (v.scene) v.destroy();
    }
    this.views.clear();
    this.dmgText.clear();
    this.fx.clear();
    for (const p of this.projectiles) p.img.destroy();
    this.projectiles = [];
    this.lastBars.clear();
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
        wordWrap: { width: 280 },
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
        .text(72, y + 3, who, { fontFamily: FONT.body, fontSize: '12px', color: css(accent) })
        .setOrigin(0, 0)
    );
    y += 28;

    const active = traits.filter((t) => t.tier >= 0).sort((a, b) => b.tier - a.tier);
    const inactive = traits.filter((t) => t.tier < 0);

    if (active.length === 0) {
      container.add(
        this.add.text(0, y, '（未激活任何羁绊）', { fontFamily: FONT.body, fontSize: '12px', color: css(INK[300]) }).setOrigin(0, 0)
      );
      y += 24;
    }
    for (const t of active) {
      const def = TRAIT_BY_ID[t.id];
      const color = TRAIT_TIER_COLOR_HEX[Math.min(t.tier, 3)];
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
      y += 26;
      // 效果文字独立成行：不与 chip 同行挤，宽度收在面板内容区内
      const effect = this.add
        .text(8, y, def?.effectText[Math.min(t.tier, def.effectText.length - 1)] ?? '', {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[300]),
          wordWrap: { width: 280 },
          lineSpacing: 3,
        })
        .setOrigin(0, 0);
      container.add(effect);
      y += effect.height + 10;
    }
    if (inactive.length > 0) {
      y += 6;
      container.add(
        this.add.text(0, y, '未满', { fontFamily: FONT.body, fontSize: '12px', color: css(INK[300]) }).setOrigin(0, 0)
      );
      y += 20;
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
        y += 18;
      }
    }
    return y;
  }

  // ══════════════ 坐标 ══════════════

  private cellWorld(c: number, r: number): { x: number; y: number } {
    const p = this.board.cellToXY(c, r);
    return { x: BOARD_X + p.x, y: BOARD_Y + p.y };
  }

  private unitAnchor(uid: number): { x: number; y: number } | null {
    const v = this.views.get(uid);
    if (!v) return null;
    return { x: v.x, y: v.y - 34 };
  }

  // ══════════════ 事件 → 音画 ══════════════

  private onEvent(e: BattleEvent): void {
    if (this.creatingBattle) return;
    switch (e.t) {
      case 'start':
        for (const s of e.units) {
          if (this.views.has(s.uid)) continue;
          const p = this.cellWorld(s.cell.c, s.cell.r);
          const v = new UnitView(this, s.defId, s.team, s.star, p.x, p.y, this.monsterUids.has(s.uid));
          v.setDepth(30 + s.cell.r * 2);
          this.views.set(s.uid, v);
          v.syncBars(s.hp, s.maxHp, 0, 0, 0);
          // 召唤物登场演出
          this.fx.play({ kind: 'summon', x: p.x, y: p.y });
          v.setScale(0.2);
          this.tweens.add({ targets: v, scale: v.scaleX, duration: 320, ease: 'Back.easeOut' });
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
          this.time.delayedCall(Math.max(0, e.windup * 1000), () => {
            if (v.scene && this.running) audio.play('shoot');
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
          audio.play(e.crit && e.source === 'attack' ? 'crit' : 'hit');
        }
        break;
      }

      case 'heal': {
        const t = this.unitAnchor(e.dstUid);
        if (!t) break;
        this.dmgText.spawn(t.x, t.y, e.amount, 'heal', '+');
        audio.play('heal');
        break;
      }

      case 'shield': {
        if (e.amount <= 0) break;
        const t = this.unitAnchor(e.uid);
        if (!t) break;
        this.dmgText.spawn(t.x, t.y, e.amount, 'shield', '+');
        audio.play('shield');
        break;
      }

      case 'castStart': {
        const v = this.views.get(e.uid);
        if (!v) break;
        v.playCast(e.windup);
        const a = this.unitAnchor(e.uid);
        if (a) this.fx.play({ kind: 'castRing', x: a.x, y: a.y + 34 });
        audio.play('cast');
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
        audio.play('death');
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
    this.time.delayedCall(1000, () => em.destroy());
  }

  private onBattleEnd(winner: number | null, timeout: boolean): void {
    this.running = false;
    audio.stopBgm();
    audio.play(winner === 1 ? 'victory' : 'defeat');

    // 对局模式：把结果交回 Match，然后回主场景走结算。
    // 判定发生在内核，这里只是搬运 —— 渲染层永远不改变战斗结果。
    this.settleMatch();

    const panel = this.add.container(0, 0).setDepth(200);
    const shade = this.add.graphics();
    shade.fillStyle(SHADE, 0.62);
    shade.fillRect(0, 0, W, H);
    panel.add(shade);

    const bw = 620;
    const bh = 340;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;
    const card = this.add.graphics();
    card.fillStyle(INK[800], 0.97);
    card.fillRoundedRect(bx, by, bw, bh, 12);
    card.lineStyle(2, winner === 1 ? GILT.base : CINNABAR.base, 0.95);
    card.strokeRoundedRect(bx, by, bw, bh, 12);
    card.lineStyle(1, GILT.base, 0.2);
    card.strokeRoundedRect(bx + 5, by + 5, bw - 10, bh - 10, 9);
    panel.add(card);

    const titleTxt = winner === null ? '和  局' : winner === 1 ? '胜' : '败';
    const title = this.add
      .text(W / 2, by + 46, titleTxt, {
        fontFamily: FONT.title,
        fontSize: '64px',
        color: winner === 1 ? css(GILT.light) : winner === null ? css(PAPER[200]) : css(CINNABAR.light),
      })
      .setOrigin(0.5, 0);
    title.setShadow(0, 0, winner === 1 ? css(GILT.base) : css(CINNABAR.base), 26, false, true);
    panel.add(title);

    const sub = this.add
      .text(
        W / 2,
        by + 126,
        timeout ? '战斗超时 · 按剩余兵力裁定' : winner === 1 ? '我方棋子存活' : '我方全军覆没',
        { fontFamily: FONT.body, fontSize: '14px', color: css(PAPER[400]) },
      )
      .setOrigin(0.5, 0);
    panel.add(sub);

    // 战报：伤害 / 承伤 / 治疗 排行
    const rows = this.buildScoreboard();
    let ry = by + 166;
    for (const r of rows.slice(0, 5)) {
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
      ry += 24;
    }

    const isMatch = !!this.matchCtx;
    const btnLabel = isMatch ? '返 回' : '再 来 一 局';
    const btn = new Button(this, W / 2 - 90, by + bh - 62, btnLabel, () => {
      if (this.matchCtx) {
        this.returnToGame();
      } else {
        panel.destroy();
        this.restart();
      }
    }, { width: 180, height: 42, variant: 'primary' });
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
      this.time.delayedCall(3500, () => {
        if (this.matchCtx) this.returnToGame();
      });
    }
  }

  /** 把本场结果写回对局（掉血、连胜连败、淘汰判定） */
  private settleMatch(): void {
    if (!this.matchCtx || !this.battle?.result) return;
    const { match, pair } = this.matchCtx;
    // 人类战场的回放快照：config 与内核输入逐字节同源；渲染战斗不录事件流，
    // digest 走 '' 口径（verifyReplay 届时只比 winner/ticks）。
    match.battleSnapshots.push({
      round: match.round,
      config: this.battleConfig ?? this.matchCtx.match.buildBattleConfig(pair, pair.swap),
      winner: this.battle.result.winner as 0 | 1 | null,
      ticks: this.battle.result.ticks,
      eventsDigest: '',
    });
    match.applyBattleResult(pair, this.battle.result);
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
        name: `${u.team === 1 ? '我' : '敌'} ${u.entry.name}${'★'.repeat(u.star)}`,
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
        wordWrap: { width: w - 28 },
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

    // 1) 推进战斗（固定步长，与渲染帧率解耦）
    if (this.battle && this.running && !this.paused) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= DT && steps < 8) {
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
    // 避免每帧每单位拼模板串 —— 22 单位 × 60fps 的纯 GC 噪声
    const key = (Math.round(u.hp) << 28) | (Math.round(u.shield) << 14) | Math.round(u.mp);
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
