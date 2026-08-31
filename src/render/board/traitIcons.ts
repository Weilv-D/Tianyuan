import Phaser from 'phaser';
import { GILT, PAPER, css } from '../view/palette';
import { BADGE_R, BADGE_SIZE } from '../view/hudLayout';
import sealFontUrl from '../../assets/fonts/seal.woff2?url';

/**
 * 羁绊小篆徽章 · 烘焙管线
 *
 * 一枚徽章 = 篆字 + 激活金线，一图一态烘死，运行期零绘制命令：
 *  - 未激活：灰环灰字；
 *  - 激活 N 档：纸白篆字 + N 圈金线（三档羁绊第三级三圈，环组收在 r16~13.5
 *    一带，不侵占字区）；
 *  - 计数不烘 —— 每局变动，由调用处以 Text 放在徽章内环下方。
 *
 * 字体：用户提供的篆体 TTF（design/fonts/）经 scripts/subset-seal.mjs 裁出
 * 羁绊字表 22 字 → seal.woff2（6.7KB，单文件构建时内联）。开屏「天」取自同一
 * 族（index.html 直引 XiaoZhuan）；字表以源字体篆形为界，「弈」为楷形不在表内。
 * 载入失败时族栈自动落到楷体，徽章体系不变。
 */

export const SEAL_FONT = 'XiaoZhuan';

/** traitId → 篆字。17 字全独特：丹鼎取「鼎」、丹师取「丹」消歧。 */
const GLYPH: Record<string, string> = {
  tian: '天',
  youming: '幽',
  shanhai: '山',
  jianzong: '劍',
  yaozu: '妖',
  jiguan: '機',
  danding: '鼎',
  longyuan: '龍',
  momen: '墨',
  bingjia: '兵',
  warrior: '武',
  guardian: '護',
  assassin: '刺',
  marksman: '射',
  mage: '方',
  warlock: '術',
  support: '丹',
};

/** 字表外兜底：楷体首字，保证任何新羁绊都有图标 */
export function sealGlyph(traitId: string, name: string): string {
  return GLYPH[traitId] ?? name.slice(0, 1);
}

export function traitIconKey(traitId: string, tier: number): string {
  return `trait_icon_${traitId}_t${Math.max(0, Math.min(3, tier))}`;
}

let sealLoaded = false;

/** 启动咽喉载入篆体子集（main.ts 顶层 await，与 AI 棋子预解码同槽位） */
export async function preloadSealFont(): Promise<void> {
  if (sealLoaded) return;
  sealLoaded = true;
  try {
    const face = new FontFace(SEAL_FONT, `url(${sealFontUrl})`);
    await face.load();
    document.fonts.add(face);
  } catch {
    console.warn('[百战天元] 篆体字库不可用，羁绊徽章回退楷体');
  }
}

/** 激活金线：档位 → 同心环半径组。环组收在 r16~13.5，字区（中心 ±8）不受侵。 */
const TIER_RINGS: number[][] = [[], [16], [16, 13.5], [16, 14.75, 13.5]];

const BOX = BADGE_SIZE; // 逻辑边长（r16 外环 + 4px 呼吸）
const SS = 2; // 超采样：徽章在屏上不超过 32 逻辑 px，2× 已留足余量

/** 一次性烘出 17 羁绊 × 4 态（未激活/一圈/两圈/三圈）。键判重，场景重入零成本。 */
export function bakeTraitIcons(scene: Phaser.Scene): void {
  for (const [traitId, glyph] of Object.entries(GLYPH)) {
    for (let tier = 0; tier <= 3; tier++) {
      const key = traitIconKey(traitId, tier);
      if (scene.textures.exists(key)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = BOX * SS;
      canvas.height = BOX * SS;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      drawBadge(ctx, glyph, tier);
      scene.textures.addCanvas(key, canvas);
    }
  }
}

function drawBadge(ctx: CanvasRenderingContext2D, glyph: string, tier: number): void {
  const c = (BOX / 2) * SS;
  const active = tier > 0;

  // 激活态一圈极淡的金雾，读作"点亮"
  if (active) {
    ctx.fillStyle = css(GILT.base, 0.08);
    ctx.beginPath();
    ctx.arc(c, c, BADGE_R * SS, 0, Math.PI * 2);
    ctx.fill();
  }

  // 金线：档位即圈数；未激活一根灰环
  const rings = active ? TIER_RINGS[tier] : [BADGE_R];
  rings.forEach((r, i) => {
    const outer = i === 0;
    ctx.beginPath();
    ctx.lineWidth = (outer ? 1.4 : 1.1) * SS;
    ctx.strokeStyle = css(
      outer ? GILT.base : GILT.light,
      active ? (outer ? 0.95 : 0.85) : 0.55,
    );
    ctx.arc(c, c, r * SS, 0, Math.PI * 2);
    ctx.stroke();
  });

  // 篆字：环内唯一元素，按**实测墨迹框**居中 —— 篆体字形在 em 框里偏移大，
  // middle 基线不可靠（实机确认偏心）；计数在环右侧，见 hudLayout 徽章几何
  ctx.font = `${14 * SS}px ${cssFamily()}`;
  const m = ctx.measureText(glyph);
  ctx.fillStyle = active ? css(PAPER[100], 0.98) : css(PAPER[300], 0.75);
  if (typeof m.actualBoundingBoxLeft === 'number') {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const ax = c - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const ay = c + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillText(glyph, ax, ay);
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, c, c);
  }
}

/** 字体族：篆体优先，楷体兜底 */
export function cssFamily(): string {
  return `"${SEAL_FONT}","Kaiti SC","STKaiti","KaiTi",serif`;
}
