// 规格单向导出：只读加载冻结仓 src/data + src/core/config → godot/data/spec.json。
// 隔离铁律（docs/MILESTONES.md）：本脚本对 ../src 只 import 不写；产物只进 godot/data/。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { CHAMPIONS, CHAMPION_IDS_BY_COST } from '../../src/data/champions.ts';
import { ITEMS, COMPONENT_IDS, RECIPE_INDEX } from '../../src/data/items.ts';
import { TRAITS } from '../../src/data/traits.ts';
import { TRAIT_TUNING, TRAIT_TUNING_KEYS, TRAIT_TUNE_KEYS } from '../../src/data/tuning.ts';
import * as CFG from '../../src/core/config.ts';

const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

/** 键序规范化：递归排序对象键（数组保序），保证 hash 幂等 */
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = stable(v[k]);
    return out;
  }
  return v;
}

function fnv1a32(str) {
  let h = 2166136261 >>> 0;
  for (const b of Buffer.from(str, 'utf8')) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// 常量全量导出：标量与嵌套对象/数组（MECH/LEGEND_T3/MATCH_TUNING/星级与经济数组）都要，
// 只排除函数。M0 版只收 typeof number，星级缩放表与 MECH 整体漏发（M1 移植时发现）。
const config = {};
for (const [k, v] of Object.entries(CFG)) {
  if (typeof v === 'number' || (v !== null && typeof v === 'object')) config[k] = v;
}

const payload = stable({
  config,
  champions: CHAMPIONS,
  championIdsByCost: CHAMPION_IDS_BY_COST,
  items: ITEMS,
  componentIds: COMPONENT_IDS,
  recipeIndex: RECIPE_INDEX,
  traits: TRAITS,
  traitTuning: TRAIT_TUNING,
  traitTuningKeys: TRAIT_TUNING_KEYS,
  traitTuneKeys: TRAIT_TUNE_KEYS,
});
const canonical = JSON.stringify(payload);
const counts = {
  champions: CHAMPIONS.length,
  items: ITEMS.length,
  traits: TRAITS.length,
  recipes: Object.keys(RECIPE_INDEX).length,
};

// 与 slice-sheet 同风格的对账断言：数量对不上直接失败，不产出半成品 spec
const expect = { champions: 64, items: 44, traits: 17, recipes: 36 };
for (const [k, n] of Object.entries(expect)) {
  if (counts[k] !== n) {
    console.error(`[spec] 对账失败：${k}=${counts[k]}，应为 ${n}`);
    process.exit(1);
  }
}

const spec = {
  schema: 1,
  gameVersion: rootPkg.version,
  fnv1a32: fnv1a32(canonical).toString(16).padStart(8, '0'),
  sha256: createHash('sha256').update(canonical).digest('hex'),
  counts,
  payload,
};
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/spec.json', import.meta.url), JSON.stringify(spec, null, 1) + '\n');
console.log(
  `[spec] schema=${spec.schema} game=${spec.gameVersion} counts=${JSON.stringify(counts)} ` +
  `fnv1a32=${spec.fnv1a32} sha256=${spec.sha256.slice(0, 16)}…`,
);
