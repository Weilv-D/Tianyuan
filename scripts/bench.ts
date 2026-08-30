/** 战斗内核吞吐基准。用于判断平衡模拟的规模该开多大。 */
import { Battle } from '../src/core/battle';
import { PRESET_COMPS, buildTeam } from '../src/game/comp';

const N = Number(process.argv[2] ?? 300);
const t0 = Date.now();
let ticks = 0;
let timeouts = 0;
for (let i = 0; i < N; i++) {
  const a = buildTeam(PRESET_COMPS[0], 0, 1, ['duanhun']);
  const b = buildTeam(PRESET_COMPS[1], 1, 200, []);
  const r = new Battle(
    { seed: 1000 + i * 7919, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } },
    null,
    false,
  ).run();
  ticks += r.ticks;
  if (r.timeout) timeouts++;
}
const dt = (Date.now() - t0) / 1000;
console.log(`battles ${N}  time ${dt.toFixed(2)}s  = ${Math.round(N / dt)} battles/s`);
console.log(`avg ticks ${(ticks / N).toFixed(0)}  = ${(ticks / N / 30).toFixed(1)}s per battle  timeouts ${timeouts}`);
