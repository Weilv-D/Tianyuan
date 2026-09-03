/**
 * 棋子头顶栈与冠弧的几何真源 —— 纯算术、零 Phaser 依赖（tests 直接运行）。
 *
 * 为什么要有这个模块：头顶锚件（血条/法力/星标/装备行/三星冠弧）曾是
 * 五处各自内联的 y，其中旧 overheadY 把星级缩放 s 乘进了 contentH——
 * 而剪影内容早已归一（silContentHeight 不随 star 缩放）、容器又缩放一次，
 * 双重应用让头顶净距变成 9s + contentH·s·(s-1)：1★ 只剩 2px、3★ 虚涨 23px，
 * 装备行掉进这道虚涨的空隙带与整环冠饰相撞。
 *
 * 语义定稿：**头顶栈全部以世界像素定义**（恒定大小）——
 * 体量表达只属于剪影与底座（容器缩放），头顶 UI 是跨星级一致的标准件：
 * 血条/装备行 1★ 与 3★天命 同宽同高，锚件不随星级缩放跳动。
 * 局部绘制尺寸 = 世界尺寸 / containerScale（容器子对象会被容器缩放）。
 *
 * 坐标语义：headStackLayout 返回**容器局部 y**（y 向下为正，剪影脚底 = 0）；
 * 常量全部为**世界 px**（自剪影顶向上的距离）。
 */
import { LEGEND_T3 } from '../../core/config';

/** 星级容器缩放（1★/2★/3★ 体量差的唯一表达；剪影内容已归一，不再叠乘） */
export const UNIT_STAR_SCALE = [0, 0.9, 1.02, 1.16] as const;

/** 五费三星·天命的体量增幅是否适用于该棋子。
 *  与内核 unit.ts 的 legend 判定同口径排除墨兽——数值不天命，渲染也不天命。 */
export function isLegendUnit(cost: number, star: number, isBeast: boolean): boolean {
  return cost === 5 && star === 3 && !isBeast;
}

/** 容器缩放（含天命增幅）。UnitView.setScale 与头顶栈换算共用，杜绝双重缩放。 */
export function unitContainerScale(star: number, cost: number, isBeast: boolean): number {
  const s = UNIT_STAR_SCALE[star] ?? 1;
  return isLegendUnit(cost, star, isBeast) ? s * LEGEND_T3.sizeMult : s;
}

// ── 头顶栈尺寸（世界 px，跨星级恒定）──────────────────
export const HP_BAR_H = 4.5;
export const MANA_BAR_H = 3.5;
export const BAR_W = 44;
export const PIP_HALF = 3.6;
// v1.9 放大：12→16。装备是"这局打得怎么样"的第一手情报，12px 在实机 DPR 缩放下
// 几乎不可读；16px 后装备行(54)仍窄于格距 72，邻格不串行。
export const ITEM_ICON = 16;
export const ITEM_GAP = 3;
/** 装备行满编宽 —— 略宽于血条，三枚图标仍是头顶横带的视觉主体 */
export const ITEM_ROW_W = 3 * ITEM_ICON + 2 * ITEM_GAP; // 54

// ── 头顶栈净距（世界 px）──────────────────────────────
export const HEAD_GAP = {
  silhouetteItems: 7,
  itemsMana: 3,
  manaBars: 1.5,
  barsPips: 2,
  /** 冠弧圆心在星标**顶**上方多少 px（弧线穿过装备图标缝隙段时距图标角 ≥1.2px） */
  crownCyAbovePipsTop: 2,
} as const;

// ── 冠弧（3★ 越顶半弧）────────────────────────────────
/** 弧半径。弧脚角域见 CROWN_ARC_SWING：弧脚 x 恰落在装备图标之间的中缝（±[6,10]），
 *  弧线全程不触任何图标/星标（逐点采样证明见 tests/unit-layout）。 */
export const CROWN_R = 14;
/** 弧脚自水平轴抬起的角（rad）：sin=0.813 → 弧脚 y=19.1、x=±8.2，距两侧图标 ≥2.1px */
export const CROWN_ARC_SWING = 0.95;
/** 冠顶断环留白（rad）：弧分两段，顶心让给主印 */
export const CROWN_APEX_GAP = 0.3;
/** 印珠轨道半径（弧**外缘** +3）：珠沿弧外缘流转，珠顶即头顶栈最高点 */
export const CROWN_ORBIT_R = 17;
/** 印珠摆动半角（rad，绕冠顶 3π/2）：±0.3 → 珠缘与装备行顶净距 ≥1.4px */
export const CROWN_BEAR_SWING = 0.3;
export const CROWN_BEAR_HALF = 2.4;

export interface HeadStackLayout {
  /** 各锚件的**局部** y（喂给容器子对象；世界距离已除以 containerScale） */
  itemsCenterY: number;
  manaY: number;
  barsY: number;
  pipsY: number;
  crownCy: number;
  crownApexY: number;
  /** 换算用的容器缩放（绘制尺寸 = 世界尺寸 / scale） */
  scale: number;
}

/**
 * 头顶栈：自剪影顶向上锚定的唯一实现。
 * 与装备有无无关——装备带恒定占位，血条/星标不因脱装跳动；
 * 世界塔高跨星级恒定（≈30.5px），邻格净空不随星级/天命恶化。
 *
 * 链（世界 px，自下而上，全部出自净距常量）：
 *   剪影顶 →7→ 装备行(16) →3→ 法力(3.5) →1.5→ 血条(4.5) →2→ 星标(±3.6)
 *   冠弧圆心 = 星标中心 + 4，弧顶 = 圆心 - 16
 */
export function headStackLayout(contentH: number, scale: number): HeadStackLayout {
  const contentTop = -contentH;
  const w = (worldDist: number): number => worldDist / scale; // 世界距离 → 局部
  const itemsCenterY = contentTop - w(HEAD_GAP.silhouetteItems + ITEM_ICON / 2);
  const manaY = itemsCenterY - w(ITEM_ICON / 2 + HEAD_GAP.itemsMana + MANA_BAR_H);
  const barsY = manaY - w(HEAD_GAP.manaBars + HP_BAR_H);
  const pipsY = barsY - w(HEAD_GAP.barsPips + PIP_HALF);
  const crownCy = pipsY - w(PIP_HALF + HEAD_GAP.crownCyAbovePipsTop);
  const crownApexY = crownCy - w(CROWN_ORBIT_R + CROWN_BEAR_HALF);
  return { itemsCenterY, manaY, barsY, pipsY, crownCy, crownApexY, scale };
}

/** 冠弧第 k 段（k=0 左 / 1 右）的绘制角域：[start, end]，y ≤ cy 恒在上半。 */
export function crownArcSpan(k: 0 | 1): { start: number; end: number } {
  return k === 0
    ? { start: Math.PI + CROWN_ARC_SWING, end: 1.5 * Math.PI - CROWN_APEX_GAP }
    : { start: 1.5 * Math.PI + CROWN_APEX_GAP, end: 2 * Math.PI - CROWN_ARC_SWING };
}

/** 第 i 枚印珠的摆动角（绕冠顶 3π/2 往复，±CROWN_BEAR_SWING）：永不越入下半（星标/血条）区。 */
export function crownBeadAngle(i: number, count: number, t: number): number {
  const apex = 1.5 * Math.PI;
  return apex + Math.sin(t * 0.85 + (i * 2 * Math.PI) / count) * CROWN_BEAR_SWING;
}

/** 世界塔顶高（自剪影顶向上）：印珠摆到冠顶时的外缘。供净空测试复用。 */
export function headTowerWorldHeight(): number {
  const pipsCenter =
    HEAD_GAP.silhouetteItems + ITEM_ICON + HEAD_GAP.itemsMana + MANA_BAR_H + HEAD_GAP.manaBars + HP_BAR_H + HEAD_GAP.barsPips + PIP_HALF;
  const pipsTop = pipsCenter - PIP_HALF;
  const crownCy = pipsTop - HEAD_GAP.crownCyAbovePipsTop;
  return crownCy - CROWN_ORBIT_R - CROWN_BEAR_HALF;
}
