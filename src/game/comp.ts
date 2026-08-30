import { BOARD_COLS } from '../core/config';
import { CHAMPION_BY_ID, CHAMPIONS } from '../data/champions';
import { TRAIT_BY_ID } from '../data/traits';
import { assignItems } from './inventory';
import type { BattleUnitInput, Cell, Star } from '../core/types';

/**
 * 阵容构建器。
 * 把"一串棋子 id"翻译成一份可直接喂给战斗内核的入场配置 ——
 * 站位由职业自动推导（前排/后排/刺客位），玩家不必手摆每一格。
 */

/** 每个职业偏好的"纵深"：0 = 最前排，1 = 最后排 */
const DEPTH: Record<string, number> = {
  guardian: 0,
  warrior: 0.12,
  assassin: 0.95,
  marksman: 0.72,
  mage: 0.78,
  warlock: 0.6,
  support: 0.88,
};

/** 计算一堆棋子激活的羁绊（同名棋子只计一次） */
export function computeTraits(defIds: readonly string[]): { id: string; count: number; tier: number }[] {
  const unique = [...new Set(defIds)];
  const counter = new Map<string, number>();
  for (const id of unique) {
    const e = CHAMPION_BY_ID[id];
    if (!e) continue;
    for (const t of [...e.origins, ...e.classes]) counter.set(t, (counter.get(t) ?? 0) + 1);
  }
  const out: { id: string; count: number; tier: number }[] = [];
  for (const [id, count] of [...counter.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const def = TRAIT_BY_ID[id];
    if (!def) continue;
    let tier = -1;
    for (let i = 0; i < def.breakpoints.length; i++) {
      if (count >= def.breakpoints[i]) tier = i;
    }
    out.push({ id, count, tier });
  }
  return out;
}

/**
 * 自动站位。
 * @param team 0 = 上半场（前排在第 3 行），1 = 下半场（前排在第 4 行）
 */
export function autoPlace(defIds: readonly string[], team: 0 | 1): Map<string, Cell> {
  const rows = team === 0 ? [3, 2, 1, 0] : [4, 5, 6, 7];
  const sorted = [...defIds].sort((a, b) => {
    const ea = CHAMPION_BY_ID[a];
    const eb = CHAMPION_BY_ID[b];
    const da = DEPTH[ea?.cls ?? 'warrior'] ?? 0.5;
    const db = DEPTH[eb?.cls ?? 'warrior'] ?? 0.5;
    if (da !== db) return da - db;
    return (eb?.cost ?? 0) - (ea?.cost ?? 0);
  });

  // 列填充顺序：由中心向两侧，保证阵型永远对称美观
  const COL_ORDER: number[] = [];
  for (let i = 0; i < BOARD_COLS; i++) {
    const half = (BOARD_COLS - 1) / 2;
    const v = Math.round(half + (i % 2 === 0 ? -Math.ceil(i / 2) : Math.ceil(i / 2)));
    if (v >= 0 && v < BOARD_COLS) COL_ORDER.push(v);
  }

  const rowUsed: Set<string>[] = [new Set(), new Set(), new Set(), new Set()];
  const out = new Map<string, Cell>();
  for (const id of sorted) {
    const e = CHAMPION_BY_ID[id];
    const depth = DEPTH[e?.cls ?? 'warrior'] ?? 0.5;
    let rowIdx = Math.min(3, Math.floor(depth * 4));
    // 该行满了就往远离前排的方向挪
    let guard = 0;
    while (rowUsed[rowIdx].size >= BOARD_COLS && guard < 4) {
      rowIdx = Math.min(3, rowIdx + 1);
      guard++;
    }
    const used = rowUsed[rowIdx];
    let c = COL_ORDER.find((cc) => !used.has(String(cc))) ?? 0;
    while (used.has(String(c))) c = (c + 1) % BOARD_COLS;
    used.add(String(c));
    out.set(id, { c, r: rows[rowIdx] });
  }
  return out;
}

export interface CompSpec {
  name: string;
  desc: string;
  /** 棋子 id → 星级 */
  units: Record<string, Star>;
}

/**
 * M1 演示用预设流派。每条都真实成立（羁绊档位可达），不是摆设。
 *
 * **所有预设必须在同一造价带内（52~58 金，见 `scripts/gold-value.ts`）。**
 * 这不是形式主义：一个 5 费二星值 15 金，一个 1 费二星才 3 金 ——
 * 造价差 20 金的两套阵容对拍，测出来的是造价而不是羁绊强度。
 * 早期版本六套预设造价从 42 到 63 金，胜率极差里有一大半是这个造成的，
 * 而当时一直在调羁绊数值，等于在追一个不存在的目标。
 *
 * 星级按真实构筑习惯分配：低费堆三星，高费留一星。
 */
export const PRESET_COMPS: readonly CompSpec[] = [
  {
    name: '快攻压制 · 剑宗刺客',
    desc: '四剑宗三刺客四武将，跳后排切法师，滚雪球。',
    units: { duanyue: 3, wujiu: 2, canghao: 2, chitong: 2, yingsha: 2, ajiu: 2, qingming: 2 },
  },
  {
    name: '后期大招 · 龙渊方士',
    // 原版是"六方士四龙渊"，只有一个护卫当前排 —— 六个后排挤在一起，
    // 被剑宗刺客一轮跳脸就打穿，诊断显示 7 个方士里 4 个到死没放出技能。
    // 加前排后它从 24.8% 直接跳到 98.8%：这个游戏里**前排的有无
    // 是第一支配变量**，比任何羁绊数值都大。
    desc: '四龙渊四方士三护卫，前排站住，后排一发定胜负。',
    units: { yuansu: 2, aoyin: 2, moyu: 2, yinglong: 1, canglan: 2, pan: 2, zhenyue: 2 },
  },
  {
    name: '荆棘反伤 · 护卫山海',
    // 原版七个全是护卫/武将，一点输出都没有，纯靠荆棘反弹和流血磨 ——
    // 打不死人就是打不死人。第七格换成朱炎（方士/山海），
    // 让它有至少一个能主动制造伤害的单位。
    desc: '六护卫二山海，荆棘反弹 + 流血磨血，站得住就赢。',
    units: { pan: 2, lingxiao: 2, xuanwu: 2, budong: 2, zhenyue: 2, canglan: 1, zhuyan: 2 },
  },
  {
    name: '亡语续航 · 幽冥术士',
    // 原版七个全是后排（术士/方士/丹师），零前排 —— 四幽冥的复活
    // 根本来不及触发就被冲垮。让出两个格子给护卫，复活机制才有意义。
    desc: '四幽冥三术士二护卫，死了还能再战一轮。',
    units: { yeyou: 2, moyu: 2, dasiming: 2, shidian: 2, jiuying: 2, pan: 2, xuanwu: 2 },
  },
  {
    name: '机关召唤 · 傀儡海',
    desc: '四机关召唤流，用数量淹没对手。',
    units: { gongshu: 2, muji: 2, pan: 2, budong: 2, canghao: 2, jingyu: 3, qinghe: 3 },
  },
  {
    name: '妖族吸血 · 化形反击',
    // 原版四武将是三个 1~3 费的便宜货，整个阵容没有一个能打的 carry；
    // 全能吸血再高也没东西可吸。把 1 费的断岳换成 5 费的昊天，
    // 四武将档位不变，但终于有了输出核心。
    desc: '四妖族四武将，全能吸血，残血化形反杀。',
    units: { ajiu: 3, chitong: 2, jiuying: 2, qingqiu: 1, wujiu: 2, canghao: 2, haotian: 1 },
  },
];

/**
 * 生成一个队伍的入场配置。
 *
 * `items` 为空时等价于无装备（M1~M3 的所有模拟都走这条路径）。
 * 传入装备时走 `assignItems` —— 与实机 AI 的配装判断同一套代码，
 * 否则模拟出来的装备强度是假的。
 */
export function buildTeam(spec: CompSpec, team: 0 | 1, uidBase: number, items: readonly string[] = []): {
  inputs: BattleUnitInput[];
  traits: { id: string; count: number; tier: number }[];
} {
  const ids = Object.keys(spec.units);
  const placement = autoPlace(ids, team);
  const carried = items.length ? assignItems(spec.units, items) : {};
  const inputs: BattleUnitInput[] = ids.map((id, i) => ({
    uid: uidBase + i,
    defId: id,
    team,
    star: spec.units[id],
    cell: placement.get(id) ?? { c: i % BOARD_COLS, r: team === 0 ? 0 : 7 },
    items: carried[id],
  }));
  return { inputs, traits: computeTraits(ids) };
}

/** 随机阵容（用于"再来一局"的变化性） */
export function randomComp(rng: () => number, size = 7): CompSpec {
  const pool = [...CHAMPIONS];
  const picked: string[] = [];
  // 先随机挑一条主轴羁绊，再围绕它选人 —— 保证随机出来的阵容是"有思路的"
  const anchors = ['jianzong', 'longyuan', 'shanhai', 'youming', 'yaozu', 'jiguan', 'tian', 'danding'];
  const anchor = anchors[Math.floor(rng() * anchors.length)];
  const inAnchor = pool.filter((c) => c.origins.includes(anchor) || c.classes.includes(anchor));
  for (const c of inAnchor) {
    if (picked.length >= Math.ceil(size * 0.6)) break;
    picked.push(c.id);
  }
  const rest = pool.filter((c) => !picked.includes(c.id));
  while (picked.length < size && rest.length > 0) {
    picked.push(rest.splice(Math.floor(rng() * rest.length), 1)[0].id);
  }
  const units: Record<string, Star> = {};
  for (let i = 0; i < picked.length; i++) {
    const cost = CHAMPION_BY_ID[picked[i]].cost;
    const r = rng();
    const star: Star = cost >= 5 ? 1 : cost >= 4 ? (r < 0.25 ? 2 : 1) : r < 0.1 ? 3 : r < 0.45 ? 2 : 1;
    units[picked[i]] = star;
  }
  return { name: '随机阵容', desc: '系统生成的对手阵容', units };
}
