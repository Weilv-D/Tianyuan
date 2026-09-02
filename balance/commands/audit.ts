/** 羁绊成员构成速查：确认每个羁绊的最高档位都真的凑得出来。 */
import { CHAMPIONS } from '../../src/data/champions';
import { TRAITS } from '../../src/data/traits';

const m = new Map<string, string[]>();
for (const c of CHAMPIONS) {
  for (const t of [...c.origins, ...c.classes]) {
    if (!m.has(t)) m.set(t, []);
    m.get(t)!.push(`${c.name}(${c.cost})`);
  }
}
let failures = 0;
for (const t of TRAITS) {
  const list = m.get(t.id) ?? [];
  const max = t.breakpoints[t.breakpoints.length - 1];
  const ok = list.length >= max ? 'OK ' : '!! ';
  if (ok === '!! ') failures++;
  console.log(
    `${ok}${t.category === 'origin' ? '地域' : '职业'} ${t.name.padEnd(4)} 档位 ${JSON.stringify(t.breakpoints).padEnd(10)} 成员 ${String(list.length).padStart(2)}  ${list.join(' ')}`,
  );
}
// 有不可达档位即非零退出：让 CI / 发布前置能阻断，而不是只打印感叹号
if (failures > 0) {
  console.error(`
✗ ${failures} 条羁绊最高档不可达`);
  process.exit(1);
}
