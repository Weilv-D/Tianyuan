/**
 * 典藏音乐清单回归（D4）。
 *
 * 单一真源 src/music/tracks.json：文件存在、sha256 匹配、id 唯一、
 * 四心境全覆盖、授权恒 CC0-1.0。与 scripts/audit-music.mjs（release 门禁）
 * 同口径 —— 测试管开发期，门禁管发布期。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LICENSED_MUSIC } from '../src/music/manifest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tracks = JSON.parse(readFileSync(join(root, 'src/music/tracks.json'), 'utf8')) as {
  id: string;
  file: string;
  title: string;
  artist: string;
  license: string;
  sha256: string;
}[];

describe('典藏音乐清单', () => {
  it('四个心境全覆盖且 id 唯一', () => {
    const ids = tracks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const mood of ['menu', 'prep', 'battle', 'final']) {
      expect(ids, `心境 ${mood} 缺曲`).toContain(mood);
    }
  });

  it('授权恒为 CC0-1.0（ADR D1：禁 CC-BY / 自定义授权）', () => {
    for (const t of tracks) expect(t.license).toBe('CC0-1.0');
  });

  it('每个曲目文件存在且 sha256 与清单一致', () => {
    for (const t of tracks) {
      const file = join(root, t.file);
      expect(existsSync(file), `${t.id} 文件缺失 ${t.file}`).toBe(true);
      const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(sha, `${t.id} sha256 漂移`).toBe(t.sha256);
    }
  });

  it('manifest.ts 与 tracks.json 同源（id 一一对应）', () => {
    expect(LICENSED_MUSIC.map((t) => t.id).sort()).toEqual([...tracks.map((t) => t.id)].sort());
    for (const t of LICENSED_MUSIC) expect(t.url).toBeTruthy();
  });
});
