/** 职责：指针/键盘输入的绑定与派发——命中检测、棋子与装备拖拽、落点高亮、悬停详情卡等输入细节。 */
import Phaser from 'phaser';
import { CHAMPION_BY_ID } from '../../data/champions';
import { canPlace, moveToSlot, sellValue, type UnitInstance } from '../../game/state';
import { audio } from '../../audio/AudioEngine';
import { ItemTooltip } from '../../ui/tooltip';
import { UnitPortrait, UnitDetailCard } from '../../ui/cards';
import { itemIconKey } from '../itemIcons';
import { GILT, CINNABAR } from '../palette';
import {
  BENCH_CELL,
  BENCH_W,
  BENCH_X,
  BENCH_Y,
  CELL,
  DETAIL_H,
  DETAIL_W,
  GRID_H,
  GRID_W,
  GRID_X,
  GRID_Y,
  HALF_ROWS,
  ITEM_BAR_SLOTS,
  ITEM_BAR_X,
  ITEM_BAR_Y,
  ITEM_COLS,
  ITEM_GAP,
  ITEM_ROWS,
  ITEM_SIZE,
  W,
  H,
} from '../layout';
import type { GameScene } from '../scenes/GameScene';

/**
 * 输入控制器（原 GameScene.bindInput/hitSource/hitTarget/hitItemChip/hitUnitItemSlot/
 * beginItemDrag/endItemDrag/beginDrag/updateDragTarget/endDrag/clearHover/updateHover 原样搬移）。
 * 输入注册顺序与处理器内部 return 顺序保持原样；对局动作经场景公共方法回调。
 */
export class InputController {
  // 拖拽
  private dragUnit: UnitInstance | null = null;
  private dragFrom: { where: 'board' | 'bench'; slot: number } | null = null;
  private dragGhost: UnitPortrait | null = null;
  /** 正在拖拽的装备（从装备栏拖向棋子） */
  private dragItemId: string | null = null;
  private dragItemGhost: Phaser.GameObjects.Image | null = null;

  // 悬停详情
  private hoverKey = '';
  private detailCard: UnitDetailCard | null = null;
  itemTip!: ItemTooltip;

  constructor(private scene: GameScene) {}

  /** create() 时与原场景字段复位一一对应（itemTip 重建、detailCard/拖拽状态/悬停键清空） */
  resetForCreate(): void {
    this.itemTip = new ItemTooltip(this.scene);
    this.detailCard = null;
    this.hoverKey = '';
    this.dragGhost = null;
    this.dragUnit = null;
    this.dragFrom = null;
  }

  // ══════════════ 输入 ══════════════

  bindInput(): void {
    this.scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      audio.unlock();
      if (this.scene.phase !== 'prep' || this.scene.busy) return;
      // 点在奇遇面板上：卡片自己响应，不透传成棋盘/备战席的拖拽
      if (this.scene.adventure.contains(p.x, p.y)) return;
      // 羁绊浮层开着：不透传棋盘交互（遮罩只挡对象事件，挡不住场景级 pointerdown）
      if (this.scene.hud.traitModalOpen) return;

      // 1) 装备栏里的一格 → 开始拖这件装备
      const chip = this.hitItemChip(p.x, p.y);
      if (chip >= 0 && this.scene.itemAt(chip)) {
        this.beginItemDrag(this.scene.itemAt(chip)!, p.x, p.y);
        return;
      }

      const where = this.hitSource(p.x, p.y);
      if (!where) return;
      const arr = where.where === 'board' ? this.scene.match.human.board : this.scene.match.human.bench;
      const unit = arr[where.slot];
      if (!unit) return;

      // 2) 点在棋子的装备图标上 → 卸下（可撤销，所以直接卸不会造成损失）
      const itemIdx = this.hitUnitItemSlot(p.x, p.y, where, unit);
      if (itemIdx >= 0) {
        this.scene.onUnequip(unit, unit.items[itemIdx]);
        return;
      }
      // 3) 手里有选中的装备 → 装上
      if (this.scene.selectedItem) {
        this.scene.onEquip(unit, this.scene.selectedItem);
        return;
      }
      // 4) 否则拖这个棋子
      this.beginDrag(where.where, where.slot, unit, p.x, p.y);
    });

    this.scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.dragGhost) {
        this.dragGhost.setPosition(p.x - (CELL - 6) / 2, p.y - (CELL - 6) / 2);
        this.updateDragTarget(p.x, p.y);
        this.itemTip.hide();
        return;
      }
      if (this.dragItemGhost) {
        // 此前装备 ghost 从不跟随指针（只有棋子 ghost 跟随），拖装备时图标停在按下处
        this.dragItemGhost.setPosition(p.x, p.y);
        if (this.dragItemId) this.itemTip.show(this.dragItemId, p.x, p.y);
        return;
      }
      this.updateHover(p.x, p.y);
    });

    this.scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.dragItemGhost) {
        this.endItemDrag(p.x, p.y);
        return;
      }
      if (this.dragGhost) this.endDrag(p.x, p.y);
    });

    // 快捷键
    this.scene.input.keyboard?.on('keydown-D', () => this.scene.onReroll());
    this.scene.input.keyboard?.on('keydown-F', () => this.scene.onBuyXp());
    this.scene.input.keyboard?.on('keydown-E', () => this.scene.onAutoArrange());
    this.scene.input.keyboard?.on('keydown-SPACE', () => {
      if (this.scene.phase === 'prep') this.scene.startBattlePhase();
    });
    this.scene.input.keyboard?.on('keydown-Z', (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) this.scene.onUndo();
    });
    // ESC 统一分发：设置 → 调试 → 侦查 → 暂停，一次只关一层
    this.scene.input.keyboard?.on('keydown-ESC', () => {
      if (this.scene.settingsPanel?.isOpen) {
        this.scene.settingsPanel.close();
        return;
      }
      if (this.scene.debug.isOpen) {
        this.scene.debug.toggle();
        return;
      }
      if (this.scene.hud.traitModalOpen) {
        this.scene.hud.closeTraitModal();
        return;
      }
      if (this.scene.pauseScout.scoutPanel) {
        this.scene.pauseScout.closeScout();
        return;
      }
      if (this.scene.phase === 'prep' && !this.scene.busy) this.scene.pauseScout.togglePause();
    });
  }

  // ══════════════ 命中检测 ══════════════

  private hitSource(x: number, y: number): { where: 'board' | 'bench'; slot: number } | null {
    // 大漆盘 8 行全可见，但只有下半 4 行是数据阵地（敌营在数据层没有槽位）
    if (x >= GRID_X && x < GRID_X + GRID_W && y >= GRID_Y && y < GRID_Y + GRID_H) {
      const c = Math.floor((x - GRID_X) / CELL);
      const r = Math.floor((y - GRID_Y) / CELL);
      if (r < GRID_H / CELL - HALF_ROWS) return null; // 敌营：不可放置也不可选中
      return { where: 'board', slot: (r - (GRID_H / CELL - HALF_ROWS)) * 8 + c };
    }
    if (x >= BENCH_X && x < BENCH_X + BENCH_W && y >= BENCH_Y && y < BENCH_Y + BENCH_CELL) {
      return { where: 'bench', slot: Math.floor((x - BENCH_X) / BENCH_CELL) };
    }
    return null;
  }

  private hitTarget(x: number, y: number): { where: 'board' | 'bench' | 'sell'; slot: number } | null {
    if (this.scene.hud.sellRect.contains(x, y)) return { where: 'sell', slot: 0 };
    return this.hitSource(x, y);
  }

  /** 命中了器匣（2×5 网格）的哪一格，-1 表示没命中 */
  private hitItemChip(x: number, y: number): number {
    const col = Math.floor((x - ITEM_BAR_X + ITEM_GAP / 2) / (ITEM_SIZE + ITEM_GAP));
    const row = Math.floor((y - ITEM_BAR_Y + ITEM_GAP / 2) / (ITEM_SIZE + ITEM_GAP));
    if (col < 0 || col >= ITEM_COLS || row < 0 || row >= ITEM_ROWS) return -1;
    const i = row * ITEM_COLS + col;
    if (i < 0 || i >= ITEM_BAR_SLOTS) return -1;
    // 落在格子里而不是缝隙里
    const left = ITEM_BAR_X + col * (ITEM_SIZE + ITEM_GAP);
    const top = ITEM_BAR_Y + row * (ITEM_SIZE + ITEM_GAP);
    return x >= left && x <= left + ITEM_SIZE && y >= top && y <= top + ITEM_SIZE ? i : -1;
  }

  /** 点中了棋子身上的第几件装备，-1 表示没点中 */
  private hitUnitItemSlot(
    x: number,
    y: number,
    where: { where: 'board' | 'bench'; slot: number },
    u: UnitInstance
  ): number {
    if (u.items.length === 0) return -1;
    const size = where.where === 'board' ? CELL - 6 : BENCH_CELL - 6;
    const px =
      (where.where === 'board' ? GRID_X + (where.slot % 8) * CELL : BENCH_X + where.slot * BENCH_CELL) + 3;
    const py =
      (where.where === 'board' ? GRID_Y + (Math.floor(where.slot / 8) + HALF_ROWS) * CELL : BENCH_Y) + 3;
    const isz = Math.max(11, Math.round(size * 0.17));
    const gap = 2;
    for (let i = 0; i < Math.min(3, u.items.length); i++) {
      const ix = px + 4 + i * (isz + gap);
      if (x >= ix && x <= ix + isz && y >= py + 5 && y <= py + 5 + isz) return i;
    }
    return -1;
  }

  // ══════════════ 装备拖拽 ══════════════

  private beginItemDrag(itemId: string, x: number, y: number): void {
    this.dragItemId = itemId;
    const key = itemIconKey(itemId);
    this.dragItemGhost = this.scene.add.image(x, y, key).setDisplaySize(46, 46).setDepth(320).setAlpha(0.92);
    audio.play('ui');
  }

  private endItemDrag(x: number, y: number): void {
    const id = this.dragItemId;
    if (this.dragItemGhost) {
      this.dragItemGhost.destroy();
      this.dragItemGhost = null;
    }
    this.dragItemId = null;
    const where = this.hitSource(x, y);
    if (!id || !where) {
      this.scene.refreshAll();
      return;
    }
    const arr = where.where === 'board' ? this.scene.match.human.board : this.scene.match.human.bench;
    const unit = arr[where.slot];
    if (!unit) {
      this.scene.refreshAll();
      return;
    }
    this.scene.onEquip(unit, id);
  }

  // ══════════════ 棋子拖拽 ══════════════

  private beginDrag(where: 'board' | 'bench', slot: number, unit: UnitInstance, x: number, y: number): void {
    this.dragUnit = unit;
    this.dragFrom = { where, slot };
    const size = where === 'board' ? CELL - 6 : BENCH_CELL - 6;
    this.dragGhost = new UnitPortrait(this.scene, x - size / 2, y - size / 2, size);
    this.dragGhost.setUnit(unit);
    this.dragGhost.setDepth(300);
    this.dragGhost.setAlpha(0.9);
    (where === 'board' ? this.scene.boardBake.boardPortraits : this.scene.boardBake.benchPortraits)[slot].setAlpha(0.3);
    audio.play('ui');
  }

  /**
   * 落点反馈：允许落下的格子亮金边，不允许的亮红边。
   *
   * 底座已经烤成纹理了，所以这里只重画**一个**高亮框。
   * 原实现是每次指针移动都重画全部 32 格 + 9 槽 —— 拖拽时每帧多跑几千条命令，
   * 恰好是"拖动棋子时最需要跟手"的时刻。
   */
  private updateDragTarget(x: number, y: number): void {
    const t = this.hitTarget(x, y);
    this.scene.boardBake.boardHover.clear();
    if (!t || t.where === 'sell' || !this.dragUnit) return;
    const check = canPlace(this.scene.match.human, this.dragUnit.iid, t.where, t.slot);
    const col = check.ok ? GILT.light : CINNABAR.base;
    const size = t.where === 'board' ? CELL : BENCH_CELL;
    const ox = t.where === 'board' ? GRID_X + (t.slot % 8) * CELL : BENCH_X + t.slot * BENCH_CELL;
    const oy = t.where === 'board' ? GRID_Y + (Math.floor(t.slot / 8) + HALF_ROWS) * CELL : BENCH_Y;
    this.scene.boardBake.boardHover.setPosition(ox, oy);
    this.scene.boardBake.boardHover.lineStyle(2, col, 0.9);
    this.scene.boardBake.boardHover.strokeRect(1, 1, size - 2, size - 2);
    this.scene.boardBake.boardHover.fillStyle(col, 0.1);
    this.scene.boardBake.boardHover.fillRect(1, 1, size - 2, size - 2);
  }

  private endDrag(x: number, y: number): void {
    const unit = this.dragUnit;
    const from = this.dragFrom;
    const target = this.hitTarget(x, y);
    if (this.dragGhost) {
      this.dragGhost.destroy();
      this.dragGhost = null;
    }
    this.dragUnit = null;
    this.dragFrom = null;
    this.scene.boardBake.boardHover.clear();
    if (!unit || !from) return;
    (from.where === 'board' ? this.scene.boardBake.boardPortraits : this.scene.boardBake.benchPortraits)[from.slot].setAlpha(1);

    if (!target) return;

    if (target.where === 'sell') {
      this.scene.pushUndo('卖出');
      const gain = sellValue(unit);
      if (this.scene.match.sell(this.scene.match.human, unit.iid)) {
        audio.play('coin');
        this.scene.showToast(`卖出 ${CHAMPION_BY_ID[unit.defId]?.name ?? ''}，返还 ${gain} 金`);
      }
    } else {
      const check = canPlace(this.scene.match.human, unit.iid, target.where, target.slot);
      if (!check.ok) {
        this.scene.showToast(check.reason ?? '不能放在这里', true);
        audio.play('warn');
      } else if (target.where === from.where && target.slot === from.slot) {
        // 原地放下，什么都不做
      } else {
        this.scene.pushUndo('移动');
        moveToSlot(this.scene.match.human, unit.iid, target.where, target.slot);
        audio.play('ui');
      }
    }
    this.scene.afterAction();
  }

  // ══════════════ 悬停详情 ══════════════

  private clearHover(): void {
    // 复用式详情卡：隐藏而非销毁，下一次悬停只做 setText / 换贴图
    this.detailCard?.container.setVisible(false);
    this.hoverKey = '';
  }

  private updateHover(px: number, py: number): void {
    if (this.scene.pauseScout.scoutPanel || this.scene.settingsPanel?.isOpen || this.scene.hud.traitModalOpen) {
      this.clearHover();
      this.itemTip.hide();
      return;
    }
    // 指针在奇遇面板上：不透过面板去高亮/详情其下的棋子
    if (this.scene.adventure.contains(px, py)) {
      this.clearHover();
      this.itemTip.hide();
      return;
    }
    if (this.dragGhost) {
      this.clearHover();
      this.itemTip.hide();
      return;
    }
    // 器匣装备：悬停出提示卡（名 + 效果 + 合成路径）
    const chipIdx = this.hitItemChip(px, py);
    const chipItem = chipIdx >= 0 ? this.scene.itemAt(chipIdx) : null;
    if (chipItem) this.itemTip.show(chipItem, px, py);
    else this.itemTip.hide();
    const hit = this.hitSource(px, py);
    let key = '';
    let unit: UnitInstance | null = null;
    if (hit) {
      const arr = hit.where === 'board' ? this.scene.match.human.board : this.scene.match.human.bench;
      const u = arr[hit.slot];
      if (u) {
        unit = u;
        key = `${hit.where}:${hit.slot}:${u.iid}:${u.star}`;
      }
    }
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      if (unit) {
        if (!this.detailCard) this.detailCard = new UnitDetailCard(this.scene, DETAIL_W);
        this.detailCard.update(unit, DETAIL_W, DETAIL_H);
      } else {
        this.detailCard?.container.setVisible(false);
      }
      return;
    }
    // 同一枚棋子：只跟随指针挪位（整卡复用，无重建）
    if (this.detailCard?.container.visible) {
      const x = Math.min(px + 24, W - DETAIL_W - 20);
      const y = Math.min(py + 16, H - DETAIL_H - 20);
      this.detailCard.container.setPosition(x, y);
    }
  }
}
