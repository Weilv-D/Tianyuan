/**
 * 三星五费专属全屏演出 —— 「天命之印」（样稿同款制式）。
 *
 * 夜色压暗 → 巨型剪影浮现 → 196px 朱砂方印携名将之名盖落（竖排楷字、双环印框）
 * → 落款字距收拢 → 鎏金尘埃迸散 + 轻微摄震。
 * 发光只此一处 —— 全场最稀有的瞬间独享全场唯一的 ADD 光。
 */
import Phaser from 'phaser';
import { CINNABAR, GILT, PAPER, SHADE, css } from '../view/palette';
import { W, H } from '../view/layout';
import { TEX } from '../view/textures';
import { silhouetteKey } from './silhouetteFactory';
import { FONT } from '../../ui/kit';
import { CHAMPION_BY_ID } from '../../data/champions';
import { audio } from '../../audio/AudioEngine';
import { motion } from '../view/motion';

export function playLegendaryStarFx(scene: Phaser.Scene, defId: string): void {
  // 世界系常量：scene.scale.width 在 DPR 底座上是 1920K（物理像素），
  // 拿它当世界坐标会把整段演出推离屏幕中心 K 倍 —— 必须用 layout 的逻辑常量
  const cx = W / 2;
  const cy = H * 0.44;
  const root = scene.add.container(0, 0).setDepth(1500);

  // ── 1) 夜色压暗：把这一刻从连续的时间流里抠出来 ──
  const dim = scene.add.rectangle(0, 0, W + 8, H + 8, SHADE).setOrigin(0).setAlpha(0);
  root.add(dim);
  scene.tweens.add({ targets: dim, alpha: 0.62, duration: 220, ease: 'Quad.easeOut' });

  // ── 2) 巨型剪影：名将的墨影在印后升起 ──
  const shadow = scene.add
    .image(cx, cy + 90, silhouetteKey(defId, 0))
    .setAlpha(0)
    .setScale(5.2);
  root.add(shadow);
  scene.tweens.add({ targets: shadow, alpha: 0.12, y: cy + 40, duration: 900, ease: 'Quad.easeOut' });

  // ── 3) 印后鎏金光晕（全场唯一 ADD 光，只给这一刻） ──
  const halo = scene.add
    .image(cx, cy, TEX.glow)
    .setTint(GILT.base)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDisplaySize(560, 560)
    .setAlpha(0);
  root.add(halo);
  scene.tweens.add({ targets: halo, alpha: 0.35, duration: 520, delay: 160, ease: 'Quad.easeOut' });

  // ── 4) 朱砂方印：竖排楷名，双环印框（样稿 #legendSeal 制式） ──
  const name = defName(defId);
  const sealSize = 196;
  const seal = scene.add.container(cx, cy).setScale(2.1).setAlpha(0);
  const g = scene.add.graphics();
  g.fillStyle(CINNABAR.deep, 0.97);
  g.fillRect(-sealSize / 2, -sealSize / 2, sealSize, sealSize);
  // 印框：外缘米金亮线 + 内环发丝（样稿 inset 双环）
  g.lineStyle(1.5, GILT.light, 0.85);
  g.strokeRect(-sealSize / 2, -sealSize / 2, sealSize, sealSize);
  g.lineStyle(1, PAPER[100], 0.4);
  g.strokeRect(-sealSize / 2 + 8, -sealSize / 2 + 8, sealSize - 16, sealSize - 16);
  // 竖排楷名：一字一行，字距由行距承担
  const nameSize = name.length <= 2 ? 56 : 42;
  const nameText = scene.add
    .text(0, 0, name.split('').join('\n'), {
      fontFamily: FONT.kai,
      fontSize: `${nameSize}px`,
      color: css(PAPER[50]),
      lineSpacing: name.length <= 2 ? 6 : 2,
    })
    .setOrigin(0.5);
  seal.add([g, nameText]);
  root.add(seal);

  // ── 5) 落款：字距从 1.7em 收拢到 1.1em（样稿 #legendText） ──
  const banner = scene.add
    .text(cx, H * 0.81, '神 品 三 星 · 天 命 所 归', {
      fontFamily: FONT.title,
      fontSize: '16px',
      color: css(GILT.light),
      letterSpacing: 20,
    })
    .setOrigin(0.5)
    .setAlpha(0);
  root.add(banner);

  // ── 落印：2.1 倍压下 → 定格 → 印身微 squash ──
  scene.tweens.add({ targets: seal, alpha: 1, duration: 120, delay: 200 });
  scene.tweens.add({
    targets: seal,
    scale: 1,
    duration: 300,
    delay: 210,
    ease: 'Cubic.easeIn',
    onComplete: () => {
      audio.playPluck(130.8); // 宫音落印
      if (!motion.calm) scene.cameras.main.shake(170, 0.0045);
      scene.tweens.add({ targets: seal, scaleY: motion.calm ? 0.96 : 0.9, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
      if (!motion.calm) {
        burst(scene, root, cx, cy, GILT.light, 26);
        burst(scene, root, cx, cy, CINNABAR.light, 14);
      }
    },
  });
  scene.tweens.add({ targets: banner, alpha: 1, letterSpacing: 12, duration: 800, delay: 620, ease: 'Quad.easeOut' });

  // ── 收场：夜色散去，一切如初 ──
  // 静观模式：整段演出缩短为约 1 秒（v2 圣经 §五）
  scene.tweens.add({
    targets: [dim, shadow, halo, seal, banner],
    alpha: 0,
    delay: motion.calm ? 700 : 1850,
    duration: 460,
    ease: 'Quad.easeIn',
    onComplete: () => {
      if (root.scene) {
        root.removeAll(true); // Container.destroy 不递归销毁子对象（exclusive=false）
        root.destroy();
      }
    },
  });
  // 场景在演出中切换（重开/快进/切图鉴）：root 与粒子必须随场景退场销毁，
  // 否则残留在新场景时钟里（旧容器自毁回调还会对已销毁对象二次 destroy）。
  // 归一到"场景 shutdown 清空本场演出"的既有纪律 —— 与 EffectsLayer 同款守卫。
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    if (root.scene) {
      scene.tweens.killTweensOf([dim, shadow, halo, seal, banner]);
      // root 直接 destroy 不会递归销毁子对象（Container 需显式 exclusive），
      // 演出中途切场景时子对象会游离到场景显示列表 —— 先 removeAll(true) 再销毁
      root.removeAll(true);
      root.destroy();
    }
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
  scene.time.delayedCall(900, () => {
    // 销毁语义以 active 为准（EffectsLayer 同口径）：shutdown 清场后 scene 引用不保证为空
    if (p.active) p.destroy();
  });
}

function defName(defId: string): string {
  return CHAMPION_BY_ID[defId]?.name ?? '神';
}
