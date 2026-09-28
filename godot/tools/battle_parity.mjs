// 战斗对拍夹具生成器：TS 侧跑真实 Battle，产出 {cfg, 事件行, 摘要, 结果} 夹具。
// GDScript 侧镜像：godot/headless/battle_probe.gd。配置全部来自真实数据表
// （按 class/origin 挑人、按 hook 挑装备），覆盖召唤/复活/荆棘/兼爱/围攻/天命/墨兽。
// 用法：node --import tsx tools/battle_parity.mjs [--n 8] [--out data/battle_fixture.json]
import { writeFileSync, mkdirSync } from 'node:fs';
import { Battle } from '../../src/core/battle.ts';
import { CHAMPIONS } from '../../src/data/champions.ts';
import { ITEMS } from '../../src/data/items.ts';
import { encodeEvent, fnv1a32 } from './codec.mjs';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    out[k] = v ?? '';
  }
  return out;
}

const byClass = (cls) => CHAMPIONS.filter((c) => c.classes.includes(cls));
const byOrigin = (o) => CHAMPIONS.filter((c) => c.origins.includes(o));
const itemByHook = (hook) => ITEMS.find((i) => (i.hooks ?? []).includes(hook));
const components = ITEMS.filter((i) => i.tier === 'component').slice(0, 6).map((i) => i.id);

/** 布阵：team0 占 0~3 行、team1 占 4~7 行；行优先（每行 6 格），无碰撞 */
function place(defIds, team, stars = null, itemMap = null) {
  return defIds.map((defId, i) => ({
    uid: team * 100 + i + 1,
    defId,
    team,
    star: stars ? stars[i % stars.length] : 1,
    cell: { c: 1 + (i % 6), r: (team === 0 ? 0 : 4) + Math.floor(i / 6) },
    items: itemMap && itemMap[defId] ? itemMap[defId] : [],
  }));
}

// ── 六套主阵容（覆盖面优先）──
const W = byClass('warrior').slice(0, 6).map((c) => c.id);
const M = byClass('mage').slice(0, 6).map((c) => c.id);
const J = byOrigin('jiguan').slice(0, 6).map((c) => c.id);
const A = byClass('assassin').slice(0, 4).map((c) => c.id);
const G = byOrigin('guardian').slice(0, 6).map((c) => c.id);
const Y = byOrigin('youming').slice(0, 4).map((c) => c.id);
const MO = byOrigin('momen').slice(0, 3).map((c) => c.id);
const cost5 = CHAMPIONS.filter((c) => c.cost === 5).map((c) => c.id);
const cost4 = CHAMPIONS.filter((c) => c.cost === 4).map((c) => c.id);

const thornItem = itemByHook('thorns')?.id;
const immortalItem = itemByHook('immortal')?.id;
const sunItem = itemByHook('sunSpear')?.id;
const frenzyItem = itemByHook('killFrenzy')?.id;
const bannerItem = itemByHook('warBanner')?.id;
const bellItem = itemByHook('bellStun')?.id;

// count = 该队中持有此羁绊的去重棋子数（与 match 侧口径一致；直接由名单推导）
function mkTraits(list) {
  return list.map(([ids, id, tier]) => ({ id, tier, count: new Set(ids).size }));
}

const CONFIGS = [
  {
    name: 'warrior-vs-mage',
    build: () => ({
      units: [
        ...place(W, 0, [1, 2, 1, 2, 1, 3], { [W[0]]: [sunItem], [W[3]]: components.slice(0, 2) }),
        ...place(M, 1, [2, 1, 2, 1, 3, 1], { [M[0]]: [frenzyItem], [M[2]]: [bannerItem] }),
      ],
      traits: {
        0: mkTraits([[W, 'warrior', 1]]),
        1: mkTraits([[M, 'mage', 2]]),
      },
    }),
  },
  {
    name: 'jiguan-vs-guardian',
    build: () => ({
      units: [
        ...place(J, 0, [1, 1, 2, 1, 2, 1]),
        ...place(G, 1, [2, 1, 2, 1, 2, 2], { [G[0]]: [thornItem], [G[2]]: [immortalItem], [G[4]]: [bellItem] }),
      ],
      traits: {
        0: mkTraits([[J, 'jiguan', 1]]),
        1: mkTraits([[G, 'guardian', 2]]),
      },
    }),
  },
  {
    name: 'assassin-vs-youming-momen',
    build: () => {
      const ym = [...Y, ...MO];
      return {
        units: [
          ...place(A, 0, [2, 1, 2, 2]),
          ...place(ym, 1, [1, 2, 1, 2, 1, 1, 2]),
        ],
        traits: {
          0: mkTraits([[A, 'assassin', 1]]),
          1: mkTraits([[Y, 'youming', 1], [MO, 'momen', 1]]),
        },
      };
    },
  },
];

// ── 特殊案例（每种恰一局）──
function specialCases() {
  const out = [];
  // 天命 3★五费 + 登峰 3★四费 vs 混编
  out.push({
    name: 'legend-vs-mixed',
    seed: 424242,
    cfg: {
      units: [
        ...place([cost5[0], cost5[1], cost4[0], cost4[1], cost4[2]], 0, [3, 2, 3, 2, 3]),
        ...place([...byClass('marksman').slice(0, 3).map((c) => c.id), ...byClass('support').slice(0, 3).map((c) => c.id)], 1, [2, 2, 2, 2, 2, 2]),
      ],
      traits: {},
    },
  });
  // 墨兽（monster + powMult 引导轮口径）
  out.push({
    name: 'beast-powMult',
    seed: 777,
    cfg: {
      units: [
        ...place(W.slice(0, 4), 0, [1, 1, 1, 1]),
        { uid: 901, defId: cost5[2], team: 1, star: 2, cell: { c: 4, r: 5 }, monster: true, powMult: 0.15 },
        { uid: 902, defId: cost4[3], team: 1, star: 1, cell: { c: 2, r: 6 }, monster: true, powMult: 0.15 },
      ],
      traits: { 0: mkTraits([[W.slice(0, 4), 'warrior', 0]]) },
    },
  });
  // 短上限演习（maxTicks 通道）
  out.push({
    name: 'maxTicks-drill',
    seed: 99,
    cfg: {
      units: [
        ...place(W.slice(0, 3), 0, [2, 2, 2]),
        ...place(M.slice(0, 3), 1, [2, 2, 2]),
      ],
      traits: {},
      maxTicks: 300,
    },
  });
  return out;
}

const args = parseArgs(process.argv.slice(2));
const nSeeds = Number(args.n ?? 8);
const outPath = args.out ?? '../data/battle_fixture.json';

const cases = [];
for (const cfgDef of CONFIGS) {
  for (let s = 1; s <= nSeeds; s++) {
    cases.push({ name: `${cfgDef.name}#${s}`, seed: 1000 + s * 17, cfg: cfgDef.build() });
  }
}
for (const sp of specialCases()) {
  // cfg 内 seed 以 case.seed 为准（build 的 cfg 不带 seed）
  cases.push(sp);
}

let totalEvents = 0;
const outCases = [];
for (const c of cases) {
  const cfg = { ...c.cfg, seed: c.seed };
  const b = new Battle(cfg, null, true);
  const result = b.run();
  const lines = b.events.map(encodeEvent);
  totalEvents += lines.length;
  outCases.push({
    name: c.name,
    seed: c.seed,
    cfg,
    lines,
    fnv1a32: fnv1a32(lines.join('\n')).toString(16).padStart(8, '0'),
    result: {
      winner: result.winner,
      ticks: result.ticks,
      timeout: result.timeout,
      survivors: result.survivors,
      remainingHpRatio: result.remainingHpRatio,
    },
    finalUnits: b.units.map((u) => ({
      uid: u.uid,
      hp: u.hp,
      maxHp: u.maxHp,
      cell: { c: u.cell.c, r: u.cell.r },
      alive: u.alive,
      revived: u.revived,
    })),
  });
}

const fixture = { v: 1, engine: 'ts', cases: outCases };
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL(outPath, import.meta.url), JSON.stringify(fixture));
console.log(
  `[battle-parity] cases=${outCases.length} events=${totalEvents} ` +
  `mean_events=${(totalEvents / outCases.length).toFixed(0)} -> ${outPath}`,
);
