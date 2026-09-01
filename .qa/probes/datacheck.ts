import { CHAMPIONS } from '../../src/data/champions';
import { TRAITS } from '../../src/data/traits';
import { ITEMS, ITEM_BY_ID } from '../../src/data/items';
import * as fs from 'node:fs';

const line = (s: string) => console.log(s);

line(`棋子总数: ${CHAMPIONS.length}   (README 声称 64)`);
line(`羁绊总数: ${TRAITS.length}   (README 声称 17)`);
const components = ITEMS.filter((i: any) => i.tier === 'component');
const combined = ITEMS.filter((i: any) => i.tier === 'combined');
line(`装备总数: ${ITEMS.length}   组件=${components.length} 成品=${combined.length}   (README 声称 8 组件 14 成品 = 22)`);

// ── 技能 kind ──
const kinds = new Set<string>();
for (const c of CHAMPIONS as any[]) if (c.skillSpec?.kind) kinds.add(c.skillSpec.kind);
line(`\n实际使用 skill kind: ${kinds.size} 种 -> ${[...kinds].sort().join(', ')}`);
line(`(champions.ts 类型声明 15 种, README 声称 15 类)`);

const skillsSrc = fs.readFileSync('src/core/skills.ts', 'utf8');
const implBlock = skillsSrc.slice(skillsSrc.indexOf('const IMPL'), skillsSrc.indexOf('/** 施放技能的统一入口 */'));
const declared = [...skillsSrc.matchAll(/^\s*\|?\s*'([a-zA-Z]+)'/gm)].map((m) => m[1]);
const missing = [...kinds].filter((k) => !implBlock.includes(k + ':'));
line(`缺少实现的 kind: ${missing.length === 0 ? '无' : missing.join(', ')}`);
const unused = [...new Set(declared)].filter((k) => !kinds.has(k) && implBlock.includes(k + ':'));
line(`声明/实现但无棋子使用的 kind: ${unused.length === 0 ? '无' : unused.join(', ')}`);

// ── 费用分布 ──
const byCost: Record<number, number> = {};
for (const c of CHAMPIONS as any[]) byCost[c.cost] = (byCost[c.cost] ?? 0) + 1;
line(`\n费用分布: ${JSON.stringify(byCost)}`);

// ── 羁绊引用完整性 ──
const traitIds = new Set((TRAITS as any[]).map((t) => t.id));
const badRef: string[] = [];
for (const c of CHAMPIONS as any[]) {
  for (const o of c.origins ?? []) if (!traitIds.has(o)) badRef.push(`${c.id}.origins=${o}`);
  for (const cl of c.classes ?? []) if (!traitIds.has(cl)) badRef.push(`${c.id}.classes=${cl}`);
}
line(`\n无效羁绊引用: ${badRef.length === 0 ? '无 ✓' : badRef.join(', ')}`);

// ── 羁绊可达性：每个羁绊的棋子数 vs 断点 ──
line(`\n羁绊 -> 持有棋子数 / 断点`);
const unreachable: string[] = [];
for (const t of TRAITS as any[]) {
  const n = (CHAMPIONS as any[]).filter(
    (c) => (c.origins ?? []).includes(t.id) || (c.classes ?? []).includes(t.id),
  ).length;
  const maxBp = Math.max(...(t.breakpoints ?? []));
  const ok = n >= maxBp;
  if (!ok) unreachable.push(`${t.id}(${n}<${maxBp})`);
  line(
    `  ${String(t.id).padEnd(11)} ${t.name.padEnd(4)} 持有=${String(n).padStart(2)}  断点=${JSON.stringify(t.breakpoints)}  ${ok ? '' : '  ⚠ 最高档不可达'}`,
  );
}
line(`最高档不可达的羁绊: ${unreachable.length === 0 ? '无 ✓' : unreachable.join(', ')}`);

// ── 装备配方 ──
line(`\n装备配方校验:`);
const compIds = new Set(components.map((i: any) => i.id));
const recipeMap = new Map<string, string[]>();
const badRecipe: string[] = [];
for (const it of ITEMS as any[]) {
  for (const r of it.recipe ?? []) {
    if (!ITEM_BY_ID[r]) badRecipe.push(`${it.id} -> ${r}`);
    if (!compIds.has(r)) badRecipe.push(`${it.id} 配方原料 ${r} 非组件`);
  }
  if (it.recipe && it.recipe.length === 2) {
    const key = [...it.recipe].sort().join('+');
    if (!recipeMap.has(key)) recipeMap.set(key, []);
    recipeMap.get(key)!.push(it.id);
  }
}
line(`  无效配方引用: ${badRecipe.length === 0 ? '无 ✓' : badRecipe.join(', ')}`);

// 全配方覆盖：8 组件两两组合（含同件）= 36
const allPairs: string[] = [];
const compList = [...compIds].sort();
for (let i = 0; i < compList.length; i++)
  for (let j = i; j < compList.length; j++) allPairs.push(compList[i] + '+' + compList[j]);
const uncovered = allPairs.filter((p) => !recipeMap.has(p));
line(`  组件两两组合(含同件)总数=${compList.length * (compList.length + 1) / 2}，已覆盖=${allPairs.length - uncovered.length}，未覆盖=${uncovered.length}`);
if (uncovered.length) line(`  未覆盖组合: ${uncovered.join('  ')}`);
const multi = [...recipeMap.entries()].filter(([, v]) => v.length > 1);
if (multi.length) line(`  一对多配方: ${multi.map(([k, v]) => k + '->' + v.join('/')).join('  ')}`);

// ── 装备钩子实现 ──
const hookIds = new Set<string>();
for (const it of ITEMS as any[]) for (const h of it.hooks ?? []) hookIds.add(h);
const itemsSrc = fs.readFileSync('src/core/items.ts', 'utf8');
const missingHooks = [...hookIds].filter((h) => !itemsSrc.includes(`'${h}'`));
line(`\n装备钩子: 声明 ${hookIds.size} 种，未实现: ${missingHooks.length === 0 ? '无 ✓' : missingHooks.join(', ')}`);

// 钩子反向：实现了但无装备使用
const itemsSrcHooks = [...itemsSrc.matchAll(/has\(u, '([a-zA-Z]+)'\)/g)].map((m) => m[1]);
const unusedHooks = [...new Set(itemsSrcHooks)].filter((h) => !hookIds.has(h));
line(`实现了但无装备使用的钩子: ${unusedHooks.length === 0 ? '无 ✓' : unusedHooks.join(', ')}`);
