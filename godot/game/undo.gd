## 全局撤销栈（src/game/undo.ts 对齐版）。
## 快照整个玩家状态而非反向操作 —— 一处正确，处处正确。
## scope = 准备阶段玩家可触碰的一切 + 卡池计数 + 本回合未领恩赐（rng 游标由
## 调用方 GameScene 的 UndoEntry 随入/出栈定格/回写，与本文件分工一致）。
## hp / streak / rank 刻意不在快照内：只在战斗结算变化，撤销永不跨结算。
class_name Undo
extends RefCounted


## 恩赐浅克隆：options 数组拷贝一份（选项对象是发放时新建的只读规格）
static func clone_offer(offer) -> Variant:
	if offer == null or not (offer is Dictionary):
		return null
	var c: Dictionary = offer.duplicate()
	c["options"] = (offer["options"] as Array).duplicate()
	return c


## 在动作发生前调用：把玩家可变状态连同卡池一起定格
static func snapshot_player(p: Dictionary, pool, adventure_offer: Variant = null) -> Dictionary:
	return {
		"board": GameState.clone_board(p["board"]),
		"bench": GameState.clone_slots(p["bench"]),
		"gold": p["gold"],
		"level": p["level"],
		"xp": p["xp"],
		"shop": (p["shop"] as Array).duplicate(),
		"shopLocked": p["shopLocked"],
		"items": (p["items"] as Array).duplicate(),
		"pool": pool.snapshot(),
		"adventureOffer": clone_offer(adventure_offer),
	}


## 撤销：把快照回写进玩家状态。回写时再拷贝一次，同一份快照可安全复用。
## offer 目标必传（恩赐挂在 Match 上而非 PlayerState 上）：恢复职责与快照职责
## 对称收口在这一处，新增快照消费方不会漏写 adventureOffer 造成半回滚。
static func restore_player(p: Dictionary, pool, s: Dictionary, offer_target) -> void:
	p["board"] = GameState.clone_board(s["board"])
	p["bench"] = GameState.clone_slots(s["bench"])
	p["gold"] = s["gold"]
	p["level"] = s["level"]
	p["xp"] = s["xp"]
	p["shop"] = (s["shop"] as Array).duplicate()
	p["shopLocked"] = s["shopLocked"]
	p["items"] = (s["items"] as Array).duplicate()
	pool.restore(s["pool"])
	offer_target.adventure_offer = clone_offer(s["adventureOffer"])
