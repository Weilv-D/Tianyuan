/**
 * 阵容装载器 —— 「阵容维」分析的入口。
 *
 * 缺省用 src/game/comp.ts 的 PRESET_COMPS（9 套同造价带预设，历史可比口径）；
 * `--comps <file.json>` 可传入自定义阵容表（CompSpec[] JSON，如天花板探针、
 * 平衡战役中的候选构筑），装载时做存在性校验与造价带提示。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHAMPION_BY_ID } from '../../src/data/champions';
import { PRESET_COMPS, type CompSpec } from '../../src/game/comp';

const COPIES: Record<number, number> = { 1: 1, 2: 3, 3: 9 };

export function goldOf(units: Record<string, number>): number {
  let g = 0;
  for (const [id, star] of Object.entries(units)) {
    g += (CHAMPION_BY_ID[id]?.cost ?? 1) * (COPIES[star] ?? 1);
  }
  return g;
}

/**
 * 装载阵容表：无参 = 预设；传路径 = 读 CompSpec[] JSON。
 * 校验：棋子存在、星级合法；造价带越界（52~58 金）只警告不阻断 ——
 * 天花板探针类场景本来就允许越带，但混带对拍测出的是造价差，必须显式提示。
 */
export function loadComps(path?: string): { comps: CompSpec[]; source: string; warnings: string[] } {
  // 预设与自定义同一校验口径：PRESET_COMPS 活 import 自 src/game/comp.ts，
  // 棋子改名后 buildTeam 会静默 continue（探针读数失真不报错）——默认路径
  // 也过一遍存在性校验，改名/删子在第一次 sweep 就显式炸出来
  if (!path) {
    const presets = [...PRESET_COMPS];
    for (const c of presets) {
      for (const id of Object.keys(c.units)) {
        if (!CHAMPION_BY_ID[id]) throw new Error(`预设阵容「${c.name}」引用不存在的棋子 ${id}（src/game/comp.ts 与名单脱节）`);
      }
    }
    return { comps: presets, source: 'PRESET_COMPS', warnings: [] };
  }
  const raw = JSON.parse(readFileSync(resolve(path), 'utf8')) as CompSpec[];
  if (!Array.isArray(raw) || raw.length < 2 || raw.some((c) => !c.name || !c.units)) {
    throw new Error(`阵容文件需为 CompSpec[] JSON（≥2 套，含 name/units）：${path}`);
  }
  const warnings: string[] = [];
  raw.forEach((c, i) => {
    for (const [id, star] of Object.entries(c.units)) {
      if (!CHAMPION_BY_ID[id]) throw new Error(`阵容「${c.name}」引用不存在的棋子 ${id}`);
      if (![1, 2, 3].includes(star)) throw new Error(`阵容「${c.name}」棋子 ${id} 星级非法：${star}`);
    }
    const gold = goldOf(c.units);
    if (gold < 52 || gold > 58) warnings.push(`阵容「${c.name}」（#${i}）造价 ${gold} 金，超出 52~58 基线带 —— 混带对拍测的是造价差`);
  });
  return { comps: raw, source: path, warnings };
}
