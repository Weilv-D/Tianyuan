import type Phaser from 'phaser';
import { H, W } from './layout';

/**
 * 画布底座倍率 —— 高分屏整屏发糊的根治。
 *
 * 画布物理缓冲 = 1920×1080 × K，CSS 尺寸仍由 Scale.FIT 适配窗口：
 * K 抹平 devicePixelRatio 与系统缩放后，1 逻辑 px 恰好落在 K 物理像素上，
 * FIT 的 CSS 拉伸归零。相机 zoom = K（1 逻辑 px → K 物理 px），逻辑坐标
 * 恒为 1920×1080，布局代码零感知；文字 resolution:2 与原生分辨率棋子
 * 烘焙在采样端 1:1 落地。
 */
export const VIEW_K = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);

/** 相机基准 zoom（逻辑 1920×1080 → 物理 1920K×1080K 的唯一换算） */
export const CAM_ZOOM = VIEW_K;

/**
 * 场景 create() 统一调用：把主相机钉在逻辑坐标系上。
 *
 * zoom≠1 时相机的取景锚点是「scroll + 半宽（物理 px）」而非视口左上，
 * 不重钉锚点整个世界会偏移 K×(W/2)。centerOn 把锚点定在世界正中，
 * 视图恰为 [0..1920]×[0..1080]，对任意 K 成立；受击 punch 围绕同一锚点缩放。
 */
export function baseZoom(scene: Phaser.Scene): void {
  const cam = scene.cameras.main;
  cam.setZoom(CAM_ZOOM);
  cam.centerOn(W / 2, H / 2);
}
