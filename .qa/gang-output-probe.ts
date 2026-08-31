/** 围攻通道输出量探针：机关 vs 荆棘，扫 gangAtk 档位下机关全队 dealtDamage 变化 */
import { Battle } from '../src/core/battle';
import { PRESET_COMPS, buildTeam } from '../src/game/comp';
import { withOverrides, type Overrides } from '../scripts/lib/patch';

const N = 60;
const seedBase = 20260829;

function mechOutput(ov: Overrides | null): { total: number; guardTotal: number; mechWins: number; dur: number } {
  return withOverrides(ov, () => {
    const a = buildTeam(PRESET_COMPS[4], 0, 1);
    const b = buildTeam(PRESET_COMPS[2], 1, 200);
    let total = 0, guardTotal = 0, wins = 0, dur = 0;
    for (let k = 0; k < N; k++) {
      const seed = (seedBase + k * 7919) >>> 0;
      const bt = new Battle({ seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } }, null, false);
      bt.run();
      for (const u of bt.units) {
        if (u.team === 0) total += u.dealtDamage;
        else guardTotal += u.dealtDamage;
      }
      if (bt.result?.winner === 0) wins++;
      dur += bt.result?.ticks ? bt.result.ticks / 60 : 0;
    }
    return { total: total / N, guardTotal: guardTotal / N, mechWins: wins / N, dur: dur / N };
  });
}

const base = mechOutput(null);
console.log(`基准：机关输出 ${base.total.toFixed(0)}  荆棘输出 ${base.guardTotal.toFixed(0)}  机关胜率 ${(base.mechWins * 100).toFixed(1)}%  时长 ${base.dur.toFixed(1)}s`);
for (const g of [0.75, 1.5, 3.0, 6.0]) {
  const r = mechOutput({ 'trait.jiguan.gangAtk': g });
  console.log(`gangAtk=${g}\t机关输出 ${r.total.toFixed(0)}（${(((r.total - base.total) / base.total) * 100).toFixed(1)}%）\t荆棘输出 ${r.guardTotal.toFixed(0)}\t机关胜率 ${(r.mechWins * 100).toFixed(1)}%\t时长 ${r.dur.toFixed(1)}s`);
}
// 组合档：围攻 + 护卫 t2 卸甲（悬崖面二次探测）
for (const [g, cut] of [[6.0, 0.5], [8.0, 0.5], [10.0, 0.5], [6.0, 0.75], [8.0, 0.75], [12.0, 0.5]] as const) {
  const r = mechOutput({ 'trait.jiguan.gangAtk': g, 'trait.guardian.t2ArmorCut': cut });
  console.log(`gang=${g} + cut=${cut}	机关输出 ${r.total.toFixed(0)}（${(((r.total - base.total) / base.total) * 100).toFixed(1)}%）	荆棘输出 ${r.guardTotal.toFixed(0)}	机关胜率 ${(r.mechWins * 100).toFixed(1)}%	时长 ${r.dur.toFixed(1)}s`);
}
