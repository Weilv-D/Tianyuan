/** 职责：把 Match 状态增量刷到 HUD——签名守卫下的棋盘/备战席/器匣/商店/顶栏/羁绊/计分板/记事/战报刷新。 */
import Phaser from 'phaser';
import { MAX_LEVEL, PLAYER_START_HP, REROLL_COST, XP_BUY_COST, XP_BUY_AMOUNT } from '../../core/config';
import { CHAMPION_BY_ID } from '../../data/champions';
import { TRAIT_BY_ID } from '../../data/traits';
import { boardCap, boardCount } from '../../game/state';
import { interestOf, streakGold, xpToNext } from '../../game/economy';
import { Bar, FONT, setTextIf } from '../../ui/kit';
import { TraitRow } from '../../ui/cards';
import { bakedTexture } from '../bake';
import { INK, GILT, CINNABAR, SPIRIT, MOON, VOID, PAPER, TRAIT_TIER_COLOR_HEX, css } from '../palette';
import { ITEM_BAR_SLOTS, LEFT_W } from '../layout';
import type { GameScene } from '../scenes/GameScene';

/**
 * 全量刷新家族（原 GameScene.refreshAll/refreshItems/refreshTraits/refreshScoreboard/
 * refreshLog/refreshReport 原样搬移）。
 * 签名守卫状态（boardCellsReady 等）随本模块按局重建，等价于原 create() 里的复位；
 * 奇遇面板的刷新委托 scene.adventure.refresh()，仍保持在 refreshAll 尾部。
 */
export class SceneRefresh {
  /** 烘焙底座只画一次：格子纹理在场景生命周期内不变，重复 setTexture 是无谓开销 */
  private boardCellsReady = false;
  private benchSlotsReady = false;
  private traitSig = '';
  private scoreSig = '';
  private logSig = -1;
  private lastReportSig = '\u0000';

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
    // 装备栏
    this.refreshItems();
    // 商店
    for (let i = 0; i < 5; i++) {
      const id = p.shop[i];
      this.scene.hud.shopCards[i].setDef(id);
      this.scene.hud.shopCards[i].setAffordable(!id || p.gold >= (CHAMPION_BY_ID[id]?.cost ?? 0));
    }

    // 顶栏（setText 会整段重新栅格化，全部走变化守卫）
    setTextIf(this.scene.hud.roundText, `第 ${this.scene.match.round} 回合`);
    const isBeast = this.scene.match.isBeastRound();
    setTextIf(
      this.scene.hud.phaseText,
      this.scene.phase === 'prep'
        ? isBeast
          ? '准 备 · 墨 兽 轮'
          : '准 备'
        : this.scene.phase === 'battle'
          ? '交 战'
          : '终 局'
    );
    this.scene.hud.phaseText.setColor(css(isBeast ? VOID.light : SPIRIT.light));

    // 状态
    this.scene.hud.hpBar.setValue(p.hp / PLAYER_START_HP);
    setTextIf(this.scene.hud.hpText, `生命 ${p.hp}`);
    setTextIf(this.scene.hud.goldText, `${p.gold}`);
    const inc = 5 + interestOf(p.gold) + streakGold(p.streak);
    setTextIf(
      this.scene.hud.streakText,
      `下回合收入 ${inc} 金（息 ${interestOf(p.gold)} · 连${p.streak >= 0 ? '胜' : '败'} ${Math.abs(p.streak)}）`
    );
    setTextIf(this.scene.hud.levelText, `等级 ${p.level}`);
    const need = xpToNext(p.level);
    if (need > 0) {
      this.scene.hud.xpBar.setValue(p.xp / need);
      setTextIf(this.scene.hud.xpText, `经验 ${p.xp}/${need}　升级 ${XP_BUY_COST} 金 → ${XP_BUY_AMOUNT} 经验`);
    } else {
      this.scene.hud.xpBar.setValue(1);
      setTextIf(this.scene.hud.xpText, '已达最高等级');
    }
    setTextIf(this.scene.hud.boardCountText, `场上 ${boardCount(p)}/${boardCap(p)}`);

    // 按钮可用性
    this.scene.hud.rerollBtn.setDisabled(p.gold < REROLL_COST);
    this.scene.hud.levelBtn.setDisabled(p.gold < XP_BUY_COST || p.level >= MAX_LEVEL);
    this.scene.hud.undoBtn.setDisabled(this.scene.undoStack.length === 0);
    this.scene.hud.lockBtn.setText(p.shopLocked ? '已锁定 ✓' : '锁定商店');
    this.scene.hud.lockBtn.setAlpha(p.shopLocked ? 1 : 0.75);

    // 面板
    this.refreshTraits();
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
    this.scene.hud.itemHint.setText(
      n === 0
        ? '墨兽轮掉落器件　·　拖到棋子上装备'
        : `${n} 件待装　·　拖到棋子上即可装备`
    );
  }

  private refreshTraits(): void {
    const p = this.scene.match.human;
    const traits = this.scene.match.traitsOf(p.board);
    // 签名守卫：羁绊面板整表重建（9 行 × 5 对象），只在羁绊真的变了时发生
    const sig = traits.map((t) => `${t.id}:${t.count}:${t.tier}`).join('|');
    if (sig === this.traitSig) return;
    this.traitSig = sig;
    this.scene.hud.traitContainer.removeAll(true);
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

    let y = 0;
    // 不再截断到 9 行：面板带滚动遮罩，排序已把最相关的行放最前
    for (const s of scored) {
      if (!s.def) continue;
      const color = s.t.tier >= 0 ? TRAIT_TIER_COLOR_HEX[Math.min(s.t.tier, 3)] : INK[500];
      const desc = s.t.tier >= 0 ? s.def.effectText[Math.min(s.t.tier, s.def.effectText.length - 1)] : s.def.description;
      const row = new TraitRow(this.scene, 0, y, LEFT_W - 32);
      row.set(s.t.id, s.t.count, s.t.tier, s.nextBreak, color, desc);
      this.scene.hud.traitContainer.add(row);
      y += row.rowHeight + 4; // 行高自适应：两行描述不会压到下一行
    }
    if (scored.length === 0) {
      this.scene.hud.traitContainer.add(
        this.scene.add
          .text(0, 8, '上阵后此处点亮羁绊', {
            fontFamily: FONT.body,
            fontSize: '13px',
            color: css(PAPER[400]),
            wordWrap: { width: LEFT_W - 32 },
          })
          .setOrigin(0, 0)
      );
    }
    this.scene.hud.traitScroll?.setHeight(y);
  }

  private refreshScoreboard(): void {
    const order = this.scene.match.standings();
    // 签名守卫：8 行整表重建只在血量/等级/连胜/生死/配对变化时发生
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

      // 行底板按（宽 × 身份）烘焙：己方金框 / 对手朱框 / 普通三种
      const kind = isHuman ? 'h' : isOpponent ? 'o' : 'n';
      const rowKey = `srow_${LEFT_W - 32}_${kind}`;
      bakedTexture(this.scene, rowKey, LEFT_W - 32, 36, (g) => {
        g.fillStyle(isHuman ? INK[650] : INK[800], isHuman ? 0.95 : 0.7);
        g.fillRoundedRect(0, 0, LEFT_W - 32, 36, 6);
        if (isHuman) {
          g.lineStyle(1.5, GILT.base, 0.8);
          g.strokeRoundedRect(0, 0, LEFT_W - 32, 36, 6);
        } else if (isOpponent) {
          g.lineStyle(1.5, CINNABAR.base, 0.75);
          g.strokeRoundedRect(0, 0, LEFT_W - 32, 36, 6);
        }
      });
      row.add(this.scene.add.image(0, 0, rowKey).setOrigin(0));

      const rankTxt = p.alive ? `${p.hp}` : `第${p.rank}名`;
      const rank = this.scene.add
        .text(10, 18, rankTxt, {
          fontFamily: FONT.body,
          fontSize: p.alive ? '14px' : '12px',
          color: p.alive ? css(PAPER[100]) : css(PAPER[500]),
        })
        .setOrigin(0, 0.5);
      row.add(rank);

      const name = this.scene.add
        .text(58, 18, p.name, {
          fontFamily: FONT.body,
          fontSize: '13px',
          color: p.alive ? css(PAPER[100]) : css(PAPER[500]),
        })
        .setOrigin(0, 0.5);
      row.add(name);

      // 血条
      const bar = new Bar(this.scene, 200, 14, 150, 8, p.idx === 0 ? SPIRIT.base : CINNABAR.base);
      bar.setValue(p.hp / PLAYER_START_HP, false);
      row.add(bar);

      const lv = this.scene.add
        .text(362, 18, `Lv${p.level}`, { fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[400]) })
        .setOrigin(0, 0.5);
      row.add(lv);

      const streak =
        p.streak >= 2
          ? `连胜 ${p.streak}`
          : p.streak <= -2
            ? `连败 ${-p.streak}`
            : '';
      if (streak) {
        row.add(
          this.scene.add
            .text(408, 18, streak, {
              fontFamily: FONT.body,
              fontSize: '12px',
              color: css(p.streak > 0 ? SPIRIT.light : MOON.base),
            })
            .setOrigin(0, 0.5)
        );
      }
      if (!p.alive) row.setAlpha(0.5);
      // 点击他人行 → 侦查其阵地（只读快照）
      if (!isHuman && p.alive) {
        row.setInteractive(new Phaser.Geom.Rectangle(0, 0, LEFT_W - 32, 36), Phaser.Geom.Rectangle.Contains);
        row.on('pointerover', () => this.scene.input.setDefaultCursor('pointer'));
        row.on('pointerout', () => this.scene.input.setDefaultCursor('default'));
        row.on('pointerdown', () => this.scene.pauseScout.showOpponentBoard(p.idx));
      }
      this.scene.hud.scoreContainer.add(row);
      y += 42;
    }

    // 本轮对手提示
    const pr = this.scene.match.pairings.find((x) => x.a === 0 || x.b === 0);
    if (pr) {
      const other = pr.a === 0 ? pr.b : pr.a;
      this.scene.hud.opponentText.setText(
        pr.beast ? '本轮对手：墨兽' : other >= 0 ? `本轮对手：${this.scene.match.players[other].name}` : pr.ghost >= 0 ? '本轮对手：墨影' : '本轮轮空'
      );
    } else {
      this.scene.hud.opponentText.setText('');
    }
  }

  private refreshLog(): void {
    if (this.scene.match.log.length === this.logSig) return;
    this.logSig = this.scene.match.log.length;
    const lines = this.scene.match.log.slice(-16);
    this.scene.hud.logText.setText(lines.length > 0 ? lines.join('\n') : '对局伊始，万象未动。');
  }

  private refreshReport(): void {
    if (this.scene.lastReport === this.lastReportSig) return;
    this.lastReportSig = this.scene.lastReport;
    this.scene.hud.reportText.setText(this.scene.lastReport || '首战未启，静候鼓角。');
  }
}
