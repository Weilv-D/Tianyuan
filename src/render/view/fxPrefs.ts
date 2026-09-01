import { motion } from './motion';

/**
 * 演出偏好（fx）：伤害飘字开关 + 镜头震动强度。
 *
 * 与静观模式（prefs.calm）的关系：静观是"前庭敏感/低配"的整档降级（震动/闪光
 * 全部归零），本模块是常人的精细调节 —— 二者叠加时静观恒胜（shakeFactor 已含）。
 * 独立存档键 inkarena.fx.v1，不混入对局档/偏好档。
 */

export type ShakeStrength = 'standard' | 'light' | 'off';

export interface FxPrefs {
  damageText: boolean;
  shake: ShakeStrength;
}

const KEY = 'inkarena.fx.v1';
const DEFAULTS: FxPrefs = { damageText: true, shake: 'standard' };

let current: FxPrefs = load();

function load(): FxPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<FxPrefs>;
    return {
      damageText: typeof p.damageText === 'boolean' ? p.damageText : DEFAULTS.damageText,
      shake: p.shake === 'light' || p.shake === 'off' ? p.shake : DEFAULTS.shake,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* 忽略 */
  }
}

export const fxPrefs = {
  get damageText(): boolean {
    return current.damageText;
  },
  get shake(): ShakeStrength {
    return current.shake;
  },
  /** 逐项设置并立即落盘（设置面板点击即生效） */
  set(patch: Partial<FxPrefs>): void {
    current = { ...current, ...patch };
    persist();
  },
};

/** 镜头震动倍率：静观恒 0；off=0 / light=0.4 / standard=1 */
export function shakeFactor(): number {
  if (motion.calm) return 0;
  return current.shake === 'off' ? 0 : current.shake === 'light' ? 0.4 : 1;
}
