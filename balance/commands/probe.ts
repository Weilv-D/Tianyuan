/** 对阵分布探针：看一个 matchup 的胜负分布与时长分布，判断是"数值差"还是"机制崩"。 */
import { Battle } from '../../src/core/battle';
import { PRESET_COMPS, buildTeam } from '../../src/game/comp';

const ai = Number(process.argv[2] ?? 0);
const bi = Number(process.argv[3] ?? 1);
const N = Number(process.argv[4] ?? 60);

let w = 0;
let l = 0;
let d = 0;
const times: number[] = [];
const castA: number[] = [];
const castB: number[] = [];

for (let i = 0; i < N; i++) {
  const seed = 1000 + i * 7919;
  const a = buildTeam(PRESET_COMPS[ai], 0, 1);
  const b = buildTeam(PRESET_COMPS[bi], 1, 200);
  const bt = new Battle(
    { seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } },
    null,
    false,
  );
  const r = bt.run();
  times.push(r.ticks / 30);
  const ua = bt.units.filter((u) => u.team === 0 && !u.isMinion);
  const ub = bt.units.filter((u) => u.team === 1 && !u.isMinion);
  castA.push(ua.reduce((s, u) => s + u.castCount, 0));
  castB.push(ub.reduce((s, u) => s + u.castCount, 0));
  if (r.winner === 0) w++;
  else if (r.winner === 1) l++;
  else d++;
}

times.sort((x, y) => x - y);
const avg = (xs: number[]) => (xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1);
const med = times[Math.floor(times.length / 2)].toFixed(1);

console.log(`${PRESET_COMPS[ai].name}  VS  ${PRESET_COMPS[bi].name}`);
console.log(`  上方 ${w} 胜 / 下方 ${l} 胜 / ${d} 平    时长 中位 ${med}s 最短 ${times[0].toFixed(1)}s 最长 ${times[times.length - 1].toFixed(1)}s`);
console.log(`  平均施法次数：上方 ${avg(castA)}  下方 ${avg(castB)}`);
