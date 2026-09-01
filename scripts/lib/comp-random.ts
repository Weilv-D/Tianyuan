/**
 * 随机阵容生成器（模拟脚本专用）。
 *
 * 从 src/game/comp.ts 迁出：它以 `() => number` 异构随机抽象为输入，且唯一
 * 消费者是模拟脚本（scripts/sim.ts）。留在 game 层会让"对局内随机只走 Rng"
 * 的可复现契约出现一个合法的旁路签名 —— 脚本层用 Math.random 派生的 rnd
 * 是允许的（模拟不进存档、不进战斗确定性契约），对局层则不允许。
 */
import { CHAMPION_BY_ID, CHAMPIONS } from '../../src/data/champions';
import type { Star } from '../../src/core/types';
import type { CompSpec } from '../../src/game/comp';

export function randomComp(rng: () => number, size = 7): CompSpec {
  const pool = [...CHAMPIONS];
  const picked: string[] = [];
  // 先随机挑一条主轴羁绊，再围绕它选人 —— 保证随机出来的阵容是"有思路的"
  const anchors = ['jianzong', 'longyuan', 'shanhai', 'youming', 'yaozu', 'jiguan', 'tian', 'danding'];
  const anchor = anchors[Math.floor(rng() * anchors.length)];
  const inAnchor = pool.filter((c) => c.origins.includes(anchor) || c.classes.includes(anchor));
  for (const c of inAnchor) {
    if (picked.length >= Math.ceil(size * 0.6)) break;
    picked.push(c.id);
  }
  const rest = pool.filter((c) => !picked.includes(c.id));
  while (picked.length < size && rest.length > 0) {
    picked.push(rest.splice(Math.floor(rng() * rest.length), 1)[0].id);
  }
  const units: Record<string, Star> = {};
  for (let i = 0; i < picked.length; i++) {
    const cost = CHAMPION_BY_ID[picked[i]].cost;
    const r = rng();
    const star: Star = cost >= 5 ? 1 : cost >= 4 ? (r < 0.25 ? 2 : 1) : r < 0.1 ? 3 : r < 0.45 ? 2 : 1;
    units[picked[i]] = star;
  }
  return { name: '随机阵容', desc: '系统生成的对手阵容', units };
}
