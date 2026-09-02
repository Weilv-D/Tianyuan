/**
 * 棋子与羁绊速查表。
 *
 * 调平衡时最常问的两个问题：
 *  - "这条羁绊到底有几个成员？最高档真的凑得出来吗？"
 *  - "想搭一套 X 羁绊 + Y 羁绊，有哪些棋子可选？"
 * 每次都去翻 champions.ts 太慢，也不利于对照。
 */

import { CHAMPIONS } from '../../src/data/champions';
import { TRAITS } from '../../src/data/traits';

console.log('── 棋子按职业分组（职业决定站位纵深）──');
const byCls = new Map<string, string[]>();
for (const c of CHAMPIONS) {
  const k = c.cls;
  if (!byCls.has(k)) byCls.set(k, []);
  byCls.get(k)!.push(`${c.id}(${c.name} ${c.cost}费 ${c.origins.join('/')})`);
}
for (const [k, v] of byCls) console.log(`  ${k.padEnd(9)} ${v.join('  ')}`);

console.log('\n── 羁绊成员（断点 = 需要几个不同棋子）──');
for (const t of TRAITS) {
  const ids = CHAMPIONS.filter((c) => [...c.origins, ...c.classes].includes(t.id)).map((c) => c.id);
  const maxBp = t.breakpoints[t.breakpoints.length - 1];
  const ok = ids.length >= maxBp ? '✓' : '✗ 最高档凑不出来！';
  console.log(
    `  ${t.id.padEnd(10)} ${t.name.padEnd(4)} 断点 ${String(t.breakpoints.join('/')).padEnd(8)} 成员 ${String(ids.length).padStart(2)}  ${ok}  ${ids.join(' ')}`
  );
}
