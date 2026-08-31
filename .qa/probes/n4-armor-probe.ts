import { CHAMPION_BY_ID } from '../../src/data/champions';
import { PRESET_COMPS } from '../../src/game/comp';
for (let ci = 0; ci < PRESET_COMPS.length; ci++) {
  const comp = PRESET_COMPS[ci];
  const ids = Object.keys(comp.units);
  let hpSum = 0, armorSum = 0, n = 0;
  const rows: string[] = [];
  for (const id of ids) {
    const e = CHAMPION_BY_ID[id]!;
    const star = comp.units[id];
    const hp = Math.round(e.base.hp * [1, 1.8, 3.24][star - 1]);
    const atk = Math.round(e.base.atk * [1, 1.45, 2.1][star - 1]);
    hpSum += hp; armorSum += e.base.armor; n++;
    rows.push(`    ${id.padEnd(9)} star${star} hp=${String(hp).padStart(5)} atk=${String(atk).padStart(4)} armor=${String(e.base.armor).padStart(3)} mr=${String(e.base.mr).padStart(3)} traits=[${[...e.origins, ...e.classes].join(',')}]`);
  }
  console.log(`[${ci}] ${comp.name}  总面板hp=${hpSum} 平均armor=${(armorSum / n).toFixed(0)}`);
  for (const r of rows) console.log(r);
}
