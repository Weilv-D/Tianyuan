import Phaser from 'phaser';

/**
 * 场景切换过渡 —— 五场景统一 160ms 淡出到夜色再 start，入场淡入。
 *
 * 之前的切换是"硬切"（极少数点有私有 fadeOut，参数各异、时长不一），
 * 场景之间没有连续的视觉过渡。统一走这一对函数后，切换点不再各自写
 * fadeOut + delayedCall 的样板；淡出开始即关闭输入，防止切走瞬间误点。
 */
const COLOR = [7, 9, 12] as const; // 夜墨（与既有 fadeOut(7,9,12) 同色）

/** 淡出到夜色后切换场景。data 原样交给目标场景 create()。 */
export function fadeTo(scene: Phaser.Scene, key: string, data?: object, ms = 160): void {
  scene.input.enabled = false; // 淡出期间不再响应任何输入
  scene.cameras.main.fadeOut(ms, ...COLOR);
  scene.time.delayedCall(ms + 24, () => scene.scene.start(key, data));
}

/** 场景入场：从夜色淡入。各场景 create() 首部调用一次。 */
export function fadeIn(scene: Phaser.Scene, ms = 160): void {
  scene.cameras.main.fadeIn(ms, ...COLOR);
}
