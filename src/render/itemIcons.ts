/**
 * 装备图标的程序化烘焙。
 *
 * 全部 22 件装备共用一套绘制语言：**几何外形 + 单层描边 + 一点高光**。
 * 刻意不做拟物细节 —— 装备图标在棋盘上只有 14px 大，
 * 能被认出来靠的是**轮廓**，不是纹理。
 */

import Phaser from 'phaser';
import { ITEMS, type ItemGlyph } from '../data/items';
import { GILT, INK, PAPER } from './palette';

export const ITEM_ICON_SIZE = 48;

export function itemIconKey(id: string): string {
  return `item_${id}`;
}

/** 组件偏冷白，成品偏鎏金 —— 余光里也能分辨"这是组件还是神装" */
function paletteOf(tier: 'component' | 'combined'): { main: number; line: number } {
  return tier === 'combined'
    ? { main: GILT.base, line: GILT.light }
    : { main: PAPER[300], line: PAPER[100] };
}

export function bakeItemIcons(scene: Phaser.Scene): void {
  // 尺寸放大 2 倍再缩，避免小尺寸下描边发虚
  const S = ITEM_ICON_SIZE * 2;
  for (const item of ITEMS) {
    const key = itemIconKey(item.id);
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const { main, line } = paletteOf(item.tier);
    drawGlyph(g, item.glyph, S, main, line);
    const rt = scene.add.renderTexture(0, 0, S, S);
    rt.draw(g, 0, 0);
    rt.saveTexture(key);
    rt.destroy();
    g.destroy();
  }
}

type G = Phaser.GameObjects.Graphics;

function drawGlyph(g: G, glyph: ItemGlyph, S: number, main: number, line: number): void {
  const c = S / 2;
  g.lineStyle(2.5, line, 0.95);
  g.fillStyle(main, 0.9);

  switch (glyph) {
    case 'blade':
      g.beginPath();
      g.moveTo(c + 12, c - 14);
      g.lineTo(c - 2, c + 14);
      g.lineTo(c - 10, c + 10);
      g.lineTo(c + 6, c - 16);
      g.closePath();
      g.fillPath();
      g.strokePath();
      g.lineBetween(c - 10, c + 4, c + 3, c + 10);
      break;

    case 'armor':
      g.beginPath();
      g.moveTo(c, c - 15);
      g.lineTo(c + 13, c - 8);
      g.lineTo(c + 11, c + 6);
      g.lineTo(c, c + 16);
      g.lineTo(c - 11, c + 6);
      g.lineTo(c - 13, c - 8);
      g.closePath();
      g.fillPath();
      g.strokePath();
      break;

    case 'orb':
      g.fillCircle(c, c, 12);
      g.strokeCircle(c, c, 12);
      g.fillStyle(line, 0.9);
      g.fillCircle(c - 4, c - 4, 3.5);
      break;

    case 'boot':
      g.beginPath();
      g.moveTo(c - 13, c - 6);
      g.lineTo(c + 6, c - 6);
      g.lineTo(c + 13, c + 8);
      g.lineTo(c - 13, c + 8);
      g.closePath();
      g.fillPath();
      g.strokePath();
      break;

    case 'jade':
      g.beginPath();
      g.moveTo(c, c - 14);
      g.lineTo(c + 12, c);
      g.lineTo(c, c + 14);
      g.lineTo(c - 12, c);
      g.closePath();
      g.fillPath();
      g.strokePath();
      break;

    case 'talisman':
      g.fillRoundedRect(c - 8, c - 15, 16, 30, 2);
      g.strokeRoundedRect(c - 8, c - 15, 16, 30, 2);
      g.lineBetween(c - 4, c - 8, c + 4, c - 8);
      g.lineBetween(c - 4, c - 1, c + 4, c - 1);
      g.lineBetween(c - 4, c + 6, c + 4, c + 6);
      break;

    case 'gauntlet':
      g.fillRoundedRect(c - 9, c - 6, 18, 17, 5);
      g.strokeRoundedRect(c - 9, c - 6, 18, 17, 5);
      g.fillCircle(c, c - 11, 5);
      g.strokeCircle(c, c - 11, 5);
      break;

    case 'cloak':
      g.beginPath();
      g.moveTo(c - 6, c - 15);
      g.lineTo(c + 6, c - 15);
      g.lineTo(c + 15, c + 14);
      g.lineTo(c - 15, c + 14);
      g.closePath();
      g.fillPath();
      g.strokePath();
      break;

    case 'soulblade':
      g.lineBetween(c - 13, c - 13, c + 13, c + 13);
      g.lineBetween(c + 13, c - 13, c - 13, c + 13);
      g.fillStyle(line, 0.85);
      g.fillCircle(c, c, 4);
      break;

    case 'lance':
      g.lineBetween(c, c - 16, c, c + 12);
      g.beginPath();
      g.moveTo(c, c - 17);
      g.lineTo(c + 6, c - 7);
      g.lineTo(c - 6, c - 7);
      g.closePath();
      g.fillPath();
      g.strokePath();
      g.lineBetween(c - 7, c + 8, c + 7, c + 8);
      break;

    case 'bloodfang':
      g.beginPath();
      g.moveTo(c - 10, c - 12);
      g.lineTo(c - 4, c + 12);
      g.lineTo(c - 13, c + 2);
      g.closePath();
      g.fillPath();
      g.strokePath();
      g.beginPath();
      g.moveTo(c + 10, c - 12);
      g.lineTo(c + 4, c + 12);
      g.lineTo(c + 13, c + 2);
      g.closePath();
      g.fillPath();
      g.strokePath();
      break;

    case 'stupa':
      for (let i = 0; i < 3; i++) {
        const w = 13 - i * 3;
        const y = c + 12 - i * 11;
        g.fillRoundedRect(c - w, y - 6, w * 2, 7, 2);
        g.strokeRoundedRect(c - w, y - 6, w * 2, 7, 2);
      }
      g.lineBetween(c, c - 17, c, c - 12);
      break;

    case 'turtle':
      g.fillCircle(c, c, 13);
      g.strokeCircle(c, c, 13);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.lineBetween(c, c, c + Math.cos(a) * 12, c + Math.sin(a) * 12);
      }
      break;

    case 'chaosorb':
      g.strokeCircle(c, c, 13);
      g.strokeCircle(c, c, 7);
      g.fillStyle(line, 0.85);
      g.fillCircle(c, c, 3);
      break;

    case 'voidpearl':
      g.fillCircle(c, c, 10);
      g.strokeCircle(c, c, 10);
      g.lineStyle(2, line, 0.7);
      g.strokeCircle(c, c, 15);
      break;

    case 'bloodpearl':
      g.fillCircle(c, c + 1, 10);
      g.strokeCircle(c, c + 1, 10);
      g.beginPath();
      g.moveTo(c, c - 15);
      g.lineTo(c + 6, c - 6);
      g.lineTo(c - 6, c - 6);
      g.closePath();
      g.fillPath();
      break;

    case 'gale':
      for (let i = 0; i < 3; i++) {
        const y = c - 9 + i * 9;
        g.lineBetween(c - 13, y, c + 9, y);
        g.fillStyle(line, 0.9);
        g.fillCircle(c + 11, y, 2.5);
        g.fillStyle(main, 0.9);
      }
      break;

    case 'shadow':
      g.beginPath();
      g.moveTo(c, c - 15);
      g.lineTo(c + 13, c - 4);
      g.lineTo(c + 8, c + 13);
      g.lineTo(c - 8, c + 13);
      g.lineTo(c - 13, c - 4);
      g.closePath();
      g.fillPath();
      g.strokePath();
      g.fillStyle(INK[900], 0.95);
      g.fillRect(c - 7, c - 4, 5, 4);
      g.fillRect(c + 2, c - 4, 5, 4);
      break;

    case 'darkrobe':
      g.beginPath();
      g.moveTo(c, c - 16);
      g.lineTo(c + 14, c + 14);
      g.lineTo(c - 14, c + 14);
      g.closePath();
      g.fillPath();
      g.strokePath();
      g.fillStyle(INK[900], 0.9);
      g.beginPath();
      g.moveTo(c, c - 8);
      g.lineTo(c + 6, c + 9);
      g.lineTo(c - 6, c + 9);
      g.closePath();
      g.fillPath();
      break;

    case 'undying':
      g.strokeCircle(c, c, 13);
      g.lineStyle(3, line, 0.95);
      g.beginPath();
      g.arc(c, c, 13, -Math.PI * 0.75, Math.PI * 0.15);
      g.strokePath();
      break;

    case 'rebirth':
      g.strokeCircle(c, c, 12);
      g.fillStyle(line, 0.9);
      g.beginPath();
      g.moveTo(c + 12, c - 6);
      g.lineTo(c + 12, c + 4);
      g.lineTo(c + 4, c + 4);
      g.closePath();
      g.fillPath();
      break;

    case 'titan':
      g.beginPath();
      g.moveTo(c - 14, c + 12);
      g.lineTo(c - 8, c - 8);
      g.lineTo(c + 3, c - 14);
      g.lineTo(c + 12, c - 2);
      g.lineTo(c + 14, c + 12);
      g.closePath();
      g.fillPath();
      g.strokePath();
      break;
  }
}

/** 装备品质外框色：成品鎏金，组件石色 */
export function itemFrameColor(tier: 'component' | 'combined'): number {
  return tier === 'combined' ? GILT.base : INK[400];
}
