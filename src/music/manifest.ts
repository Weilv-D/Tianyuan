/**
 * 典藏音乐清单（D4）—— 授权曲目的单一真源。
 *
 * 数据层在 ./tracks.json（审计脚本与测试直接读它），本文件把数据与
 * `?url` 构建产物绑定：托管形态得到哈希化的文件 URL，单文件形态
 * （vite-plugin-singlefile + assetsInlineLimit）内联为 data URL ——
 * 两种形态零改动共享同一入口。
 *
 * 授权纪律（ADR D1）：只收 CC0-1.0。单文件分发零署名义务；
 * 来源与哈希仍随包分发（release/THIRD_PARTY_LICENSES.txt，audit-music 生成）。
 * 任何曲目缺失 / 解码失败 / 开关关闭 → 程序化合成路径原样运行，游戏不依赖授权层。
 */
import menuUrl from './tracks/menu.ogg?url';
import prepUrl from './tracks/prep.ogg?url';
import battleUrl from './tracks/battle.ogg?url';
import finalUrl from './tracks/final.ogg?url';
import raw from './tracks.json';

export type MusicMood = 'menu' | 'prep' | 'battle' | 'final';

export interface LicensedTrack {
  id: MusicMood;
  /** 仓库内路径（相对根）；audit-music 校验存在性与 sha256 用 */
  file: string;
  /** 构建产物 URL（托管形态为 hash 文件；单文件形态为 data URL） */
  url: string;
  title: string;
  artist: string;
  license: 'CC0-1.0';
  sourceUrl: string;
  sha256: string;
}

/** tracks.json 的原始形状（id 为宽松 string，map 时收紧为 MusicMood） */
interface TrackJson {
  id: string;
  file: string;
  title: string;
  artist: string;
  license: string;
  sourceUrl: string;
  sha256: string;
}

const rawTracks = raw as TrackJson[];

const URLS: Record<MusicMood, string> = {
  menu: menuUrl,
  prep: prepUrl,
  battle: battleUrl,
  final: finalUrl,
};

export const LICENSED_MUSIC: LicensedTrack[] = rawTracks.map((t) => ({
  id: t.id as MusicMood,
  file: t.file,
  title: t.title,
  artist: t.artist,
  license: 'CC0-1.0',
  sourceUrl: t.sourceUrl,
  sha256: t.sha256,
  url: URLS[t.id as MusicMood],
}));

/** 按心境取曲；无对应曲目返回 null（调用方回落程序化合成） */
export function licensedTrackOf(mood: MusicMood): LicensedTrack | null {
  return LICENSED_MUSIC.find((t) => t.id === mood) ?? null;
}

/** 出处脚注一行（设置面板 / 菜单脚注显示用） */
export function musicCreditLine(): string {
  const artists = [...new Set(LICENSED_MUSIC.map((t) => t.artist))].join(' / ');
  return `音乐 ${LICENSED_MUSIC.length} 曲 · ${artists} · CC0`;
}
