/** 单场对局诊断：打印逐单位贡献，定位"某流派为什么打不动"。 */
import { Battle } from '../../src/core/battle';
import { PRESET_COMPS, buildTeam } from '../../src/game/comp';

const intArg = (v: string | undefined, name: string, min: number, fallback: number, max?: number): number => {
  const x = Number(v ?? fallback);
  if (!Number.isInteger(x) || x < min || (max !== undefined && x >= max)) {
    console.error(`✗ ${name} 必须为 ≥${min} 的整数${max !== undefined ? ` 且小于 ${max}` : ''}`);
    process.exit(1);
  }
  return x;
};
const ai = intArg(process.argv[2], '阵容下标 A', 0, 0, PRESET_COMPS.length); // 快攻压制
const bi = intArg(process.argv[3], '阵容下标 B', 0, 1, PRESET_COMPS.length); // 后期大招
const seed = intArg(process.argv[4], '种子', 1, 4242);

const a = buildTeam(PRESET_COMPS[ai], 0, 1);
const b = buildTeam(PRESET_COMPS[bi], 1, 200);
const bt = new Battle(
  { seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } },
  null,
  false,
);
const res = bt.run();

console.log(`\n${PRESET_COMPS[ai].name}  VS  ${PRESET_COMPS[bi].name}`);
console.log(`结果: ${res.winner === 1 ? '下方(team1)胜' : res.winner === 0 ? '上方(team0)胜' : '平局'}  时长 ${(res.ticks / 30).toFixed(1)}s  超时 ${res.timeout}`);

for (const team of [0, 1]) {
  const us = bt.units.filter((u) => u.team === team && !u.isMinion);
  console.log(`\n──── team ${team} ${team === 0 ? PRESET_COMPS[ai].name : PRESET_COMPS[bi].name} ────`);
  console.log('单位      星  生命      攻击  法强  护甲  攻速  射程  造成伤害  承受  治疗  施法  存活');
  let td = 0;
  for (const u of us) {
    td += u.dealtDamage;
    console.log(
      `${u.entry.name.padEnd(6)}${'★'.repeat(u.star).padEnd(3)} ${String(u.maxHp).padStart(6)} ${String(Math.round(u.atk)).padStart(6)} ${String(Math.round(u.sp)).padStart(5)} ${String(Math.round(u.baseArmor)).padStart(5)} ${u.baseAspd.toFixed(2).padStart(5)} ${String(u.range).padStart(5)} ${String(Math.round(u.dealtDamage)).padStart(9)} ${String(Math.round(u.takenDamage)).padStart(6)} ${String(Math.round(u.healed)).padStart(5)} ${String(u.castCount).padStart(5)} ${u.alive ? '  ✓' : '  ✗'}`,
    );
  }
  console.log(`团队总输出 ${Math.round(td)}`);
}

// 伤害来源拆解
const bySource = new Map<string, number>();
bt.events.forEach((e) => {
  if (e.t === 'damage') {
    const k = `${e.source}/${e.type}`;
    bySource.set(k, (bySource.get(k) ?? 0) + e.amount);
  }
});
console.log('\n──── 伤害来源拆解 ────');
for (const [k, v] of [...bySource.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${k.padEnd(18)} ${Math.round(v)}`);
}
