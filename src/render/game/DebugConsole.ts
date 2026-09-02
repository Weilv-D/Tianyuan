/** 职责：DEV 专属实验控制台（Ctrl+~ 唤起）——金/级/生命/卡牌/装备等调试注入按钮，仅调试版本可见。 */
import Phaser from 'phaser';
import { CHAMPIONS } from '../../data/champions';
import { PLAYER_START_HP } from '../../core/config';
import { MAX_ITEMS_PER_UNIT } from '../../game/inventory';
import { newIid, resolveMerges } from '../../game/state';
import type { Star } from '../../core/types';
import { FONT, Button } from '../../ui/kit';
import { INK, GILT, PAPER, css } from '../view/palette';
import { W, H } from '../view/layout';
import type { GameScene } from '../scenes/GameScene';

/**
 * 实验控制台（原 GameScene.toggleDebug/openDebug/handleDebug 原样搬移）。
 * 构造一次、随场景实例存活：debugPanel 的开合状态与旧行为一致，不随 create() 复位。
 */
export class DebugConsole {
  private panel: Phaser.GameObjects.Container | null = null;

  constructor(private scene: GameScene) {
    // 场景关闭即清引用（与 reset 同语义，防御 create 之前就有 SHUTDOWN 的时序）
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.panel = null;
    });
  }

  get isOpen(): boolean {
    return this.panel !== null;
  }

  /**
   * 场景重启复位（C5）：panel 指向的容器随场景关闭已销毁，不置空的话
   * isOpen 恒真（ESC 分支会误以为控制台开着）、toggle() 也会对尸体操作。
   */
  reset(): void {
    if (this.panel && this.panel.scene) this.panel.destroy();
    this.panel = null;
  }

  toggle(): void {
    if (this.panel) { this.panel.destroy(); this.panel = null; return; }
    this.open();
  }

  private open(): void {
    // layout 逻辑常量（1920×1080）：scene.scale.width 在 DPR 底座上是物理像素，
    // K=2 时 W/2 会把面板钉到屏外右下角
    const c = this.scene.add.container(W / 2, H / 2).setDepth(950);
    this.panel = c;
    const bg = this.scene.add.graphics();
    bg.fillStyle(INK[900], 0.96);
    bg.fillRect(-360, -240, 720, 480);
    bg.lineStyle(2, GILT.base, 0.95);
    bg.strokeRect(-360, -240, 720, 480);
    bg.lineStyle(1, INK[500], 0.6);
    bg.strokeRect(-358, -238, 716, 476);
    bg.fillStyle(GILT.base, 0.08);
    bg.fillRect(-360, -240, 720, 28);
    c.add(bg);
    c.add(this.scene.add.text(0, -232, '实验控制台（仅调试版本）', { fontFamily: FONT.title, fontSize: '14px', color: css(GILT.light), letterSpacing: 2 }).setOrigin(0.5, 0));
    const btns: [string, string][] = [
      ['gold', '+50 金'], ['level', '+1 级'], ['hpPlus', '+20 生命'], ['comp', ' random 2★'],
      ['all2', ' bench 全 2★'], ['items', '1 full bag'], ['legend', '天命 3★'], ['skip', '快进到底'], ['reset', '清场'],
    ];
    for (let i = 0; i < btns.length; i++) {
      const [id, label] = btns[i];
      const x = -320 + (i % 4) * 170; const y = -190 + Math.floor(i / 4) * 54;
      const b = new Button(this.scene, x, y, label, () => this.handle(id), { width: 150, height: 42 });
      c.add(b);
    }
    c.add(this.scene.add.text(-320, 20, '快捷键：Ctrl+~ 唤起/关闭', { fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[400]) }).setOrigin(0, 0));
    // 关闭钮收进面板内：y=210 时底缘 247 越过面板底框 240（bg 外扩 1px）
    c.add(new Button(this.scene, 210, 192, '关闭', () => this.toggle(), { width: 100, height: 36, variant: 'primary' }));
    // Esc 也能关
  }

  private handle(id: string): void {
    const p = this.scene.match.human;
    switch (id) {
      case 'gold': p.gold += 50; break;
      case 'level': p.level = Math.min(9, p.level + 1); break;
      case 'hpPlus': p.hp = Math.min(PLAYER_START_HP, p.hp + 20); break;
      case 'comp': {
        // DEV 作弊台（Ctrl+~ 仅 DEV 注册）：取非战斗随机即可 —— 用 Rng 会
        // 消耗对局随机流，改写后续商店/掉落，反而破坏实机调试的可复现性
        const c = CHAMPIONS[Math.floor(Math.random() * CHAMPIONS.length)]; const slot = p.bench.findIndex((x) => x === null);
        if (slot >= 0) p.bench[slot] = { defId: c.id, star: 2, items: [], iid: newIid() };
        else this.scene.showToast('备战席已满', true); break;
      }
      case 'all2': for (let i = 0; i < p.bench.length; i++) { const c = CHAMPIONS[(i * 7) % CHAMPIONS.length]; p.bench[i] = { defId: c.id, star: 2, items: [], iid: newIid() }; } break;
      case 'legend': {
        // 五费三星·天命验收：三张同名 2★ 入席 → 走真实合成链出 3★ → 上场。
        // 没有它，3★ 天命档在实机上永远验不到（对局内自然合成成本极高）。
        const five = CHAMPIONS.find((c) => c.cost === 5) ?? CHAMPIONS[0];
        p.board.fill(null);
        p.bench.fill(null);
        for (let i = 0; i < 3; i++) p.bench[i] = { defId: five.id, star: 2 as Star, items: [], iid: newIid() };
        resolveMerges(p);
        const merged = p.bench.find((b) => b !== null && b.star === 3);
        if (merged) {
          const slot = p.board.findIndex((x) => x === null);
          p.bench[p.bench.indexOf(merged)] = null;
          p.board[slot] = merged;
        } else this.scene.showToast('合成异常', true);
        break;
      }
      case 'items': {
        // 满袋调试：整袋 6 件在备战席与器匣间按装备上限分发 —— 此前无视
        // MAX_ITEMS_PER_UNIT 一次塞 6 件/人，超出部分在装备三格槽外不可见，
        // 卖出时 stripItems 会把超出部分全量拆回器匣、静默撑爆 10 格上限。
        const bag = ['xuanjia', 'moren', 'lingzhu', 'yunlv', 'xueyu', 'fafu'];
        let given = 0;
        for (const slot of p.bench) {
          if (!slot) continue;
          const n = Math.min(MAX_ITEMS_PER_UNIT, bag.length - given);
          if (n <= 0) break;
          slot.items.push(...bag.slice(given, given + n));
          given += n;
        }
        p.items.push(...bag.slice(given));
        break;
      }
      case 'skip': void this.scene.fastForward(); break;
      case 'reset': p.board.fill(null); p.bench.fill(null); p.items.length = 0; break;
      default: break;
    }
    this.scene.afterAction();
    if (this.panel) { this.panel.destroy(); this.panel = null; this.open(); }
  }
}
