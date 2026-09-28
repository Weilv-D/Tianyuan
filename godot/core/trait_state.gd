## 单位身上由羁绊/装备沉淀下来的修正（src/core/api.ts TraitState）。
## 挂在单位而非队伍：自走棋惯例是"羁绊加成作用于持有者"，全队效果才写全队。
class_name TraitState
extends RefCounted

var skill_amp := 0.0
var skill_true_ratio := 0.0
var physical_dr := 0.0
var magic_dr := 0.0
var all_dr := 0.0
var armor_pen := 0.0
var thorn_resist := 0.0
var heal_amp := 0.0
var shield_amp := 0.0
var mana_per_sec := 0.0
var hp_regen_pct_per_sec := 0.0
var mana_from_damage_mult := 1.0
var skill_crit_chance := 0.0
var skill_crit_mult := 0.0
## 已激活羁绊 → 0-based 档位（未激活不在表里）
var tier := {}


static func create() -> TraitState:
	return TraitState.new()
