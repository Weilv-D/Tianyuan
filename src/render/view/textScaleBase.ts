/**
 * 全局字号基线常量（唯一真源）。
 *
 * 单独成模块的原因：render/view/hudLayout 是 HUD 几何真源，必须保持
 * 零 Phaser 依赖（tests 直接跑纯函数），而 textScale.ts 本体要 import Phaser
 * 打猴子补丁 —— 几何需要的是这个数字，不是补丁。
 *
 * 所有「按字号算宽度/列位」的布局都必须用本值换算渲染字号后再定预算；
 * 直接拿声明字号算预算，会在 textScale 放大后静默重叠（计分板名字压血条即此根因）。
 */
export const TEXT_SCALE = 1.12;

/** 声明字号 → 渲染字号（add.text 入口被 textScale 放大后的实际值） */
export function renderedSize(declaredSize: number): number {
  return Math.round(declaredSize * TEXT_SCALE);
}
