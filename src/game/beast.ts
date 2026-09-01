/**
 * 墨兽（PvE 轮次）。
 *
 * 为什么需要它，有两个理由，第二个比第一个重要：
 *
 * 1. **装备来源。** 装备不能从商店买（那会让金币身兼两职，经济系统失去清晰度），
 *    必须有一个独立的产出渠道。
 * 2. **节奏起伏。** 全是 PvP 的对局是一串等强度的对抗，玩家没有喘息点。
 *    墨兽轮是"这一轮只要打过这只东西就能拿装备"——一个目标明确、压力较小的回合，
 *    它让 28 回合的长局有了呼吸。
 *
 * 墨兽阵容**复用现有棋子**生成，只换一套墨色剪影。这样零美术成本就得到了
 * 一整套 PvE 内容，而且它看起来就该是"墨"变成的怪物 —— 与世界观自洽。
 */

import { Rng } from '../core/rng';
import { CHAMPION_BY_ID } from '../data/champions';
import { cloneBoard, createUnit, type UnitInstance } from './state';
import type { Star } from '../core/types';

/** 墨兽的候选棋子池，按"该在第几回合开始出现"分层 */
const BEAST_TIERS: readonly { fromRound: number; ids: readonly string[] }[] = [
  // 早期：石灵、荒狼、铜人 —— 肉，慢，好打
  { fromRound: 0, ids: ['pan', 'canghao', 'budong', 'lingxiao', 'muji'] },
  // 中期：玄龟、傀儡、毕方 —— 有机制了
  { fromRound: 7, ids: ['xuanwu', 'gongshu', 'zhuyan', 'jiuying', 'zhenyue'] },
  // 后期：龙王、天帝、阎君、应龙 —— 真正的 Boss
  { fromRound: 15, ids: ['canglan', 'haotian', 'shidian', 'yinglong', 'qingqiu'] },
];

function poolFor(round: number): readonly string[] {
  const out: string[] = [];
  for (const tier of BEAST_TIERS) {
    if (round >= tier.fromRound) out.push(...tier.ids);
  }
  return out.length > 0 ? out : BEAST_TIERS[0].ids;
}

/** 首回合引导墨兽的攻击力倍率：只留威胁之形，去威胁之实 —— 首战是引导轮，不掉血、不掉节奏 */
export const BEAST_INTRO_POW_MULT = 0.15;

/**
 * 生成一场墨兽战的阵容。
 *
 * 强度曲线刻意设计成"前期明显好打、后期明显难打"：
 * 早期墨兽要给玩家拿到第一批装备的成就感，后期墨兽要真的能淘汰掉弱势玩家。
 * 第 1 回合（引导轮）例外：2 只 1★ 前排、攻击力 ×0.15，输赢都不构成伤害威胁
 * （Match 侧教学轮同步归零掉血），全部意义在掉落与节奏教学。
 */
export function generateBeastBoard(round: number, rng: Rng): (UnitInstance | null)[] {
  const board: (UnitInstance | null)[] = new Array(32).fill(null);
  const pool = poolFor(round);

  // 数量：早期 2 只，随回合增长到 8 只
  const count = Math.min(8, 2 + Math.floor(round / 4));
  // 星级：8 回合前全 1★；8~15 出现 2★；16 回合起出现 3★
  const twoStarChance = round < 8 ? 0 : round < 16 ? 0.45 : 0.6;
  const threeStarChance = round < 16 ? 0 : round < 24 ? 0.12 : 0.3;

  // 站位：从后排往前排铺，前排优先（墨兽是冲脸的）
  const slots: number[] = [];
  for (let row = 0; row < 4; row++) {
    const order = row % 2 === 0 ? [3, 2, 4, 1, 5, 0, 6, 7] : [4, 3, 5, 2, 6, 1, 7, 0];
    for (const c of order) slots.push(row * 8 + c);
  }

  const picked = rng.shuffle([...pool] as string[]);
  const used = new Set<string>();
  // 先生成入列（去重 + 名单校验），再连续占位 —— 此前"跳过仍占 slots[i]"，
  // 候选重名或未知 id 时会留下站位空洞，宣告数量与实际落地不符。
  // rng 语义不变：chance 只在真正落地时消费，顺序与旧实现逐位一致。
  const chosen: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = picked[i % picked.length];
    if (used.has(id) || !CHAMPION_BY_ID[id]) continue;
    used.add(id);
    chosen.push(id);
  }
  for (let i = 0; i < chosen.length; i++) {
    let star: Star = 1;
    if (rng.chance(threeStarChance)) star = 3;
    else if (rng.chance(twoStarChance)) star = 2;
    const u = createUnit(chosen[i], star);
    u.isBeast = true;
    if (round === 1) u.powMult = BEAST_INTRO_POW_MULT;
    board[slots[i]] = u;
  }
  return board;
}

/** 墨兽的展示名 */
export const BEAST_NAME = '墨兽';

/** 深拷贝一份墨兽阵容（每个玩家面对同一只，避免各自 roll 出不同强度） */
export function cloneBeast(board: readonly (UnitInstance | null)[]): (UnitInstance | null)[] {
  return cloneBoard(board);
}
