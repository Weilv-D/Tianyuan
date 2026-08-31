import Phaser from 'phaser';
import { audio } from '../../audio/AudioEngine';
import { loadMatch, loadPrefs } from '../../game/save';
import { dailySeedFor, loadDailyBest, todayKey } from '../../game/daily';
import { GAME_BUILD, GAME_VERSION } from '../../version';
import { CHAMPIONS } from '../../data/champions';
import { Button, FONT } from '../../ui/kit';
import { SettingsPanel } from '../../ui/SettingsPanel';
import { GILT, INK, PAPER, css } from '../view/palette';
import { bakeItemIcons } from '../board/itemIcons';
import { bakeSilhouettes, silhouetteKey } from '../board/silhouetteFactory';
import { buildTextures, grainOverlay } from '../view/textures';
import { baseZoom } from '../view/viewScale';
import { H, W } from '../view/layout';
import { motion } from '../view/motion';

/**
 * 主菜单场景。
 *
 * 场景流的根：新对局 / 继续上次存档 / 图鉴 / 设置。
 * 此前启动直接进对局，元游戏没有任何入口结构。
 */
export class MenuScene extends Phaser.Scene {
  private settings: SettingsPanel | null = null;

  constructor() {
    super({ key: 'Menu' });
  }

  create(): void {
    baseZoom(this);
    buildTextures(this);
    grainOverlay(this);
    bakeSilhouettes(this);
    bakeItemIcons(this);

    this.settings?.close();
    this.settings = null;

    // 背景：夜色山海由 index.html 的 #bg 承担（透明画布），场景不再铺底

    // 底部剪影长卷：几名棋子的墨影平铺，暗合"点将"的意象
    const picks = [7, 19, 31, 44, 56];
    picks.forEach((i, k) => {
      const def = CHAMPIONS[i % CHAMPIONS.length];
      const key = silhouetteKey(def.id, 0, 1);
      if (!this.textures.exists(key)) return;
      const img = this.add
        .image(W * 0.5 + (k - 2) * 260, H - 130, key)
        .setOrigin(0.5, 1)
        .setAlpha(0.34)
        .setTint(INK[500]);
      img.setDisplaySize(210, 260);
    });

    // 标题
    const title = this.add
      .text(W / 2, H * 0.26, '百 战 天 元', {
        fontFamily: FONT.kai,
        fontSize: '104px',
        color: css(PAPER[100]),
        letterSpacing: 26,
      })
      .setOrigin(0.5);
    title.setShadow(0, 0, css(GILT.base), 38, false, true);
    this.add
      .text(W / 2, H * 0.26 + 110, '八 人 对 弈　·　幽 冥 水 墨', {
        fontFamily: FONT.body,
        fontSize: '16px',
        color: css(GILT.base),
        letterSpacing: 8,
      })
      .setOrigin(0.5);
    this.add
      .text(W / 2, H * 0.26 + 142, '六十四棋 · 十七羁绊 · 墨兽轮 · 神兵谱', {
        fontFamily: FONT.body,
        fontSize: '13px',
        color: css(PAPER[500]),
        letterSpacing: 3,
      })
      .setOrigin(0.5);

    // 入口
    const hasSave = !!loadMatch();
    const prefs = loadPrefs();
    audio.setMuted(prefs.muted);
    motion.calm = prefs.calm;

    const bx = W / 2;
    let by = H * 0.52;
    const mk = (label: string, onClick: () => void, opts: { primary?: boolean; width?: number } = {}) => {
      const b = new Button(this, bx - (opts.width ?? 260) / 2, by, label, onClick, {
        width: opts.width ?? 260,
        height: 56,
        fontSize: 17,
        variant: opts.primary ? 'primary' : 'ghost',
      });
      by += 74;
      return b;
    };

    if (hasSave) {
      mk('继 续 对 局', () => this.scene.start('Game', {}), { primary: true });
      mk('新 对 局', () => this.scene.start('Game', { fresh: true }));
    } else {
      mk('新 对 局', () => this.scene.start('Game', { fresh: true }), { primary: true });
    }

    // 每日挑战（M4）：种子取自今日日期哈希，同一日反复进入是同一局。
    // daily.ts 的四个入口一律 try/catch —— 并行线未落地或本地存储异常时，
    // 种子回退随机、成绩行整行隐藏（与 save.ts 的容错口径一致）。
    let dailySeed = (Date.now() ^ 0x9e3779b1) >>> 0;
    try {
      dailySeed = dailySeedFor(new Date()) >>> 0;
    } catch {
      /* 回退随机种子 */
    }
    let bestText = '';
    try {
      const best = loadDailyBest();
      if (best && best.date === todayKey(new Date()) && Number.isFinite(best.rank) && best.rank >= 1) {
        bestText = `今日最佳 · 第 ${best.rank} 名`;
      }
    } catch {
      /* 无成绩记录或读取失败：不显示成绩行 */
    }
    const dailyBtnY = by;
    mk('每 日 挑 战', () => this.scene.start('Game', { daily: true, fresh: true, seed: dailySeed }));
    if (bestText) {
      // 成绩小字贴在按钮右侧：按钮纵向栈间距只够下一颗按钮，横排不与版本行/落款相犯
      this.add
        .text(bx + 148, dailyBtnY, bestText, {
          fontFamily: FONT.body,
          fontSize: '13px',
          color: css(PAPER[400]),
          letterSpacing: 2,
        })
        .setOrigin(0, 0.5);
    }
    mk('图　鉴', () => this.scene.start('Codex', {}));
    mk('设　置', () => {
      this.settings ??= new SettingsPanel(this, { prefs });
      this.settings.open();
    });

    this.add
      .text(W - 24, H - 20, '夜宴 · 幽冥水墨', {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(INK[300]),
        letterSpacing: 2,
      })
      .setOrigin(1, 0.5);

    // 版本戳（锁版基建）：左下角落款，与右下「文人案头」同规格、对角呼应，互不重叠
    this.add
      .text(24, H - 20, `v${GAME_VERSION} · ${GAME_BUILD}`, {
        fontFamily: FONT.body,
        fontSize: '12px',
        color: css(INK[300]),
        letterSpacing: 2,
      })
      .setOrigin(0, 0.5);

    audio.unlock();
    audio.startBgm('prep');

    this.cameras.main.fadeIn(360, 7, 9, 12);
    // ESC 在主菜单关设置
    this.input.keyboard?.on('keydown-ESC', () => this.settings?.close());
  }
}
