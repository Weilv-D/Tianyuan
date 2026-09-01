import type Phaser from 'phaser';
import { BOARD_SIZE, H, W } from './layout';

/**
 * 画布底座倍率 —— 高分屏整屏发糊的根治。
 *
 * 画布物理缓冲 = 1920×1080 × K，CSS 尺寸仍由 Scale.FIT 适配窗口：
 * K 抹平 devicePixelRatio 与系统缩放后，1 逻辑 px 恰好落在 K 物理像素上，
 * FIT 的 CSS 拉伸归零。相机 zoom = K（1 逻辑 px → K 物理 px），逻辑坐标
 * 恒为 1920×1080，布局代码零感知；文字 resolution:2 与原生分辨率棋子
 * 烘焙在采样端 1:1 落地。
 */
export const VIEW_K = Math.min(
  Math.max(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1),
  2,
);

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

/**
 * 画布像素 → 世界坐标（1920×1080 逻辑系）。
 *
 * Phaser 的 pointer.x/y 是画布分辨率空间（1920K×1080K），而场景级命中检测
 * （棋盘/备战席/器匣/出售印）全部拿它比对世界常量 —— K≠1 时整体 K 倍偏移。
 * 本工程相机恒满足 scroll=0（baseZoom centerOn 钉锚），换算精确为 px/zoom。
 * zoom 必须取**当下**的相机 zoom（celebrate 推镜期间是 CAM_ZOOM×1.012），
 * 而不是常量，否则推镜窗口内的拖拽落点会偏。
 */
export function screenToWorld(px: number, py: number, zoom: number): { x: number; y: number } {
  return { x: px / zoom, y: py / zoom };
}

// ── 战斗场景棋盘层（BattleScene 布局与指针换算的唯一真源）────────
//
// 战斗时棋盘层整体放大 1.25×（棋子/特效/飘字/投射物随之），层外组件
// （左右阵容面板 / 顶栏 / 底部控制条 / 悬停卡）不受影响：
//   层世界范围 x ∈ [560, 1360] 落在左右面板（344 / 1576）之间，
//   y ∈ [108, 908] 让开顶部带（≤84）——底部控制条对齐层底 + 24。
// 常量放这里（而非场景内）让指针逆变换可以被核心测试直接断言。

/** 棋盘层放大系数（盘 640 → 800） */
export const BATTLE_BOARD_SCALE = 1.25;
/** 放大后的棋盘层边长（世界 px） */
export const BATTLE_BOARD_SIZE = BOARD_SIZE * BATTLE_BOARD_SCALE;
/** 棋盘层左上角（世界坐标） */
export const BATTLE_BOARD_LX = (W - BATTLE_BOARD_SIZE) / 2;
export const BATTLE_BOARD_LY = 108;

/** 世界坐标 → 棋盘层局部坐标（战斗场景指针悬停命中的唯一入口） */
export function battleWorldToLayer(x: number, y: number): { x: number; y: number } {
  return { x: (x - BATTLE_BOARD_LX) / BATTLE_BOARD_SCALE, y: (y - BATTLE_BOARD_LY) / BATTLE_BOARD_SCALE };
}
