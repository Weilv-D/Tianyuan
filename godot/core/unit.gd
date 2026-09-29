## 战斗中的单位运行时状态（src/core/unit.ts）。纯数据 + 查询方法，不含渲染。
## entry 是 spec.json 的棋子定义字典；数值字段一律 float（JS number = double）。
class_name Unit
extends RefCounted

const MAX_SAFE_INT := 9007199254740991.0

## RESIST_CAP 兜底默认值：与 config.ts 真源同值的单一常量（两处调用点共用，
## spec 改档未重导出时至少两侧同步——2.4.1 审查修复，原为两处各写 220.0）
const RESIST_CAP_FALLBACK := 220.0

var uid: int
var entry: Dictionary
var team: int
var star: int
var is_minion: bool
var is_monster: bool

# ── 静态面板（已含装备加成，不含临时状态） ──
var max_hp: float
var hp: float
var atk: float
var sp: float
var base_armor: float
var base_mr: float
var base_aspd: float
var range: int
var move_time: float
var crit_chance: float
var crit_mult: float
var lifesteal: float
var omnivamp: float
var damage_amp: float

# ── 法力 ──
var mp: float
var max_mp: float
var mana_lock: float

# ── 位置 ──
var cell: Vector2i
var alive: bool
## 死亡位置（复活锚点）；death_cell_valid=false 等价 TS 的 null
var death_cell: Vector2i
var death_cell_valid: bool
var move_from: Vector2i
var move_to: Vector2i
var move_valid: bool
var move_t: float
var move_dur: float

# ── 状态 ──
var shield: float
var statuses: Array = []
var perm_atk_pct := 0.0
var perm_aspd_pct := 0.0
var cc_immune := 0
var tstate: TraitState
var item_ids: Array = []
var item_hooks: Array = []
var item_used := {}
var trait_stacks := {}
var kill_handlers: Array = []

# ── 行为计时器（秒） ──
var attack_cd := 0.0
var windup_left := 0.0
var windup_total := 0.0
var windup_target_uid := -1
var move_cd := 0.0
var retarget_cd := 0.0
var cast_windup_left := 0.0
var target_uid := -1
var cast_count := 0
var attack_count := 0

# ── 生命周期 ──
var revived := false
var yaozu_transformed := false

# ── 统计 ──
var dealt_damage := 0.0
var taken_damage := 0.0
var dealt_by_type := {}
var taken_by_type := {}
var absorbed_damage := 0.0
var healed := 0.0
var kills := 0


static func clampf(v: float, lo: float, hi: float) -> float:
	return lo if v < lo else (hi if v > hi else v)


static func create(input: Dictionary) -> Unit:
	Spec.ensure()
	var entry = Spec.champion_by_id.get(input.get("defId", ""), null)
	if entry == null or entry.is_empty():
		push_error("未知棋子: %s" % str(input.get("defId")))
		return null
	var star_v: Variant = input.get("star", 0)
	# 星级入口校验：越界/非整星级会让缩放表查空，NaN 沿链路静默传播
	if not ParityUtil.js_is_int(star_v) or int(star_v) < 1 or int(star_v) > 3:
		push_error("非法星级: %s（%s）" % [str(star_v), str(input.get("defId"))])
		return null
	var pow_mult: Variant = input.get("powMult", null)
	if pow_mult != null and not ParityUtil.js_finite(pow_mult):
		push_error("非法 powMult: %s（%s）" % [str(pow_mult), str(input.get("defId"))])
		return null
	var bonus_v: Variant = input.get("bonus", null)
	var in_bonus: Dictionary = bonus_v if bonus_v is Dictionary else {}
	for k: String in in_bonus:
		if not ParityUtil.js_finite(in_bonus[k]):
			push_error("非法 bonus.%s: %s（%s）" % [k, str(in_bonus[k]), str(input.get("defId"))])
			return null

	var u := Unit.new()
	var star := int(star_v)
	var b: Dictionary = entry["base"]
	var si := star - 1
	var hp_scale := Spec.star_scale("STAR_HP_SCALE", si)
	var pow_scale := Spec.star_scale("STAR_POWER_SCALE", si)
	# unit↔ItemFx 存在 class_name 循环引用（Godot 解析器不支持）：
	# 装备聚合在这里只能经运行时 load 调用，编译期不出现 ItemFx 标识符
	var item_fx := load("res://core/items_core.gd")
	var items_v: Variant = input.get("items", null)
	var eff: Dictionary = item_fx.item_effects(items_v if items_v is Array else [])
	# 装备加成与外部 bonus 同键求和（同 itemEffects 按件求和口径；覆盖会丢装备贡献）
	var bonus: Dictionary = {}
	for k: String in eff["bonus"]:
		bonus[k] = eff["bonus"][k]
	for k: String in in_bonus:
		bonus[k] = float(bonus.get(k, 0.0)) + float(in_bonus[k])

	# 天命（3★五费）/登峰（3★四费）：墨兽与召唤物排除（与 skills.skillRaw 同口径）
	var legend: bool = int(entry["cost"]) == 5 and star == 3 and not input.get("isMinion", false) and not input.get("monster", false)
	var legend_hp := Spec.legend("hpMult") if legend else 1.0
	var legend_pow := Spec.legend("powerMult") if legend else 1.0
	var elite: bool = int(entry["cost"]) == 4 and star == 3 and not input.get("isMinion", false) and not input.get("monster", false)
	# 登峰倍率走 Spec.elite()（缺键 push_error，与 legend() 同纪律；旧裸读静默 1.0）
	var elite_hp: float = Spec.elite("hpMult") if elite else 1.0
	var elite_pow: float = Spec.elite("powerMult") if elite else 1.0
	var global_hp := Spec.c("GLOBAL_HP_SCALE", 1.0)

	u.uid = int(input["uid"])
	u.entry = entry
	u.team = int(input["team"])
	u.star = star
	u.is_minion = input.get("isMinion", false)
	u.is_monster = input.get("monster", false)
	# 天命 3★五费天生免疫控制（battle.apply_status 以 cc_immune > 0 短路全部 CONTROL_KINDS）
	u.cc_immune = 1_000_000_000 if legend and Spec.legend("ccImmune") > 0.5 else 0

	# maxHp 下界 1 / startMp 下界 0：负向 bonus 在边界终止，不沿战斗链路传播
	u.max_hp = maxf(1.0, ParityUtil.js_round(
		float(b["hp"]) * hp_scale * global_hp * legend_hp * elite_hp + float(bonus.get("hp", 0.0))))
	u.hp = u.max_hp
	u.atk = maxf(1.0, ParityUtil.js_round(
		float(b["atk"]) * pow_scale * legend_pow * elite_pow * (float(pow_mult) if pow_mult != null else 1.0) + float(bonus.get("atk", 0.0))))
	u.sp = maxf(0.0, ParityUtil.js_round(
		float(b["sp"]) * pow_scale * legend_pow * elite_pow + float(bonus.get("sp", 0.0))))
	u.base_armor = float(b["armor"]) + float(bonus.get("armor", 0.0))
	u.base_mr = float(b["mr"]) + float(bonus.get("mr", 0.0))
	u.base_aspd = float(b["aspd"]) * (1.0 + float(bonus.get("aspd", 0.0)))
	u.range = int(b["range"])
	u.move_time = float(b["moveTime"])
	u.crit_chance = float(b["critChance"]) + float(bonus.get("critChance", 0.0))
	u.crit_mult = float(b["critMult"]) + float(bonus.get("critMult", 0.0))
	u.lifesteal = float(bonus.get("lifesteal", 0.0))
	u.omnivamp = float(bonus.get("omnivamp", 0.0)) + (Spec.legend("omnivamp") if legend else 0.0)
	u.damage_amp = float(bonus.get("damageAmp", 0.0))

	u.mp = maxf(0.0, minf(float(b["startMp"]) + float(bonus.get("startMp", 0.0)), float(b["maxMp"])))
	u.max_mp = float(b["maxMp"])
	u.mana_lock = 0.0

	var c: Dictionary = input["cell"]
	u.cell = Vector2i(int(c["c"]), int(c["r"]))
	u.alive = true
	u.death_cell_valid = false
	u.death_cell = Vector2i.ZERO
	u.move_valid = false
	u.move_from = Vector2i.ZERO
	u.move_to = Vector2i.ZERO
	u.move_t = 0.0
	u.move_dur = 0.0

	# 开战护盾（无 shield 状态 → 永不到期；受击回蓝把吸收计入 final 是有意口径）
	u.shield = ParityUtil.js_round(u.max_hp * Spec.legend("startShieldPct")) if legend else 0.0
	u.statuses = []
	u.tstate = TraitState.create()
	u.trait_stacks = {}
	u.kill_handlers = []
	u.item_ids = (input.get("items", []) as Array).duplicate()
	u.item_hooks = eff["hooks"]
	u.item_used = {}

	u.dealt_damage = 0.0
	u.taken_damage = 0.0
	u.dealt_by_type = {"physical": 0.0, "magic": 0.0, "true": 0.0}
	u.taken_by_type = {"physical": 0.0, "magic": 0.0, "true": 0.0}
	u.absorbed_damage = 0.0
	u.healed = 0.0
	u.kills = 0
	return u


## 由已有单位派生召唤物
static func create_minion(uid: int, src: Unit, cell: Vector2i, hp_pct: float, atk_pct: float) -> Unit:
	if not ParityUtil.js_finite(hp_pct) or not ParityUtil.js_finite(atk_pct):
		push_error("createMinion: invalid scaling hpPct=%s atkPct=%s" % [str(hp_pct), str(atk_pct)])
		return null
	var m: Unit = create({
		"uid": uid, "defId": src.entry["id"], "team": src.team, "star": 1,
		"cell": {"c": cell.x, "r": cell.y}, "isMinion": true,
	})
	m.max_hp = maxf(1.0, ParityUtil.js_round(src.max_hp * maxf(0.0, hp_pct)))
	m.hp = m.max_hp
	m.atk = maxf(1.0, ParityUtil.js_round(src.atk * maxf(0.0, atk_pct)))
	m.sp = maxf(0.0, ParityUtil.js_round(src.sp * maxf(0.0, atk_pct)))
	m.max_mp = MAX_SAFE_INT  # 召唤物不施法
	m.mp = 0.0
	m.range = 1
	m.base_aspd = 0.7
	m.move_time = 0.5
	return m


# ── 有效属性 ────────────────────────────────────────────

func sum_status(kind: String) -> float:
	var v := 0.0
	for s: Status in statuses:
		if s.kind == kind:
			v += s.value
	return v


func eff_atk() -> float:
	return atk * (1.0 + perm_atk_pct) * (1.0 + sum_status("atkUp") / 100.0)


func eff_sp() -> float:
	return sp


func eff_aspd() -> float:
	var up := 1.0 + perm_aspd_pct + sum_status("aspdUp") / 100.0
	var slow := 1.0 - minf(0.8, sum_status("slow") / 100.0)
	return maxf(0.15, base_aspd * up * slow)


func eff_armor() -> float:
	return clampf(base_armor + sum_status("armorUp") - sum_status("armorShred"), 0.0, Spec.c("RESIST_CAP", RESIST_CAP_FALLBACK))


func eff_mr() -> float:
	return clampf(base_mr + sum_status("mrUp") - sum_status("mrShred"), 0.0, Spec.c("RESIST_CAP", RESIST_CAP_FALLBACK))


func eff_move_time() -> float:
	var slow := 1.0 - minf(0.7, sum_status("slow") / 100.0)
	return move_time / maxf(0.3, slow)


func has_status(kind: String) -> bool:
	for s: Status in statuses:
		if s.kind == kind:
			return true
	return false


func is_stunned() -> bool:
	return has_status("stun")


func is_silenced() -> bool:
	return has_status("silence")


func is_disarmed() -> bool:
	return has_status("disarm")


func is_targetable() -> bool:
	return alive and not has_status("stealth")
