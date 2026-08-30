import Phaser from 'phaser';
import { INK, css } from './render/palette';
import { MenuScene } from './render/scenes/MenuScene';
import { GameScene, GAME_SCENE_H, GAME_SCENE_W } from './render/scenes/GameScene';
import { BattleScene } from './render/scenes/BattleScene';
import { ResultScene } from './render/scenes/ResultScene';
import { CodexScene } from './render/scenes/CodexScene';
import { audio } from './audio/AudioEngine';

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
    const orig = proto.text;
    proto.text = function (this: unknown, x, y, text, style, ...rest) {
      return orig.call(
        this,
        x,
        y,
        text,
        { resolution: RES, ...(style as object) },
        ...rest,
      );
    };
  }
}

/**
 * 启动入口。
 *
 * 设计分辨率固定 1920×1080，用 Scale.FIT 等比适配任意 16:9 窗口 ——
 * 缩放不错位、不裁切，逻辑坐标永远是 1920×1080。
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_SCENE_W,
  height: GAME_SCENE_H,
  backgroundColor: css(INK[900]),
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_SCENE_W,
    height: GAME_SCENE_H,
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

const game = new Phaser.Game(config);

// 开发期把 game 挂到 window，方便在控制台/自动化里检视场景状态与驱动对局
if (import.meta.env.DEV) {
  (window as unknown as { __arena?: Phaser.Game }).__arena = game;

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

// 隐藏加载遮罩
const boot = document.getElementById('boot');
if (boot) {
  requestAnimationFrame(() => {
    boot.classList.add('hidden');
    window.setTimeout(() => boot.remove(), 500);
  });
}

// 开发期：把致命错误暴露在控制台之外，避免"白屏无提示"
window.addEventListener('error', (e) => {
  console.error('[百战天元] 运行时错误', e.error ?? e.message);
});

export default game;
