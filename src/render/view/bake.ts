import Phaser from 'phaser';

/**
 * 静态图元烘焙。
 *
 * 为什么必须有这个东西：Phaser 的 WebGL Graphics **每帧都要重放整个命令缓冲**，
 * 不做任何缓存。而一个 `fillRoundedRect` 就是约 45 条命令（圆角是四段圆弧拼出来的），
 * 一个看起来"只有几行绘制代码"的控件实际可能背着上百条命令。
 * 实测：准备阶段场景里有 234 个 Graphics、合计 20377 条命令，吃掉 24ms/帧，
 * 帧率被压到 37 —— 而其中绝大多数画的东西**一次都没变过**。
 *
 * 所以规则很简单：**只要一个图形的形态不随每帧变化，就烤成纹理。**
 * 会变的部分（数值条的长度、悬停高亮）留下极少数实时 Graphics。
 *
 * 纹理挂在 TextureManager 上，生命周期长于 Scene，而 Phaser 会复用 Scene 实例 ——
 * 所以这里的判重不是防御性编程，不判就会拿到 null 或泄漏同名纹理。
 */
export function bakedTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (g: Phaser.GameObjects.Graphics) => void,
): string {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
  g.destroy();
  return key;
}

/** 取一张烘焙图；已存在则直接返回 Image。 */
export function bakedImage(
  scene: Phaser.Scene,
  x: number,
  y: number,
  key: string,
  w: number,
  h: number,
  draw: (g: Phaser.GameObjects.Graphics) => void,
  originX = 0,
  originY = 0,
): Phaser.GameObjects.Image {
  bakedTexture(scene, key, w, h, draw);
  return scene.add.image(x, y, key).setOrigin(originX, originY);
}
