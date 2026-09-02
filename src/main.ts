import Phaser from 'phaser';
import { MenuScene } from './render/scenes/MenuScene';
import { GameScene, GAME_SCENE_H, GAME_SCENE_W } from './render/scenes/GameScene';
import { BattleScene } from './render/scenes/BattleScene';
import { ResultScene } from './render/scenes/ResultScene';
import { CodexScene } from './render/scenes/CodexScene';
import { audio } from './audio/AudioEngine';
import { preloadAiPieces } from './render/art/piece/aiBake';
import { preloadItemArt } from './render/board/itemIcons';
import { preloadSealFont } from './render/board/traitIcons';
import { VIEW_K } from './render/view/viewScale';
// 全局字号包装必须与下方 descent 垫高同处一条模块链：先经 textScale 放大
// 声明字号，updateText 才能按"渲染字号"算余量。场景都经 kit 间接依赖它，
// 这里显式引入把顺序钉死，防止未来某条 import 链绕开。
import './render/view/textScale';

/**
 * 直角体系（ART_BIBLE §9.2）：全项目禁用圆角矩形。
 *
 * 圆角是 web 应用的语言，水墨案头的语言是"界格"—— 直线裁切 + 四角短线。
 * 与其散落 110 处逐个盯防，不如在唯一的启动咽喉把 Graphics 的圆角方法
 * 一并接管为直角绘制：一处声明，处处生效，未来新代码也不可能违例。
 * 需要圆的场合（圆形粒子、光晕、印章本体）用的是 arc/ellipse/图片，不经此处。
 */
{
  const proto = Phaser.GameObjects.Graphics.prototype as unknown as Record<
    string,
    (this: Phaser.GameObjects.Graphics, ...a: unknown[]) => unknown
  >;
  proto.fillRoundedRect = function fillRectSq(this: Phaser.GameObjects.Graphics, x, y, w, h) {
    return this.fillRect(x as number, y as number, w as number, h as number);
  };
  proto.strokeRoundedRect = function strokeRectSq(this: Phaser.GameObjects.Graphics, x, y, w, h) {
    return this.strokeRect(x as number, y as number, w as number, h as number);
  };
}

/**
 * 容器命中矩形的锚定口径。
 *
 * Phaser 的输入命中测试会把局部坐标加上 displayOrigin 再做矩形包含，
 * 而容器的 displayOrigin 恒为「尺寸的一半」——等于要求容器的命中矩形以
 * 中心锚定书写。本工程所有容器（Button/ShopCard/ItemChip/奇遇卡……）的
 * 子对象一律从 (0,0) 左上布局、命中矩形也按左上锚定书写，两个口径相差
 * 整半个身位：按键只有左上一半可点，右下的点击静默丢失，悬停高亮同样
 * 只亮左上象限。在此把容器的 displayOrigin 归零，命中测试回到左上锚定，
 * 与写码口径一致 —— 一处声明，处处生效，未来新容器不可能再踩。
 */
{
  const proto = Phaser.GameObjects.Container.prototype;
  for (const axis of ['displayOriginX', 'displayOriginY'] as const) {
    Object.defineProperty(proto, axis, {
      get(this: Phaser.GameObjects.Container) {
        return 0;
      },
      configurable: true,
    });
  }
}

/**
 * 高清屏文字发糊的根治：文字纹理默认按 1× 栅格化，再经 FIT 的 CSS 缩放，
 * 在 125%/150% 系统缩放的屏幕上必然发虚。在唯一的建字咽喉给所有文本
 * 注入 2× 分辨率 —— 一处声明，处处清晰。
 */
{
  const RES = 2;
  for (const proto of [
    Phaser.GameObjects.GameObjectFactory.prototype,
    Phaser.GameObjects.GameObjectCreator.prototype,
  ] as unknown as Record<string, (...a: unknown[]) => unknown>[]) {
    // HMR 幂等守卫（与下方 __descentPadded 同款）：Vite 热重载会重新执行本模块，
    // 不加标记则每次重载都在已包裹的 proto.text 上再缠一层 ×2 resolution
    if ((proto.text as unknown as { __resolutionPatched?: boolean }).__resolutionPatched) continue;
    const orig = proto.text;
    const wrapped = function (this: unknown, x: unknown, y: unknown, text: unknown, style?: object, ...rest: unknown[]) {
      return orig.call(
        this,
        x,
        y,
        text,
        { resolution: RES, ...(style as object) },
        ...rest,
      );
    } as unknown as typeof orig & { __resolutionPatched?: boolean };
    wrapped.__resolutionPatched = true;
    proto.text = wrapped;
  }
}

/**
 * 文字底部削切的根治：Phaser 按浏览器上报的字体度量（ascent+descent）给
 * 文本纹理画布定高，而部分平台/字体组合（本作宋体族小字号实证，2026-09-01
 * 设置面板页脚 D/ESC 整行削底）上报的 descent 小于真实字形墨迹，画布在
 * 基线附近就截止——无下延的大写字母底部被水平削平。updateText 是纹理
 * 重建的唯一咽喉，在此给 metrics.descent 追加安全余量：画布只在基线
 * 下方变高，墨迹位置与 origin 锚点完全不动；余量随字号比例放大。
 * setStyle 换字体重建度量（伤害飘字等）后 markers 随新对象消失，
 * 「无标记即再补」自然覆盖该路径。
 */
{
  const proto = Phaser.GameObjects.Text.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const prev = proto.updateText;
  if (!(prev as { __descentPadded?: boolean }).__descentPadded) {
    const wrapped = function (this: Phaser.GameObjects.Text, ...args: unknown[]) {
      const size = (this.style as unknown as {
        metrics?: { ascent: number; descent: number; fontSize: number; __descentPadded?: boolean };
      })?.metrics;
      if (size && !size.__descentPadded) {
        size.descent += Math.max(2, Math.round(size.fontSize * 0.12));
        size.fontSize = size.ascent + size.descent;
        size.__descentPadded = true;
      }
      return prev.apply(this, args);
    } as ((...a: unknown[]) => unknown) & { __descentPadded?: boolean };
    wrapped.__descentPadded = true;
    proto.updateText = wrapped;
  }
}

/**
 * 启动入口。
 *
 * 设计分辨率固定 1920×1080，用 Scale.FIT 等比适配任意 16:9 窗口 ——
 * 缩放不错位、不裁切，逻辑坐标永远是 1920×1080。物理缓冲再乘 VIEW_K
 * （见 render/view/viewScale）：HiDPI 与系统缩放屏上 1 逻辑 px = 1 设备 px，
 * 整屏不再被 CSS 拉大发糊；相机 zoom = 1/K 由各场景 baseZoom 钉住。
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_SCENE_W * VIEW_K,
  height: GAME_SCENE_H * VIEW_K,
  // 画布透明：夜色山海（index.html #bg）作为全窗底，Phaser 只画内容层
  transparent: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_SCENE_W * VIEW_K,
    height: GAME_SCENE_H * VIEW_K,
    autoRound: true,
  },
  render: {
    antialias: true,
    powerPreference: 'high-performance',
    roundPixels: true,
    // 开启后 Phaser 会在 WebGL 下按需要清屏，避免长局累积的脏帧
    clearBeforeRender: true,
  },
  fps: {
    // rAF 模式下实际帧率跟随显示器刷新率（fps.limit 未设 = 不限），
    // target 只决定增量平滑的基准。设为 120：高刷屏吃满刷新率时
    // delta 平滑按 8.3ms 帧预算校准，避免长帧误判。
    target: 120,
    min: 30,
  },
  // 主菜单是场景流的根：Menu → Game ↔ Battle → Result → Menu；Codex 从 Menu 进入
  scene: [MenuScene, GameScene, BattleScene, ResultScene, CodexScene],
  disableContextMenu: true,
};

// 启动期唯一的几步异步：篆体子集 + AI 棋子图 + 装备图预解码。此后场景烘焙全同步。
// 零字体 / 零图时立即通过，互不阻塞。
await preloadSealFont();
// 篆体就绪（或已确认失联落楷体）才放行开屏「天」的入场动画 —— index.html 以
// #boot.seal 门控，保证第一笔画就是篆书，绝不先闪楷体再换字。
document.getElementById('boot')?.classList.add('seal');
await preloadAiPieces();
await preloadItemArt();

const game = new Phaser.Game(config);

// 画布语义垫脚石：纯 canvas 游戏无法给读屏器完整语义，但至少让主画布有
// 可朗读的身份说明（装饰性的 #bg 已在 index.html 标 aria-hidden）。
game.events.once('ready', () => {
  game.canvas.setAttribute('role', 'img');
  game.canvas.setAttribute('aria-label', '百战天元 · 夜宴对局画布：八人对弈自走棋，全部操作需用鼠标与键盘快捷键完成');
});

// E2E/截图直入备战层：?autostart=1 跳过菜单（仅 DEV）
if (import.meta.env.DEV && new URLSearchParams(location.search).has('autostart')) {
  game.events.once('ready', () => {
    game.scene.stop('Menu');
    game.scene.start('Game', { fresh: true });
  });
}

// 开发期把 game 挂到 window，方便在控制台/自动化里检视场景状态与驱动对局
if (import.meta.env.DEV) {
  (window as unknown as { __arena?: Phaser.Game }).__arena = game;
  (window as unknown as { __tftAudio?: typeof audio }).__tftAudio = audio;

  // QA 探针：把 console 的报错/警告抄一份到 ring buffer，供自动化脚本读取。
  // 只抄不吞 —— 原始 console 行为完全不变，所以"无 console 报错"这条验收
  // 依然是对着真实控制台说的，不是对着一个被静音的假控制台说的。
  const qa = { errors: [] as string[], warns: [] as string[] };
  (window as unknown as { __qa?: typeof qa }).__qa = qa;
  const bump = (arr: string[], args: unknown[]) => {
    arr.push(args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(' '));
    if (arr.length > 200) arr.shift();
  };
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    bump(qa.errors, args);
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    bump(qa.warns, args);
    origWarn(...args);
  };
}

// 首次交互解锁音频（浏览器自动播放策略）
const unlock = () => {
  audio.unlock();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// 自定义光标的悬停态桥接：index.html 的金环在悬停可交互对象时放大。
// 场景级 gameobjectover/out 汇入 body.cur-hover —— DOM 光标与画布内命中同源。
// InputPlugin 在 Scene SHUTDOWN 时 removeAllListeners，once 挂一次的桥接会在
// 首次切场景后丢弃。各场景 create() 已通过 kit.resetCursorOnShutdown 自持桥接
//（SHUTDOWN 清 cur-hover + 再次 START 重挂），此处只保留 ready 时的首屏挂载。
function wireCursorForScene(scene: Phaser.Scene): void {
  const doc = document.body.classList;
  // 幂等：先摘旧监听再挂新，避免重复挂载叠加
  try { scene.input.off('gameobjectover'); } catch { /* ignore */ }
  try { scene.input.off('gameobjectout'); } catch { /* ignore */ }
  scene.input.on('gameobjectover', () => doc.add('cur-hover'));
  scene.input.on('gameobjectout', () => doc.remove('cur-hover'));
}
game.events.once('ready', () => {
  for (const scene of game.scene.scenes) wireCursorForScene(scene);
});

// 隐藏加载序章：先让「弈」字与进度条走完入场（~1.5s），再上掀退场（clip-path 1.2s）。
// 刻意不用 requestAnimationFrame 包裹：后台标签页会节流 RAF，首帧回调不来
// boot 就永久滞留，把整屏点击都挡在序章上（实测事故，2026-08-30）。
const boot = document.getElementById('boot');
if (boot) {
  window.setTimeout(() => {
    boot.classList.add('hidden');
    window.setTimeout(() => boot.remove(), 1300);
  }, 1500);
}

// 开发期：把致命错误暴露在控制台之外，避免"白屏无提示"
window.addEventListener('error', (e) => {
  console.error('[百战天元] 运行时错误', e.error ?? e.message);
});

export default game;
