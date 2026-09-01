import Phaser from 'phaser';
// 副作用：全局字号缩放必须先于任何场景建字挂载（见 render/view/textScale）
import '../render/view/textScale';
import { css, CINNABAR, DANGER, GILT, INK, PAPER, UI } from '../render/view/palette';
import { bakedTexture } from '../render/view/bake';
import { screenToWorld } from '../render/view/viewScale';
import { audio } from '../audio/AudioEngine';

/**
 * UI 设计系统基元 —— 「夜宴 · 幽冥水墨」体系。
 *
 * 字体三线：楷体（标题/品牌/印文的书写感）、宋体（正文的刻本感）、
 * mono（数值与英文小注的仪器感）。控件语言是"大漆描金"：
 * 1px 金线描边、半透漆底、悬停提亮而非发光。任何面板、按钮、徽章
 * 都不允许自己定义圆角与线宽。
 */

export const FONT = {
  /** 标题/品牌/印文：楷体 —— 书写的字，不是排印的字 */
  kai: '"Kaiti SC", "STKaiti", "KaiTi", "Songti SC", serif',
  /** 标题：宋体 + 字距，碑刻感 */
  title: '"Songti SC", "STZhongsong", "Noto Serif SC", "SimSun", serif',
  /** 正文：同一宋体族 —— 全 serif 是本体系的身份 */
  body: '"Songti SC", "STSong", "Noto Serif SC", "SimSun", serif',
  /** 数字：衬线拉丁数字与宋体同构，且小字号更清晰 */
  num: 'Georgia, "Songti SC", "SimSun", serif',
  /** 仪器小注：回合数、金数、英文微标 */
  mono: '"SF Mono", "Menlo", "Consolas", "Courier New", monospace',
} as const;

/** 标题字距（宋体拉开才好看，挤在一起就成报纸） */
export const TRACK = {
  title: 3,
  label: 1,
} as const;

export const RADIUS = 0; // 直角体系：圆角在 main.ts 的 Graphics 接管处被全局禁用
export const GRID = 4;

/**
 * 界格角饰 —— 本体系的"圆角替代品"。
 * 四角短线像漆盘木胎的界格钉，直角由此获得装饰性而不显生硬。
 */
export function cornerTicks(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha = 0.55,
  len = 9,
): void {
  g.lineStyle(2, color, alpha);
  g.beginPath();
  g.moveTo(x, y + len);
  g.lineTo(x, y);
  g.lineTo(x + len, y);
  g.moveTo(x + w - len, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + len);
  g.moveTo(x + w, y + h - len);
  g.lineTo(x + w, y + h);
  g.lineTo(x + w - len, y + h);
  g.moveTo(x + len, y + h);
  g.lineTo(x, y + h);
  g.lineTo(x, y + h - len);
  g.strokePath();
}

export interface PanelOptions {
  title?: string;
  accent?: number;
  alpha?: number;
  padding?: number;
}

export function makePanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: PanelOptions = {},
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const accent = opts.accent ?? GILT.deep;
  const a = opts.alpha ?? 0.9;

  // 面板底是死的：烤成纹理（角饰外扩 3px，画布四边留 4px 边距），每帧成本归零
  const key = `panel_v3_${Math.round(w)}x${Math.round(h)}_${accent.toString(16)}_${a}`;
  bakedTexture(scene, key, w + 8, h + 8, (g) => {
    g.translateCanvas(4, 4);
    g.fillStyle(INK[800], Math.min(0.82, a));
    g.fillRect(0, 0, w, h);
    // 顶部一道强调线：让每块面板都有"标题带"的秩序感
    g.fillStyle(accent, 0.55);
    g.fillRect(0, 0, w, 1.5);
    // 细线语言：外圈墨线 1px，内圈金色发丝线若隐若现
    g.lineStyle(1, INK[500], 1);
    g.strokeRect(0, 0, w, h);
    g.lineStyle(1, GILT.base, 0.12);
    g.strokeRect(1.5, 1.5, w - 3, h - 3);
    // 界格角饰：直角体系的签名
    cornerTicks(g, -3, -3, w + 6, h + 6, accent, 0.45);
  });
  c.add(scene.add.image(-4, -4, key).setOrigin(0));

  if (opts.title) {
    const t = scene.add
      .text(GRID * 3, GRID * 2.5, opts.title, {
        fontFamily: FONT.title,
        fontSize: '16px',
        color: css(PAPER[100]),
        letterSpacing: TRACK.title,
      })
      .setAlpha(0.92);
    c.add(t);
  }
  return c;
}

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

export interface ButtonOptions {
  variant?: ButtonVariant;
  width?: number;
  height?: number;
  fontSize?: number;
  disabled?: boolean;
}

/**
 * 描边式按钮：夜宴的按钮没有"实心色块"——只有漆底、金线与提亮。
 * 四态（常态/悬停/按下/禁用）各自烘焙一张纹理，redraw 只换贴图。
 */
export class Button extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private readonly btnW: number;
  private readonly btnH: number;
  private readonly variant: ButtonVariant;
  private disabled = false;
  private hovered = false;
  private pressed = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    onClick: () => void,
    opts: ButtonOptions = {},
  ) {
    super(scene, x, y);
    this.btnW = opts.width ?? 108;
    this.btnH = opts.height ?? 34;
    this.variant = opts.variant ?? 'ghost';
    this.disabled = opts.disabled ?? false;

    this.bg = scene.add.image(-1, -1, '__btn').setOrigin(0);
    this.label = scene.add
      .text(this.btnW / 2, this.btnH / 2, text, {
        fontFamily: FONT.title,
        fontSize: `${opts.fontSize ?? 14}px`,
        color: css(PAPER[100]),
        letterSpacing: TRACK.title,
      })
      .setOrigin(0.5);

    this.add([this.bg, this.label]);
    this.setSize(this.btnW, this.btnH);
    // 命中区向四周外扩 5px：快速点击时指尖/指针常有 1~2px 漂移，
    // 贴边按下被判"没点上"是"点击不灵敏"的主要来源
    const pad = 5;
    this.setInteractive(
      new Phaser.Geom.Rectangle(-pad, -pad, this.btnW + pad * 2, this.btnH + pad * 2),
      Phaser.Geom.Rectangle.Contains,
    );

    this.on('pointerover', () => {
      this.hovered = true;
      this.redraw();
      scene.input.setDefaultCursor('pointer');
    });
    this.on('pointerout', () => {
      this.hovered = false;
      this.pressed = false;
      this.setScale(1);
      this.redraw();
      scene.input.setDefaultCursor('default');
    });
    this.on('pointerdown', () => {
      if (this.disabled) return;
      this.pressed = true;
      // 按下 0.96 / 70ms 弹回：触觉反馈交给形变，不靠发光
      scene.tweens.add({ targets: this, scale: 0.96, duration: 70, yoyo: true });
      this.redraw();
      audio.play('ui');
    });
    this.on('pointerup', () => {
      if (this.disabled) return;
      this.pressed = false;
      this.setScale(1);
      this.redraw();
      onClick();
    });

    this.redraw();
    scene.add.existing(this);
  }

  setText(s: string): void {
    // setText 会触发整段文本重新栅格化（2× 分辨率下更贵），同值直接跳过
    if (this.label.text === s) return;
    this.label.setText(s);
  }

  setDisabled(v: boolean): void {
    this.disabled = v;
    this.label.setAlpha(v ? 0.35 : 1);
    this.redraw();
  }

  private redraw(): void {
    const state = this.disabled ? 'dis' : this.pressed ? 'prs' : this.hovered ? 'hov' : 'nrm';
    const w = this.btnW;
    const h = this.btnH;
    const key = `btnv3_${this.variant}_${w}x${h}_${state}`;
    bakedTexture(this.scene!, key, w + 2, h + 2, (g) => {
      g.translateCanvas(1, 1);
      // 三变体的漆底与线色：primary 金、danger 朱、ghost 墨
      const wash = this.variant === 'ghost' ? INK[800] : this.variant === 'primary' ? GILT.base : CINNABAR.base;
      const washA = this.variant === 'ghost' ? 0.5 : this.variant === 'primary' ? 0.13 : 0.09;
      const line =
        this.variant === 'primary' ? GILT.base : this.variant === 'danger' ? CINNABAR.base : GILT.base;

      if (!this.disabled) {
        g.fillStyle(wash, washA);
        g.fillRect(0, 0, w, h);
      } else {
        g.fillStyle(INK[850], 0.55);
        g.fillRect(0, 0, w, h);
      }

      if (!this.disabled) {
        if (this.pressed) {
          // 按下：明显提亮 + 亮边 2px，松手即回落
          const hi = this.variant === 'danger' ? DANGER.light : GILT.light;
          g.fillStyle(PAPER[100], 0.12);
          g.fillRect(0, 0, w, h);
          g.lineStyle(2, hi, 0.95);
        } else if (this.hovered) {
          const hi = this.variant === 'danger' ? CINNABAR.light : GILT.light;
          g.fillStyle(GILT.base, this.variant === 'danger' ? 0.07 : 0.08);
          g.fillRect(0, 0, w, h);
          g.lineStyle(1.5, hi, 0.9);
        } else {
          g.lineStyle(1, line, this.variant === 'ghost' ? 0.35 : this.variant === 'danger' ? 0.55 : 0.7);
        }
      } else {
        g.lineStyle(1, INK[500], 0.4);
      }
      g.strokeRect(0, 0, w, h);
      if (!this.pressed && !this.disabled) {
        // 内侧发丝高光：斜面感来自细线而不是粗边
        g.lineStyle(1, PAPER[100], this.hovered ? 0.1 : 0.05);
        g.strokeRect(1.5, 1.5, w - 3, h - 3);
      }
    });
    this.bg.setTexture(key);
    // 主按钮的字是米金，危按钮的字是朱砂亮字——按钮的身份先于阅读到达
    const idle =
      this.variant === 'primary' ? GILT.light : this.variant === 'danger' ? CINNABAR.light : PAPER[100];
    this.label.setColor(css(this.pressed ? PAPER[50] : idle));
  }
}

/** 带过渡的数值条。任何数值变化都走 200~400ms 补间，没有生硬跳变。 */
export class Bar extends Phaser.GameObjects.Container {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly barW: number;
  private readonly barH: number;
  private readonly color: number;
  private value = 1;
  private shown = 1;
  private ghost = 1;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, color: number) {
    super(scene, x, y);
    this.barW = w;
    this.barH = h;
    this.color = color;
    // 底槽与描边是死的，烤成一张图；只有"充到多少"是活的。
    const key = `barTrack_v3_${Math.round(w)}_${Math.round(h)}`;
    bakedTexture(scene, key, w + 2, h + 2, (g) => {
      g.fillStyle(INK[950], 0.85);
      g.fillRect(0, 0, w + 2, h + 2);
      g.fillStyle(INK[600], 1);
      g.fillRect(1, 1, w, h);
      g.lineStyle(1, INK[500], 0.9);
      g.strokeRect(1, 1, w, h);
    });
    this.add(scene.add.image(-1, -1, key).setOrigin(0));
    this.g = scene.add.graphics();
    this.add(this.g);
    this.redraw();
    scene.add.existing(this);
    // Container 默认不在 scene 的 update list 里，补间动画（残影条）不会自己跑。
    // 这里手动登记，否则带过渡的数值条会静止在初始值 —— 这个坑很隐蔽，
    // 因为 setValue(animate=false) 看起来是好的，只有动画路径会露出问题。
    scene.sys.updateList.add(this);
  }

  /** Phaser 的 UpdateList 只调 preUpdate，转发到 update */
  preUpdate(): void {
    this.update();
  }

  override destroy(fromScene?: boolean): void {
    // 场景先亡时 sys.updateList 已整体 shutdown（自然移除本条），不再手工摘
    if (this.scene && this.scene.sys) this.scene.sys.updateList.remove(this);
    super.destroy(fromScene);
  }

  setValue(v: number, animate = true): void {
    this.value = Phaser.Math.Clamp(v, 0, 1);
    if (!animate) {
      this.shown = this.value;
      this.ghost = this.value;
      this.redraw();
    }
  }

  override update(): void {
    if (Math.abs(this.shown - this.value) > 0.0005) {
      this.shown += (this.value - this.shown) * 0.14;
      this.redraw();
    }
    // 残影条：掉血时留下缓慢追赶的白色残影，伤害量一眼可读
    if (this.ghost > this.shown) {
      this.ghost += (this.shown - this.ghost) * 0.05;
      this.redraw();
    } else if (this.ghost < this.shown) {
      this.ghost = this.shown;
    }
  }

  /** 只画"填充到哪了"这三块；底槽与描边已在烘焙图里 */
  private redraw(): void {
    const g = this.g;
    const w = this.barW;
    const h = this.barH;
    g.clear();
    if (this.ghost > this.shown) {
      g.fillStyle(PAPER[100], 0.32);
      g.fillRect(0, 0, w * this.ghost, h);
    }
    g.fillStyle(this.color, 1);
    g.fillRect(0, 0, w * this.shown, h);
    g.fillStyle(PAPER[50], 0.2);
    g.fillRect(1, 1, Math.max(0, w * this.shown - 2), Math.max(1, h * 0.32));
  }
}

/** 徽章：羁绊档位、稀有度标签等 */
export function makeChip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: number,
  active = true,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const t = scene.add
    .text(0, 0, text, {
      fontFamily: FONT.body,
      fontSize: '12px',
      color: active ? css(PAPER[100]) : css(PAPER[500]),
      letterSpacing: TRACK.label,
    })
    .setOrigin(0, 0.5);
  const w = t.width + 16;
  const h = 22;
  const g = scene.add.graphics();
  g.fillStyle(active ? INK[700] : INK[800], active ? 0.9 : 0.55);
  g.fillRect(0, -h / 2, w, h);
  g.lineStyle(1.4, active ? color : INK[500], active ? 0.9 : 0.45);
  g.strokeRect(0, -h / 2, w, h);
  if (active) {
    g.fillStyle(color, 0.14);
    g.fillRect(0, -h / 2, w, h);
  }
  c.add([g, t]);
  t.setPosition(8, 0);
  c.setSize(w, h);
  return c;
}

/** 分隔线 */
export function divider(scene: Phaser.Scene, x: number, y: number, w: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setPosition(x, y);
  g.lineStyle(1, INK[500], 0.8);
  g.lineBetween(0, 0, w, 0);
  g.lineStyle(1, GILT.base, 0.12);
  g.lineBetween(0, 1, w, 1);
  return g;
}

/**
 * 场景 SHUTDOWN 时复位自定义光标 + 自持悬停桥接（C6 / P1-1）。
 *
 * 画布光标 Phaser 会在 InputPlugin.shutdown 里自己重置，但 index.html 的
 * 金环光标（body.cur-hover）挂在 DOM 上：悬停高亮点亮时切场景，监听随场景
 * 消失而 cur-hover 类永远留在 body 上。各场景 create() 统一调用一次。
 *
 * 悬停桥接（gameobjectover/out → body.cur-hover）在 main.ts 里只于游戏
 * ready 时挂一次，而 InputPlugin.shutdown() 会 removeAllListeners —— 首次
 * 场景切换后金环的悬停放大态永久失效。这里把桥接改为场景自持：create 时挂，
 * SHUTDOWN 后标记失效，场景再次 START 时重挂（与 main.ts 的初始桥接并存，
 * classList 增删幂等）。
 */
export function resetCursorOnShutdown(scene: Phaser.Scene): void {
  const flag = scene.input as unknown as {
    __curHoverBound?: boolean;
    __curHoverLifecycleBound?: boolean;
  };
  const attach = () => {
    if (flag.__curHoverBound) return;
    flag.__curHoverBound = true;
    const doc = document.body.classList;
    scene.input.on('gameobjectover', () => doc.add('cur-hover'));
    scene.input.on('gameobjectout', () => doc.remove('cur-hover'));
  };
  attach();
  if (flag.__curHoverLifecycleBound) return;
  flag.__curHoverLifecycleBound = true;
  // once 只覆盖第一次关闭：场景实例跨局复用，每次关闭都要复位光标与桥接标记
  scene.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
    flag.__curHoverBound = false;
    scene.input.setDefaultCursor('default');
    document.body.classList.remove('cur-hover');
  });
  scene.events.on(Phaser.Scenes.Events.START, attach);
}

/** 有变化守卫的 setText：文本栅格化只发生在字符串真正变化时 */
export function setTextIf(t: Phaser.GameObjects.Text, s: string): void {
  if (t.text !== s) t.setText(s);
}

/** 文本按像素宽截断（末端省略号）。返回实际落地的字符串。 */
export function clipToWidth(t: Phaser.GameObjects.Text, s: string, maxW: number): string {
  t.setText(s);
  while (t.width > maxW && t.text.length > 2) {
    t.setText(t.text.slice(0, -2).trimEnd() + '…');
  }
  return t.text;
}

export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size = 13,
  color = UI.textSecondary,
  font: 'title' | 'body' = 'body',
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, {
      fontFamily: font === 'title' ? FONT.title : FONT.body,
      fontSize: `${size}px`,
      color: typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color,
    })
    .setOrigin(0, 0);
}

/**
 * 可滚动列表：给容器套几何遮罩并接管滚轮。
 *
 * 用于内容行数不定的面板（羁绊面板、战斗阵容面板）：行数超出可视高时滚动，
 * 不超出时滚轮是空操作。内容高度由调用方在重建后通过 setHeight 告知 ——
 * Container 的 height 依赖 getBounds 计算，重建频繁的面板自己记账更便宜。
 */
export interface ScrollHandle {
  /** 内容实际高度（px）。≤ 可视高时复位到顶部 */
  setHeight(contentH: number): void;
  /** 摘除滚轮监听并销毁遮罩 —— 容器被销毁前必须调用，否则监听逐次累积 */
  destroy(): void;
}

export function enableScroll(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  viewX: number,
  viewY: number,
  viewW: number,
  viewH: number,
): ScrollHandle {
  const homeY = container.y;
  let max = 0;
  const clamp = () => {
    container.y = Phaser.Math.Clamp(container.y, homeY - max, homeY);
  };
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillRect(viewX, viewY, viewW, viewH);
  container.setMask(g.createGeometryMask());
  // wheel 回调实参顺序为 (pointer, overObjects, deltaX, deltaY, deltaZ)
  const onWheel = (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
    if (max <= 0 || !container.scene || !container.visible) return;
    // 指针必须落在这个视口内：否则并排的多个滚动区（侧栏+浮层）会同时滚。
    // p.x/y 是画布像素（1920K 系），视口矩形是世界系 —— 必须先换算（A1）
    const { x, y } = screenToWorld(p.x, p.y, scene.cameras.main.zoom);
    if (x < viewX || x > viewX + viewW || y < viewY || y > viewY + viewH) return;
    container.y -= dy;
    clamp();
  };
  scene.input.on('wheel', onWheel);
  return {
    setHeight(contentH: number): void {
      max = Math.max(0, contentH - viewH);
      if (max <= 0) container.y = homeY;
      else clamp();
    },
    destroy(): void {
      scene.input.off('wheel', onWheel);
      container.clearMask(true);
      // GeometryMask.destroy() 只置空引用，遮罩 Graphics 本体必须自己销毁 ——
      // 它由 make.graphics(addToScene=false) 创建、不在显示列表，
      // 场景关闭不会回收它，不销毁就随每次面板开关累积一枚
      g.destroy();
    },
  };
}
