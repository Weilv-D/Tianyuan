import Phaser from 'phaser';
import { MAX_LEVEL } from '../../core/config';
import { CHAMPION_BY_ID } from '../../data/champions';
import { Match, type Pairing, type RoundOutcome } from '../../game/match';
import { autoArrange } from '../../game/arrange';
import { restorePlayer, snapshotPlayer, type PlayerSnapshot } from '../../game/undo';
import { findUnit, type UnitInstance } from '../../game/state';
import { autoEquip, equipItem, unequipItem, MAX_ITEMS_PER_UNIT } from '../../game/inventory';
import { ITEM_BY_ID } from '../../data/items';
import { clearSave, loadMatch, loadPrefs, saveMatch, type Preferences } from '../../game/save';
import { audio } from '../../audio/AudioEngine';
import { FONT } from '../../ui/kit';
import { baseZoom, CAM_ZOOM } from '../viewScale';
import { SettingsPanel } from '../../ui/SettingsPanel';
import { bakeItemIcons } from '../itemIcons';
import { bakeTraitIcons } from '../traitIcons';
import { buildTextures, grainOverlay } from '../textures';
import { playLegendaryStarFx } from '../LegendaryFx';
import { bakeSilhouettes } from '../silhouetteFactory';
import { INK, GILT, CINNABAR, SPIRIT, PAPER, css } from '../palette';
import { W, H } from '../layout';
import { motion } from '../motion';

// ── 渲染模块（R2 拆分）：场景只保留 create/update 主循环、场景切换与对局数据装配；
//    覆盖层/面板/输入/刷新细节全部委托 src/render/game/ 下的模块。 ──
import { HudPanels } from '../game/HudPanels';
import { BoardBake } from '../game/BoardBake';
import { SceneRefresh } from '../game/SceneRefresh';
import { AdventurePanel } from '../game/AdventurePanel';
import { PauseScoutOverlay } from '../game/PauseScoutOverlay';
import { RoundResultOverlay } from '../game/RoundResultOverlay';
import { EliminatedOverlay } from '../game/EliminatedOverlay';
import { DebugConsole } from '../game/DebugConsole';
import { InputController } from '../game/InputController';

/** 撤销栈深度上限（DESIGN §十：最多 30 步） */
const UNDO_LIMIT = 30;

interface SceneData {
  match?: Match;
  /** 战斗结束后返回：带着结果继续走结算流程 */
  resultPending?: boolean;
  /** 新开一局 */
  fresh?: boolean;
  /** 每日挑战（M4）：以当日日期哈希为种子的固定局 */
  daily?: boolean;
  /** 每日挑战的种子（MenuScene 算好注入；缺失时回退随机种子） */
  seed?: number;
}

interface UndoEntry {
  /** 动作前的完整玩家快照（含等级/经验/器匣/卡池），见 src/game/undo.ts */
  snap: PlayerSnapshot;
  label: string;
}

/**
 * 主对局场景（准备阶段）。
 *
 * 职责：把 Match 的纯数据状态翻译成可操作的界面，并把玩家操作翻译回 Match 动作。
 * 这里**不做任何战斗判定** —— 战斗一律交给内核，本场景只负责"谁打谁"和"打完怎么算"。
 *
 * R2 拆分说明：原先内联的覆盖层（回合结算/淘汰/暂停/侦查/奇遇/调试台）、
 * 面板构建（buildXxx 家族）、输入拖拽（bindInput+drag）与刷新家族（refreshAll）
 * 分别搬进 src/render/game/ 的九个模块；依赖单向（场景 → 模块，模块间互不引用）。
 * 下方标记为 public 的字段/方法是模块回调面，仅此而已。
 */
export class GameScene extends Phaser.Scene {
  // ── 模块（public：供模块经 scene.* 回调与读取）──
  /** DEV 调试台：随场景实例只建一次，开合状态跨局保持（与旧 debugPanel 字段同寿命） */
  readonly debug = new DebugConsole(this);
  /** 输入控制器：随场景实例只建一次，每局 create() 里 resetForCreate（复位集与旧代码一致） */
  readonly inputCtl = new InputController(this);
  /** 以下模块每局 create() 重建 —— 构造即复位，等价于旧 create() 的逐字段清零 */
  hud!: HudPanels;
  boardBake!: BoardBake;
  refresher!: SceneRefresh;
  adventure!: AdventurePanel;
  pauseScout!: PauseScoutOverlay;
  roundResult!: RoundResultOverlay;
  eliminated!: EliminatedOverlay;

  // ── 对局数据与流程状态（public：模块读取/守卫用）──
  match!: Match;
  phase: 'prep' | 'battle' | 'over' = 'prep';
  busy = false;
  /** 准备阶段暂停（只冻结倒计时，操作仍可用：给玩家无限思考时间） */
  paused = false;
  undoStack: UndoEntry[] = [];
  lastReport = '';
  /** 器匣里点选中的装备（点一下选中，再点棋子装上） */
  selectedItem: string | null = null;
  settingsPanel: SettingsPanel | null = null;

  // ── 场景私有 ──
  private prefs!: Preferences;
  private prepLeft = 0;
  private timerUrgent = false;
  private toast: Phaser.GameObjects.Container | null = null;
  private onBeforeUnload: (() => void) | null = null;
  private saveTimer: Phaser.Time.TimerEvent | null = null;
  /** 开战前玩家的连胜/连败值（负数为连败）—— 翻盘判定必须用战前口径 */
  private streakBefore = 0;
  /** 投降/重开后置真：阻止 SHUTDOWN 与 beforeunload 把已放弃的存档写回去 */
  private abandoned = false;

  constructor() {
    super({ key: 'Game' });
  }

  // ══════════════ 生命周期 ══════════════

  create(data: SceneData): void {
    baseZoom(this);
    buildTextures(this);
    grainOverlay(this);
    bakeSilhouettes(this);
    bakeItemIcons(this);
    bakeTraitIcons(this);

    // Phaser 复用 Scene 实例，类字段初始化只在构造函数里跑一次。
    // 场景重启（准备 → 战斗 → 准备）时这些状态还残留着上一轮的已销毁对象，
    // 不清理就会在 refreshAll 里访问到 scene === undefined 的死引用。
    // （UI 控件/签名守卫/奇遇/拖拽状态随下方模块按局重建，等价于原先的逐字段复位。）
    this.undoStack = [];
    this.toast = null;
    this.paused = false;
    this.timerUrgent = false;
    this.selectedItem = null;
    // settingsPanel 内部持有已销毁的容器：不置空则 isOpen 永真，设置面板再也打不开
    this.settingsPanel = null;
    this.abandoned = false;
    this.streakBefore = 0;
    // 战报必须跨越"战斗场景往返"（resultPending 回来时 afterBattle 要读它），
    // 只在真正开新局时清空，避免把上一局的战报带进新一局的准备阶段
    if (!data.resultPending) this.lastReport = '';
    this.hud = new HudPanels(this);
    this.boardBake = new BoardBake(this);
    this.refresher = new SceneRefresh(this);
    this.adventure = new AdventurePanel(this);
    this.pauseScout = new PauseScoutOverlay(this);
    this.roundResult = new RoundResultOverlay(this);
    this.eliminated = new EliminatedOverlay(this);

    this.prefs = loadPrefs();
    motion.calm = this.prefs.calm;
    this.inputCtl.resetForCreate();
    this.saveTimer?.remove();
    this.saveTimer = null;

    // 去抖存档的兜底：关页/切页前把排队中的存档立刻落盘，否则丢最后 600ms 的操作
    this.onBeforeUnload = () => this.flushSave();
    window.addEventListener('beforeunload', this.onBeforeUnload);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.onBeforeUnload) window.removeEventListener('beforeunload', this.onBeforeUnload);
      if (!this.match.isOver()) this.flushSave();
    });

    if (data.match) {
      this.match = data.match;
    } else if (data.daily) {
      // 每日挑战：种子由入口层注入（同一天任何时刻进入是同一局）；
      // seed 缺失时回退随机种子，normal 路径行为零变化。
      this.match = new Match(data.seed ?? ((Date.now() ^ 0x9e3779b1) >>> 0), '你', 'daily');
    } else {
      const loaded = data.fresh ? null : loadMatch();
      this.match = loaded ?? new Match((Date.now() ^ 0x9e3779b1) >>> 0);
    }
    this.match.settings.autoDeploy = this.prefs.autoDeploy;
    audio.setMuted(this.prefs.muted);
    // 恢复持久化的三条总线音量 —— 不恢复的话"听到 0.5、滑杆显示 0.2"
    audio.setVolume('bgm', this.prefs.volBgm);
    audio.setVolume('sfx', this.prefs.volSfx);
    audio.setVolume('ui', this.prefs.volUi);

    // 构建顺序与拆分前完全一致（同层深度按创建先后叠放，不可重排）
    this.hud.buildBackground();
    this.hud.buildTopBar();
    this.boardBake.buildBoard();
    this.boardBake.buildBench();
    this.hud.buildPhaseStrip();
    this.hud.buildShop();
    this.hud.buildItemBar();
    this.hud.buildActionBar();
    this.hud.buildSell();
    this.hud.buildBoardCount();
    this.hud.buildTraitRail();
    this.hud.buildIntel();
    this.hud.buildScoreboard();
    this.hud.buildLogPanel();
    this.hud.buildReportPanel();
    this.inputCtl.bindInput();

    audio.unlock();
    audio.startBgm(this.match.round >= 14 ? 'final' : 'prep');

    if (data.resultPending) {
      // 从战斗场景返回：结果已由 BattleScene 写回 Match，这里只负责展示与推进
      this.phase = 'battle';
      this.busy = true;
      this.cameras.main.fadeIn(240, 7, 9, 12);
      this.afterBattle();
    } else {
      if (this.match.round === 0) this.match.beginRound();
      this.enterPrep();
    }

    this.refreshAll();
    if (import.meta.env.DEV) {
      this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
        if (e.ctrlKey && (e.key === '`' || e.key === '~' || e.code === 'Backquote')) {
          e.preventDefault();
          this.debug.toggle();
        }
      });
    }

  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);
    if (this.phase === 'prep' && !this.busy && !this.paused) {
      this.prepLeft -= dt;
      if (this.prepLeft <= 0) {
        this.prepLeft = 0;
        this.startBattlePhase();
      }
      // setText 会触发整段文本重新栅格化 —— 只在秒数变化时更新
      const label = `${Math.ceil(this.prepLeft)}s`;
      if (label !== this.hud.timerText.text) this.hud.timerText.setText(label);
      this.hud.timerBar.setValue(this.prepLeft / Math.max(1, this.match.prepSeconds()));
      // 最后 5 秒进入"催促"状态：变色 + 心跳
      const urgent = this.prepLeft <= 5;
      if (urgent !== this.timerUrgent) {
        this.timerUrgent = urgent;
        this.hud.timerText.setColor(css(urgent ? CINNABAR.light : GILT.base));
      }
    }
  }

  // ══════════════ 器匣点选 ══════════════

  /** 装备栏第 i 格的装备 id */
  itemAt(i: number): string | null {
    return this.match.human.items[i] ?? null;
  }

  onItemChipClick(i: number): void {
    const id = this.itemAt(i);
    if (!id) return;
    // 点一下选中，再点棋子装上；拖也行。两条路都留着，
    // 因为拖拽对触屏和手抖的人并不友好，而"点选"永远不会拖错地方。
    if (this.selectedItem === id) {
      this.selectedItem = null;
    } else {
      this.selectedItem = id;
      audio.play('ui');
    }
    this.refreshAll();
  }

  // ══════════════ 装备操作 ══════════════

  onEquip(u: UnitInstance, itemId: string): void {
    this.pushUndo('装配');
    const r = equipItem(this.match.human, u.iid, itemId);
    if (!r.ok) {
      this.undoStack.pop();
      this.showToast(r.reason ?? '装不上', true);
      audio.play('warn');
    } else {
      this.selectedItem = null;
      audio.play('coin');
      if (r.combined) {
        // 合成神装是这局的高光之一，值得一次演出
        this.celebrate('item', `${ITEM_BY_ID[r.combined].name}`);
      } else {
        this.showToast(`${u.items.length}/${MAX_ITEMS_PER_UNIT} 件`);
      }
    }
    this.afterAction();
  }

  onUnequip(u: UnitInstance, itemId: string): void {
    this.pushUndo('卸下');
    if (unequipItem(this.match.human, u.iid, itemId)) {
      audio.play('ui');
      const def = ITEM_BY_ID[itemId];
      this.showToast(
        def?.tier === 'combined' && def.recipe
          ? `卸下 ${def.name}，拆回两个组件`
          : `卸下 ${def?.name ?? ''}`
      );
    } else {
      this.undoStack.pop();
    }
    this.afterAction();
  }

  onAutoEquip(): void {
    if (this.phase !== 'prep' || this.busy) return;
    if (this.match.human.items.length === 0) {
      this.showToast('器匣是空的', true);
      return;
    }
    this.pushUndo('一键装备');
    autoEquip(this.match.human);
    this.selectedItem = null;
    audio.play('uiBig');
    this.showToast('已自动分配装备');
    this.afterAction();
  }

  // ══════════════ 玩家动作 ══════════════

  onBuy(slot: number): void {
    if (this.phase !== 'prep' || this.busy) return;
    const p = this.match.human;
    const before = p.gold;
    const starsBefore = this.snapshotStars();
    this.pushUndo('买入');
    if (this.match.buy(p, slot)) {
      audio.play('coin');
      this.detectThreeStar(starsBefore);
      this.showToast(`花费 ${before - p.gold} 金`);
    } else {
      this.undoStack.pop();
      const id = p.shop[slot];
      if (id && CHAMPION_BY_ID[id] && p.gold < CHAMPION_BY_ID[id]!.cost) {
        this.showToast('金币不足', true);
      } else if (id) {
        this.showToast('备战席已满', true);
      }
      audio.play('warn');
    }
    this.afterAction();
  }

  onReroll(): void {
    if (this.phase !== 'prep' || this.busy) return;
    this.pushUndo('刷新');
    if (this.match.reroll(this.match.human)) {
      audio.play('ui');
    } else {
      this.undoStack.pop();
      this.showToast('金币不足', true);
      audio.play('warn');
    }
    this.afterAction();
  }

  onBuyXp(): void {
    if (this.phase !== 'prep' || this.busy) return;
    const before = this.match.human.level;
    this.pushUndo('升级');
    if (this.match.buyExp(this.match.human)) {
      if (this.match.human.level > before) audio.play('levelup');
      else audio.play('coin');
    } else {
      this.undoStack.pop();
      this.showToast(this.match.human.level >= MAX_LEVEL ? '已达最高等级' : '金币不足', true);
      audio.play('warn');
    }
    this.afterAction();
  }

  onAutoArrange(): void {
    if (this.phase !== 'prep' || this.busy) return;
    this.pushUndo('布阵');
    autoArrange(this.match.human, this.match.pool);
    audio.play('uiBig');
    this.showToast('已自动布阵');
    this.afterAction();
  }

  onToggleLock(): void {
    if (this.phase !== 'prep' || this.busy) return;
    this.match.human.shopLocked = !this.match.human.shopLocked;
    audio.play('ui');
    this.afterAction();
  }

  onUndo(): void {
    // 开战/结算期间撤销会把"战前快照"盖回已结算的状态（血量/金币已变），必须禁止
    if (this.phase !== 'prep' || this.busy) return;
    const e = this.undoStack.pop();
    if (!e) {
      this.showToast('没有可撤销的操作', true);
      return;
    }
    // 整份快照对称回滚：金币、等级/经验、棋子与装备、商店、器匣、卡池计数
    restorePlayer(this.match.human, this.match.pool, e.snap);
    audio.play('ui');
    this.showToast(`已撤销：${e.label}`);
    this.afterAction();
  }

  pushUndo(label: string): void {
    this.undoStack.push({ snap: snapshotPlayer(this.match.human, this.match.pool), label });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  afterAction(): void {
    this.refreshAll();
    this.queueSave();
  }

  /** 存档去抖：连发的动作（连点刷新/连买）合并成一次写盘；切场景/关页前强制落盘 */
  queueSave(): void {
    this.saveTimer?.remove();
    this.saveTimer = this.time.delayedCall(600, () => {
      this.saveTimer = null;
      if (this.abandoned) return;
      saveMatch(this.match);
    });
  }

  private flushSave(): void {
    // 已放弃的局（投降/重开）不允许回写：否则 clearSave 之后又被兜底落盘复活
    if (this.abandoned) return;
    if (this.saveTimer) {
      this.saveTimer.remove();
      this.saveTimer = null;
      saveMatch(this.match);
    }
  }

  // ══════════════ 刷新（委托 SceneRefresh） ══════════════

  refreshAll(): void {
    this.refresher.refreshAll();
  }

  // ══════════════ 提示条 ══════════════

  showToast(msg: string, warn = false): void {
    if (this.toast) {
      // 旧 toast 身上还挂着 1700ms 后的淡出 tween，不先杀掉会在销毁后误触发
      this.tweens.killTweensOf(this.toast);
      this.toast.destroy();
    }
    const c = this.add.container(W / 2, H - 78).setDepth(500);
    const t = this.add
      .text(0, 0, msg, {
        fontFamily: FONT.body,
        fontSize: '15px',
        color: css(warn ? CINNABAR.light : PAPER[100]),
      })
      .setOrigin(0.5);
    const w = t.width + 40;
    const g = this.add.graphics();
    g.fillStyle(INK[800], 0.96);
    g.fillRect(-w / 2, -20, w, 40);
    g.lineStyle(1.4, warn ? CINNABAR.base : GILT.deep, 0.8);
    g.strokeRect(-w / 2, -20, w, 40);
    c.add([g, t]);
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, y: H - 88, duration: 220, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: c, alpha: 0, delay: 1700, duration: 380, onComplete: () => c.destroy() });
    this.toast = c;
  }

  // ══════════════ 高光时刻 ══════════════

  /**
   * 高光演出。
   *
   * 自走棋一局接近半小时，真正被记住的只有几个瞬间：凑出三星、合成神装、终结连败。
   * 这些时刻必须有**超出常规的视听反馈** —— 常规的反馈会被玩家的注意力自动过滤掉，
   * 结果就是"赢了也没感觉"。
   */
  private celebrate(kind: 'star3' | 'item' | 'streak' | 'comeback', detail: string): void {
    const isBig = kind === 'star3' || kind === 'comeback';
    const color = kind === 'star3' ? GILT.light : kind === 'item' ? GILT.base : SPIRIT.light;
    const title =
      kind === 'star3' ? '三  星' : kind === 'item' ? '神  兵' : kind === 'streak' ? '连  胜' : '翻  盘';

    // 全屏色闪 + 轻微推镜，把这一刻从连续的时间流里"抠"出来（静观模式只留文字浮现）
    if (!motion.calm) {
      const [r, g, b] = rgbOf(color);
      this.cameras.main.flash(isBig ? 420 : 260, r, g, b);
      if (isBig) {
        // zoom 是绝对值：在 DPR 底座上 punch 相对基准 CAM_ZOOM，而不是相对 1
        this.cameras.main.zoomTo(CAM_ZOOM * 1.012, 90);
        this.time.delayedCall(220, () => this.cameras.main.zoomTo(CAM_ZOOM, 220));
      }
    }

    const c = this.add.container(W / 2, H * 0.34).setDepth(650);
    const t = this.add
      .text(0, 0, title, { fontFamily: FONT.title, fontSize: isBig ? '76px' : '54px', color: css(color) })
      .setOrigin(0.5);
    t.setShadow(0, 0, css(color), 30, false, true);
    const d = this.add
      .text(0, isBig ? 62 : 46, detail, { fontFamily: FONT.body, fontSize: '17px', color: css(PAPER[100]) })
      .setOrigin(0.5);
    c.add([t, d]);
    c.setAlpha(0);
    c.setScale(0.7);
    this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 320, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: c,
      alpha: 0,
      y: H * 0.34 - 40,
      delay: isBig ? 1500 : 1100,
      duration: 420,
      onComplete: () => c.destroy(),
    });

    audio.play(kind === 'star3' ? 'star3' : 'levelup');
  }

  /** 买入后检查是否凑出了三星（用于触发高光演出；五费三星走专属全屏演出） */
  private detectThreeStar(before: Map<number, number>): void {
    const after = new Map<number, number>();
    for (const u of [...this.match.human.board, ...this.match.human.bench]) {
      if (u) after.set(u.iid, u.star);
    }
    for (const [iid, star] of after) {
      if (star >= 3 && (before.get(iid) ?? 0) < 3) {
        const u = findUnit(this.match.human, iid);
        const def = u ? CHAMPION_BY_ID[u.defId] : undefined;
        if (def?.cost === 5 && u) {
          playLegendaryStarFx(this, u.defId);
          audio.play('star3');
          audio.play('skillBig');
          return;
        }
        this.celebrate('star3', `${def?.name ?? ''} 三星`);
        return;
      }
    }
  }

  private snapshotStars(): Map<number, number> {
    const m = new Map<number, number>();
    for (const u of [...this.match.human.board, ...this.match.human.bench]) {
      if (u) m.set(u.iid, u.star);
    }
    return m;
  }

  // ══════════════ 回合流转 ══════════════

  private enterPrep(): void {
    this.phase = 'prep';
    this.busy = false;
    this.prepLeft = this.match.prepSeconds();
    this.undoStack = [];
    saveMatch(this.match);
    audio.startBgm(this.match.round >= 14 ? 'final' : 'prep');
    this.refreshAll();
  }

  /** 准备阶段结束 → 战斗 */
  startBattlePhase(): void {
    if (this.busy || this.phase !== 'prep') return;
    this.pauseScout.setPaused(false);
    this.pauseScout.closeScout();
    this.busy = true;
    this.phase = 'battle';
    // 阵容锁定：撤销栈清空（防止结算期间 Ctrl+Z 回滚到战前快照），
    // 并记下开战前的连胜/连败口径 —— 翻盘演出要用战前值判定
    this.undoStack = [];
    this.streakBefore = this.match.human.streak;
    // 存档必须先于 AI 无头结算落盘：此刻存的是与准备阶段一致的快照；
    // 若拖到结算之后再写，战斗中途刷新页面会把已结算一半的状态存下来，
    // 重新载入时 AI 战被二次结算
    this.flushSave();
    // 奇遇恩赐过期即作废（无惩罚）：公共字段按契约由游戏层清空，面板同步收起
    this.match.adventureOffer = null;
    this.adventure.hide();

    const pairings = this.match.makePairings();
    this.match.pairings = pairings;

    // 1) 别人的战斗先无头跑完（玩家只关心自己的战场，别人的结果以战报呈现）
    const humanPair = pairings.find((p) => p.a === 0 || p.b === 0);
    const reports: string[] = [];
    for (const pair of pairings) {
      if (pair === humanPair) continue;
      const res = this.match.runBattleHeadless(pair);
      const before = pair.b >= 0 ? this.match.players[pair.b].hp : 0;
      const outs = this.match.applyBattleResult(pair, res);
      reports.push(this.describeOutcome(pair, outs, before));
    }

    // 2) 玩家自己的战斗
    if (!humanPair || !this.match.human.alive) {
      this.lastReport = reports.join('\n');
      this.finishRound();
      return;
    }
    this.lastReport = reports.join('\n');
    this.refreshAll();

    audio.playPluck(196); // 徵音起手：开战的弦响
    this.cameras.main.fadeOut(260, 7, 9, 12);
    this.time.delayedCall(280, () => {
      this.scene.start('Battle', { match: this.match, pair: humanPair });
    });
  }

  private describeOutcome(pair: Pairing, outs: RoundOutcome[], loserHpBefore: number): string {
    const nameOf = (i: number) => this.match.players[i].name;
    if (pair.beast) {
      const o = outs[0];
      const won = o?.outcome === 'win';
      const drop = o?.drops?.length ? `　得 ${o.drops.length} 件器件` : '';
      return `${nameOf(pair.a)} VS 墨兽 · ${won ? `胜${drop}` : `败 -${o?.damage ?? 0}${drop}`}`;
    }
    if (pair.b < 0) {
      const o = outs[0];
      return o?.outcome === 'bye' ? `${nameOf(pair.a)} 轮空` : `${nameOf(pair.a)} VS 墨影 · ${o?.outcome === 'win' ? '胜' : `败 -${o?.damage ?? 0}`}`;
    }
    const a = outs.find((o) => o.idx === pair.a);
    const b = outs.find((o) => o.idx === pair.b);
    const winner = a?.outcome === 'win' ? nameOf(pair.a) : b?.outcome === 'win' ? nameOf(pair.b) : null;
    const loser = a?.outcome === 'loss' ? a : b?.outcome === 'loss' ? b : null;
    if (!winner || !loser) return `${nameOf(pair.a)} 与 ${nameOf(pair.b)} 同归于尽`;
    let line = `${winner} 胜 ${nameOf(loser.idx)}`;
    if (loser.damage > 0) line += `（-${loser.damage}，剩 ${loser.hpAfter}）`;
    if (loser.eliminated) line += `　☠ 淘汰`;
    void loserHpBefore;
    return line;
  }

  /**
   * 玩家本回合没有战斗可看（轮空 / 已被淘汰）时走这里：
   * 别人的战斗在 startBattlePhase 里已经跑完并结算，这里只需收尾。
   */
  private finishRound(): void {
    this.busy = true;
    this.match.endRound();
    saveMatch(this.match);
    this.afterBattle();
  }

  /** 战斗已结算完毕：写战报、判定淘汰、决定下一步 */
  private afterBattle(): void {
    const p = this.match.human;

    // 把玩家自己的结果顶到战报最上面 —— 玩家最关心的是自己这一场
    // 墨兽轮的掉落走战报，不再弹窗 —— 准备阶段的正反馈不该打断操作节奏
    if (p.lastOutcome === 'loss') {
      this.lastReport = `你 败北　-${p.lastDamage} 生命（剩 ${p.hp}）\n${this.lastReport}`.trim();
    } else if (p.lastOutcome === 'win') {
      this.lastReport = `你 获胜\n${this.lastReport}`.trim();
      // 终结连败的那一胜，值得单独一次演出 —— 用战前连败口径（负数），
      // 累计败场会让任何四败之后的胜场都误触发
      if (p.streak === 1 && this.streakBefore <= -4) this.celebrate('comeback', '终结连败');
      else if (p.streak >= 3) this.celebrate('streak', `${p.streak} 连胜`);
    } else if (p.lastOutcome === 'bye') {
      this.lastReport = `你 本轮轮空\n${this.lastReport}`.trim();
    }

    if (this.match.isOver()) {
      this.showFinalStandings();
      return;
    }
    if (!p.alive) {
      this.eliminated.show(p, this.match.round, () => this.fastForward(), () => this.restart());
      return;
    }

    this.roundResult.show(p, () => {
      this.match.beginRound();
      this.enterPrep();
    });
  }

  /** 玩家淘汰后把剩下的回合快进完，给出最终名次 */
  fastForward(): void {
    let guard = 0;
    while (!this.match.isOver() && guard++ < 60) {
      this.match.beginRound();
      if (this.match.isOver()) break;
      for (const pair of this.match.makePairings()) {
        this.match.applyBattleResult(pair, this.match.runBattleHeadless(pair));
      }
      this.match.endRound();
    }
    this.showFinalStandings();
  }

  private showFinalStandings(): void {
    // 终局结算已独立为 ResultScene：对局场景就此卸下，残留状态随场景关闭清空
    this.phase = 'over';
    this.scene.start('Result', { match: this.match });
  }

  restart(): void {
    this.abandoned = true; // 阻止离场流程把已清档的旧局写回
    clearSave();
    this.scene.start('Game', { fresh: true });
  }

  /** 投降：放弃当前对局，清档回主菜单（设置面板里二次确认后才走到这里） */
  private resign(): void {
    this.abandoned = true;
    clearSave();
    this.scene.start('Menu', {});
  }

  // ══════════════ 设置 ══════════════

  openSettings(): void {
    this.settingsPanel ??= new SettingsPanel(this, {
      prefs: this.prefs,
      inMatch: true,
      onRestart: () => this.restart(),
      onResign: () => this.resign(),
      onAutoDeploy: (v) => { this.match.settings.autoDeploy = v; },
    });
    this.settingsPanel.open();
  }
}

/** 0xRRGGBB → [r, g, b]。Phaser 的 flash 只吃三个分量，不吃整数色值。 */
function rgbOf(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

export const GAME_SCENE_W = W;
export const GAME_SCENE_H = H;
