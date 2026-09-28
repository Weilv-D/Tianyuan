// RNG 对拍 TS 侧镜像（GDScript 侧：godot/headless/rng_parity.gd）。
// 用法：node --import tsx tools/parity_rng.mjs -- --seed=12345 --draws=1000000 --mode=rng|seq
// 双方对同一操作序列产出同一规范化文本，比对 fnv1a32/sha256。
import { createHash } from 'node:crypto';
import { Rng, hashSeed } from '../../src/core/rng.ts';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    out[k] = v ?? '';
  }
  return out;
}

function f64hex(v) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, v, false);
  return Buffer.from(buf).toString('hex');
}

function fnv1a32(str) {
  let h = 2166136261 >>> 0;
  for (const b of Buffer.from(str, 'utf8')) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const args = parseArgs(process.argv.slice(2));
const seed = Number(args.seed ?? 12345);
const draws = Number(args.draws ?? 1_000_000);
const mode = args.mode ?? 'rng';

const rng = new Rng(seed);
const lines = [];
if (mode === 'rng') {
  for (let i = 0; i < draws; i++) lines.push(f64hex(rng.next()));
} else {
  for (let i = 0; i < 100; i++) lines.push(f64hex(rng.float(0.5, 1.5)));
  for (let i = 0; i < 100; i++) lines.push(String(rng.int(3, 10)));
  for (let i = 0; i < 100; i++) lines.push(String(rng.intn(64)));
  for (let i = 0; i < 100; i++) lines.push(rng.chance(0.3) ? '1' : '0');
  for (let i = 0; i < 100; i++) lines.push(String(rng.pick([11, 22, 33, 44, 55])));
  for (let i = 0; i < 20; i++) {
    const a = Array.from({ length: 64 }, (_, k) => k);
    rng.shuffle(a);
    lines.push(a.join(','));
  }
  for (let i = 0; i < 50; i++) {
    lines.push(rng.sampleWeighted([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [5, 0, 3, 1, 0, 2, 7, 0, 1, 4], 5).join(','));
  }
  for (const s of ['duanyue', '百战天元', 'daily-2026-09-28', '']) lines.push(String(hashSeed(s) >>> 0));
}

const body = lines.join('\n');
const result = {
  engine: 'ts',
  mode,
  seed,
  draws: mode === 'rng' ? draws : lines.length,
  fnv1a32: fnv1a32(body).toString(16).padStart(8, '0'),
  sha256: createHash('sha256').update(body).digest('hex'),
  head: lines.slice(0, 3),
  tail: lines.slice(-3),
};
console.log('PARITY_JSON ' + JSON.stringify(result));
