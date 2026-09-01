/**
 * 全局字号缩放 —— 可视性基线（1.7.0）。
 *
 * 全项目的文本经由唯一的建字咽喉（GameObjectFactory / GameObjectCreator 的
 * text 方法）创建，在此把显式 fontSize 统一放大 12%：桌面 16:9 下 12px 正文
 * 经 FIT 缩到 1600×900 视口后只有 10 物理px，可读性不足。缩放发生在文本
 * 创建入口，已测量的布局（makeChip 自测宽、clipToWidth 截断、行高流式排布）
 * 全部自动适配；不经过该入口的 canvas 烘焙字（羁绊篆徽、开屏篆体）不受影响。
 *
 * 本模块是副作用模块：在 ui/kit.ts 顶部导入，保证任何场景建字之前已挂好。
 */
import Phaser from 'phaser';
import { TEXT_SCALE } from './textScaleBase';

const SCALE = TEXT_SCALE;

{
  type TextFn = (this: unknown, ...a: unknown[]) => unknown;
  for (const proto of [
    Phaser.GameObjects.GameObjectFactory.prototype,
    Phaser.GameObjects.GameObjectCreator.prototype,
  ] as unknown as Record<string, TextFn>[]) {
    // 幂等守卫：Vite HMR 会重读本模块，不判重就在旧包装上再缠一层 ×1.12。
    // 已打过补丁的原型跳过（continue），另一个原型仍要独立检查 —— 用 break
    // 会把 Creator 留在未补丁状态，HMR 后 create 出的字全部缩回 1×。
    const prev = proto.text as TextFn & { __textScaled?: boolean };
    if (prev?.__textScaled) continue;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const [x, y, text, style, ...rest] = args as [number, number, string, Phaser.Types.GameObjects.Text.TextStyle | undefined, unknown[]];
      let s = style;
      if (s) {
        const fs = s.fontSize as unknown;
        if (typeof fs === 'string') {
          const m = /^(\d+(?:\.\d+)?)px$/.exec(fs);
          if (m) s = { ...s, fontSize: `${Math.round(parseFloat(m[1]) * SCALE)}px` };
        } else if (typeof fs === 'number') {
          s = { ...s, fontSize: Math.round(fs * SCALE) };
        }
      }
      return prev.call(this, x, y, text, s, ...rest);
    } as TextFn & { __textScaled?: boolean };
    wrapped.__textScaled = true;
    proto.text = wrapped;
  }
}

export { TEXT_SCALE };
