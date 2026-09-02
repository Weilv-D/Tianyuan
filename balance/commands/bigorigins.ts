/**
 * 大地域羁绊强度探针 —— 回答「墨门/兵家满羁绊到底有多强」。
 *
 * 主矩阵（PRESET_COMPS，现 9 套）已覆盖 6墨门/5兵家的**同造价同人口**成型强度
 * （7人口 52~58金，见 src/game/comp.ts），与实战中期锁血一致。
 * 本探针额外对比 9墨门/8兵家的**天花板**（9人口 65/56金，2★为主），用于
 * 回答"高roll是否统治"。定位锚点：胜率显著高于 50%（强），但不是 100%（统治）；
 * 「仅次于三星五费」= 顶级构筑之一，而非无敌。
 *
 * 运行： npm run balance -- bigorigins [每对局数]
 */
import { Battle } from '../../src/core/battle';
import { PRESET_COMPS, buildTeam, type CompSpec } from '../../src/game/comp';

const N = Number(process.argv[2] ?? 120);
if (!Number.isInteger(N) || N <= 0) {
  console.error(`✗ 对局数必须是正整数，收到：${process.argv[2] ?? '(缺省)'}`);
  process.exit(1);
}

const MOMEN9: CompSpec = {
  name: '墨门九守·天花板',
  desc: '9墨门（65金，9人口天胡）：兼爱30%分摊+20%墨门减伤，与主矩阵6墨门(57金)对比看9人口提升。',
  units: { moyan: 2, yunchu: 2, chiji: 2, guicheng: 2, xuanji: 2, baitao: 2, yusuan: 2, moliu: 2, mozhai: 1 },
};
const BINGJIA8: CompSpec = {
  name: '兵家八阵·天花板',
  desc: '8兵家+墨岩补位（56金，9人口天胡）：百战滚雪球，与主矩阵5兵家(54金)对比看8人口提升。',
  units: { zhenfeng: 2, jinghong: 2, xijue: 2, paoche: 2, guzhen: 2, podu: 2, zhechong: 2, taibu: 1, moyan: 2 },
};

/** 双向平均胜率（i 的视角） */
function pairWin(i: CompSpec, j: CompSpec, n: number, seedBase: number): number {
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const seed = (seedBase + k * 7919) >>> 0;
    const a = buildTeam(i, 0, 1);
    const b = buildTeam(j, 1, 200);
    const r1 = new Battle({ seed, units: [...a.inputs, ...b.inputs], traits: { 0: a.traits, 1: b.traits } }, null, false).run();
    sum += r1.winner === 0 ? 1 : r1.winner === null ? 0.5 : 0;
    const a2 = buildTeam(i, 1, 1);
    const b2 = buildTeam(j, 0, 200);
    const r2 = new Battle({ seed, units: [...a2.inputs, ...b2.inputs], traits: { 0: b2.traits, 1: a2.traits } }, null, false).run();
    sum += r2.winner === 1 ? 1 : r2.winner === null ? 0.5 : 0;
  }
  return sum / (n * 2);
}

console.log(`═════════ 百战天元 · 大地域羁绊强度探针（每对 ${N}×2 局，双向；主矩阵 ${PRESET_COMPS.length} 套） ═════════\n`);
const t0 = Date.now();
for (const big of [MOMEN9, BINGJIA8]) {
  const row: string[] = [];
  let sum = 0;
  let cnt = 0;
  for (const p of PRESET_COMPS) {
    const w = pairWin(big, p, N, 20260829);
    row.push(`${p.name.split(' · ')[0]} ${(w * 100).toFixed(0)}%`);
    sum += w;
    cnt++;
  }
  console.log(`【${big.name}】`);
  console.log(`  对${PRESET_COMPS.length}预设胜率: ${row.join('　')}`);
  console.log(`  平均胜率 ${((sum / cnt) * 100).toFixed(1)}%（>72% 为"成型即强"，>85% 为统治级警报）`);
  console.log('');
}
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
