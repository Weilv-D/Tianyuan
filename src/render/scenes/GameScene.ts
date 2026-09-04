import Phaser from 'phaser';
import { MAX_LEVEL } from '../../core/config';
import { CHAMPION_BY_ID } from '../../data/champions';
import { Match, type Pairing, type RoundOutcome } from '../../game/match';
import { autoArrange } from '../../game/arrange';
import { restorePlayer, snapshotPlayer, type PlayerSnapshot } from '../../game/undo';
import { findUnit, type UnitInstance } from '../../game/state';
import { autoEquip, equipItem, unequipAll, unequipItem, MAX_ITEMS_PER_UNIT } from '../../game/inventory';
import { ITEM_BY_ID, combine } from '../../data/items';
import { clearSave, loadMatch, loadPrefs, saveMatch, type Preferences } from '../../game/save';
import { audio } from '../../audio/AudioEngine';
import { FONT, resetCursorOnShutdown } from '../../ui/kit';
import { baseZoom, CAM_ZOOM } from '../view/viewScale';
import { SettingsPanel } from '../../ui/SettingsPanel';
import { bakeItemIcons } from '../board/itemIcons';
import { bakeTraitIcons } from '../board/traitIcons';
import { buildTextures, grainOverlay } from '../view/textures';
import { playLegendaryStarFx } from '../board/LegendaryFx';
import { bakeSilhouettes } from '../board/silhouetteFactory';
import { INK, GILT, CINNABAR, SPIRIT, PAPER, css } from '../view/palette';
import { W, H } from '../view/layout';
import { motion } from '../view/motion';
import { fadeIn, fadeTo } from '../view/transition';

// ── 渲染模块（R2 拆分）：场景只保留 create/update 主循环、场景切换与对局数据装配；
//    覆盖层/面板/输入/刷新细节全部委托 src/render/game/ 下的模块。 ──
import { HudPanels } from '../game/HudPanels';
import { BoardBake } from '../game/BoardBake';
import { SceneRefresh } from '../game/SceneRefresh';
import { absoluteItemIndex, clampItemPage } from '../game/itemPaging';
import { AdventurePanel } from '../game/AdventurePanel';
import { PauseScoutOverlay } from '../game/PauseScoutOverlay';
import { TraitMembersCard } from '../game/TraitMembersCard';
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
  /**
   * 动作前的对局随机流游标（Rng.state）。随机游标是世界状态的一部分：
   * 不随快照回滚的话，"刷新-撤销-再刷新"可零成本预览后续商店（免费探店）。
   * 准备阶段随机流的唯一消费者是玩家动作本身，回滚到动作前即恢复一致。
   */
  rngState: number;
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
  /** 点击左轨徽章钉住的羁绊成员卡（悬停效果笺之外的第二交互层） */
  traitMembers!: TraitMembersCard;
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
  /** 器匣当前页（视觉 10 格 ↔ 绝对索引映射，见 game/itemPaging.ts）：
   *  系统回收允许器匣溢出 10 格（守恒优先），分页让溢出资产保持可点选可拖拽 */
  itemPage = 0;
  /** 卸载器模式：点选后点击任意棋子，全身装备一键回器匣（开局可用） */
  unloadMode = false;
  settingsPanel: SettingsPanel | null = null;

  // ── 场景私有 ──
  private prefs!: Preferences;
  private toast: Phaser.GameObjects.Container | null = null;
  private onBeforeUnload: (() => void) | null = null;
  private saveTimer: Phaser.Time.TimerEvent | null = null;
  /** DEV 调试台热键（具名句柄：create 重入前须摘除旧监听，见 create 注册处） */
  private devKeydown: ((e: KeyboardEvent) => void) | null = null;
  /** 开战前玩家的连胜/连败值（负数为连败）—— 翻盘判定必须用战前口径 */
  private streakBefore = 0;
  /** 投降/重开后置真：阻止 SHUTDOWN 与 beforeunload 把已放弃的存档写回去 */
  private abandoned = false;
  /** 本局存档失败是否已提示过（配额满的 toast 只弹一次，连续动作不刷屏；成功后复位） */
  private saveFailNotified = false;

  constructor() {
    super({ key: 'Game' });
  }

  // ══════════════ 生命周期 ══════════════

  create(data: SceneData): void {
    baseZoom(this);
    fadeIn(this);
    resetCursorOnShutdown(this);
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
    this.selectedItem = null;
    this.itemPage = 0;
    this.unloadMode = false;
    // settingsPanel 内部持有已销毁的容器：不置空则 isOpen 永真，设置面板再也打不开
    this.settingsPanel = null;
    this.abandoned = false;
    this.streakBefore = 0;
    this.saveFailNotified = false;
    // 战报必须跨越"战斗场景往返"（resultPending 回来时 afterBattle 要读它），
    // 只在真正开新局时清空，避免把上一局的战报带进新一局的准备阶段
    if (!data.resultPending) this.lastReport = '';
    this.hud = new HudPanels(this);
    this.boardBake = new BoardBake(this);
    this.refresher = new SceneRefresh(this);
    this.adventure = new AdventurePanel(this);
    this.pauseScout = new PauseScoutOverlay(this);
    this.traitMembers = new TraitMembersCard(this);
    this.roundResult = new RoundResultOverlay(this);
    this.eliminated = new EliminatedOverlay(this);

    this.prefs = loadPrefs();
    motion.calm = this.prefs.calm;
    this.inputCtl.resetForCreate();
    // DEV 控制台随场景实例存活：panel 若在上一场关闭时还开着，现在指向
    // 已销毁的容器（isOpen 恒真）—— create 时统一复位（C5）。
    // attach 必须在 create（scene.events 已由 Systems boot 挂载）调用：
    // DebugConsole 是字段初始化期构造的模块，构造器里读 scene.events 为 undefined
    this.debug.reset();
    this.debug.attach();
    this.saveTimer?.remove();
    this.saveTimer = null;

    // 去抖存档的兜底：关页/切页前把排队中的存档立刻落盘，否则丢最后 600ms 的操作
    this.onBeforeUnload = () => this.flushSave();
    window.addEventListener('beforeunload', this.onBeforeUnload);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.onBeforeUnload) window.removeEventListener('beforeunload', this.onBeforeUnload);
      if (this.devKeydown) {
        this.input.keyboard?.off('keydown', this.devKeydown);
        this.devKeydown = null;
      }
      if (this.match && !this.match.isOver()) this.flushSave();
    });

    if (data.match) {
      this.match = data.match;
    } else if (data.daily) {
      // 每日挑战：种子由入口层注入（同一天任何时刻进入是同一局）；
      // seed 缺失时回退随机种子，normal 路径行为零变化。
      // 每日档独立分键：进入即视为重开，先清昨日/上次中断的每日残档。
      clearSave('daily');
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
    audio.setLicensedMusicEnabled(this.prefs.licensedMusic);

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
      this.cameras.main.fadeIn(160, 7, 9, 12);
      this.afterBattle();
    } else {
      // 读档路由（A2）：终局档进终局；人类已亡快进到底；结算已落盘（phase='result'）
      // 的档必须先 beginRound 推进回合，否则同一回合会被二次结算（双倍掉血）。
      if (this.match.isOver()) {
        this.scene.start('Result', { match: this.match });
        return;
      }
      if (!this.match.human.alive) {
        this.fastForward();
        return;
      }
      if (this.match.round === 0 || this.match.needsAdvanceOnLoad()) this.match.beginRound();
      this.enterPrep();
    }

    this.refreshAll();
    if (import.meta.env.DEV) {
      // 具名句柄 + SHUTDOWN 对称摘除：Phaser 复用 Scene 实例时 create() 会重入，
      // 匿名 keydown 监听每次重入叠加一发（Ctrl+~ 触发次数倍增）
      this.devKeydown = (e: KeyboardEvent) => {
        if (e.ctrlKey && (e.key === '`' || e.key === '~' || e.code === 'Backquote')) {
          e.preventDefault();
          this.debug.toggle();
        }
      };
      this.input.keyboard?.on('keydown', this.devKeydown);
    }
  }

  override update(_time: number, delta: number): void {
    void _time;
    void delta;
    // 备战不设倒计时（玩家公测反馈）：思考时间无限，开战完全由玩家手动
    // （「开战」按钮 / 空格）。update 无每帧工作，保留空实现以备后续需求。
  }

  // ══════════════ 器匣点选 ══════════════

  /** 装备栏第 i 格（本页可视格）的装备 id —— 溢出分页映射到器匣绝对索引 */
  itemAt(i: number): string | null {
    return this.match.human.items[absoluteItemIndex(this.itemPage, i)] ?? null;
  }

  onItemChipClick(i: number): void {
    const id = this.itemAt(i);
    if (!id) return;
    // 点一下选中，再点棋子装上；拖也行。两条路都留着，
    // 因为拖拽对触屏和手抖的人并不友好，而"点选"永远不会拖错地方。
    // 选中与卸载两模式互斥：留下任何一侧都会让 InputController 的
    // 卸载分支抢在装配分支之前吃掉点击，装备永远装不上。
    if (this.selectedItem === id) {
      this.selectedItem = null;
      this.exitUnloadMode();
    } else {
      this.selectedItem = id;
      this.exitUnloadMode();
      audio.play('ui');
    }
    this.refreshAll();
  }

  /** 器匣翻页（溢出分页控件回调）：delta 为 -1（上一页）/ +1（下一页） */
  onItemPage(delta: number): void {
    if (this.phase !== 'prep' || this.busy) return;
    // 拖拽中翻页会让 InputController 持有的视觉格映射到错误的绝对索引
    if (this.inputCtl.dragging) return;
    const next = clampItemPage(this.itemPage + delta, this.match.human.items.length);
    if (next === this.itemPage) return;
    this.itemPage = next;
    // 选中件可能已不在本页：翻页即回中性态，避免"点棋子装上的是看不见的那件"
    this.selectedItem = null;
    this.exitUnloadMode();
    audio.play('ui');
    this.refreshAll();
  }

  // ══════════════ 装备操作 ══════════════

  /**
   * 器匣内合成：组件 A 拖到组件 B 上，原地合出成品（v1.9 全配方）。
   * 结果落在靠前的那个格位 —— 先摘后放，其余装备的格位保持稳定。
   */
  onCombineInBar(from: number, to: number): void {
    const a = this.itemAt(from);
    const b = this.itemAt(to);
    // 同 id 两件是合法配方（翠玦×2、法符×2 等）—— 不能按 id 判自拖；
    // 同格落点已在 InputController 分流为"原地放下"，这里 from !== to 恒成立
    if (!a || !b) {
      this.refreshAll();
      return;
    }
    const out = combine(a, b);
    if (!out) {
      // 全配方下不可达（36/36 两两可合），守在这里只是防未来加"不成装"组合
      this.showToast('这两件合不出东西', true);
      audio.play('warn');
      this.refreshAll();
      return;
    }
    this.pushUndo('器匣合成');
    const p = this.match.human;
    // 视觉格 → 绝对索引：溢出分页下，合成消费的是本页两个绝对格位
    const lo = absoluteItemIndex(this.itemPage, Math.min(from, to));
    const hi = absoluteItemIndex(this.itemPage, Math.max(from, to));
    p.items.splice(hi, 1);
    p.items.splice(lo, 1, out);
    this.selectedItem = null;
    this.exitUnloadMode();
    audio.play('coin');
    // 合成神装是这局的高光之一，与拖到棋子上的合成共用同一场演出
    this.celebrate('item', ITEM_BY_ID[out].name);
    this.afterAction();
  }

  onEquip(u: UnitInstance, itemId: string): void {
    this.pushUndo('装配');
    const r = equipItem(this.match.human, u.iid, itemId);
    if (!r.ok) {
      this.undoStack.pop();
      this.showToast(r.reason ?? '装不上', true);
      audio.play('warn');
    } else {
      this.selectedItem = null;
      this.exitUnloadMode();
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

  /** 退出卸载模式：状态与按钮态必须同进同退，否则按钮文字卡在「卸载中…」 */
  exitUnloadMode(): void {
    this.unloadMode = false;
    this.hud.setUnloadMode(false);
  }

  /** 卸载器开关（器匣右上「卸 载」钮）：仅备战阶段可用 */
  onToggleUnload(): void {
    if (this.phase !== 'prep' || this.busy) return;
    this.unloadMode = !this.unloadMode;
    if (this.unloadMode) this.selectedItem = null;
    this.hud.setUnloadMode(this.unloadMode);
    audio.play('ui');
    if (this.unloadMode) this.showToast('卸载：点选棋子收回装备');
  }

  /** 卸载器执行：全身装备整体回器匣（成品拆回组件；容量不足整体拒绝） */
  onUnequipAll(u: UnitInstance): void {
    this.exitUnloadMode();
    this.pushUndo('卸载全部');
    const r = unequipAll(this.match.human, u.iid);
    if (r.ok) {
      audio.play('uiBig');
      this.showToast(`卸下 ${r.count} 件装备回器匣`);
    } else {
      this.undoStack.pop();
      this.showToast(r.reason ?? '无法卸载', true);
    }
    this.afterAction();
  }

  onUnequip(u: UnitInstance, itemId: string): void {
    this.pushUndo('卸下');
    const r = unequipItem(this.match.human, u.iid, itemId);
    if (r.ok) {
      audio.play('ui');
      const def = ITEM_BY_ID[itemId];
      this.showToast(
        def?.tier === 'combined' && def.recipe
          ? `卸下 ${def.name}，拆回两个组件`
          : `卸下 ${def?.name ?? ''}`
      );
    } else {
      this.undoStack.pop();
      this.showToast(r.reason ?? '无法卸下', true);
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
    this.exitUnloadMode();
    audio.play('uiBig');
    this.showToast('已自动分配装备');
    this.afterAction();
  }

  // ══════════════ 玩家动作 ══════════════

  onBuy(slot: number): void {
    if (this.phase !== 'prep' || this.busy) return;
    if (this.inputCtl.dragging) return; // 与键盘路同口径：拖拽中不接受第二输入源
    const p = this.match.human;
    const before = p.gold;
    const starsBefore = this.snapshotStars();
    this.pushUndo('买入');
    const r = this.match.buy(p, slot);
    if (r.ok) {
      audio.play('coin');
      this.detectThreeStar(starsBefore);
      this.showToast(`花费 ${before - p.gold} 金`);
    } else {
      this.undoStack.pop();
      // 反馈就位：失败落在被点的卡上（红边脉冲），toast 只作补充说明
      this.hud.shopCards[slot]?.pulseDenied();
      if (r.reason === 'gold') this.showToast('金币不足', true);
      else if (r.reason === 'pool') this.showToast('卡池不足', true);
      else if (r.reason === 'bench') this.showToast('备战席已满', true);
      else this.showToast('没有可买的卡', true);
      audio.play('warn');
    }
    this.afterAction();
  }

  onReroll(): void {
    if (this.phase !== 'prep' || this.busy) return;
    if (this.inputCtl.dragging) return;
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
    if (this.inputCtl.dragging) return;
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
    if (this.inputCtl.dragging) return;
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
    if (this.inputCtl.dragging) return;
    // 撤销恢复的是快照时刻的阵容，卸载模式的"点棋子卸全身"语境已失效，回中性态
    this.exitUnloadMode();
    const e = this.undoStack.pop();
    if (!e) {
      this.showToast('没有可撤销的操作', true);
      return;
    }
    // 整份快照对称回滚：金币、等级/经验、棋子与装备、商店、器匣、卡池计数、
    // 奇遇恩赐（restorePlayer 内一并回写）与随机流游标
    restorePlayer(this.match.human, this.match.pool, e.snap, this.match);
    this.match.rng.state = e.rngState;
    // 恩赐面板的"本回合已择"记忆随撤销失效：撤销到领赐前快照后 offer 已还原，
    // 面板必须重开，否则还原的恩赐没有领取入口（resolvedRound 守卫会拦掉重开）
    this.adventure.resetResolved();
    audio.play('ui');
    this.showToast(`已撤销：${e.label}`);
    this.afterAction();
  }

  pushUndo(label: string): void {
    // 撤销快照 scope=准备阶段（见 undo.ts 文件头）：结算期间入栈的快照
    // 一旦被 Ctrl+Z 消费会把已结算的血量/连胜盖回战前值 —— 在入口拦死
    if (this.phase !== 'prep' || this.busy) return;
    // 奇遇恩赐与玩家状态一并入快照：领取发生在准备阶段，撤销到领赐前快照
    // 时必须把 offer 还原（否则恩赐永久蒸发），否则同一回合「领完再撤销」后
    // 面板不会重开 —— 见 undo.ts 的 PlayerSnapshot.adventureOffer 注释
    this.undoStack.push({
      snap: snapshotPlayer(this.match.human, this.match.pool, this.match.adventureOffer),
      label,
      rngState: this.match.rng.state,
    });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  afterAction(): void {
    this.inputCtl.clearSelection();
    this.refreshAll();
    this.queueSave();
  }

  /** 存档去抖：连发的动作（连点刷新/连买）合并成一次写盘；切场景/关页前强制落盘 */
  queueSave(): void {
    this.saveTimer?.remove();
    this.saveTimer = this.time.delayedCall(600, () => {
      this.saveTimer = null;
      if (this.abandoned) return;
      // 写盘失败要给玩家可见反馈：配额满时静默失败会让「继续」读到旧档、
      // 回退若干回合且无提示（M4 确立的失败可见纪律）
      this.persistMatch();
    });
  }

  private flushSave(): void {
    // 已放弃的局（投降/重开）不允许回写：否则 clearSave 之后又被兜底落盘复活
    if (this.abandoned) return;
    if (this.saveTimer) {
      this.saveTimer.remove();
      this.saveTimer = null;
      this.persistMatch();
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
    // 落位 y=176：备战期敌方半场恒空（棋盘上半），绝不遮商肆卡/阶段条/操作列。
    // 旧 H-78 正压商肆 2-4 号卡的价格行，连买时反馈自己挡住被反馈的对象。
    const c = this.add.container(W / 2, 186).setDepth(500);
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
    this.tweens.add({ targets: c, alpha: 1, y: 176, duration: 220, ease: 'Quad.easeOut' });
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

  /**
   * 统一的存档出口：成功则复位"已提示"标记；失败则按需弹一次配额提示
   * （所有落盘点共用同一可见性口径，避免有的路径弹、有的路径静默）。
   */
  private persistMatch(): boolean {
    const ok = saveMatch(this.match);
    if (ok) this.saveFailNotified = false;
    else if (!this.saveFailNotified) {
      this.saveFailNotified = true;
      this.showToast('存档失败：浏览器存储已满，请清理后继续', true);
    }
    return ok;
  }

  private enterPrep(): void {
    this.phase = 'prep';
    this.busy = false;
    this.undoStack = [];
    this.persistMatch();
    audio.startBgm(this.match.round >= 14 ? 'final' : 'prep');
    this.refreshAll();
  }

  /** 准备阶段结束 → 战斗 */
  startBattlePhase(): void {
    if (this.busy || this.phase !== 'prep') return;
    this.exitUnloadMode();
    this.pauseScout.setPaused(false);
    this.pauseScout.closeScout();
    this.traitMembers.close(); // 成员卡/悬停笺在战斗演出页无意义，随开战收起
    this.inputCtl.cancelDrag(); // 阵容锁定：拖拽残影与选中态随开战一并中止
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
    // 未点选的奇遇恩赐由系统代选一个（与 AI 同一选型纯函数，发放同入口）；
    // 面板无论如何收起
    if (this.match.resolveHumanAdventure()) {
      this.showToast('未选择恩赐，已自动领取', true);
      this.refreshAll();
    }
    this.adventure.hide();

    // 配对已在 beginRound 生成（备战期全程可侦查本轮对手）；此处只消费。
    // 兜底：异常路径进场而配对缺失/脏表被弃时补生成一次 —— recordHistory=false，
    // 回合开始的原生成已把交手写入 opponents（随档持久化），重掷再记即双记
    if (this.match.pairings.length === 0) this.match.pairings = this.match.makePairings(false);
    const pairings = this.match.pairings;

    // 1) 全部战斗按配对顺序无头结算（含人类场 —— A3）。人类场随后由 BattleScene
    //    用同一 config 播放演出，判定只发生在这里：渲染永远不参与结算，
    //    墨兽轮掉落的 rng 消费顺序与无头模拟逐位一致（确定性契约）。
    const humanPair = pairings.find((p) => p.a === 0 || p.b === 0);
    // 我方/对手是否空阵、本场战斗配置，都必须在结算前取证：settleRound 若把任一方
    // 打至淘汰，eliminate 会当场清空其棋盘 —— 事后读棋盘会把"上阵后战死"误判成
    // "未上阵"，终局最后一战因此被当作弃权局吞掉；事后重建 config 也会让演出与
    // 判定不一致（2026-09-02 实机复现修复）。对手棋盘用人类视角语义
    //（boardFacedByHuman：人类可能是 pair.a 也可能是 pair.b）。
    const meEmptyBefore = this.match.human.board.every((u) => u === null);
    const oppEmptyBefore = humanPair ? this.match.boardFacedByHuman(humanPair).every((u) => u === null) : false;
    const humanConfig = humanPair ? this.match.buildBattleConfig(humanPair, humanPair.swap) : null;
    const reports: string[] = [];
    const outcomes = this.match.settleRound();
    pairings.forEach((pair, i) => {
      if (pair === humanPair) return;
      reports.push(this.describeOutcome(pair, outcomes[i] ?? []));
    });

    // 2) 玩家自己的战斗
    // 注意不得以"结算后 human.alive"决定跳过演出：settleRound 已在本块上方
    // 无头完成判定，人类若在本轮战败淘汰，alive 已翻 false —— 但他的最后一战
    // 仍然要打给玩家看（对手满阵也照样吞掉整场战斗，终局表现就是"点开战
    // 直接弹结算页"）。淘汰态交给 afterBattle 的淘汰演出承接。
    if (!humanPair) {
      this.lastReport = reports.join('\n');
      this.finishRound();
      return;
    }
    // 空阵对手直胜：对手零上场子时不入 BattleScene（避免 1-tick 零条计分板）
    // 判定已在本轮 settleRound 内按弃权口径完成，这里只收尾。
    // 空阵判定一律用结算前快照（meEmptyBefore / oppEmptyBefore）。
    if (humanPair) {
      const oppEmpty = oppEmptyBefore;
      const meEmpty = meEmptyBefore;
      // 轮空（无对手）与空阵弃权是两回事：轮空不掉血、不计胜负、连胜保留，
      // 战报行由 afterBattle 的「你 本轮轮空」承担 —— 绝不能落「直接胜利」标签
      const isBye = !humanPair.beast && humanPair.b < 0 && humanPair.ghost < 0;
      if (isBye || oppEmpty || meEmpty) {
        const tag = isBye
          ? ''
          : meEmpty && oppEmpty
            ? '双方均未上阵 · 平局'
            : oppEmpty
              ? '对手未上阵 · 直接胜利'
              : '我方未上阵 · 直接败北';
        this.lastReport = tag ? `${tag}\n${reports.join('\n')}`.trim() : reports.join('\n');
        this.finishRound();
        return;
      }
    }
    this.lastReport = reports.join('\n');
    this.refreshAll();

    audio.playPluck(196); // 徵音起手：开战的弦响
    fadeTo(this, 'Battle', { match: this.match, pair: humanPair, config: humanConfig ?? undefined });
  }

  private describeOutcome(pair: Pairing, outs: RoundOutcome[]): string {
    const nameOf = (i: number) => this.match.players[i].name;
    if (pair.beast) {
      const o = outs[0];
      const won = o?.outcome === 'win';
      const parts: string[] = [];
      if ((o?.drops?.length ?? 0) > 0) parts.push(`得 ${o!.drops.length} 件器件`);
      if ((o?.gold ?? 0) > 0) parts.push(`+${o!.gold} 金`);
      const drop = parts.length > 0 ? `　${parts.join(' · ')}` : '';
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
    return line;
  }

  /**
   * 玩家本回合没有战斗可看（轮空 / 已被淘汰）时走这里：
   * 别人的战斗在 startBattlePhase 里已经跑完并结算，这里只需收尾。
   */
  private finishRound(): void {
    this.busy = true;
    this.match.endRound();
    this.persistMatch();
    this.afterBattle();
  }

  /** 战斗已结算完毕：写战报、判定淘汰、决定下一步 */
  private afterBattle(): void {
    const p = this.match.human;

    // 无头结算已改写血量/淘汰态，HUD 必须先跟上再弹任何浮层 ——
    // 否则淘汰面板会盖在"结算前"的过期数值上（看起来血没归零就被淘汰）
    this.refreshAll();

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

    // 淘汰演出优先于终局判定：终局轮战死（2 人残局败北）也要先看到
    // 「你被淘汰」，确认后再进终局结算 —— 否则最后一战被无头结算吞掉后，
    // 连淘汰面板都不弹，玩家直接被闪送到结算页（2026-09-02 实机复现修复）
    if (!p.alive) {
      this.eliminated.show(p, this.match.round, () => this.fastForward(), () => this.restart());
      return;
    }
    if (this.match.isOver()) {
      this.showFinalStandings();
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
      // 人类已亡不在配对内，批量结算走 settleRound —— 与正常回合同一入口，
      // 结算后内部清空 pairings（手工逐对消费会留下同轮配对的二次消费窗口）
      this.match.settleRound();
      this.match.endRound();
    }
    this.showFinalStandings();
  }

  private showFinalStandings(): void {
    // 终局结算已独立为 ResultScene：对局场景就此卸下，残留状态随场景关闭清空
    this.phase = 'over';
    fadeTo(this, 'Result', { match: this.match });
  }

  restart(): void {
    this.abandoned = true; // 阻止离场流程把已清档的旧局写回
    clearSave(this.match.mode); // 只清本局模式的档：普通档重开不波及每日档，反之亦然
    fadeTo(this, 'Game', { fresh: true });
  }

  /** 投降：放弃当前对局，清档回主菜单（设置面板里二次确认后才走到这里） */
  private resign(): void {
    this.abandoned = true;
    clearSave(this.match.mode);
    fadeTo(this, 'Menu', {});
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
