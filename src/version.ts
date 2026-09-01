/**
 * 全局版本戳（M2 锁版基建）。
 *
 * 这是版本信息的唯一真源：
 *  - 主菜单（MenuScene）左下角落款从此取值；
 * 发版时与 package.json 同步，并在 CHANGELOG 记录同一版本，三处一致即为锁版状态。
 * 游戏逻辑严禁引用时间与随机源 —— 这里只有两个常量，供展示层安全使用。
 */

/** 游戏语义版本（与 package.json 的 version 字段保持一致） */
export const GAME_VERSION = '1.8.0';

/** 构建日期戳（对齐 M2 锁版日，随手改版本号一起更新） */
export const GAME_BUILD = '2026-09-01';
