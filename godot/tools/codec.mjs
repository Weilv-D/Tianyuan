// 对拍编解码器 TS 侧（规格：docs/PARITY_CODEC.md）。纯 JS，无冻结仓依赖。
// 数值一律编码为 float64 大端位型 hex；可选字段判据是 !== undefined 且 !== null。

const SAFE_STRING = /^[A-Za-z0-9_.|:-]*$/;

export function num(v) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, v, false);
  return Buffer.from(buf).toString('hex');
}

function bool01(v) {
  return v ? '1' : '0';
}

function str(s) {
  if (!SAFE_STRING.test(s)) throw new Error(`codec: 字符串越界字符集: ${JSON.stringify(s)}`);
  return JSON.stringify(s);
}

/** opt 槽：返回 [] 或 ['1', ...值 token] */
function opt(...tokens) {
  return tokens.length === 0 ? ['-'] : ['1', ...tokens];
}

function optNum(v) {
  return v === undefined ? ['-'] : ['1', num(v)];
}

function optStr(v) {
  return v === undefined ? ['-'] : ['1', str(v)];
}

function optCell(c) {
  return c === undefined ? ['-'] : ['1', num(c.c), num(c.r)];
}

function params(p) {
  if (p === undefined) return ['-'];
  const out = ['1'];
  for (const k of Object.keys(p).sort()) {
    if (!SAFE_STRING.test(k)) throw new Error(`codec: params 键越界: ${JSON.stringify(k)}`);
    out.push(JSON.stringify(k), num(p[k]));
  }
  return out;
}

function units(us) {
  const out = [num(us.length)];
  for (const u of us) {
    out.push(num(u.uid), str(u.defId), num(u.team), num(u.star), num(u.cell.c), num(u.cell.r), num(u.maxHp), num(u.hp));
  }
  return out;
}

export function encodeEvent(e) {
  const t = [];
  switch (e.t) {
    case 'start':
    case 'spawn':
      t.push(str(e.t), num(e.tick), ...units(e.units));
      break;
    case 'castStart':
      t.push(str(e.t), num(e.tick), num(e.uid), str(e.skillId), num(e.windup));
      break;
    case 'cast':
      t.push(str(e.t), num(e.tick), num(e.uid), str(e.skillId), ...optNum(e.targetUid), ...optCell(e.cell), ...params(e.params));
      break;
    case 'attackStart':
      t.push(str(e.t), num(e.tick), num(e.uid), num(e.targetUid), num(e.windup), bool01(e.isRanged));
      break;
    case 'projectile':
      t.push(str(e.t), num(e.tick), num(e.uid), num(e.targetUid), num(e.from.c), num(e.from.r), num(e.to.c), num(e.to.r), num(e.dur), str(e.kind));
      break;
    case 'damage':
      t.push(str(e.t), num(e.tick), num(e.srcUid), num(e.dstUid), num(e.amount), str(e.type), bool01(e.crit), bool01(e.kill), str(e.source));
      break;
    case 'heal':
      t.push(str(e.t), num(e.tick), num(e.srcUid), num(e.dstUid), num(e.amount));
      break;
    case 'mana':
      t.push(str(e.t), num(e.tick), num(e.uid), num(e.mp), num(e.maxMp));
      break;
    case 'shield':
      t.push(str(e.t), num(e.tick), num(e.uid), num(e.amount), num(e.total));
      break;
    case 'move':
    case 'blink':
      t.push(str(e.t), num(e.tick), num(e.uid), num(e.from.c), num(e.from.r), num(e.to.c), num(e.to.r), num(e.dur));
      break;
    case 'status':
      t.push(str(e.t), num(e.tick), num(e.uid), str(e.kind), num(e.dur), num(e.value), bool01(e.added), ...optStr(e.src));
      break;
    case 'death':
      t.push(str(e.t), num(e.tick), num(e.uid), num(e.killerUid));
      break;
    case 'fx':
      t.push(str(e.t), num(e.tick), str(e.kind), ...optNum(e.uid), ...optCell(e.cell), ...optNum(e.targetUid), ...optNum(e.radius), ...optNum(e.team), ...params(e.params));
      break;
    case 'end':
      t.push(str(e.t), num(e.tick), ...optNum(e.winner ?? undefined), bool01(e.timeout));
      break;
    default:
      throw new Error(`codec: 未知事件类型 ${JSON.stringify(e.t)}`);
  }
  return '[' + t.join(',') + ']';
}

export function fnv1a32(s) {
  let h = 2166136261 >>> 0;
  for (const b of Buffer.from(s, 'utf8')) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function encodeStream(events) {
  const lines = events.map(encodeEvent);
  const body = lines.join('\n');
  return {
    lines,
    fnv1a32: fnv1a32(body).toString(16).padStart(8, '0'),
  };
}
