// 整局对拍夹具生成器：TS 侧跑真实 Match 整局（含人类操作脚本/存档轮转/撤销/
// 恩赐/每日模式），产出每回合状态摘要行 + 剧本。GDScript 侧镜像：
// godot/headless/match_probe.gd —— 同一剧本重放、同款编码器、逐行比对。
//
// 编码器口径（两侧必须逐字符一致）：
// - 浮点一律 f64 位型 hex（Buffer.writeDoubleBE / StreamPeerBuffer 大端）；
// - rngState/u32 用十进制整数（JS number 与 GDScript int 均精确）；
// - eventsDigest 不进编码（record_events=false 恒 ''；JSON.stringify 键序是
//   引擎内自洽口径，跨引擎比对走 PARITY_CODEC 战斗对拍，已在 M1 全绿）；
// - log 文本经「每条 fnv 再串接再 fnv」的 UTF-8 摘要 —— 中文文案逐字可比。
// 用法：node --import tsx tools/match_parity.mjs [--seeds 6] [--out data/match_fixture.json]
import { writeFileSync, mkdirSync } from 'node:fs';
import { Match } from '../../src/game/match.ts';
import { moveToSlot } from '../../src/game/state.ts';
import { equipItem, unequipAll, autoEquip } from '../../src/game/inventory.ts';
import { autoArrange } from '../../src/game/arrange.ts';
import { snapshotPlayer, restorePlayer } from '../../src/game/undo.ts';
import { dailySeedFor } from '../../src/game/daily.ts';
import { fnv1a32 } from './codec.mjs';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    out[k] = v ?? '';
  }
  return out;
}

const f64h = (v) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(v, 0);
  return b.toString('hex');
};

// ───────────────── 状态编码器（GDScript 侧必须同款） ─────────────────

function encCells(board) {
  const parts = [];
  for (let i = 0; i < board.length; i++) {
    const u = board[i];
    if (!u) continue;
    parts.push(
      `${i}:${u.iid}:${u.defId}:${u.star}:${u.items.join('.')}:` +
      `${u.isBeast ? 1 : 0}${u.powMult != null ? ':' + f64h(u.powMult) : ''}`,
    );
  }
  return parts.length ? parts.join(';') : '-';
}

function encPlayer(p) {
  const shop = p.shop.map((s) => s ?? '-').join(',');
  const opp = p.opponents.join(',');
  const ai = p.ai ? p.ai.arch : '-';
  return (
    `${p.idx}:${p.alive ? 1 : 0}:${f64h(p.hp)}:${f64h(p.gold)}:${p.level}:${f64h(p.xp)}:` +
    `${p.streak}:${p.bestStreak}:${p.rank}:${p.wins}:${p.losses}:${p.lastOutcome ?? '-'}:` +
    `${f64h(p.lastDamage)}:${f64h(p.totalDamage)}|${shop}|${p.shopLocked ? 1 : 0}|` +
    `${opp}|${encCells(p.board)}|${encCells(p.bench)}|${p.items.join('.')}|${ai}`
  );
}

function encodeMatch(m) {
  const pl = m.players.map(encPlayer).join('|');
  const ghosts = [...m.ghosts.entries()].map(([k, b]) => `${k}>${encCells(b)}`).join('|') || '-';
  const beast = m.beastBoard ? encCells(m.beastBoard) : '-';
  const offer = m.adventureOffer
    ? `${m.adventureOffer.round}:${m.adventureOffer.options.map((o) => o.kind).join('.')}`
    : '-';
  const snaps = m.battleSnapshots.map((s) => `${s.round}.${s.winner ?? 'N'}.${s.ticks}`).join(',');
  const pairs = m.pairings.map((q) => `${q.a}.${q.b}.${q.ghost}.${q.swap ? 1 : 0}.${q.beast ? 1 : 0}`).join(',');
  const logDig = fnv1a32(m.log.map((l) => fnv1a32(l).toString(16)).join(','));
  return (
    `S|${m.seed}|${m.round}|${m.phase}|${m.rng.state}|PL|${pl}|G|${ghosts}|B|${beast}|` +
    `A|${offer}|K|${snaps}|Q|${pairs}|L|${logDig}`
  );
}

// ───────────────── 人类操作脚本（相对寻址：两侧同状态 ⇒ 同求值） ─────────────────

function kthShopSlot(m, k) {
  let seen = -1;
  for (let i = 0; i < m.human.shop.length; i++) {
    if (m.human.shop[i] != null) {
      seen++;
      if (seen === k) return i;
    }
  }
  return -1;
}

function kthUnitIdx(units, k) {
  return k < units.length ? units[k] : null;
}

function applyAction(m, act) {
  const p = m.human;
  switch (act.t) {
    case 'buy': {
      const slot = kthShopSlot(m, act.k);
      if (slot >= 0) m.buy(p, slot);
      return;
    }
    case 'reroll':
      m.reroll(p);
      return;
    case 'buyexp':
      m.buyExp(p);
      return;
    case 'sellbench': {
      const u = kthUnitIdx([...p.bench.filter(Boolean)], act.k);
      if (u) m.sell(p, u.iid);
      return;
    }
    case 'sellboard': {
      const u = kthUnitIdx([...p.board.filter(Boolean)], act.k);
      if (u) m.sell(p, u.iid);
      return;
    }
    case 'move': {
      const src = act.fw === 'bench' ? [...p.bench.filter(Boolean)] : [...p.board.filter(Boolean)];
      const u = kthUnitIdx(src, act.fk);
      if (!u) return;
      const slot = act.tw === 'board' ? act.tr * 8 + act.tc : act.tk;
      moveToSlot(p, u.iid, act.tw, slot);
      return;
    }
    case 'equip': {
      const item = p.items[act.ik];
      const u = kthUnitIdx([...p.board.filter(Boolean), ...p.bench.filter(Boolean)], act.uk);
      if (item && u) equipItem(p, u.iid, item);
      return;
    }
    case 'unequipall': {
      const u = kthUnitIdx([...p.board.filter(Boolean), ...p.bench.filter(Boolean)], act.uk);
      if (u) unequipAll(p, u.iid);
      return;
    }
    case 'autobuild':
      autoArrange(p, m.pool);
      return;
    case 'autoequip':
      autoEquip(p);
      return;
    case 'adv':
      m.resolveAdventure(act.i);
      return;
    case 'autoadv':
      m.resolveHumanAdventure();
      return;
    case 'undo': {
      const snap = snapshotPlayer(p, m.pool, m.adventureOffer);
      const rngBackup = m.rng.state;
      m.reroll(p);
      const slot = kthShopSlot(m, 0);
      if (slot >= 0) m.buy(p, slot);
      restorePlayer(p, m.pool, snap, m);
      m.rng.state = rngBackup;
      return;
    }
    default:
      throw new Error(`unknown action ${act.t}`);
  }
}

// ───────────────── 剧本生成（一次生成、序列化进夹具 —— 重放方零生成器） ─────────────────

function hash32(str) {
  let h = 2166136261;
  for (const b of Buffer.from(str, 'utf8')) {
    h ^= b;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function scriptFor(seed, round) {
  const acts = [];
  const r = hash32(`${seed}#${round}`);
  const pick = (mask) => (r >>> mask) % 100;
  // 每回合基础节奏：看情况买 0~2 张 + 偶尔刷新/买经验
  const mode = pick(0) % 7;
  if (mode === 0) {
    acts.push({ t: 'buy', k: 0 }, { t: 'buy', k: 1 % 5 });
  } else if (mode === 1) {
    acts.push({ t: 'reroll' }, { t: 'buy', k: 0 });
  } else if (mode === 2) {
    acts.push({ t: 'buyexp' }, { t: 'buy', k: 0 });
  } else if (mode === 3) {
    acts.push({ t: 'buy', k: 1 });
  } else if (mode === 4) {
    acts.push({ t: 'autobuild' });
  } else if (mode === 5 && round > 2) {
    acts.push({ t: 'sellbench', k: 0 }, { t: 'buy', k: 0 });
  } else {
    acts.push({ t: 'undo', k: 0 });
  }
  // 特定回合的专项覆盖（对拍面）：恩赐/装备/移动/卸装
  if (round === 4) acts.push({ t: 'adv', i: 0 });
  if (round === 10) acts.push({ t: 'autoadv' });
  if (round === 16) acts.push({ t: 'adv', i: 1 });
  if (round === 6 || round === 14) {
    acts.push({ t: 'equip', ik: 0, uk: 0 }, { t: 'move', fw: 'bench', fk: 0, tw: 'board', tc: 2, tr: 0 });
  }
  if (round === 9 || round === 20) acts.push({ t: 'unequipall', uk: 0 }, { t: 'autoequip' });
  if (round === 12) acts.push({ t: 'sellboard', k: 0 });
  return acts;
}

// ───────────────── 整局驱动 ─────────────────

const MAX_ROUNDS = 45;

function runMatch(seed, mode = 'normal') {
  let m = new Match(seed, '你', mode);
  const script = {};
  const checkAt = [];
  const snapshotTexts = {};
  const lines = [];
  while (!m.isOver() && m.round < MAX_ROUNDS) {
    m.beginRound();
    // 剧本一次生成、先记录后执行 —— GDScript 侧重放 fixture 内的同一份动作数据
    script[m.round] = scriptFor(seed, m.round);
    for (const act of script[m.round]) applyAction(m, act);
    m.settleRound();
    m.endRound();
    lines.push(encodeMatch(m));
    // 存档轮转：回合 5/13/21 结束后 to→from JSON（读到「同一天的自己」）；
    // phase='result' 的推进契约由下一轮循环头的 beginRound 兑现（渲染层同款）
    if (m.round === 5 || m.round === 13 || m.round === 21) {
      checkAt.push(m.round);
      const text = JSON.stringify({ v: 3, mode: m.mode, data: m.toJSON() });
      snapshotTexts[m.round] = text;
      const m2 = Match.fromJSON(JSON.parse(text).data);
      lines.push(`RELOAD|${encodeMatch(m2)}`);
      m = m2;
    }
  }
  const finalLine = `FINAL|${encodeMatch(m)}`;
  return { seed, mode, script, checkAt, snapshotTexts, lines, finalLine, rounds: m.round, over: m.isOver() };
}

// ───────────────── 主流程 ─────────────────

const args = parseArgs(process.argv.slice(2));
const nSeeds = parseInt(args.seeds ?? '6', 10);
const out = args.out ?? '../data/match_fixture.json';

const seeds = [];
for (let i = 0; i < nSeeds; i++) seeds.push(hash32(`match-seed-${i}`));
// 每日模式案例：日期种子的整局（种子数值由 TS 算出直接写入，两侧同值使用）
const dailySeed = dailySeedFor(new Date(2026, 8, 28));

const cases = seeds.map((s) => runMatch(s, 'normal'));
cases.push(runMatch(dailySeed, 'daily'));

const fixture = {
  schema: 1,
  daily: { y: 2026, m: 9, d: 28, seed: dailySeed >>> 0 },
  scriptNote: 'actions are replayed verbatim from fixture; addressing is relative (k-th non-null slot)',
  cases,
};

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL(out, import.meta.url), JSON.stringify(fixture) + '\n');

const totalLines = cases.reduce((a, c) => a + c.lines.length + 1, 0);
console.log(
  `[match-parity] cases=${cases.length} seeds=${seeds.length}+1daily lines=${totalLines} ` +
    `rounds=${cases.map((c) => c.rounds).join('/')} over=${cases.map((c) => (c.over ? 1 : 0)).join('')} ` +
    `dailySeed=0x${(dailySeed >>> 0).toString(16)} -> ${out}`,
);
