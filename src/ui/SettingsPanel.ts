import Phaser from 'phaser';
import { audio } from '../audio/AudioEngine';
import { savePrefs, type Preferences } from '../game/save';
import { Button, FONT } from './kit';
import { musicCreditLine } from '../music/manifest';
import { GILT, INK, PAPER, SHADE, css } from '../render/view/palette';
import { motion } from '../render/view/motion';
import { fxPrefs, type ShakeStrength } from '../render/view/fxPrefs';
import { screenToWorld } from '../render/view/viewScale';
import { H, W } from '../render/view/layout';

/**
 * 设置面板（共享组件）。
 *
 * 主菜单与对局内双入口共用同一份实现；对局内额外提供
 * "重开一局 / 放弃对局"（放弃需二次确认，防误触清档）。
 */

export interface SettingsPanelHost {
  prefs: Preferences;
  /** 对局内才有重开/放弃；主菜单只有音量与开关 */
  inMatch?: boolean;
  onRestart?: () => void;
  onResign?: () => void;
  /** 自动上场开关变化时同步对局设置 */
  onAutoDeploy?: (v: boolean) => void;
}

export class SettingsPanel {
  private panel: Phaser.GameObjects.Container | null = null;
  private resignArmed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: SettingsPanelHost,
  ) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  open(): void {
    if (this.panel) return;
    this.resignArmed = false;
    this.build();
  }

  close(): void {
    if (!this.panel) return;
    savePrefs(this.host.prefs);
    this.panel.destroy();
    this.panel = null;
  }

  toggle(): void {
    if (this.panel) this.close();
    else this.open();
  }

  private build(): void {
    const scene = this.scene;
    const { prefs } = this.host;
    const panel = scene.add.container(0, 0).setDepth(900);
    this.panel = panel;
    const shade = scene.add.graphics();
    shade.fillStyle(SHADE, 0.7);
    shade.fillRect(0, 0, W, H);
    shade.setInteractive(new Phaser.Geom.Rectangle(0, 0, W, H), Phaser.Geom.Rectangle.Contains);
    panel.add(shade);

    // 面板高度由内容行推导（行高表：标题带 76 + 三滑杆 66×3 + 三个开关行 60×3
    // + 对局行 58 + 关闭钮 42 + 页脚 58 + 底衬 20）。页脚贴着内容流排布，
    // 不再用 bh 固定偏移 —— 此前「关闭」钮与快捷键/署名两行重叠的根源就是两者
    // 各算各的坐标，行数一变就撞车。
    const bw = 440;
    const inMatch = !!this.host.inMatch;
    // 行高表：标题带 76 + 三滑杆 66×3 + 六个开关行 60×6（静音/自动/静观/典藏/
    // 伤害数字/镜头震动）+ 对局行 58 + 关闭钮 42 + 页脚 58 + 底衬 20。
    // 页脚贴着内容流排布，不再用 bh 固定偏移 —— 此前「关闭」钮与快捷键/署名两行
    // 重叠的根源就是两者各算各的坐标，行数一变就撞车。
    const closeRel = 76 + 66 * 3 + 60 * 6 + (inMatch ? 58 : 0);
    const hotkeyRel = closeRel + 42 + 14;
    const creditRel = hotkeyRel + 22;
    // 底衬 34：署名行（11px@1.12，行高 ~16px）+ 字形下延，与底框净距 ≥10px ——
    // 旧 20 时文字视觉上骑在面板底边框上（浏览器实测）
    const bh = creditRel + 34;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;

    const g = scene.add.graphics();
    g.fillStyle(INK[800], 0.98);
    g.fillRect(bx, by, bw, bh);
    g.lineStyle(2, GILT.deep, 0.9);
    g.strokeRect(bx, by, bw, bh);
    panel.add(g);
    panel.add(
      scene.add
        .text(W / 2, by + 26, '设 置', { fontFamily: FONT.title, fontSize: '26px', color: css(PAPER[100]) })
        .setOrigin(0.5, 0)
    );

    const sliders: { label: string; key: 'volBgm' | 'volSfx' | 'volUi' }[] = [
      { label: '背 景 音 乐', key: 'volBgm' },
      { label: '战 斗 音 效', key: 'volSfx' },
      { label: '界 面 音 效', key: 'volUi' },
    ];
    let y = by + 76;
    for (const s of sliders) {
      panel.add(
        scene.add
          .text(bx + 34, y, s.label, { fontFamily: FONT.body, fontSize: '14px', color: css(PAPER[300]) })
          .setOrigin(0, 0)
      );
      const track = scene.add.graphics();
      const draw = () => {
        track.clear();
        const v = prefs[s.key];
        const tw = bw - 68;
        track.fillStyle(INK[900], 1);
        track.fillRect(bx + 34, y + 28, tw, 6);
        track.fillStyle(GILT.base, 1);
        track.fillRect(bx + 34, y + 28, tw * v, 6);
        track.fillStyle(GILT.light, 1);
        track.fillCircle(bx + 34 + tw * v, y + 31, 8);
      };
      draw();
      panel.add(track);
      const zone = scene.add
        .zone(bx + 34, y + 20, bw - 68, 28)
        .setOrigin(0, 0)
        .setInteractive(new Phaser.Geom.Rectangle(0, 0, bw - 68, 28), Phaser.Geom.Rectangle.Contains);
      const apply = (localX: number) => {
        const v = Phaser.Math.Clamp(localX / (bw - 68), 0, 1);
        prefs[s.key] = Math.round(v * 20) / 20;
        draw();
        audio.setVolume(s.key === 'volBgm' ? 'bgm' : s.key === 'volSfx' ? 'sfx' : 'ui', prefs[s.key]);
        // 音量是活偏好：拖动即落盘。close() 的 savePrefs 只覆盖"正常关闭"路径，
        // 对局场景里设置面板可能因开战/切场景而不经 close 直接销毁
        savePrefs(this.host.prefs);
      };
      // 滑杆取值用的是世界系轨道几何，而 p.x 是画布像素（1920K 系）——先换算（A1）
      const localOf = (p: Phaser.Input.Pointer) =>
        screenToWorld(p.x, p.y, scene.cameras.main.zoom).x - (bx + 34);
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => apply(localOf(p)));
      zone.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (p.isDown) apply(localOf(p));
      });
      panel.add(zone);
      y += 66;
    }

    // 静音
    const muteBtn = new Button(scene, bx + 34, y + 6, prefs.muted ? '已静音' : '静音', () => {
      prefs.muted = !prefs.muted;
      audio.setMuted(prefs.muted);
      audio.setVolume('bgm', prefs.volBgm);
      audio.setVolume('sfx', prefs.volSfx);
      audio.setVolume('ui', prefs.volUi);
      savePrefs(this.host.prefs);
      muteBtn.setText(prefs.muted ? '已静音' : '静音');
    }, { width: 150, height: 40 });
    panel.add(muteBtn);

    // 自动上场
    const autoBtn = new Button(scene, bx + 220, y + 6, prefs.autoDeploy ? '自动上场 开' : '自动上场 关', () => {
      prefs.autoDeploy = !prefs.autoDeploy;
      autoBtn.setText(prefs.autoDeploy ? '自动上场 开' : '自动上场 关');
      this.host.onAutoDeploy?.(prefs.autoDeploy);
    }, { width: 180, height: 40 });
    panel.add(autoBtn);
    y += 60;

    // 静观模式（降级档）：震动归零 / 闪光关闭 / 飘字去冲击 / 天命之印缩短
    const calmBtn = new Button(scene, bx + 34, y + 6, prefs.calm ? '静观模式 开' : '静观模式 关', () => {
      prefs.calm = !prefs.calm;
      motion.calm = prefs.calm;
      calmBtn.setText(prefs.calm ? '静观模式 开' : '静观模式 关');
    }, { width: 150, height: 40 });
    panel.add(calmBtn);
    panel.add(
      scene.add
        .text(bx + 196, y + 20, '关闭震动与闪光', {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[400]),
        })
        .setOrigin(0, 0)
    );
    y += 60;

    // 典藏音乐（D4）：CC0 授权曲目 / 程序化五声音阶合成
    const licensedBtn = new Button(scene, bx + 34, y + 6, prefs.licensedMusic ? '典藏音乐 开' : '典藏音乐 关', () => {
      prefs.licensedMusic = !prefs.licensedMusic;
      audio.setLicensedMusicEnabled(prefs.licensedMusic);
      licensedBtn.setText(prefs.licensedMusic ? '典藏音乐 开' : '典藏音乐 关');
    }, { width: 150, height: 40 });
    panel.add(licensedBtn);
    panel.add(
      scene.add
        .text(bx + 196, y + 20, '关：程序合成音乐', {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[400]),
        })
        .setOrigin(0, 0)
    );
    y += 60;

    // 演出偏好（独立 fxPrefs 键，与对局偏好档分离）：伤害飘字开关
    const dmgBtn = new Button(scene, bx + 34, y + 6, fxPrefs.damageText ? '伤害数字 开' : '伤害数字 关', () => {
      fxPrefs.set({ damageText: !fxPrefs.damageText });
      dmgBtn.setText(fxPrefs.damageText ? '伤害数字 开' : '伤害数字 关');
    }, { width: 150, height: 40 });
    panel.add(dmgBtn);
    panel.add(
      scene.add
        .text(bx + 196, y + 20, '战斗中的数值飘字', {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[400]),
        })
        .setOrigin(0, 0)
    );
    y += 60;

    // 镜头震动强度：标准 / 轻 / 关（循环切换，与静观模式叠加时静观恒胜）
    const shakeLabels: Record<ShakeStrength, string> = {
      standard: '镜头震动 标准',
      light: '镜头震动 轻',
      off: '镜头震动 关',
    };
    const shakeOrder: ShakeStrength[] = ['standard', 'light', 'off'];
    let shakeIdx = shakeOrder.indexOf(fxPrefs.shake);
    const shakeBtn = new Button(scene, bx + 34, y + 6, shakeLabels[fxPrefs.shake], () => {
      shakeIdx = (shakeIdx + 1) % shakeOrder.length;
      fxPrefs.set({ shake: shakeOrder[shakeIdx] });
      shakeBtn.setText(shakeLabels[shakeOrder[shakeIdx]]);
    }, { width: 150, height: 40 });
    panel.add(shakeBtn);
    panel.add(
      scene.add
        .text(bx + 196, y + 20, '战斗镜头晃动幅度', {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[400]),
        })
        .setOrigin(0, 0)
    );
    y += 60;

    if (this.host.inMatch) {
      // 放弃对局：二次确认（第一次点变成"确认放弃？"）
      const resignBtn = new Button(scene, bx + 34, y, '放弃对局', () => {
        if (!this.resignArmed) {
          this.resignArmed = true;
          resignBtn.setText('确认放弃？');
          return;
        }
        this.close();
        this.host.onResign?.();
      }, { width: 170, height: 42, variant: 'danger' });
      panel.add(resignBtn);
      panel.add(
        new Button(scene, bx + 216, y, '重开一局', () => {
          this.close();
          this.host.onRestart?.();
        }, { width: 170, height: 42 })
      );
      y += 58;
    }

    panel.add(
      new Button(scene, bx + 34, y, '关 闭', () => this.close(), { width: bw - 68, height: 42, variant: 'primary' })
    );

    // 页脚贴内容流：跟着关闭钮走，行数增减永不与之重叠
    panel.add(
      scene.add
        .text(W / 2, by + hotkeyRel, '快捷键：D 刷新　F 升级　E 布阵　空格 开战　Ctrl+Z 撤销　ESC 暂停', {
          fontFamily: FONT.body,
          fontSize: '12px',
          color: css(PAPER[400]),
        })
        .setOrigin(0.5, 0)
    );

    // 音乐出处（读 manifest 单一真源；正式发布说明见 design/music/CREDITS.md）
    panel.add(
      scene.add
        .text(W / 2, by + creditRel, musicCreditLine(), {
          fontFamily: FONT.body,
          fontSize: '11px',
          color: css(INK[300]),
        })
        .setOrigin(0.5, 0)
    );
  }
}
