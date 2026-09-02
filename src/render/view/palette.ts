/**
 * 百战天元 · 调色板 —— 「夜宴 · 幽冥水墨」体系（v1.3.0 起替代宋画暖调）
 *
 * 这是 docs/ART_BIBLE.md 的代码镜像 —— 任何颜色都必须来自这里，
 * 禁止在别处硬编码十六进制。改色即改全局，杜绝风格漂移。
 *
 * 体系原则（夜宴版）：
 *  - 底色是**夜的蓝墨**：n0 → n4 五阶夜蓝为骨，插值成十阶 —— 漆器夜宴
 *  - 全场只有一种热色：朱砂。它出现的地方 = 需要血液反应的地方
 *  - 友方是玉青，法术是夜蓝，盾是月白灰 —— 全部去饱和，没有荧光
 *  - 紫色全域禁用（含特效）；稀有度第四档用胭脂
 *  - 金是旧金（#b39660，带褐的哑光），高光是米金 #e3cfa0，不是亮黄
 */

// ── 夜墨：背景与结构。夜蓝墨，从深渊到雾青 ──
export const INK = {
  950: 0x050b13, // n0 深渊
  900: 0x08111b, // n1 主底
  850: 0x0c1724, // n2
  800: 0x0f1b2a, // n2→n3 之间
  700: 0x122031, // n3
  650: 0x16283a, // n3→n4 之间
  600: 0x1a2c42, // n4
  500: 0x263a52, // 结构描边
  400: 0x46596f, // 中灰描边
  300: 0x7e8b9b, // 雾青（淡墨）
} as const;

// ── 米金宣：所有"亮面"与文字。米金偏暖而非纯白 ──
export const PAPER = {
  50: 0xf7e7c3, // cream 最亮暖
  100: 0xf2ecdd, // paper 主文字
  200: 0xece5d4, // tx 正文
  300: 0xd6c8a8, // 次级文字
  400: 0xb5a888, // 弱文字
  500: 0x948a70, // 最弱
} as const;

// ── 朱砂：全场唯一热色。危险 / 敌方 / 物理暴击 ──
export const CINNABAR = {
  deep: 0x6b2a1e,
  base: 0xc65a45,
  light: 0xe58a6f,
  glow: 0xf2b09a,
} as const;

// ── 旧金：稀有 / 高光 / 五费。哑光带褐，不刺眼 ──
export const GILT = {
  deep: 0x6b582a,
  base: 0xb39660,
  light: 0xe3cfa0,
  glow: 0xf2e6c4,
} as const;

// ── 玉青：友方 / 治疗 / 安全。夜色里的青玉 ──
export const SPIRIT = {
  deep: 0x33524a,
  base: 0x9ec4ae,
  light: 0xbfdacd,
  glow: 0xdcefe4,
} as const;

// ── 夜蓝：法术 / 技能。与底色同族的蓝，无紫 ──
export const VOID = {
  deep: 0x2c3a55,
  base: 0x5a6f96,
  light: 0x8ea3c8,
  glow: 0xb8c8e2,
} as const;

// ── 酡橙：灼烧 / 熔炼。朱砂与旧金之间的火色，哑光 ──
export const EMBER = {
  deep: 0x7a4520,
  base: 0xc98a4e,
  light: 0xe8ad72,
} as const;

// ── 霁青：寒冰 / 引导束。玉青与夜蓝之间的冷调，无紫 ──
export const CERU = {
  deep: 0x2e5560,
  base: 0x7fb0bd,
  light: 0xa8d2da,
} as const;

/**
 * 特效语义色表（单一真源）。EffectsLayer 按 core 发出的 hue 槽位取色；
 * 语义在 core 发射点注释与本表双向对齐，新增槽位先在这里登记。
 * 红线不变：夜宴体系内取色、禁荧光禁紫。
 */
export const FX_TINTS: Record<number, number> = {
  0: CINNABAR.light, // 物理冲击 / 破盾新星
  1: GILT.light,     // 增益 / 战吼 / 击杀强化
  2: VOID.light,     // 法术爆发 / 范围法伤
  3: CERU.light,     // 引导束 / 贯穿光线（原 3 金与施法环混淆，改霁青）
  4: SPIRIT.light,   // 治疗
  5: CERU.base,      // 连锁闪电 / 穿透链
  6: PAPER[50],      // 处决 / 真实伤害（皓白金）
};

// ── 月白：环境光 / 护盾 / 中立信息。雾青灰 ──
export const MOON = {
  deep: 0x56616e,
  base: 0x8b98a8,
  light: 0xc2cdd6,
} as const;

/** 稀有度语义色（夜宴五色：雾灰 / 玉青 / 夜蓝 / 胭脂 / 米金）—— 与样稿逐值一致 */
export const RARITY_COLOR: Record<number, number> = {
  1: 0x7e8b9b, // 凡品 · 雾灰
  2: 0x9ec4ae, // 灵品 · 玉青
  3: 0x8ea3c8, // 宝品 · 夜蓝
  4: 0xcf9bae, // 仙品 · 胭脂
  5: 0xe3cfa0, // 神品 · 米金
};

export const RARITY_NAME: Record<number, string> = {
  1: '凡品',
  2: '灵品',
  3: '宝品',
  4: '仙品',
  5: '神品',
};

/** 阵营色：友方玉青 / 敌方朱砂 —— 不看文字也能读懂局面 */
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

/**
 * 技术性纯白：受击闪白（setTintFill 需要满通道路径）与 GeometryMask 占位
 * （遮罩只取 alpha，色相无语义）。不是夜宴色板成员，别拿它当视觉色用。
 */
export const PURE_WHITE = 0xffffff;

/** 危险按钮变体（kit Button danger）：比朱砂更深一档的暗红 */
export const DANGER = {
  base: 0x7e3323,
  light: 0xa85242,
} as const;

/** 盘面纸纹的阴干调（BoardView 纸纹 setTint）—— 夜色下的雾青 */
export const PAPER_TINT = 0x8b98a8;

/** 飘字描边暗色 —— 与 ART_BIBLE 的飘字分级一一对应，全部走夜墨底 */
export const DAMAGE_OUTLINE = {
  normal: 0x0a121c,
  crit: 0x3a120a,
  skill: 0x141d2e,
  true: 0x2e2810,
  heal: 0x0f2a20,
  shield: 0x18222a,
  execute: 0x382c0e,
  dot: 0x301a12,
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

/**
 * 羁绊档位色（古铜 / 暖银 / 米金 / 胭脂）。
 * 古铜 #9a7d5e→#b59a77：旧值在 INK700 面板底 4.28:1 低于 AA（4.5:1），
 * 提亮后 6.2:1，与暖银 #b9b3a4 仍靠明度与色相差区分档位。
 */
export const TRAIT_TIER_COLOR_HEX: readonly number[] = [0xb59a77, 0xb9b3a4, 0xe3cfa0, 0xcf9bae];

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
