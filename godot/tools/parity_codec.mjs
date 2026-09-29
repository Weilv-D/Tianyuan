// 生成对拍编解码合成夹具：覆盖全部 16 类事件、可选字段在/缺、零值、分数值、null winner、
// 乱序 params 键（编码侧必须排序）。产物 data/codec_fixture.json 供 GDScript 侧往返验收。
// 用法：node --import tsx tools/parity_codec.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encodeStream } from './codec.mjs';

const events = [
  { t: 'start', tick: 0, units: [
    { uid: 1, defId: 'duanyue', team: 0, star: 3, cell: { c: 0, r: 1 }, maxHp: 1800.5, hp: 1800.5 },
    { uid: 2, defId: 'qingqiu', team: 1, star: 1, cell: { c: 7, r: 6 }, maxHp: 550, hp: 0 },
  ] },
  { t: 'spawn', tick: 90, units: [{ uid: 9, defId: 'mohe', team: 0, star: 2, cell: { c: 3, r: 3 }, maxHp: 300.25, hp: 300.25 }] },
  { t: 'castStart', tick: 12, uid: 1, skillId: 'tianlei', windup: 0.6 },
  { t: 'cast', tick: 30, uid: 1, skillId: 'tianlei', targetUid: 0, cell: { c: 4, r: 4 }, params: { zhen: 1.5, bai: 2, a: 0.125 } },
  { t: 'cast', tick: 31, uid: 2, skillId: 'wuji' },
  { t: 'attackStart', tick: 5, uid: 1, targetUid: 2, windup: 0.35, isRanged: false },
  { t: 'attackStart', tick: 6, uid: 2, targetUid: 1, windup: 0.2, isRanged: true },
  { t: 'projectile', tick: 7, uid: 2, targetUid: 1, from: { c: 7, r: 6 }, to: { c: 0, r: 1 }, dur: 0.4, kind: 'arrow' },
  { t: 'damage', tick: 18, srcUid: 1, dstUid: 2, amount: 123.75, type: 'magic', crit: true, kill: false, source: 'skill' },
  { t: 'damage', tick: 19, srcUid: 2, dstUid: 1, amount: 0, type: 'true', crit: false, kill: true, source: 'dot' },
  { t: 'heal', tick: 20, srcUid: 1, dstUid: 1, amount: 66.6 },
  { t: 'mana', tick: 21, uid: 1, mp: 45.5, maxMp: 90 },
  { t: 'shield', tick: 22, uid: 1, amount: 120, total: 320 },
  { t: 'move', tick: 23, uid: 1, from: { c: 0, r: 1 }, to: { c: 1, r: 1 }, dur: 0.3 },
  { t: 'blink', tick: 24, uid: 1, from: { c: 1, r: 1 }, to: { c: 5, r: 5 }, dur: 0.25 },
  { t: 'status', tick: 25, uid: 2, kind: 'burn', dur: 4, value: 15, added: true, src: 'item.huoshan' },
  { t: 'status', tick: 26, uid: 2, kind: 'chill', dur: 2, value: 0, added: false },
  { t: 'death', tick: 27, uid: 2, killerUid: 1 },
  { t: 'fx', tick: 28, kind: 'burst', uid: 1, cell: { c: 4, r: 4 }, targetUid: 2, radius: 1.5, team: 1, params: { n: 3 } },
  { t: 'fx', tick: 29, kind: 'groundMark', cell: { c: 2, r: 2 } },
  { t: 'fx', tick: 30, kind: 'healWave' },
  { t: 'end', tick: 31, winner: 0, timeout: false },
  { t: 'end', tick: 900, winner: null, timeout: true },
];

// 夹具里也放一条「带 undefined 显式键」的 cast（TS 语义下等同缺省）——夹具 JSON 序列化会省略它，
// GDScript 侧按缺省处理即为正确行为；此条主要约束 TS 编码器自身不为 undefined 发标志位。
events.splice(4, 0, { t: 'cast', tick: 31, uid: 3, skillId: 'kong', targetUid: undefined, params: undefined });

const stream = encodeStream(events);
const body = stream.lines.join('\n');
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../data/codec_fixture.json', import.meta.url),
  JSON.stringify({ v: 1, events, lines: stream.lines, fnv1a32: stream.fnv1a32 }, null, 1) + '\n',
);
console.log(`[codec] events=${events.length} fnv1a32=${stream.fnv1a32} sha256=${createHash('sha256').update(body).digest('hex').slice(0, 16)}…`);
