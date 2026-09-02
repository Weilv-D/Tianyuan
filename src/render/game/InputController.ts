/** 职责：指针/键盘输入的绑定与派发——命中检测、棋子与装备拖拽、落点高亮、悬停详情卡等输入细节。 */
import Phaser from 'phaser';
import { CHAMPION_BY_ID } from '../../data/champions';
import { combine } from '../../data/items';
import { canPlace, moveToSlot, sellValue, validPlacements, type UnitInstance } from '../../game/state';
import { audio } from '../../audio/AudioEngine';
import { ItemTooltip } from '../../ui/tooltip';
import { UnitPortrait, UnitDetailCard } from '../../ui/cards';
import { itemIconKey } from '../board/itemIcons';
import { GILT, CINNABAR } from '../view/palette';
import { screenToWorld } from '../view/viewScale';
import { hitItemChip, hitSource, hitTarget, hitUnitItemSlot } from './hitTest';
import {
  BENCH_CELL,
  BENCH_X,
  BENCH_Y,
  CELL,
  DETAIL_H,
  DETAIL_W,
  GRID_X,
  GRID_Y,
  HALF_ROWS,
  W,
  H,
} from '../view/layout';
import type { GameScene } from '../scenes/GameScene';

/** 轻点 vs 拖拽的位移阈值（世界 px）：低于此位移松手视为点选 */
const CLICK_DRAG_THRESHOLD = 8;

/**
 * 输入控制器（原 GameScene.bindInput/hitSource/hitTarget/hitItemChip/hitUnitItemSlot/
 * beginItemDrag/endItemDrag/beginDrag/updateDragTarget/endDrag/clearHover/updateHover 原样搬移）。
 * 输入注册顺序与处理器内部 return 顺序保持原样；对局动作经场景公共方法回调。
 *
 * v1.10 手感升级：
 * - 按下不再立即拖拽：位移 ≥8px 才升级为拖拽，轻点 = 选中棋子（金框呼吸 + 详情卡钉住）；
 *   已选中时点目标空格落子，点另一枚棋子改选，点空处/同格取消。
 * - 拖起时一次算清全部可放置落点并淡金衬底（与拖拽位置无关，松手清除）。
 * - 商肆 1-5 / 小键盘 1-5 直购。
 * - 拖组件悬停到器匣另一组件上 → 预览 A + B → C。
 */
export class InputController {
  // 拖拽
  private dragUnit: UnitInstance | null = null;
  private dragFrom: { where: 'board' | 'bench'; slot: number } | null = null;
  private dragGhost: UnitPortrait | null = null;
  /** 正在拖拽的装备（从装备栏拖向棋子；拖向器匣另一组件 = 直接合成） */
  private dragItemId: string | null = null;
  private dragItemFrom = -1;
  private dragItemGhost: Phaser.GameObjects.Image | null = null;

  // 点选落子
  private pendingUnit: { where: 'board' | 'bench'; slot: number; unit: UnitInstance; x: number; y: number } | null = null;
  /** 当前选中的棋子（金框呼吸；点目标空格落子） */
  private selectedSlot: { where: 'board' | 'bench'; slot: number } | null = null;
  private selectionG: Phaser.GameObjects.Graphics | null = null;
  private selectionTween: Phaser.Tweens.Tween | null = null;
  /** 选中态钉住的详情卡内容键（与悬停体系的 hoverKey 分开，避免相互重建） */
  private pinnedKey = '';
  /** 拖起时预显的可放置落点衬底 */
  private validG: Phaser.GameObjects.Graphics | null = null;

  // 悬停详情
  private hoverKey = '';
  private detailCard: UnitDetailCard | null = null;
  itemTip!: ItemTooltip;

  constructor(private scene: GameScene) {}

  /** 棋子或装备拖拽进行中（多点触控/快捷键守卫共用） */
  private get dragging(): boolean {
    return this.dragGhost !== null || this.dragItemGhost !== null;
  }

  /** 全屏浮层（设置/调试/羁绊全览/侦查）是否打开 —— 键盘快捷键的统一让路口径 */
  private overlayOpen(): boolean {
    const s = this.scene;
    return !!(s.settingsPanel?.isOpen || s.debug.isOpen || s.hud.traitModalOpen || s.pauseScout.scoutPanel);
  }

  /** 页面隐藏：中止拖拽/点选（稳定引用，供 game.events 注册/摘除） */
  private onGameHidden = (): void => {
    this.pendingUnit = null;
    this.clearSelection();
    this.clearValid();
    if (this.dragGhost) this.endDrag(0, 0);
    if (this.dragItemGhost) {
      this.dragItemGhost.destroy();
      this.dragItemGhost = null;
      this.dragItemId = null;
      this.dragItemFrom = -1;
    }
  };

  /** create() 时与原场景字段复位一一对应（itemTip 重建、detailCard/拖拽状态/悬停键清空） */
  resetForCreate(): void {
    this.itemTip = new ItemTooltip(this.scene);
    this.detailCard = null;
    this.hoverKey = '';
    this.pendingUnit = null;
    this.selectedSlot = null;
    this.pinnedKey = '';
    this.selectionTween?.remove();
    this.selectionTween = null;
    this.selectionG = null; // 上一局的 Graphics 已随场景销毁
    this.validG = null;
    if (this.dragGhost) {
      this.dragGhost.destroy();
      this.dragGhost = null;
    }
    this.dragUnit = null;
    this.dragFrom = null;
    this.dragItemId = null;
    this.dragItemFrom = -1;
    if (this.dragItemGhost) {
      this.dragItemGhost.destroy();
      this.dragItemGhost = null;
    }
  }

  /** 清除点选态（拖起/动作/开战时调用） */
  clearSelection(): void {
    this.selectionTween?.remove();
    this.selectionTween = null;
    this.selectedSlot = null;
    this.pinnedKey = '';
    if (this.selectionG && this.selectionG.active) this.selectionG.clear();
    this.detailCard?.container.setVisible(false);
  }

  // ══════════════ 输入 ══════════════

  /** 画布像素 → 世界坐标。指针事件里的 p.x/y 是 1920K×1080K 画布空间，
   *  而命中检测 / ghost / 提示卡全部活在 1920×1080 世界系（A1）。 */
  private worldOf(p: Phaser.Input.Pointer): { x: number; y: number } {
    return screenToWorld(p.x, p.y, this.scene.cameras.main.zoom);
  }

  bindInput(): void {
    this.scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      audio.unlock();
      if (this.scene.phase !== 'prep' || this.scene.busy) return;
      const { x, y } = this.worldOf(p);
      // 已有拖拽进行中（多点触控的第二指）：不透传，避免覆盖状态泄漏旧 ghost
      if (this.dragGhost || this.dragItemGhost) return;
      // 点在奇遇面板上：卡片自己响应，不透传成棋盘/备战席的拖拽
      if (this.scene.adventure.contains(x, y)) return;
      // 羁绊浮层开着：不透传棋盘交互（遮罩只挡对象事件，挡不住场景级 pointerdown）
      if (this.scene.hud.traitModalOpen) return;

      // 0) 卸载模式：点击棋子 → 全身装备回器匣；点空处退出
      if (this.scene.unloadMode) {
        const uw = hitSource(x, y);
        if (uw) {
          const uarr = uw.where === 'board' ? this.scene.match.human.board : this.scene.match.human.bench;
          const uu = uarr[uw.slot];
          if (uu) {
            if (uu.isBeast) this.scene.showToast('墨兽不能装装备', true);
            else this.scene.onUnequipAll(uu);
            return;
          }
        }
        this.scene.onToggleUnload();
        return;
      }

      // 1) 装备栏里的一格 → 开始拖这件装备
      const chip = hitItemChip(x, y);
      if (chip >= 0 && this.scene.itemAt(chip)) {
        this.beginItemDrag(chip, this.scene.itemAt(chip)!, x, y);
        return;
      }

      const where = hitSource(x, y);
      if (!where) return;
      const arr = where.where === 'board' ? this.scene.match.human.board : this.scene.match.human.bench;
      const unit = arr[where.slot];
      if (!unit) return;

      // 2) 点在棋子的装备图标上 → 卸下（可撤销，所以直接卸不会造成损失）
      const itemIdx = hitUnitItemSlot(x, y, where, unit.items.length);
      if (itemIdx >= 0) {
        this.scene.onUnequip(unit, unit.items[itemIdx]);
        return;
      }
      // 3) 手里有选中的装备 → 装上
      if (this.scene.selectedItem) {
        this.scene.onEquip(unit, this.scene.selectedItem);
        return;
      }
      // 4) 轻点 = 选中；按住移动过阈值才升级为拖拽（v1.10 手感）
      this.pendingUnit = { where: where.where, slot: where.slot, unit, x, y };
    });

    this.scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const { x, y } = this.worldOf(p);
      if (this.dragGhost) {
        this.dragGhost.setPosition(x - (CELL - 6) / 2, y - (CELL - 6) / 2);
        this.updateDragTarget(x, y);
        this.itemTip.hide();
        return;
      }
      if (this.dragItemGhost) {
        // 此前装备 ghost 从不跟随指针（只有棋子 ghost 跟随），拖装备时图标停在按下处
        this.dragItemGhost.setPosition(x, y);
        if (this.dragItemId) {
          // P2 合成预览：悬停到器匣另一占位组件且可合成 → 预告成品
          const chip = hitItemChip(x, y);
          const other = chip >= 0 && chip !== this.dragItemFrom ? this.scene.itemAt(chip) : null;
          const out = other && this.dragItemId ? combine(this.dragItemId, other) : null;
          if (out) this.itemTip.showCombine(this.dragItemId, other!, x, y);
          else this.itemTip.show(this.dragItemId, x, y);
        }
        return;
      }
      if (this.pendingUnit) {
        // 按住未松：位移过阈值才升级为拖拽（轻点 = 选中，不产生 ghost）
        if (
          Math.abs(x - this.pendingUnit.x) >= CLICK_DRAG_THRESHOLD ||
          Math.abs(y - this.pendingUnit.y) >= CLICK_DRAG_THRESHOLD
        ) {
          const p0 = this.pendingUnit;
          this.pendingUnit = null;
          this.beginDrag(p0.where, p0.slot, p0.unit, x, y);
        }
        return;
      }
      this.updateHover(x, y);
    });

    this.scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const { x, y } = this.worldOf(p);
      if (this.dragItemGhost) {
        this.endItemDrag(x, y);
        return;
      }
      if (this.dragGhost) this.endDrag(x, y);
      else if (this.pendingUnit) this.handleClick(x, y);
    });
    // L31：画布外释放兜底（Phaser pointerupoutside / gameout）
    this.scene.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => {
      const { x, y } = this.worldOf(p);
      this.pendingUnit = null; // 画布外松手：取消这次点选
      if (this.dragItemGhost) this.endItemDrag(x, y);
      else if (this.dragGhost) this.endDrag(x, y);
    });
    // 页面隐藏时中止拖拽。用稳定引用注册并在 SHUTDOWN 摘除 ——
    // game.events 是全局总线，不会随场景关闭自动清理，匿名 once 会逐轮累积
    this.scene.game.events.on('hidden', this.onGameHidden);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scene.game.events.off('hidden', this.onGameHidden);
    });

    // 快捷键。E/Z 在拖拽进行中必须让路：autoArrange/undo 会整体重排
    // board/bench 数组，endDrag 持有的 from 槽位与残影高亮随即失效。
    // 浮层（设置/调试/羁绊全览/侦查）打开时同样让路 —— 键盘不经命中检测，
    // 指针层的"不透传"拦不住按键，必须逐键手工拦截（口径与商肆热键一致）
    this.scene.input.keyboard?.on('keydown-D', () => {
      if (!this.overlayOpen()) this.scene.onReroll();
    });
    this.scene.input.keyboard?.on('keydown-F', () => {
      if (!this.overlayOpen()) this.scene.onBuyXp();
    });
    this.scene.input.keyboard?.on('keydown-E', () => {
      if (this.dragging || this.overlayOpen()) return;
      this.scene.onAutoArrange();
    });
    this.scene.input.keyboard?.on('keydown-SPACE', () => {
      if (this.scene.phase === 'prep' && !this.overlayOpen()) this.scene.startBattlePhase();
    });
    this.scene.input.keyboard?.on('keydown-Z', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !this.dragging && !this.overlayOpen()) this.scene.onUndo();
    });
    // 商肆快捷键：1-5 直购（含小键盘），与 ShopCard 角标对应
    const shopHotkeys: [string, number][] = [
      ['keydown-ONE', 0], ['keydown-TWO', 1], ['keydown-THREE', 2], ['keydown-FOUR', 3], ['keydown-FIVE', 4],
      ['keydown-NUMPAD_ONE', 0], ['keydown-NUMPAD_TWO', 1], ['keydown-NUMPAD_THREE', 2], ['keydown-NUMPAD_FOUR', 3], ['keydown-NUMPAD_FIVE', 4],
    ];
    for (const [name, i] of shopHotkeys) {
      this.scene.input.keyboard?.on(name, () => {
        if (this.scene.phase !== 'prep' || this.scene.busy) return;
        if (this.overlayOpen()) return;
        this.scene.onBuy(i);
      });
    }
    // ESC 统一分发：设置 → 调试 → 羁绊 → 侦查 → 暂停，一次只关一层
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
  // 纯函数实现见 ./hitTest.ts（A1 抽取，供测试直接调用）；hitTarget 的
  // 出售印矩形取 HudPanels 的 sellRect 同一实例，几何单一真源在 layout.ts。

  // ══════════════ 点选落子 ══════════════

  /** 目标槽位上的棋子（board/bench 同源） */
  private unitAt(t: { where: 'board' | 'bench'; slot: number }): UnitInstance | null {
    const arr = t.where === 'board' ? this.scene.match.human.board : this.scene.match.human.bench;
    return arr[t.slot] ?? null;
  }

  /** 轻点语义：选中/取消/改选/点目标空格落子（与拖拽共用同一条落子路径） */
  private handleClick(x: number, y: number): void {
    const p = this.pendingUnit;
    this.pendingUnit = null;
    if (!p) return;
    if (this.scene.phase !== 'prep' || this.scene.busy) return;
    const t = hitTarget(x, y, this.scene.hud.sellRect);
    const tg: { where: 'board' | 'bench'; slot: number } | null =
      t && t.where !== 'sell' ? { where: t.where, slot: t.slot } : null;
    const self = !!tg && tg.where === p.where && tg.slot === p.slot;
    const onUnit = !!tg && !!this.unitAt(tg);

    // 点中棋子：已选中同格 → 取消；点另一枚 → 改选它（点选不用于交换，交换走拖拽）
    if (self || onUnit) {
      if (
        self &&
        this.selectedSlot &&
        this.selectedSlot.where === p.where &&
        this.selectedSlot.slot === p.slot
      ) {
        this.clearSelection();
      } else if (tg) {
        this.selectSlot(tg.where, tg.slot);
      } else {
        this.clearSelection();
      }
      return;
    }

    // 有选中且点在空格上 → 落子（canPlace 拒绝时给原因，不静默）
    if (this.selectedSlot && tg && !onUnit) {
      const sel = this.selectedSlot;
      const arr = sel.where === 'board' ? this.scene.match.human.board : this.scene.match.human.bench;
      const u = arr[sel.slot];
      if (u) {
        const check = canPlace(this.scene.match.human, u.iid, tg.where, tg.slot);
        if (check.ok && !(tg.where === sel.where && tg.slot === sel.slot)) {
          this.scene.pushUndo('移动');
          moveToSlot(this.scene.match.human, u.iid, tg.where, tg.slot);
          audio.play('ui');
          this.scene.afterAction(); // 内部钩子清选中
          return;
        }
        if (!check.ok) {
          this.scene.showToast(check.reason ?? '不能放在这里', true);
          audio.play('warn');
          return;
        }
      }
    }

    // 其余（点空处/不可放处/出售印）：取消选中
    this.clearSelection();
  }

  /** 选中一枚棋子：金框呼吸 + 详情卡钉住 */
  private selectSlot(where: 'board' | 'bench', slot: number): void {
    this.selectionTween?.remove();
    this.selectionTween = null;
    this.selectedSlot = { where, slot };
    if (!this.selectionG || !this.selectionG.active) this.selectionG = this.scene.add.graphics().setDepth(295);
    const size = where === 'board' ? CELL : BENCH_CELL;
    const ox = where === 'board' ? GRID_X + (slot % 8) * CELL : BENCH_X + slot * BENCH_CELL;
    const oy = where === 'board' ? GRID_Y + (Math.floor(slot / 8) + HALF_ROWS) * CELL : BENCH_Y;
    const g = this.selectionG;
    const draw = (a: number) => {
      g.clear();
      g.lineStyle(2, GILT.light, a);
      g.strokeRect(ox + 1, oy + 1, size - 2, size - 2);
      g.fillStyle(GILT.base, 0.08 * a);
      g.fillRect(ox + 1, oy + 1, size - 2, size - 2);
    };
    draw(1);
    this.selectionTween = this.scene.tweens.addCounter({
      from: 0.55,
      to: 1,
      duration: 760,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: (tw) => draw(tw.getValue() ?? 1),
    });
    this.showPinnedDetail(where, slot);
    audio.play('ui');
  }

  /** 选中棋子的详情卡钉在格旁；内容未变时只挪位不重建 */
  private showPinnedDetail(where: 'board' | 'bench', slot: number): void {
    const u = this.unitAt({ where, slot });
    if (!u) return;
    const key = `${where}:${slot}:${u.iid}:${u.star}`;
    const ox = where === 'board' ? GRID_X + (slot % 8) * CELL : BENCH_X + slot * BENCH_CELL;
    const oy = where === 'board' ? GRID_Y + (Math.floor(slot / 8) + HALF_ROWS) * CELL : BENCH_Y;
    const x = Math.min(ox + CELL + 12, W - DETAIL_W - 20);
    const y = Math.min(oy, H - DETAIL_H - 20);
    if (this.pinnedKey === key) {
      if (this.detailCard) this.detailCard.container.setPosition(x, y).setVisible(true);
      return;
    }
    this.pinnedKey = key;
    if (!this.detailCard) this.detailCard = new UnitDetailCard(this.scene, DETAIL_W);
    this.detailCard.update(u, DETAIL_W, DETAIL_H);
    this.detailCard.container.setPosition(x, y).setVisible(true);
  }

  // ══════════════ 装备拖拽 ══════════════

  private beginItemDrag(fromIdx: number, itemId: string, x: number, y: number): void {
    this.dragItemId = itemId;
    this.dragItemFrom = fromIdx;
    const key = itemIconKey(itemId);
    // v1.9 放大：ghost 52→64，与放大后的器匣/头顶图标同一可读口径
    this.dragItemGhost = this.scene.add.image(x, y, key).setDisplaySize(64, 64).setDepth(320).setAlpha(0.92);
    audio.play('ui');
  }

  private endItemDrag(x: number, y: number): void {
    const id = this.dragItemId;
    const fromIdx = this.dragItemFrom;
    if (this.dragItemGhost) {
      this.dragItemGhost.destroy();
      this.dragItemGhost = null;
    }
    this.dragItemId = null;
    this.dragItemFrom = -1;
    this.itemTip.hide(); // 拖拽途中的提示卡跟随的是拖拽件，落定后即失效
    // 阶段守卫：拖拽中途已开战，装备状态随之锁定，放弃这次穿戴
    if (this.scene.phase !== 'prep' || this.scene.busy) {
      this.scene.refreshAll();
      return;
    }
    // v1.9 全配方：组件拖到器匣里的另一组件上 = 原地合成（不再需要经过棋子）。
    // 落在自身格 = 原地放下，什么都不做。
    const dropChip = hitItemChip(x, y);
    if (dropChip >= 0) {
      if (dropChip !== fromIdx && id && this.scene.itemAt(dropChip)) {
        this.scene.onCombineInBar(fromIdx, dropChip);
        return;
      }
      this.scene.refreshAll();
      return;
    }
    const where = hitSource(x, y);
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
    this.clearSelection();
    // 拖起时一次算清全部可放置落点并淡金衬底（canPlace 与拖拽位置无关，
    // 41 次纯函数调用只在拖起发生一次，无每帧开销）
    this.drawValidSlots(validPlacements(this.scene.match.human, unit.iid));
    const size = where === 'board' ? CELL - 6 : BENCH_CELL - 6;
    this.dragGhost = new UnitPortrait(this.scene, x - size / 2, y - size / 2, size);
    this.dragGhost.setUnit(unit);
    this.dragGhost.setDepth(300);
    this.dragGhost.setAlpha(0.9);
    (where === 'board' ? this.scene.boardBake.boardPortraits : this.scene.boardBake.benchPortraits)[slot].setAlpha(0.3);
    audio.play('ui');
  }

  /** 有效落点预显：淡金衬底标出"这里放得下" */
  private drawValidSlots(list: { where: 'board' | 'bench'; slot: number }[]): void {
    if (!this.validG || !this.validG.active) this.validG = this.scene.add.graphics().setDepth(290);
    const g = this.validG;
    g.clear();
    for (const t of list) {
      const size = t.where === 'board' ? CELL : BENCH_CELL;
      const ox = t.where === 'board' ? GRID_X + (t.slot % 8) * CELL : BENCH_X + t.slot * BENCH_CELL;
      const oy = t.where === 'board' ? GRID_Y + (Math.floor(t.slot / 8) + HALF_ROWS) * CELL : BENCH_Y;
      g.fillStyle(GILT.base, 0.07);
      g.fillRect(ox + 1, oy + 1, size - 2, size - 2);
    }
  }

  private clearValid(): void {
    if (this.validG && this.validG.active) this.validG.clear();
  }

  /**
   * 落点反馈：允许落下的格子亮金边，不允许的亮红边。
   *
   * 底座已经烤成纹理了，所以这里只重画**一个**高亮框。
   * 原实现是每次指针移动都重画全部 32 格 + 9 槽 —— 拖拽时每帧多跑几千条命令，
   * 恰好是"拖动棋子时最需要跟手"的时刻。
   */
  private updateDragTarget(x: number, y: number): void {
    const t = hitTarget(x, y, this.scene.hud.sellRect);
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
    // 先清拖拽态再判落点：无论放哪（或根本放不了），ghost/高亮都必须消失
    if (this.dragGhost) {
      this.dragGhost.destroy();
      this.dragGhost = null;
    }
    this.dragUnit = null;
    this.dragFrom = null;
    this.scene.boardBake.boardHover.clear();
    this.clearValid();
    if (!unit || !from) return;
    (from.where === 'board' ? this.scene.boardBake.boardPortraits : this.scene.boardBake.benchPortraits)[from.slot].setAlpha(1);

    // 阶段守卫：拖拽中途已开战（配对已生成），此时落子会破坏已锁定的阵容 —— 原样放回
    if (this.scene.phase !== 'prep' || this.scene.busy) return;

    const target = hitTarget(x, y, this.scene.hud.sellRect);
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
    if (this.scene.unloadMode) {
      // 卸载模式的语境是"点棋子全身回匣"，此时弹出"这件装备效果是…"的
      // 器匣悬停卡会误导点击预期；详情卡保留（看棋子穿什么正是卸载前的自然需求）
      this.clearHover();
      this.itemTip.hide();
      return;
    }
    // 器匣装备：悬停出提示卡（名 + 效果 + 合成路径）
    const chipIdx = hitItemChip(px, py);
    const chipItem = chipIdx >= 0 ? this.scene.itemAt(chipIdx) : null;
    if (chipItem) this.itemTip.show(chipItem, px, py);
    else this.itemTip.hide();
    const hit = hitSource(px, py);
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
        this.pinnedKey = ''; // 悬停接管详情卡，钉住态让位
        if (!this.detailCard) this.detailCard = new UnitDetailCard(this.scene, DETAIL_W);
        this.detailCard.update(unit, DETAIL_W, DETAIL_H);
      } else if (this.selectedSlot) {
        // 指针在空处：保持选中棋子的详情卡常驻（点选落子语境）
        this.showPinnedDetail(this.selectedSlot.where, this.selectedSlot.slot);
      } else {
        this.detailCard?.container.setVisible(false);
      }
      return;
    }
    // 同一枚棋子：只跟随指针挪位（整卡复用，无重建）。
    // 空处（hoverKey=''）时选中卡应钉在原位，不跟随指针
    if (this.detailCard?.container.visible && (key.startsWith('board:') || key.startsWith('bench:'))) {
      const x = Math.min(px + 24, W - DETAIL_W - 20);
      const y = Math.min(py + 16, H - DETAIL_H - 20);
      this.detailCard.container.setPosition(x, y);
    }
  }
}