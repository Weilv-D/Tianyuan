/** 职责：把 Match 状态增量刷到 HUD——签名守卫下的棋盘/备战席/器匣/商肆/顶栏数值/羁绊轨/敌情/诸侯/记事/战报刷新。 */
import Phaser from 'phaser';
import { MAX_LEVEL, PLAYER_START_HP, REROLL_COST, XP_BUY_COST } from '../../core/config';
import { CHAMPION_BY_ID } from '../../data/champions';
import { TRAIT_BY_ID } from '../../data/traits';
import { boardCap, boardCount } from '../../game/state';
import { interestOf, streakGold, xpToNext } from '../../game/economy';
import { Bar, FONT, clipToWidth, setTextIf } from '../../ui/kit';
import { INK, GILT, CINNABAR, SPIRIT, MOON, VOID, PAPER, TRAIT_TIER_COLOR_HEX, css } from '../view/palette';
import { ITEM_BAR_SLOTS, LOG_H, RAIL_PITCH, SIDE_W } from '../view/layout';
import { traitIconKey } from '../board/traitIcons';
import {
  REPORT_ROW,
  railBadgeHit,
  railBadgeY,
  railCountPos,
  railPopupClampY,
  railPopupLayout,
  RAIL_POPUP_W,
} from '../view/hudLayout';
import type { GameScene } from '../scenes/GameScene';

/**
 * 全量刷新家族。签名守卫状态随本模块按局重建；羁绊轨与敌情/诸侯为整表重建
 * （行数 ≤ 17 / ≤ 8，仅在签名变化时发生）。
 */
export class SceneRefresh {
  /** 烘焙底座只画一次：格子纹理在场景生命周期内不变，重复 setTexture 是无谓开销 */
  private boardCellsReady = false;
  private benchSlotsReady = false;
  private traitSig = '\u0000';
  private scoreSig = '';
  private intelSig = '';
  private logSig = -1;
  private lastReportSig = '\u0000';
  /** 羁绊悬停详情浮层（单例，随悬停重建） */
  private railPopup: Phaser.GameObjects.Container | null = null;

  constructor(private scene: GameScene) {}

  refreshAll(): void {
    const p = this.scene.match.human;

    // 棋盘
    if (!this.boardCellsReady) {
      this.scene.boardBake.drawBoardCells();
      this.boardCellsReady = true;
    }
    for (let i = 0; i < this.scene.boardBake.boardPortraits.length; i++) {
      this.scene.boardBake.boardPortraits[i].setUnit(p.board[i]);
      this.scene.boardBake.boardPortraits[i].setItems(p.board[i]?.items ?? []);
      this.scene.boardBake.boardPortraits[i].setAlpha(1);
    }
    // 备战席
    if (!this.benchSlotsReady) {
      this.scene.boardBake.drawBenchSlots();
      this.benchSlotsReady = true;
    }
    for (let i = 0; i < this.scene.boardBake.benchPortraits.length; i++) {
      this.scene.boardBake.benchPortraits[i].setUnit(p.bench[i]);
      this.scene.boardBake.benchPortraits[i].setItems(p.bench[i]?.items ?? []);
      this.scene.boardBake.benchPortraits[i].setAlpha(1);
    }
    // 器匣
    this.refreshItems();
    // 商肆。已有同名（场上/备战席任一处）→ 金框呼吸高亮：
    // "买它 = 向合成或羁绊推进"的第一眼提示
    const ownedIds = new Set<string>();
    for (const u of p.board) if (u) ownedIds.add(u.defId);
    for (const u of p.bench) if (u) ownedIds.add(u.defId);
    for (let i = 0; i < 5; i++) {
      const id = p.shop[i];
      this.scene.hud.shopCards[i].setDef(id);
      this.scene.hud.shopCards[i].setAffordable(!id || p.gold >= (CHAMPION_BY_ID[id]?.cost ?? 0));
      this.scene.hud.shopCards[i].setOwned(!!id && ownedIds.has(id));
    }

    // ── 顶栏（mono 数值口径；setText 走变化守卫） ──
    setTextIf(this.scene.hud.roundText, `${this.scene.match.round}`);
    const isBeast = this.scene.match.isBeastRound();
    setTextIf(
      this.scene.hud.phaseText,
      this.scene.phase === 'prep'
        ? isBeast
          ? '备 战 · 墨 兽 轮'
          : '备 战'
        : this.scene.phase === 'battle'
          ? '交 战'
          : '终 局'
    );
    // 战时转朱砂（样稿 .war）；墨兽轮保留夜蓝
    this.scene.hud.phaseText.setColor(
      css(isBeast ? VOID.light : this.scene.phase === 'battle' ? CINNABAR.light : SPIRIT.light)
    );

    this.scene.hud.hpBar.setValue(p.hp / PLAYER_START_HP);
    setTextIf(this.scene.hud.hpText, `${p.hp}`);
    setTextIf(this.scene.hud.goldText, `${p.gold}`);
    const inc = 5 + interestOf(p.gold) + streakGold(p.streak);
    setTextIf(this.scene.hud.streakText, `+${inc}`);
    setTextIf(
      this.scene.hud.streakLabel,
      p.streak >= 2 ? `来 金 · 连胜 ${p.streak}` : p.streak <= -2 ? `来 金 · 连败 ${-p.streak}` : '来 金'
    );
    setTextIf(this.scene.hud.levelText, `${p.level}`);
    const need = xpToNext(p.level);
    if (need > 0) {
      this.scene.hud.xpBar.setValue(p.xp / need);
      setTextIf(this.scene.hud.xpText, `${p.xp}/${need}`);
    } else {
      this.scene.hud.xpBar.setValue(1);
      setTextIf(this.scene.hud.xpText, '满级');
    }
    setTextIf(this.scene.hud.boardCountText, `场上 ${boardCount(p)}/${boardCap(p)}`);

    // 操作列可用性
    this.scene.hud.rerollBtn.setDisabled(p.gold < REROLL_COST);
    this.scene.hud.levelBtn.setDisabled(p.gold < XP_BUY_COST || p.level >= MAX_LEVEL);
    this.scene.hud.undoBtn.setDisabled(this.scene.undoStack.length === 0);
    this.scene.hud.lockBtn.setText(p.shopLocked ? '已锁定 ✓' : '锁定商店');
    this.scene.hud.lockBtn.setAlpha(p.shopLocked ? 1 : 0.8);

    // 面板
    this.refreshTraits();
    this.refreshIntel();
    this.refreshScoreboard();
    this.refreshLog();
    this.refreshReport();
    this.scene.adventure.refresh();
  }

  private refreshItems(): void {
    const p = this.scene.match.human;
    for (let i = 0; i < ITEM_BAR_SLOTS; i++) {
      this.scene.hud.itemChips[i].setItem(this.scene.itemAt(i));
      this.scene.hud.itemChips[i].setAlpha(this.scene.selectedItem && this.scene.selectedItem !== this.scene.itemAt(i) ? 0.55 : 1);
    }
    const n = p.items.length;
    // 全配方后组件拖组件即合成 —— 手势在提示行里带上一句，玩家不必去图鉴查谱
    this.scene.hud.itemHint.setText(n === 0 ? '' : `${n} 件待装 · 拖到棋子装配，拖到组件直接合成`);
  }

  // ══════════════ 羁绊轨（左：小篆徽章 + 计数，悬停出详情） ══════════════

  private refreshTraits(): void {
    const p = this.scene.match.human;
    const traits = this.scene.match.traitsOf(p.board);
    const sig = traits.map((t) => `${t.id}:${t.count}:${t.tier}`).join('|');
    if (sig === this.traitSig) return;
    this.traitSig = sig;
    this.scene.hud.traitContainer.removeAll(true);
    this.railPopup?.destroy();
    this.railPopup = null;

    // 激活的排前面，其次按"离下一档还差几个人"排序
    const scored = traits.map((t) => {
      const def = TRAIT_BY_ID[t.id];
      const nextBreak = def ? (def.breakpoints.find((b) => b > t.count) ?? def.breakpoints[def.breakpoints.length - 1]) : 99;
      return { t, def, nextBreak, gap: nextBreak - t.count };
    });
    scored.sort((a, b) => {
      if (b.t.tier !== a.t.tier) return b.t.tier - a.t.tier;
      return a.gap - b.gap;
    });

    // 只上轨"场上有棋子"的羁绊（count>0）；无子的族不再以灰环占位。
    // 激活的亮环按档位色排前，未成档的灰环按"离下一档差几口"紧随
    let i = 0;
    for (const s of scored) {
      if (!s.def) continue;
      const active = s.t.tier >= 0 && s.t.count > 0;
      const color = s.t.tier >= 0 && s.t.count > 0 ? TRAIT_TIER_COLOR_HEX[Math.min(s.t.tier, 3)] : INK[400];
      const badgeY = railBadgeY(i);
      const item = this.scene.add.container(0, badgeY);

      // 小篆徽章：未激活灰环灰字，激活按档位点亮金线（圈数=档位）
      const icon = this.scene.add.image(0, 0, traitIconKey(s.def.id, active ? Math.min(s.t.tier, 3) : 0));
      icon.setDisplaySize(40, 40);
      item.add(icon);

      // 计数在环右侧：圆内只留篆字，字与环永不相碰
      const cp = railCountPos();
      item.add(
        this.scene.add
          .text(cp.x, cp.y, `${s.t.count}/${s.nextBreak}`, {
            fontFamily: FONT.mono,
            fontSize: '10px',
            color: css(active ? SPIRIT.base : INK[300]),
          })
          .setOrigin(0, 0.5)
      );

      const hit = railBadgeHit();
      item.setInteractive(new Phaser.Geom.Rectangle(hit.x, hit.y, hit.w, hit.h), Phaser.Geom.Rectangle.Contains);
      item.on('pointerover', () => this.showRailPopup(s.def.id, s.t.count, s.t.tier, color, badgeY));
      item.on('pointerout', () => {
        this.railPopup?.destroy();
        this.railPopup = null;
        this.scene.input.setDefaultCursor('default');
      });
      this.scene.hud.traitContainer.add(item);
      i++;
    }
    this.scene.hud.traitScroll?.setHeight(i * RAIL_PITCH);
  }

  /** 羁绊悬停详情：轨右侧浮出小笺（名/计数/当前档效果/描述），高度按内容行数自适应 */
  private showRailPopup(id: string, count: number, tier: number, color: number, railY: number): void {
    this.railPopup?.destroy();
    const def = TRAIT_BY_ID[id];
    if (!def) return;
    const c = this.scene.add.container(0, 0).setDepth(520);
    const descLines = descLineCount(def.description, RAIL_POPUP_W - 28);
    const effect = tier >= 0 ? def.effectText[Math.min(tier, def.effectText.length - 1)] : null;
    const effectLines = effect ? descLineCount(effect, RAIL_POPUP_W - 28) : 0;
    const L = railPopupLayout(effectLines, descLines);
    const py = railPopupClampY(railY, L.h);

    const g = this.scene.add.graphics();
    g.fillStyle(INK[900], 0.97);
    g.fillRect(0, 0, L.w, L.h);
    g.lineStyle(1, GILT.base, 0.4);
    g.strokeRect(0, 0, L.w, L.h);
    g.lineStyle(1.5, color, 0.8);
    g.fillRect(0, 0, 2.5, L.h);
    c.add(g);
    c.setPosition(106, py);

    c.add(
      this.scene.add
        .text(14, 12, def.name, { fontFamily: FONT.title, fontSize: '14px', color: css(PAPER[100]), letterSpacing: 2 })
        .setOrigin(0, 0)
    );
    c.add(
      this.scene.add
        .text(L.w - 14, 14, `${count}/${def.breakpoints[def.breakpoints.length - 1]}`, {
          fontFamily: FONT.mono,
          fontSize: '12px',
          color: css(GILT.base),
        })
        .setOrigin(1, 0)
    );
    if (effect) {
      c.add(
        this.scene.add
          .text(14, L.effectY, effect, {
            fontFamily: FONT.body,
            fontSize: '12px',
            color: css(color),
            wordWrap: { useAdvancedWrap: true, width: L.w - 28 },
          })
          .setOrigin(0, 0)
      );
    }
    c.add(
      this.scene.add
        .text(14, L.descY, def.description, {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[300]),
          wordWrap: { useAdvancedWrap: true, width: L.w - 28 },
          lineSpacing: 4,
        })
        .setOrigin(0, 0)
    );
    this.railPopup = c;
    this.scene.input.setDefaultCursor('pointer');
  }

  // ══════════════ 敌情（本轮对手 + 主力三员） ══════════════

  private refreshIntel(): void {
    const pr = this.scene.match.pairings.find((x) => x.a === 0 || x.b === 0);
    const other = pr ? (pr.a === 0 ? pr.b : pr.a) : -2;
    const sig = `${pr?.beast ? 'b' : other}`;
    const p = this.scene.match.human;
    const boardSig =
      other >= 0
        ? (this.scene.match.players[other].board
            .filter((u): u is NonNullable<typeof u> => !!u)
            .map((u) => `${u.defId}${u.star}`)
            .join(',') || '')
        : '';
    const full = `${sig}#${boardSig}#${p.gold}`;
    if (full === this.intelSig) return;
    this.intelSig = full;

    this.scene.hud.intelContainer.removeAll(true);
    if (!pr) {
      setTextIf(this.scene.hud.opponentText, '');
      return;
    }
    if (pr.beast) {
      setTextIf(this.scene.hud.opponentText, '墨 兽');
      this.scene.hud.intelContainer.add(
        this.scene.add.text(0, 8, '墨兽轮，无阵可侦。', {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[400]),
        })
      );
      return;
    }
    if (other < 0) {
      setTextIf(this.scene.hud.opponentText, pr.ghost >= 0 ? '墨 影' : '轮 空');
      return;
    }
    const foe = this.scene.match.players[other];
    setTextIf(this.scene.hud.opponentText, foe.name);

    const units = foe.board.filter((u): u is NonNullable<typeof u> => !!u);
    units.sort((a, b) => b.star - a.star || (CHAMPION_BY_ID[b.defId]?.cost ?? 0) - (CHAMPION_BY_ID[a.defId]?.cost ?? 0));
    units.slice(0, 3).forEach((u, i) => {
      const def = CHAMPION_BY_ID[u.defId];
      if (!def) return;
      const row = this.scene.add.container(0, i * 32);
      const hair = this.scene.add.graphics();
      hair.lineStyle(1, GILT.base, 0.12);
      hair.lineBetween(0, 26, SIDE_W, 26);
      row.add(hair);
      row.add(
        this.scene.add
          .text(0, 6, def.classes[0] ?? def.origins[0] ?? '', {
            fontFamily: FONT.body,
            fontSize: '11px',
            color: css(CINNABAR.light),
            letterSpacing: 2,
          })
          .setOrigin(0, 0)
          .setAlpha(0.9)
      );
      row.add(
        this.scene.add
          .text(SIDE_W, 2, `${def.name} ${'★'.repeat(u.star)}`, {
            fontFamily: FONT.title,
            fontSize: '13px',
            color: css(PAPER[100]),
          })
          .setOrigin(1, 0)
      );
      this.scene.hud.intelContainer.add(row);
    });
    if (units.length === 0) {
      this.scene.hud.intelContainer.add(
        this.scene.add.text(0, 8, '对手尚在整军。', {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[400]),
        })
      );
    }
  }

  // ══════════════ 八方诸侯（紧凑行：命/名/血条/级/连） ══════════════

  private refreshScoreboard(): void {
    const order = this.scene.match.standings();
    const sig =
      order.map((p) => `${p.idx}:${p.hp}:${p.level}:${p.streak}:${p.alive ? 1 : 0}:${p.rank}`).join('|') +
      '#' +
      this.scene.match.pairings.map((pr) => `${pr.a}-${pr.b}`).join(',');
    if (sig === this.scoreSig) return;
    this.scoreSig = sig;
    this.scene.hud.scoreContainer.removeAll(true);
    let y = 0;
    for (const p of order) {
      const row = this.scene.add.container(0, y);
      const isHuman = p.idx === 0;
      const isOpponent = this.scene.match.pairings.some(
        (pr) => (pr.a === 0 && pr.b === p.idx) || (pr.b === 0 && pr.a === p.idx)
      );

      // 发丝行：命值 mono · 名 · 血条 · 级 · 连胜注（列位见 hudLayout.REPORT_ROW）
      const C = REPORT_ROW;
      row.add(
        this.scene.add
          .text(C.hpX, 13, p.alive ? `${p.hp}` : `出局`, {
            fontFamily: FONT.mono,
            fontSize: `${C.hpSize}px`,
            color: p.alive ? css(PAPER[200]) : css(PAPER[500]),
          })
          .setOrigin(0, 0.5)
      );
      // 名字超预算（7 全角 × 渲染字号）时截断加省略号，绝不压血条
      const nameText = this.scene.add
        .text(C.nameX, 13, p.name, {
          fontFamily: FONT.body,
          fontSize: `${C.nameSize}px`,
          color: p.alive ? css(PAPER[100]) : css(PAPER[500]),
        })
        .setOrigin(0, 0.5);
      clipToWidth(nameText, p.name, C.nameMaxW);
      row.add(nameText);
      const bar = new Bar(this.scene, C.barX, 13, C.barW, 5, p.idx === 0 ? SPIRIT.base : CINNABAR.base);
      bar.setValue(p.hp / PLAYER_START_HP, false);
      row.add(bar);
      row.add(
        this.scene.add
          .text(C.lvX, 13, `Lv${p.level}`, { fontFamily: FONT.mono, fontSize: `${C.lvSize}px`, color: css(PAPER[400]) })
          .setOrigin(0, 0.5)
      );
      const streakTxt =
        p.streak >= 2 ? `胜${p.streak}` : p.streak <= -2 ? `败${-p.streak}` : '';
      if (streakTxt) {
        row.add(
          this.scene.add
            .text(C.streakX, 13, streakTxt, {
              fontFamily: FONT.body,
              fontSize: `${C.streakSize}px`,
              color: css(p.streak > 0 ? SPIRIT.light : MOON.base),
            })
            .setOrigin(0, 0.5)
        );
      }
      // 身份发丝线：己方金、本轮对手朱、其余墨
      const hair = this.scene.add.graphics();
      hair.lineStyle(1, isHuman ? GILT.base : isOpponent ? CINNABAR.base : INK[500], isHuman ? 0.6 : isOpponent ? 0.5 : 0.25);
      hair.lineBetween(0, 27, SIDE_W, 27);
      row.add(hair);

      if (!p.alive) row.setAlpha(0.45);
      if (!isHuman && p.alive) {
        row.setInteractive(new Phaser.Geom.Rectangle(0, -4, SIDE_W, 30), Phaser.Geom.Rectangle.Contains);
        row.on('pointerover', () => this.scene.input.setDefaultCursor('pointer'));
        row.on('pointerout', () => this.scene.input.setDefaultCursor('default'));
        row.on('pointerdown', () => this.scene.pauseScout.showOpponentBoard(p.idx));
      }
      this.scene.hud.scoreContainer.add(row);
      y += 30;
    }
  }

  private refreshLog(): void {
    if (this.scene.match.log.length === this.logSig) return;
    this.logSig = this.scene.match.log.length;
    const all = this.scene.match.log;
    if (all.length === 0) {
      this.scene.hud.logText.setText('对局开始。');
      return;
    }
    // 13 行为上限；长行折行后总高仍可能出栏——按实测高度再剥最旧行，永远收在记事栏内
    let lines = all.slice(-13);
    this.scene.hud.logText.setText(lines.join('\n'));
    while (this.scene.hud.logText.height > LOG_H - 40 && lines.length > 1) {
      lines = lines.slice(1);
      this.scene.hud.logText.setText(lines.join('\n'));
    }
  }

  private refreshReport(): void {
    if (this.scene.lastReport === this.lastReportSig) return;
    this.lastReportSig = this.scene.lastReport;
    this.scene.hud.reportText.setText(this.scene.lastReport || '首战未启。');
  }
}

/** 估算中文描述在给定宽度下的行数（12px 字，粗略 18 字/218px） */
function descLineCount(text: string, width: number): number {
  const perLine = Math.max(8, Math.floor(width / 12.2));
  return Math.max(1, Math.ceil(text.length / perLine));
}
