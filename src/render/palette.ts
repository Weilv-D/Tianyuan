/**
 * 百战天元 · 调色板 —— 「文人案头 · 宋画」体系
 *
 * 这是 ART_BIBLE.md 的代码镜像 —— 任何颜色都必须来自这里，
 * 禁止在别处硬编码十六进制。改色即改全局，杜绝风格漂移。
 *
 * 体系原则（与旧版的分水岭）：
 *  - 底色是**暖的**松烟墨，不是 GitHub 式蓝灰 —— 让宣纸真正"发光"
 *  - 全场只有一种热色：朱砂。它出现的地方 = 需要血液反应的地方
 *  - 冷色全部去饱和：绿是青瓷、蓝是青黛、盾是月白瓷 —— 没有荧光
 *  - 紫色禁用（旧 VOID 已改为青黛）；稀有度第四档用胭脂
 *  - 金是古金（带褐的哑光），不是亮黄
 */

// ── 松烟墨：背景与结构。暖灰褐，从焦墨到淡墨 ──
export const INK = {
  950: 0x0d0b09,
  900: 0x14110e,
  850: 0x1a1613,
  800: 0x201b17,
  700: 0x2c261f,
  650: 0x332c24,
  600: 0x3e362c,
  500: 0x5a5044,
  400: 0x776b5d,
  300: 0x9b8f7e,
} as const;

// ── 陈宣纸：所有"亮面"与文字。米黄而非纯白 ──
export const PAPER = {
  50: 0xf7efdd,
  100: 0xefe4cd,
  200: 0xe0d2b4,
  300: 0xd6c6a4,
  400: 0xbda987,
  500: 0x96825f,
} as const;

// ── 朱砂：全场唯一热色。危险 / 敌方 / 物理暴击 ──
export const CINNABAR = {
  deep: 0x822d1e,
  base: 0xb0402a,
  light: 0xcf7254,
  glow: 0xe8a184,
} as const;

// ── 古金：稀有 / 高光 / 五费。哑光带褐，不刺眼 ──
export const GILT = {
  deep: 0x7a5f28,
  base: 0xa8853f,
  light: 0xc9a96a,
  glow: 0xe6d19c,
} as const;

// ── 青瓷（旧"灵青"重塑）：友方 / 治疗 / 安全。去饱和的瓷绿 ──
export const SPIRIT = {
  deep: 0x2f4d40,
  base: 0x4f7a63,
  light: 0x7fa78d,
  glow: 0xb8d3bd,
} as const;

// ── 青黛（旧"幽紫"重塑）：法术 / 技能。文人黛蓝，无紫 ──
export const VOID = {
  deep: 0x2c3550,
  base: 0x44547a,
  light: 0x7286ad,
  glow: 0xa7b6d4,
} as const;

// ── 月白：环境光 / 护盾 / 中立信息。瓷青灰，冷而不蓝艳 ──
export const MOON = {
  deep: 0x5c6a67,
  base: 0x9fb0aa,
  light: 0xd9e4de,
} as const;

/** 稀有度语义色（宋画五色：石灰 / 青瓷 / 黛蓝 / 胭脂 / 古金） */
export const RARITY_COLOR: Record<number, number> = {
  1: 0x8f8574, // 凡品 · 石灰
  2: 0x4f7a63, // 灵品 · 青瓷
  3: 0x44547a, // 宝品 · 黛蓝
  4: 0xa85e75, // 仙品 · 胭脂
  5: 0xc9a96a, // 神品 · 古金
};

export const RARITY_NAME: Record<number, string> = {
  1: '凡品',
  2: '灵品',
  3: '宝品',
  4: '仙品',
  5: '神品',
};

/** 阵营色：友方青瓷 / 敌方朱砂 —— 不看文字也能读懂局面 */
export const TEAM_COLOR: Record<number, number> = {
  0: SPIRIT.base,
  1: CINNABAR.base,
};

export const TEAM_COLOR_DEEP: Record<number, number> = {
  0: SPIRIT.deep,
  1: CINNABAR.deep,
};

/** 遮罩 / 投影用纯黑 —— 色板里唯一允许的"黑" */
export const SHADE = 0x000000;

/** 危险按钮变体（kit Button danger）：比朱砂更深一档的暗红 */
export const DANGER = {
  base: 0x6f241c,
  light: 0x9c4a3a,
} as const;

/** 宣纸底纹的阴干调（BoardView 纸纹 setTint）—— 暖灰而非冷蓝 */
export const PAPER_TINT = 0x8f8574;

/** 飘字描边暗色 —— 与 ART_BIBLE 的飘字分级一一对应，全部走暖墨底 */
export const DAMAGE_OUTLINE = {
  normal: 0x141110,
  crit: 0x38100a,
  skill: 0x1a2030,
  true: 0x2e250f,
  heal: 0x12291f,
  shield: 0x1a2120,
  execute: 0x382c0e,
  dot: 0x331711,
} as const;

/** 伤害类型的飘字 / 特效配色 */
export const DAMAGE_COLOR = {
  physical: PAPER[100],
  magic: VOID.light,
  true: GILT.light,
  crit: CINNABAR.light,
  heal: SPIRIT.light,
  shield: MOON.light,
} as const;

/** 羁绊档位色（古铜 / 暖银 / 古金 / 胭脂） */
export const TRAIT_TIER_COLOR_HEX: readonly number[] = [0x9a7350, 0xb9b3a4, 0xc9a96a, 0xa85e75];

// ── UI 语义 ──
export const UI = {
  panelBg: INK[800],
  panelBgSoft: INK[700],
  panelBorder: INK[500],
  borderAccent: GILT.deep,
  textPrimary: PAPER[100],
  textSecondary: PAPER[300],
  textMuted: PAPER[400],
  success: SPIRIT.base,
  danger: CINNABAR.base,
  gold: GILT.base,
  disabled: INK[500],
} as const;

/** 把 0xRRGGBB 转成 CSS 颜色串 */
export function css(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/** 在两个颜色之间线性插值 */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
