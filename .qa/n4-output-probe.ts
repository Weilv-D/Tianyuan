/** N 线输出量探针：机关 vs 荆棘，扫描 fourthHitGiant/Crush 档位下机关全队 dealtDamage 总量变化 */
import { Battle } from '../src/core/battle';
import { PRESET_COMPS, buildTeam } from '../src/game/comp';
import { withOverrides, type Overrides } from '../scripts/lib/patch';

const N = 60;
const seedBase = 20260829;

function mechOutput(ov: Overrides | null): { total: number; thornsTotal: number; mechWins: number } {
  return withOverrides(ov, () => {
    const a = buildTeam(PRESET_COMPS[4], 0, 1);
    const b = buildTeam(PRESET_COMPS[2], 1, 200);
    let total = 0, thornsTotal = 0, wins = 0;
    for (let k = 0; k < N; k++) {
      const seed = (seedBase + k * 7919) >>> 0;
      const bt = new Battle({ seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } }, null, false);
      bt.run();
      for (const u of bt.units) {
        if (u.team === 0) total += u.dealtDamage;
        else thornsTotal += u.dealtDamage;
      }
      if (bt.result?.winner === 0) wins++;
    }
    return { total: total / N, thornsTotal: thornsTotal / N, mechWins: wins / N };
  });
}

const base = mechOutput(null);
console.log(`基准：机关总输出 ${base.total.toFixed(0)}  荆棘总输出 ${base.thornsTotal.toFixed(0)}  机关胜率 ${(base.mechWins * 100).toFixed(1)}%`);
for (const [key, v] of [
  ['fourthHitGiant', 0.01], ['fourthHitGiant', 0.015], ['fourthHitGiant', 0.02],
  ['fourthHitGiant', 0.05], ['fourthHitGiant', 0.10], ['fourthHitGiant', 0.20],
  ['fourthHitCrush', 0.3], ['fourthHitCrush', 0.5], ['fourthHitCrush', 0.8],
  ['fourthHitCrush', 1.5], ['fourthHitCrush', 3.0], ['fourthHitCrush', 5.0],
] as const) {
  const r = mechOutput({ [`trait.jiguan.${key}`]: v });
  console.log(`${key}=${v}\t机关总输出 ${r.total.toFixed(0)}（${(((r.total - base.total) / base.total) * 100).toFixed(1)}%）\t机关胜率 ${(r.mechWins * 100).toFixed(1)}%`);
}
