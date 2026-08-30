/**
 * 三星五费专属全屏演出 —— 「天命之印」。
 *
 * 一局游戏里最难达成的时刻值得一次"从时间流里被抠出来"的仪式：
 * 暖墨压暗 → 巨型剪影浮现 → 朱砂方印携名将之名盖落 → 鎏金尘埃迸散 + 轻微摄震。
 * 语气遵循「文人案头」：热色只有朱砂与古金，字用宋体拉开字距，
 * 发光只此一处 —— 全场最稀有的瞬间独享全场唯一的 ADD 光。
 */
import Phaser from 'phaser';
import { CINNABAR, GILT, PAPER, SHADE, css } from './palette';
import { TEX } from './textures';
import { silhouetteKey } from './silhouetteFactory';
import { FONT } from '../ui/kit';
import { CHAMPION_BY_ID } from '../data/champions';

export function playLegendaryStarFx(scene: Phaser.Scene, defId: string): void {
  const W = scene.scale.width;
  const H = scene.scale.height;
  const cx = W / 2;
  const cy = H * 0.42;
  const root = scene.add.container(0, 0).setDepth(1500);

  // ── 1) 暖墨压暗：把这一刻从连续的时间流里抠出来 ──
  const dim = scene.add.rectangle(0, 0, W + 8, H + 8, SHADE).setOrigin(0).setAlpha(0);
  root.add(dim);
  scene.tweens.add({ targets: dim, alpha: 0.62, duration: 220, ease: 'Quad.easeOut' });

  // ── 2) 巨型剪影：名将的墨影在印后升起 ──
  const shadow = scene.add
    .image(cx, cy + 90, silhouetteKey(defId, 0))
    .setAlpha(0)
    .setScale(5.2);
  root.add(shadow);
  scene.tweens.add({ targets: shadow, alpha: 0.13, y: cy + 40, duration: 900, ease: 'Quad.easeOut' });

  // ── 3) 印后鎏金光晕（全场唯一 ADD 光，只给这一刻） ──
  const halo = scene.add
    .image(cx, cy, TEX.glow)
    .setTint(GILT.base)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDisplaySize(560, 560)
    .setAlpha(0);
  root.add(halo);
  scene.tweens.add({ targets: halo, alpha: 0.4, duration: 520, delay: 160, ease: 'Quad.easeOut' });

  // ── 4) 朱砂方印：携名将之名盖落 ──
  const name = defName(defId);
  const sealSize = 216;
  const seal = scene.add.container(cx, cy).setRotation(-0.06).setScale(2.4).setAlpha(0);
  const g = scene.add.graphics();
  g.fillStyle(CINNABAR.deep, 0.97);
  g.fillRoundedRect(-sealSize / 2, -sealSize / 2, sealSize, sealSize, 14);
  // 印章的"烂边"感：外圈古金粗边 + 内圈发丝线，像一枚真正的老印
  g.lineStyle(4, GILT.base, 0.9);
  g.strokeRoundedRect(-sealSize / 2, -sealSize / 2, sealSize, sealSize, 14);
  g.lineStyle(1.5, PAPER[100], 0.35);
  g.strokeRoundedRect(-sealSize / 2 + 10, -sealSize / 2 + 10, sealSize - 20, sealSize - 20, 10);
  const nameSize = name.length <= 2 ? 84 : 62;
  const nameText = scene.add
    .text(0, 0, name, {
      fontFamily: FONT.title,
      fontSize: `${nameSize}px`,
      color: css(PAPER[50]),
      letterSpacing: name.length <= 2 ? 8 : 4,
    })
    .setOrigin(0.5);
  seal.add([g, nameText]);
  root.add(seal);

  // ── 5) 落款横幅 ──
  const banner = scene.add
    .text(cx, cy + sealSize / 2 + 40, '神 品 三 星 · 天 命 所 归', {
      fontFamily: FONT.title,
      fontSize: '24px',
      color: css(GILT.light),
      letterSpacing: 6,
    })
    .setOrigin(0.5)
    .setAlpha(0);
  root.add(banner);

  // ── 落印 ──
  scene.tweens.add({ targets: seal, alpha: 1, duration: 120, delay: 220 });
  scene.tweens.add({
    targets: seal,
    scale: 1,
    duration: 170,
    delay: 240,
    ease: 'Cubic.easeIn',
    onComplete: () => {
      // 落印三连：摄震 + 印身微squash + 鎏金与朱砂双色尘埃迸散
      scene.cameras.main.shake(170, 0.0045);
      scene.tweens.add({ targets: seal, scaleY: 0.94, duration: 70, yoyo: true, ease: 'Quad.easeOut' });
      burst(scene, root, cx, cy, GILT.light, 26);
      burst(scene, root, cx, cy, CINNABAR.light, 14);
      scene.tweens.add({ targets: banner, alpha: 1, y: cy + sealSize / 2 + 30, duration: 360, ease: 'Quad.easeOut' });
    },
  });

  // ── 收场：墨色散去，一切如初 ──
  scene.tweens.add({
    targets: [dim, shadow, halo, seal, banner],
    alpha: 0,
    delay: 1620,
    duration: 460,
    ease: 'Quad.easeIn',
    onComplete: () => root.destroy(),
  });
}

function burst(
  scene: Phaser.Scene,
  root: Phaser.GameObjects.Container,
  x: number,
  y: number,
  tint: number,
  count: number,
): void {
  const p = scene.add
    .particles(x, y, TEX.inkDot, {
      speed: { min: 120, max: 340 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 380, max: 760 },
      scale: { start: 0.85, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint,
      emitting: false,
    })
    .setDepth(1501);
  root.add(p);
  p.explode(count);
  scene.time.delayedCall(900, () => p.destroy());
}

function defName(defId: string): string {
  return CHAMPION_BY_ID[defId]?.name ?? '神';
}
