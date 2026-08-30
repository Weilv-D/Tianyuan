/** 职责：DEV 专属实验控制台（Ctrl+~ 唤起）——金/级/生命/卡牌/装备等调试注入按钮，仅调试版本可见。 */
import Phaser from 'phaser';
import { CHAMPIONS } from '../../data/champions';
import { PLAYER_START_HP } from '../../core/config';
import { newIid } from '../../game/state';
import { FONT, Button } from '../../ui/kit';
import { INK, GILT, PAPER, css } from '../palette';
import type { GameScene } from '../scenes/GameScene';

/**
 * 实验控制台（原 GameScene.toggleDebug/openDebug/handleDebug 原样搬移）。
 * 构造一次、随场景实例存活：debugPanel 的开合状态与旧行为一致，不随 create() 复位。
 */
export class DebugConsole {
  private panel: Phaser.GameObjects.Container | null = null;

  constructor(private scene: GameScene) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  toggle(): void {
    if (this.panel) { this.panel.destroy(); this.panel = null; return; }
    this.open();
  }

  private open(): void {
    const W = this.scene.scale.width; const H = this.scene.scale.height;
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
      ['all2', ' bench 全 2★'], ['items', '1 full bag'], ['skip', '快进到底'], ['reset', '清场'],
    ];
    for (let i = 0; i < btns.length; i++) {
      const [id, label] = btns[i];
      const x = -320 + (i % 4) * 170; const y = -190 + Math.floor(i / 4) * 54;
      const b = new Button(this.scene, x, y, label, () => this.handle(id), { width: 150, height: 42 });
      c.add(b);
    }
    c.add(this.scene.add.text(-320, 20, '快捷键：Ctrl+~ 唤起/关闭', { fontFamily: FONT.body, fontSize: '12px', color: css(PAPER[400]) }).setOrigin(0, 0));
    c.add(new Button(this.scene, 210, 210, '关闭', () => this.toggle(), { width: 100, height: 36, variant: 'primary' }));
    // Esc 也能关
  }

  private handle(id: string): void {
    const p = this.scene.match.human;
    switch (id) {
      case 'gold': p.gold += 50; break;
      case 'level': p.level = Math.min(9, p.level + 1); break;
      case 'hpPlus': p.hp = Math.min(PLAYER_START_HP, p.hp + 20); break;
      case 'comp': {
        const c = CHAMPIONS[Math.floor(Math.random() * CHAMPIONS.length)]; const slot = p.bench.findIndex((x) => x === null);
        if (slot >= 0) p.bench[slot] = { defId: c.id, star: 2, items: [], iid: newIid() };
        else this.scene.showToast('备战席已满', true); break;
      }
      case 'all2': for (let i = 0; i < p.bench.length; i++) { const c = CHAMPIONS[(i * 7) % CHAMPIONS.length]; p.bench[i] = { defId: c.id, star: 2, items: [], iid: newIid() }; } break;
      case 'items': if (p.bench.some((x) => x)) { for (const slot of p.bench) if (slot) slot.items = ['xuanjia', 'moren', 'lingzhu', 'yunlv', 'xueyu', 'fafu']; } else p.items.push(...['xuanjia', 'moren', 'lingzhu']); break;
      case 'skip': void this.scene.fastForward(); break;
      case 'reset': p.board.fill(null); p.bench.fill(null); p.items.length = 0; break;
      default: break;
    }
    this.scene.afterAction();
    if (this.panel) { this.panel.destroy(); this.panel = null; this.open(); }
  }
}
