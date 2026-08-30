/** 羁绊成员构成速查：确认每个羁绊的最高档位都真的凑得出来。 */
import { CHAMPIONS } from '../src/data/champions';
import { TRAITS } from '../src/data/traits';

const m = new Map<string, string[]>();
for (const c of CHAMPIONS) {
  for (const t of [...c.origins, ...c.classes]) {
    if (!m.has(t)) m.set(t, []);
    m.get(t)!.push(`${c.name}(${c.cost})`);
  }
}
for (const t of TRAITS) {
  const list = m.get(t.id) ?? [];
  const max = t.breakpoints[t.breakpoints.length - 1];
  const ok = list.length >= max ? 'OK ' : '!! ';
  console.log(
    `${ok}${t.category === 'origin' ? '地域' : '职业'} ${t.name.padEnd(4)} 档位 ${JSON.stringify(t.breakpoints).padEnd(10)} 成员 ${String(list.length).padStart(2)}  ${list.join(' ')}`,
  );
}
