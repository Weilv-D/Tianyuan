import { describe, expect, it } from 'vitest';
import { LOG_Y, RAIL_X, RAIL_Y } from '../src/render/layout';
import {
  BADGE_R,
  BADGE_SIZE,
  REPORT_ROW,
  RAIL_COUNT_DX,
  RAIL_COUNT_W,
  RAIL_GLYPH_INK_HALF,
  RAIL_ITEMS,
  RAIL_VIEW_H,
  RAIL_VIEW_W,
  railBadgeHit,
  railBadgeY,
  railOverlapsLog,
  railPopupClampY,
  railPopupLayout,
  reportRowFitsSide,
  reportRowRects,
} from '../src/render/hudLayout';
import { TRAITS } from '../src/data/traits';

/**
 * HUD 几何不变量（文字/UI 遮挡回归网）。
 *
 * 背景：玩家名压血条 11px、羁绊计数出圈压下一枚环，都是"坐标内联散写、
 * 改一处忘一处"的产物。现在坐标出自 hudLayout 纯函数，这里用同一组函数
 * 把不变量钉死：徽章内元素不出环、徽章互不侵、计分板行内两两不相交、
 * 悬停笺效果块永不压描述、轨不越进记事栏。
 */

const GAP = 2; // 任意两元素的最小净距（逻辑 px）

describe('羁绊轨徽章', () => {
  it('徽章数与羁绊数一致，滚动视口不越进记事栏', () => {
    expect(RAIL_ITEMS).toBe(TRAITS.length);
    expect(railOverlapsLog()).toBe(false);
    expect(RAIL_Y - 20 + RAIL_VIEW_H).toBeLessThanOrEqual(LOG_Y - 12);
  });

  it('篆字独占环内，计数在环右侧外且收进滚动视口', () => {
    // 14px 篆字墨迹半高约 6.4，环内无第二元素 —— 字与环、字与计数均不可能相碰
    expect(RAIL_GLYPH_INK_HALF).toBeLessThanOrEqual(BADGE_R - 3);
    // 计数左缘在环外留净距
    expect(RAIL_COUNT_DX).toBeGreaterThanOrEqual(BADGE_R + 4);
    // 计数右缘不越进悬浮笺区（笺从屏 x106 起）
    expect(RAIL_X + RAIL_COUNT_DX + RAIL_COUNT_W).toBeLessThanOrEqual(106);
    // 计数右缘须在滚动遮罩窗内——旧视口宽 48 把「1/4」裁成半截，此断言钉死回归
    expect(RAIL_X + RAIL_COUNT_DX + RAIL_COUNT_W).toBeLessThanOrEqual(RAIL_X - 24 + RAIL_VIEW_W);
  });

  it('相邻徽章视觉圆互不侵压', () => {
    // 徽章显示尺寸是 BADGE_SIZE（40px）：环心距必须大于它加净距。
    // 旧不变量拿环半径 BADGE_R 判定，38px 环距放过了 40px 图标的实测叠压
    for (let i = 0; i < RAIL_ITEMS - 1; i++) {
      expect(railBadgeY(i + 1) - railBadgeY(i)).toBeGreaterThanOrEqual(BADGE_SIZE + GAP);
    }
  });

  it('命中区罩住圆环与计数', () => {
    const hit = railBadgeHit();
    expect(hit.x).toBe(-BADGE_SIZE / 2);
    expect(hit.w).toBe(BADGE_SIZE + RAIL_COUNT_DX);
    expect(hit.h).toBe(BADGE_SIZE);
  });

  it('徽章整体不出左屏', () => {
    expect(RAIL_X - BADGE_SIZE / 2).toBeGreaterThanOrEqual(12);
  });
});

describe('诸侯计分板行', () => {
  it('最长玩家名（7 全角字）与血条脱开', () => {
    const r = reportRowRects(7);
    expect(r.name.w).toBeLessThanOrEqual(REPORT_ROW.nameMaxW + 8);
    expect(r.name.x + r.name.w + GAP).toBeLessThanOrEqual(r.bar.x);
  });

  it('血条与 Lv、Lv 与连胜注脱开', () => {
    const r = reportRowRects(7);
    expect(r.bar.x + r.bar.w + GAP).toBeLessThanOrEqual(r.lv.x);
    expect(r.lv.x + r.lv.w + GAP).toBeLessThanOrEqual(r.streak.x);
  });

  it('行尾不出右栏', () => {
    expect(reportRowFitsSide()).toBe(true);
  });
});

describe('羁绊悬停笺', () => {
  it('效果多行时描述跟在效果块之后，永不压字', () => {
    // 最长效果 77 字 → 5 行；描述 3 行
    const L = railPopupLayout(5, 3);
    expect(L.effectY + 5 * 17 + 6).toBeLessThanOrEqual(L.descY);
    expect(L.descY + 3 * 16).toBeLessThanOrEqual(L.h - 10);
  });

  it('无效果时描述直接跟在标题带之后', () => {
    const L = railPopupLayout(0, 2);
    expect(L.effectY).toBe(36);
    expect(L.descY).toBeGreaterThan(36);
    expect(L.h).toBeLessThan(200);
  });

  it('最高笺体钳制后不出屏底', () => {
    const L = railPopupLayout(5, 3);
    const py = railPopupClampY(railBadgeY(0), L.h);
    expect(py + L.h).toBeLessThanOrEqual(860);
  });
});
