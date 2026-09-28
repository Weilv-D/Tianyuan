## 每日挑战（src/game/daily.ts 对齐版，存储改 user://）。
## 种子 = 本地日期（YYYY-MM-DD）的 FNV-1a 32 位；日期由入口层注入，
## 本文件不读时钟（游戏逻辑禁时钟纪律），同一天任何时刻种子一致。
## 成绩 = 对局最终名次；本地保留每日最低名次，只存「今天」一条。
class_name Daily
extends RefCounted

const DAILY_PATH := "user://daily.json"


## 本地时区日期键：YYYY-MM-DD。d 为 { year, month(1 基), day }（Time.get_datetime 口径），
## 绝不经 UTC 换算。
static func today_key(d: Dictionary) -> String:
	return "%04d-%02d-%02d" % [int(d["year"]), int(d["month"]), int(d["day"])]


## 同一天任何时刻返回同一 32 位无符号种子
static func daily_seed_for(d: Dictionary) -> int:
	return ParityUtil.fnv1a32(today_key(d))


## 读取当日前的本地最佳名次；无记录 / 数据损坏返回 null，绝不抛出
static func load_daily_best() -> Variant:
	var f := FileAccess.open(DAILY_PATH, FileAccess.READ)
	if f == null:
		return null
	var raw := f.get_as_text()
	f.close()
	var parsed: Variant = JSON.parse_string(raw)
	if parsed == null or not (parsed is Dictionary):
		return null
	var date: Variant = parsed.get("date", null)
	var rank: Variant = parsed.get("rank", null)
	if not (date is String) or not (rank is int or rank is float):
		return null
	# 域校验：名次是 1~8 的整数，越界记录视作损坏
	if not ParityUtil.js_is_int(rank) or int(rank) < 1 or int(rank) > 8:
		return null
	return { "date": date, "rank": int(rank) }


## 记录一次每日挑战结果；返回是否刷新了该日纪录（名次更低）。
## 存储不可用按「未刷新」返回 false —— 与 save.gd 同口径，持久化失败不炸结算。
static func record_daily_result(d: Dictionary, rank: int) -> bool:
	if not ParityUtil.js_is_int(rank) or rank < 1 or rank > 8:
		return false
	var date := today_key(d)
	var prev: Variant = load_daily_best()
	if prev is Dictionary and prev["date"] == date and not (rank < int(prev["rank"])):
		return false
	var f := FileAccess.open(DAILY_PATH, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(JSON.stringify({ "date": date, "rank": rank }))
	f.close()
	return true
