import { describe, expect, it } from 'vitest';
import {
  BADGE_SIZE,
  RAIL_COUNT_DX,
  RAIL_COUNT_W,
  RAIL_VIEW_H,
  RAIL_VIEW_W,
  railBadgeHit,
  railBadgeWorldHit,
  railBadgeWorldY,
  railPopupLayout,
  railPopupPos,
  railOverlapsLog,
  reportRowFitsSide,
  reportRowRects,
  REPORT_ROW,
  RAIL_POPUP_W,
  TRAIT_MEMBER_COLS,
  TRAIT_MEMBER_GRID_X,
  TRAIT_MEMBER_GRID_Y,
  TRAIT_MEMBER_PITCH,
  TRAIT_MEMBER_SIZE,
  TRAIT_MEMBER_X,
  traitMemberCardH,
  traitMemberCardW,
  traitMemberCell,
  traitMemberClampY,
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
    const POPUP_X = 112; // railPopupPos 落位，净距 = 112 - (RAIL_X+DX+W)
    expect(POPUP_X - (RAIL_X + RAIL_COUNT_DX + RAIL_COUNT_W)).toBeGreaterThanOrEqual(3);
    for (const [e, d] of [[0, 1], [5, 3], [8, 6]] as const) {
      const L = railPopupLayout(e, d);
      expect(L.w).toBe(RAIL_POPUP_W);
      const pos = railPopupPos(railBadgeWorldY(0), L.h);
      expect(pos.x).toBe(POPUP_X);
      expect(pos.y + L.h).toBeLessThanOrEqual(860);
      expect(pos.y).toBeGreaterThanOrEqual(140);
    }
  });

  it('徽章行世界位 = 容器世界位 + 行局部位（锚 y 不依赖滚动）', () => {
    for (const i of [0, 7, 16]) {
      expect(railBadgeWorldY(i)).toBe(RAIL_Y + i * 44);
    }
    // 世界 y 与局部 railBadgeY 一致性的守护：局部 y=0 时锚 = RAIL_Y
    expect(railBadgeWorldY(0)).toBe(RAIL_Y);
  });

  it('徽章行世界命中区 = 局部命中区平移到世界位（滚动只改容器 y，不改行世界锚）', () => {
    const hit0 = railBadgeWorldHit(0);
    const local = railBadgeHit();
    expect(hit0.x).toBe(RAIL_X + local.x);
    expect(hit0.y).toBe(RAIL_Y + local.y);
    for (const i of [1, 16]) {
      const h = railBadgeWorldHit(i);
      expect(h.y).toBe(hit0.y + i * 44);
      expect(h.x).toBe(hit0.x);
      expect(h.w).toBe(local.w);
      expect(h.h).toBe(local.h);
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

describe('羁绊成员卡几何', () => {
  // 各档成员规模：地域族 5~9 人（单行收下）、职业族最多 24 人（5 行）——
  // 契约按 24 人最坏情形钉死，成员超过 25（5×5）前不得引滚动
  const CASES = [5, 9, 24] as const;

  it('黄金值：当前版式尺寸定版（改版式须显式改此断言）', () => {
    expect(traitMemberCardW()).toBe(484);
    expect(TRAIT_MEMBER_X).toBe(124);
    expect(TRAIT_MEMBER_GRID_Y).toBe(66);
    expect(railPopupPos(railBadgeWorldY(0), railPopupLayout(0, 1).h).x).toBe(112);
  });

  it('卡左缘在轨滚动视口右缘之外（双滚轮互不侵扰）', () => {
    // 视口世界系右缘 = RAIL_X-24+RAIL_VIEW_W
    expect(TRAIT_MEMBER_X).toBeGreaterThanOrEqual(RAIL_X - 24 + RAIL_VIEW_W + 3);
  });

  it('列格点阵全部落在卡内，且单格不越卡宽（最宽 24 人收进 5 列）', () => {
    const w = traitMemberCardW();
    for (const n of CASES) {
      // 末列格右缘、末行格底缘都在卡内
      const last = traitMemberCell(n - 1);
      expect(TRAIT_MEMBER_GRID_X + last.x + TRAIT_MEMBER_SIZE).toBeLessThanOrEqual(w);
      expect(TRAIT_MEMBER_GRID_Y + last.y + TRAIT_MEMBER_SIZE).toBeLessThanOrEqual(traitMemberCardH(n));
      // 列格数 × 行格数 ≥ 成员数
      expect(Math.min(n, TRAIT_MEMBER_COLS) * Math.ceil(n / TRAIT_MEMBER_COLS)).toBeGreaterThanOrEqual(n);
    }
  });

  it('卡高随行数自适应；全量最坏情形的卡都能钳位进 CAH 带内', () => {
    // 最坏情形：徽章行锚取整条轨上可达的最大世界 y，卡仍不越 CAH 底
    const h = traitMemberCardH(24);
    const py = traitMemberClampY(railBadgeWorldY(16), h);
    expect(py + h).toBeLessThanOrEqual(860);
    expect(py).toBeGreaterThanOrEqual(140);
    // 行高上限不超过允许带的收缩量（成员超 25 引滚动前的守卫）
    expect(h).toBeLessThanOrEqual(860 - 140);
  });

  it('格心距 ≥ 立绘边长 + 净距（相邻格不叠压）', () => {
    expect(TRAIT_MEMBER_PITCH).toBeGreaterThanOrEqual(TRAIT_MEMBER_SIZE + 4);
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
