## 百战天元 · 调色板 —— 「夜宴 · 幽冥水墨」体系（src/render/view/palette.ts 的 Godot 镜像）。
## ART_BIBLE 的代码镜像：任何颜色都必须来自这里，禁止在别处硬编码十六进制。
## 红线：底色夜蓝墨；全场唯一热色朱砂；友方玉青、法术夜蓝、盾月白灰（全去饱和）；
## 紫色全域禁用；金是旧金哑光（不刺眼）。
class_name Palette
extends RefCounted


# ── 夜墨：背景与结构。夜蓝墨，从深渊到雾青 ──
const INK := {
	950: Color("050b13"),  # n0 深渊
	900: Color("08111b"),  # n1 主底
	850: Color("0c1724"),  # n2
	800: Color("0f1b2a"),  # n2→n3 之间
	700: Color("122031"),  # n3
	650: Color("16283a"),  # n3→n4 之间
	600: Color("1a2c42"),  # n4
	500: Color("263a52"),  # 结构描边
	400: Color("46596f"),  # 中灰描边
	300: Color("7e8b9b"),  # 雾青（淡墨）
}

# ── 米金宣：所有"亮面"与文字 ──
const PAPER := {
	50: Color("f7e7c3"),  # cream 最亮暖
	100: Color("f2ecdd"),  # paper 主文字
	200: Color("ece5d4"),  # tx 正文
	300: Color("d6c8a8"),  # 次级文字
	400: Color("b5a888"),  # 弱文字
	500: Color("948a70"),  # 最弱
}

# ── 朱砂：全场唯一热色。危险 / 敌方 / 物理暴击 ──
const CINNABAR := {
	"deep": Color("6b2a1e"),
	"base": Color("c65a45"),
	"light": Color("e58a6f"),
	"glow": Color("f2b09a"),
}

# ── 旧金：稀有 / 高光 / 五费。哑光带褐 ──
const GILT := {
	"deep": Color("6b582a"),
	"base": Color("b39660"),
	"light": Color("e3cfa0"),
	"glow": Color("f2e6c4"),
}

# ── 碧青：友方 / 治疗 / 安全 ──
const SPIRIT := {
	"deep": Color("33524a"),
	"base": Color("9ec4ae"),
	"light": Color("bfdacd"),
	"glow": Color("dcefe4"),
}

# ── 夜蓝：法术 / 技能（无紫）──
const VOID := {
	"deep": Color("2c3a55"),
	"base": Color("5a6f96"),
	"light": Color("8ea3c8"),
	"glow": Color("b8c8e2"),
}

## 墨兽罩染：PvE 单位的青黛色罩（叠加色，与普通棋子蓝族拉开辨识差）
const MONSTER_WASH := Color("3a5686")
const MONSTER_WASH_ALPHA := 0.38

# ── 酡橙：灼烧 / 熔炼 ──
const EMBER := {
	"deep": Color("7a4520"),
	"base": Color("c98a4e"),
	"light": Color("e8ad72"),
}

# ── 霁青：寒冰 / 引导束 ──
const CERU := {
	"deep": Color("2e5560"),
	"base": Color("7fb0bd"),
	"light": Color("a8d2da"),
}

## 特效语义色表（单一真源；EffectsLayer 按 core 的 hue 槽位取色）
const FX_TINTS := {
	0: CINNABAR["light"],  # 物理冲击 / 破盾新星
	1: GILT["light"],      # 增益 / 战吼 / 击杀强化
	2: VOID["light"],      # 法术爆发 / 范围法伤
	3: CERU["light"],      # 引导束 / 贯穿光线
	4: SPIRIT["light"],    # 治疗
	5: CERU["base"],       # 连锁闪电 / 穿透链
	6: PAPER[50],       # 处决 / 真实伤害（皓白金）
}

# ── 月白：环境光 / 护盾 / 中立信息 ──
const MOON := {
	"deep": Color("56616e"),
	"base": Color("8b98a8"),
	"light": Color("c2cdd6"),
}

## 稀有度语义色（雾灰 / 玉青 / 夜蓝 / 胭脂 / 米金）
const RARITY_COLOR := {
	1: Color("7e8b9b"),  # 凡品 · 雾灰
	2: Color("9ec4ae"),  # 灵品 · 玉青
	3: Color("8ea3c8"),  # 宝品 · 夜蓝
	4: Color("cf9bae"),  # 仙品 · 胭脂
	5: Color("e3cfa0"),  # 神品 · 米金
}

const RARITY_NAME := {
	1: "凡品",
	2: "灵品",
	3: "宝品",
	4: "仙品",
	5: "神品",
}

## 阵营色：友方玉青 / 敌方朱砂 —— 不看文字也能读懂局面
const TEAM_COLOR := {
	0: SPIRIT["base"],
	1: CINNABAR["base"],
}

const TEAM_COLOR_DEEP := {
	0: SPIRIT["deep"],
	1: CINNABAR["deep"],
}

## 遮罩 / 投影用纯黑 —— 色板里唯一允许的"黑"
const SHADE := Color.BLACK

## 技术性纯白：受击闪白与几何遮罩占位（非视觉色）
const PURE_WHITE := Color.WHITE

## 危险按钮变体
const DANGER := {
	"base": Color("7e3323"),
	"light": Color("a85242"),
}

## 盘面纸纹的阴干调
const PAPER_TINT := Color("8b98a8")

## 飘字描边暗色（分级与 ART_BIBLE 一一对应）
const DAMAGE_OUTLINE := {
	"normal": Color("0a121c"),
	"crit": Color("3a120a"),
	"skill": Color("141d2e"),
	"true": Color("2e2810"),  # true 是保留字，键必须字符串化
	"heal": Color("0f2a20"),
	"shield": Color("18222a"),
	"execute": Color("382c0e"),
	"dotBurn": Color("2e1a0e"),
	"dotBleed": Color("301a12"),
}

## 伤害类型的飘字 / 特效配色
const DAMAGE_COLOR := {
	"physical": PAPER[100],
	"magic": VOID["light"],
	"true": GILT["light"],  # 同上
	"crit": CINNABAR["light"],
	"heal": SPIRIT["light"],
	"shield": MOON["light"],
}

## 羁绊档位色（古铜 / 暖银 / 米金 / 胭脂）
const TRAIT_TIER_COLOR := [Color("b59a77"), Color("b9b3a4"), Color("e3cfa0"), Color("cf9bae")]

# ── UI 语义 ──
const UI := {
	"panel_bg": INK[800],
	"panel_bg_soft": INK[700],
	"panel_border": INK[500],
	"border_accent": GILT["deep"],
	"text_primary": PAPER[100],
	"text_secondary": PAPER[300],
	"text_muted": PAPER[400],
	"success": SPIRIT["base"],
	"danger": CINNABAR["base"],
	"gold": GILT["base"],
	"disabled": INK[500],
}


## 两色线性插值（对齐 TS palette.mix：分量 round）
static func mix(a: Color, b: Color, t: float) -> Color:
	var r := ParityUtil.js_round(a.r8 + (b.r8 - a.r8) * t) / 255.0
	var g := ParityUtil.js_round(a.g8 + (b.g8 - a.g8) * t) / 255.0
	var bl := ParityUtil.js_round(a.b8 + (b.b8 - a.b8) * t) / 255.0
	return Color(r, g, bl)
