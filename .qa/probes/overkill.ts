import { Battle } from '../../src/core/battle';
import { CHAMPION_BY_ID } from '../../src/data/champions';

const ids = Object.keys(CHAMPION_BY_ID);
const a = CHAMPION_BY_ID[ids[0]];
const b = CHAMPION_BY_ID[ids[1]];

function mk() {
  return new Battle(
    {
      seed: 1,
      units: [
        { uid: 1, defId: a.id, team: 0, star: 1, cell: { c: 0, r: 0 } },
        { uid: 2, defId: b.id, team: 1, star: 1, cell: { c: 0, r: 7 } },
      ],
      traits: { 0: [], 1: [] },
    },
    null,
    true,
  );
}

console.log(`A=${a.id} maxHp=${a.base.hp}   B=${b.id} maxHp=${b.base.hp}`);

// ── 1) 溢出伤害是否计入统计 ──
const bt = mk();
const src = bt.unitByUid(1)!;
const dst = bt.unitByUid(2)!;
const returned = bt.dealDamage(src, dst, dst.hp + 9999, 'true', { source: 'skill' });
console.log('\n[1] 溢出伤害统计');
console.log(`  dst.maxHp            = ${dst.maxHp}`);
console.log(`  dealDamage 返回值     = ${Math.round(returned)}   <-- 期望 ≈ ${dst.maxHp}`);
console.log(`  src.dealtDamage      = ${Math.round(src.dealtDamage)}`);
console.log(`  dst.takenDamage      = ${Math.round(dst.takenDamage)}`);

// ── 2) 溢出伤害 + 吸血 ──
const bt2 = mk();
const s2 = bt2.unitByUid(1)!;
const d2 = bt2.unitByUid(2)!;
s2.omnivamp = 0.2;
s2.hp = Math.round(s2.maxHp * 0.3);
const before = s2.hp;
bt2.dealDamage(s2, d2, d2.hp + 9999, 'true', { source: 'skill' });
console.log('\n[2] 溢出伤害触发的吸血（残血 30%、全能吸血 20%）');
console.log(`  施法者 hp ${before}/${s2.maxHp}  ->  ${Math.round(s2.hp)}   期望 ≈ ${before}（击杀小兵不该大额回血）`);

// ── 3) 护盾吸收时的口径 ──
const bt3 = mk();
const s3 = bt3.unitByUid(1)!;
const d3 = bt3.unitByUid(2)!;
d3.shield = 500;
const r3 = bt3.dealDamage(s3, d3, 200, 'true', { source: 'skill' });
console.log('\n[3] 护盾吸收口径（盾 500，打 200）');
console.log(`  返回值 = ${Math.round(r3)}  期望 200（全被盾吃）`);
console.log(`  dst.hp = ${Math.round(d3.hp)}  shield = ${Math.round(d3.shield)}`);
