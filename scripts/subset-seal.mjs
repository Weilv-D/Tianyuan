/**
 * 小篆字库 · 字体子集管线
 *
 * 输入：用户提供的 YiShanBeiZhuanTi.ttf（篆体，源包无授权文件，资产由项目所有者提供）
 * 输出：src/assets/fonts/seal.woff2（仅含用字表，供 FontFace 载入 + traitIcons 烘焙）
 *
 * 先逐字探测字体覆盖（篆体字库未必收简繁全部码位），再按实际存在的字出子集。
 * 运行：node scripts/subset-seal.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

// 输入/输出锚定仓库根：脚本从任意 cwd 运行都落同一位（与切图脚本同口径）
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(root, 'design/fonts/YiShanBeiZhuanTi.ttf');
const OUT = join(root, 'src/assets/fonts/seal.woff2');

/** 用字表 = 羁绊字表；传统码位优先，简体码位作覆盖探测备选。
 *  字表以源字体篆形为界：开屏「天」取自表中，「弈」在源字体为楷形不入表。 */
const CHARS = '天幽山劍剑妖機机鼎龍龙墨兵武護护刺射方術术丹';

if (!existsSync(SRC)) {
  console.error(`✗ 源字体不存在: ${SRC}（用户提供的资产，不入库）`);
  process.exit(1);
}
const ttf = readFileSync(SRC);

const probe = [];
for (const ch of CHARS) {
  const buf = await subsetFont(ttf, ch, { targetFormat: 'woff2' });
  probe.push([ch, buf.length]);
}
// 单字子集小于 ~200 字节视为无该字形（空 cmap）
const missing = probe.filter(([, n]) => n < 200).map(([c]) => c);
const present = [...CHARS].filter((c) => !missing.includes(c));
console.log('字体缺失字形：', missing.length ? missing.join(' ') : `（无，${present.length} 字全覆盖）`);
console.log('可用字形：', present.join(' '));

mkdirSync(join(root, 'src/assets/fonts'), { recursive: true });
const woff2 = await subsetFont(ttf, present.join(''), { targetFormat: 'woff2' });
// 原子写：先落 .tmp 再 rename —— 中断（Ctrl+C / 进程被杀）时不留下半截 woff2
// 被 vite 内联成坏字体（与 slice-sheet 同一套 atomicWrite 纪律）
const tmpOut = `${OUT}.tmp`;
writeFileSync(tmpOut, woff2);
renameSync(tmpOut, OUT);
console.log(`写出 ${OUT}：${(woff2.length / 1024).toFixed(1)} KB，${present.length} 字`);
