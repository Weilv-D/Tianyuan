/**
 * 预设阵容的金币价值自检。
 *
 * 为什么需要它：调平衡时最容易犯的错误，是拿两套**造价完全不同**的阵容对拍，
 * 然后以为是羁绊强度有差异。实际上一个 5 费二星的含金量（15 金）
 * 顶得上三个 1 费二星（9 金）还要多 —— 造价差 20 金的对拍，
 * 测出来的全是造价，不是羁绊。
 *
 * 所以每套预设都必须在同一造价带内（这里定 52~58 金），
 * 星级按"低费高星、高费低星"的真实构筑习惯分配。
 */

import { PRESET_COMPS } from '../../src/game/comp';
import { CHAMPION_BY_ID } from '../../src/data/champions';
import { goldOf } from '../lib/comps';

/** 一个 N 星棋子消耗的金币（1★=1 张，2★=3 张，3★=9 张）—— 仅用于逐棋子展示；
 *  造价核算本体 goldOf 在 ../lib/comps（单一真源，此处不再复制实现） */
const COPIES: Record<number, number> = { 1: 1, 2: 3, 3: 9 };

const TARGET_MIN = 52;
const TARGET_MAX = 58;

console.log('预设阵容造价自检（目标区间 ' + TARGET_MIN + '~' + TARGET_MAX + ' 金）\n');

let allOk = true;
for (const c of PRESET_COMPS) {
  const g = goldOf(c.units);
  const ok = g >= TARGET_MIN && g <= TARGET_MAX;
  if (!ok) allOk = false;
  const detail = Object.entries(c.units)
    .map(([id, star]) => {
      const cost = CHAMPION_BY_ID[id]?.cost ?? 1;
      return `${id}${'★'.repeat(star)}(${cost * (COPIES[star] ?? 1)})`;
    })
    .join(' ');
  console.log(`  ${ok ? '✓' : '✗'} ${c.name.padEnd(22)} ${String(g).padStart(3)} 金   ${detail}`);
}

console.log('');
if (allOk) console.log('  ✓ 全部预设造价落在目标区间内，对拍结果反映的是羁绊强度');
else {
  console.log('  ✗ 存在造价越界的预设，对拍结果会被造价污染');
  process.exitCode = 1;
}
