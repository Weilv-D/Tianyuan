/** 职责：羁绊成员卡 —— 点击左轨徽章钉住，列出该羁绊全部棋子（拥有态金框 + 档位进展）。
 *  悬停效果笺（SceneRefresh.showRailPopup）保持只读效果；本卡承接"点一下看差哪口、缺哪个子"。 */
import Phaser from 'phaser';
import { CHAMPIONS } from '../../data/champions';
import { TRAIT_BY_ID } from '../../data/traits';
import { FONT } from '../../ui/kit';
import { UnitPortrait } from '../../ui/cards';
import { traitIconKey } from '../board/traitIcons';
import { GILT, INK, PAPER, TRAIT_TIER_COLOR_HEX, css } from '../view/palette';
import {
  TRAIT_MEMBER_GRID_X,
  TRAIT_MEMBER_GRID_Y,
  TRAIT_MEMBER_HEAD_H,
  TRAIT_MEMBER_SIZE,
  TRAIT_MEMBER_X,
  traitMemberCardH,
  traitMemberCardW,
  traitMemberCell,
  traitMemberClampY,
} from '../view/hudLayout';
import type { GameScene } from '../scenes/GameScene';

export class TraitMembersCard {
  private card: Phaser.GameObjects.Container | null = null;
  private cardH = 0;
  private id: string | null = null;
  /** 头部计数（syncFromMatch 原位刷字用） */
  private countT: Phaser.GameObjects.Text | null = null;
  private members: { p: UnitPortrait; owned: boolean }[] = [];

  constructor(private scene: GameScene) {
    // 容器随场景销毁；模块字段若还指着死引用，isOpen 会骗过输入守卫 —— 一并复位
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.close());
  }

  get isOpen(): boolean {
    return this.card !== null;
  }

  get traitId(): string | null {
    return this.id;
  }

  /** 点同徽章收起、点另一徽章切换。badgeWorldY 是所点徽章行的**世界** y
   *  （= RAIL_Y + 行局部 y，SceneRefresh 经 railBadgeWorldY 传入）—— 卡沿其钳位，
   *  滚动后仍贴所点徽章 */
  toggle(id: string, badgeWorldY: number): void {
    if (this.id === id) this.close();
    else this.open(id, badgeWorldY);
  }

  /** 点空白/ESC/开战/开羁绊全览时关闭 */
  close(): void {
    this.card?.destroy();
    this.card = null;
    this.cardH = 0;
    this.id = null;
    this.countT = null;
    this.members = [];
  }

  /** 世界坐标是否落在卡体内（输入层判"点卡外关卡"用） */
  containsPoint(x: number, y: number): boolean {
    if (!this.card) return false;
    const w = traitMemberCardW();
    return x >= this.card.x && x <= this.card.x + w && y >= this.card.y && y <= this.card.y + this.cardH;
  }

  /** 轨重建后同步：该族已不上阵（棋子全卖）→ 收卡；否则原位刷新计数与拥有态 */
  syncFromMatch(): void {
    if (!this.isOpen || !this.id) return;
    const human = this.scene.match.human;
    const act = this.scene.match.traitsOf(human.board).find((t) => t.id === this.id);
    if (!act || act.count <= 0) {
      this.close();
      return;
    }
    const def = TRAIT_BY_ID[this.id];
    const total = this.members.length;
    if (!def) {
      this.close();
      return;
    }
    const active = act.tier >= 0;
    this.countT?.setText(`已上阵 ${act.count} / 全 ${total}`);
    this.countT?.setColor(css(active ? GILT.light : PAPER[300]));
    // 头像金框/压暗随拥有态原位刷新（卖子/买子后不重建卡）
    const owned = ownedDefIds(human.board, human.bench);
    for (const m of this.members) {
      const now = owned.has(m.p.current?.defId ?? '');
      if (now !== m.owned) {
        m.owned = now;
        m.p.setHighlight(now);
        m.p.setAlpha(now ? 1 : 0.5);
      }
    }
  }

  private open(id: string, badgeWorldY: number): void {
    const def = TRAIT_BY_ID[id];
    if (!def) return;
    this.close();
    const human = this.scene.match.human;
    const act = this.scene.match.traitsOf(human.board).find((t) => t.id === id);
    const count = act?.count ?? 0;
    const tier = act?.tier ?? -1;
    const active = tier >= 0 && count > 0;
    const tierColor = active ? TRAIT_TIER_COLOR_HEX[Math.min(tier, 3)] : INK[400];

    // 全量反查：任一棋子的 origins/classes 命中即属族（与 computeTraits 同口径）
    const roster = CHAMPIONS.filter((c) => c.origins.includes(id) || c.classes.includes(id)).sort(
      (a, b) => a.cost - b.cost || a.id.localeCompare(b.id)
    );
    const total = roster.length;
    const cardW = traitMemberCardW();
    this.cardH = traitMemberCardH(total);
    const py = traitMemberClampY(badgeWorldY, this.cardH);
    const c = this.scene.add.container(TRAIT_MEMBER_X, py).setDepth(520);

    // 底板沿悬停笺语言：墨底 + 金发丝 + 档位色左缘
    const g = this.scene.add.graphics();
    g.fillStyle(INK[900], 0.97);
    g.fillRect(0, 0, cardW, this.cardH);
    g.lineStyle(1, GILT.base, 0.4);
    g.strokeRect(0, 0, cardW, this.cardH);
    g.lineStyle(1.5, tierColor, 0.8);
    g.fillRect(0, 0, 2.5, this.cardH);
    c.add(g);

    // 头部：小篆徽章 + 族名 + 已上阵计数
    const icon = this.scene.add.image(16, (TRAIT_MEMBER_HEAD_H - 40) / 2, traitIconKey(id, active ? Math.min(tier, 3) : 0));
    icon.setDisplaySize(40, 40);
    c.add(icon);
    const nameT = this.scene.add
      .text(68, 8, def.name, {
        fontFamily: FONT.title,
        fontSize: '18px',
        color: css(active ? tierColor : PAPER[200]),
        letterSpacing: 3,
      })
      .setOrigin(0, 0);
    c.add(nameT);
    this.countT = this.scene.add
      .text(cardW - 16, TRAIT_MEMBER_HEAD_H / 2, `已上阵 ${count} / 全 ${total}`, {
        fontFamily: FONT.mono,
        fontSize: '13px',
        color: css(active ? GILT.light : PAPER[300]),
      })
      .setOrigin(1, 0.5);
    c.add(this.countT);
    // 族名过长（未知族）与右侧计数重叠风险：预算按卡宽余量截断
    if (nameT.width > cardW - 16 - 180) nameT.setText(clip(nameT.text, Math.floor((cardW - 16 - 180) / 19)));

    // 成员网格：拥有（场上/备战席任一处）金框高亮，未拥有压暗
    const grid = this.scene.add.container(TRAIT_MEMBER_GRID_X, TRAIT_MEMBER_GRID_Y);
    const owned = ownedDefIds(human.board, human.bench);
    roster.forEach((m, i) => {
      const cell = traitMemberCell(i);
      const p = new UnitPortrait(this.scene, cell.x, cell.y, TRAIT_MEMBER_SIZE);
      p.setUnit({ defId: m.id, star: 1, items: [], iid: -1 });
      const have = owned.has(m.id);
      if (have) p.setHighlight(true);
      else p.setAlpha(0.5);
      this.members.push({ p, owned: have });
      grid.add(p);
    });
    c.add(grid);

    this.card = c;
    this.id = id;
  }
}

/** 场上 + 备战席的去重 defId 集合（"拥有"口径；羁绊计数只算场上，此处只做高亮不做计数） */
function ownedDefIds(
  board: readonly (import('../../game/state').UnitInstance | null)[],
  bench: readonly (import('../../game/state').UnitInstance | null)[]
): Set<string> {
  const s = new Set<string>();
  for (const u of [...board, ...bench]) if (u) s.add(u.defId);
  return s;
}

/** 12px 全角标题字宽 ≈19px/字；超出预算截断加省略号（保留完整族名属数据的完整性，仅展示截断） */
function clip(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(1, maxChars - 1)) + '…';
}
