import { BOARD_COLS } from '../core/config';
import { CHAMPION_BY_ID } from '../data/champions';
import { TRAIT_BY_ID } from '../data/traits';
import { assignItems } from './inventory';
import { UNIT_DEPTH, centerOutColumns } from './state';
import type { BattleUnitInput, Cell, Star } from '../core/types';

/**
 * 阵容构建器。
 * 把"一串棋子 id"翻译成一份可直接喂给战斗内核的入场配置 ——
 * 站位由职业自动推导（前排/后排/刺客位），玩家不必手摆每一格。
 */

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
  // 容量钳制：棋盘只有 4×8=32 格。合法调用方（预设 7~9 人、玩家场上上限）
  // 远够不着；此前超发（如调试注入）会走到行尾 throw —— 异常直接进 Phaser
  // 帧回调，页面冻结。截断到容量，超出的棋子由调用方的兜底落格处理。
  const CAP = 4 * BOARD_COLS;
  const sorted = [...defIds].sort((a, b) => {
    const ea = CHAMPION_BY_ID[a];
    const eb = CHAMPION_BY_ID[b];
    const da = UNIT_DEPTH[ea?.cls ?? 'warrior'] ?? 0.5;
    const db = UNIT_DEPTH[eb?.cls ?? 'warrior'] ?? 0.5;
    if (da !== db) return da - db;
    return (eb?.cost ?? 0) - (ea?.cost ?? 0);
  }).slice(0, CAP);

  // 列填充顺序：由中心向两侧，保证阵型永远对称美观
  const COL_ORDER = centerOutColumns();

  const rowUsed: Set<string>[] = [new Set(), new Set(), new Set(), new Set()];
  const out = new Map<string, Cell>();
  for (const id of sorted) {
    const e = CHAMPION_BY_ID[id];
    const depth = UNIT_DEPTH[e?.cls ?? 'warrior'] ?? 0.5;
    const preferred = Math.min(3, Math.floor(depth * 4));
    // 行选择单调前进：偏好行起向远离前排方向找第一个未满行，到头回扫全表。
    // 此前"满行原地 rowIdx+1 + guard 上限"会在 4 行全满时落回满行死循环
    // （9 人同纵深即触发，页面冻结）。
    let rowIdx = -1;
    for (let r = preferred; r < 4; r++) {
      if (rowUsed[r].size < BOARD_COLS) {
        rowIdx = r;
        break;
      }
    }
    if (rowIdx < 0) {
      for (let r = 0; r < 4; r++) {
        if (rowUsed[r].size < BOARD_COLS) {
          rowIdx = r;
          break;
        }
      }
    }
    if (rowIdx < 0) break; // 理论不可达（sorted 已钳到 32）；兜底交由调用方默认落格
    const used = rowUsed[rowIdx];
    const c = COL_ORDER.find((cc) => !used.has(String(cc)));
    if (c === undefined) break; // 同上：行未满则必有空列
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
    name: '快攻 · 4剑宗3刺客',
    desc: '4剑宗(20%暴击/18%破甲/击杀回蓝)3刺客4武将，1秒后跳后排切方士。',
    units: { duanyue: 3, wujiu: 2, canghao: 2, chitong: 2, yingsha: 2, ajiu: 2, qingming: 2 },
  },
  {
    name: '法爆 · 4龙渊4方士',
    // 原版是"六方士四龙渊"，只有一个护卫当前排 —— 六个后排挤在一起，
    // 被剑宗刺客一轮跳脸就打穿，诊断显示 7 个方士里 4 个到死没放出技能。
    // 加前排后它从 24.8% 直接跳到 98.8%：这个游戏里**前排的有无
    // 是第一支配变量**，比任何羁绊数值都大。
    desc: '4龙渊(32%技能增幅)4方士(16%护盾/魔抗 shred)三护卫，前排站住后排一发定胜负。',
    units: { yuansu: 2, aoyin: 2, moyu: 2, yinglong: 1, canglan: 2, pan: 2, zhenyue: 2 },
  },
  {
    name: '护卫 · 6护卫2山海',
    // 原版七个全是护卫/武将，一点输出都没有，纯靠荆棘反弹和流血磨 ——
    // 打不死人就是打不死人。第七格换成朱炎（方士/山海），
    // 让它有至少一个能主动制造伤害的单位。
    desc: '6护卫(55%攻击/荆棘52%)2山海(16%流血)，站得住就赢。',
    units: { pan: 2, lingxiao: 2, xuanwu: 2, budong: 2, zhenyue: 2, canglan: 1, zhuyan: 2 },
  },
  {
    name: '幽冥 · 4幽冥3术士',
    // 原版七个全是后排（术士/方士/丹师），零前排 —— 四幽冥的复活
    // 根本来不及触发就被冲垮。让出两个格子给护卫，复活机制才有意义。
    desc: '4幽冥(10%复活)3术士(30%真伤)二护卫，死了再战。',
    units: { yeyou: 2, moyu: 2, dasiming: 2, shidian: 2, jiuying: 2, pan: 2, xuanwu: 2 },
  },
  {
    name: '机关 · 4机关3神射',
    desc: '4机关(22甲/9%叠攻速)3神射(15%攻击)，数量压制。',
    units: { gongshu: 2, muji: 2, pan: 2, budong: 2, canghao: 2, jingyu: 3, qinghe: 3 },
  },
  {
    name: '妖族 · 4妖族4武将',
    // 原版四武将是三个 1~3 费的便宜货，整个阵容没有一个能打的 carry；
    // 全能吸血再高也没东西可吸。把 1 费的断岳换成 5 费的昊天，
    // 四武将档位不变，但终于有了输出核心。
    desc: '4妖族(36%吸血/化形)4武将(45%攻击)，残血反杀。',
    units: { ajiu: 3, chitong: 2, jiuying: 2, qingqiu: 1, wujiu: 2, canghao: 2, haotian: 1 },
  },
  {
    name: '天庭 · 4天庭',
    desc: '4天庭(20%护盾/破盾法爆)双五费天王2星，覆盖天庭/丹鼎/丹师（实战7人口高费）。',
    units: { lingxiao: 2, yaoguang: 2, xinhuan: 2, zhenyue: 2, haotian: 2, gouchen: 1, qinghe: 2 },
  },
  {
    name: '墨门 · 6墨门',
    desc: '6墨门(8%团队减伤/2%回血)墨翟2星，贴近实战7人口成型。',
    units: { moyan: 3, yunchu: 2, chiji: 2, guicheng: 2, xuanji: 2, baitao: 2, mozhai: 2 },
  },
  {
    name: '兵家 · 5兵家',
    desc: '5兵家(26%攻击/20%攻速)百战滚雪球，武将/神射混搭，贴合实战中期锁血。',
    units: { zhenfeng: 3, jinghong: 3, xijue: 2, paoche: 2, guzhen: 2, canghao: 2, jingyu: 3 },
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
