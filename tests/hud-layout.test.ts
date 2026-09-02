import { describe, expect, it } from 'vitest';
import {
  BADGE_SIZE,
  RAIL_COUNT_DX,
  RAIL_COUNT_W,
  RAIL_VIEW_H,
  RAIL_VIEW_W,
  railBadgeHit,
  railPopupClampY,
  railPopupLayout,
  railOverlapsLog,
  reportRowFitsSide,
  reportRowRects,
  REPORT_ROW,
  RAIL_POPUP_W,
} from '../src/render/view/hudLayout';
import { LOG_Y, RAIL_X, RAIL_Y, SIDE_W } from '../src/render/view/layout';

/**
 * HUD 几何契约 —— hudLayout 纯函数的遮挡不变量。
 * 改字号/列位/轨距时这里必须全绿；几何口径的单一真源在 hudLayout.ts。
 */
describe('羁绊轨几何', () => {
  it('轨视口永不越进左下记事栏', () => {
    expect(railOverlapsLog()).toBe(false);
  });

  it('全量 17 族的徽章命中区都收在滚动视口内（内容高于视口由滚动承接）', () => {
    const hit = railBadgeHit();
    // 视口世界系左缘 RAIL_X-24；命中区相对环心，环心挂 RAIL_X
    expect(RAIL_X + hit.x).toBeGreaterThanOrEqual(RAIL_X - 24);
    expect(RAIL_X + hit.x + hit.w).toBeLessThanOrEqual(RAIL_X - 24 + RAIL_VIEW_W);
    // 内容底可超视口（滚动），但视口底不得进记事栏 —— railOverlapsLog 即此断言
    expect(RAIL_Y - 20 + RAIL_VIEW_H).toBeLessThanOrEqual(LOG_Y - 12);
  });

  it('命中区罩住圆环与计数串全部墨迹', () => {
    const hit = railBadgeHit();
    expect(hit.x).toBeLessThanOrEqual(-BADGE_SIZE / 2);
    expect(hit.x + hit.w).toBeGreaterThanOrEqual(RAIL_COUNT_DX + RAIL_COUNT_W);
  });

  it('相邻徽章命中区上下不叠压（环心距 ≥ 命中高）', () => {
    const hit = railBadgeHit();
    expect(44).toBeGreaterThanOrEqual(hit.h);
  });

  it('悬浮笺左缘与计数串右缘保持净距，且钳位后不越屏底', () => {
    const POPUP_X = 112; // SceneRefresh.showRailPopup 的落位，净距 = 112 - (RAIL_X+DX+W)
    expect(POPUP_X - (RAIL_X + RAIL_COUNT_DX + RAIL_COUNT_W)).toBeGreaterThanOrEqual(3);
    for (const [e, d] of [[0, 1], [5, 3], [8, 6]] as const) {
      const L = railPopupLayout(e, d);
      expect(L.w).toBe(RAIL_POPUP_W);
      const py = railPopupClampY(RAIL_Y, L.h);
      expect(py + L.h).toBeLessThanOrEqual(860);
    }
  });
});

describe('计分板行几何', () => {
  it('行尾不越右栏', () => {
    expect(reportRowFitsSide()).toBe(true);
    expect(REPORT_ROW.streakX + REPORT_ROW.streakMaxW).toBeLessThanOrEqual(SIDE_W);
  });

  it('7 全角名与最长连胜注同行不相互叠压', () => {
    const r = reportRowRects(7);
    expect(r.name.x + r.name.w).toBeLessThanOrEqual(r.bar.x);
    expect(r.bar.x + r.bar.w).toBeLessThanOrEqual(r.lv.x);
    expect(r.lv.x + r.lv.w).toBeLessThanOrEqual(r.streak.x);
    expect(r.streak.x + r.streak.w).toBeLessThanOrEqual(SIDE_W);
  });

  it('行内元素不出右栏边界（名字截断到预算）', () => {
    const r = reportRowRects(12); // 超长名：截断到 nameMaxW
    expect(r.name.w).toBeLessThanOrEqual(REPORT_ROW.nameMaxW);
    expect(r.streak.x + r.streak.w).toBeLessThanOrEqual(SIDE_W);
  });
});

describe('信息字号下限', () => {
  it('计分板等级/连胜注不低于 12px 声明值（小窗 FIT 后仍可读）', () => {
    expect(REPORT_ROW.lvSize).toBeGreaterThanOrEqual(12);
    expect(REPORT_ROW.streakSize).toBeGreaterThanOrEqual(12);
  });

  it('轨命中区几何与计数串口径自洽（右缘=DX+W）', () => {
    const hit = railBadgeHit();
    expect(hit.x + hit.w).toBe(RAIL_COUNT_DX + RAIL_COUNT_W);
  });
});
