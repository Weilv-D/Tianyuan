## 棋盘几何（src/core/grid.ts）。Cell 内部表示为 Vector2i（x=c, y=r），
## 事件出口转 {c, r} 字典（PARITY_CODEC 口径）。
class_name Grid
extends RefCounted

const COLS := 8
const ROWS := 8

## 8 邻域偏移顺序固定 —— 保证寻路结果确定
const NEIGHBOR_OFFSETS: Array[Vector2i] = [
	Vector2i(-1, -1), Vector2i(0, -1), Vector2i(1, -1),
	Vector2i(-1, 0), Vector2i(1, 0),
	Vector2i(-1, 1), Vector2i(0, 1), Vector2i(1, 1),
]


static func cell_index(c: int, r: int) -> int:
	return r * COLS + c


static func in_bounds(c: int, r: int) -> bool:
	return c >= 0 and c < COLS and r >= 0 and r < ROWS


## 切比雪夫距离 —— 攻击距离 1 = 周围 8 格
static func chebyshev(a: Vector2i, b: Vector2i) -> int:
	return maxi(absi(a.x - b.x), absi(a.y - b.y))


static func cell_dict(v: Vector2i) -> Dictionary:
	return {"c": v.x, "r": v.y}


## BFS 到第一个满足 is_goal 的可达格。占用格既不能穿过也不能落脚（占位表不可腐坏）。
## 返回 {path: Array[Vector2i], goal: Vector2i}，不可达返回 {}。
static func bfs_to(start: Vector2i, is_goal: Callable, blocked: Callable, max_nodes: int = COLS * ROWS) -> Dictionary:
	var start_idx := cell_index(start.x, start.y)
	if is_goal.call(start.x, start.y):
		return {"path": [], "goal": start}

	var prev := PackedInt32Array()
	prev.resize(COLS * ROWS)
	prev.fill(-1)
	var seen := PackedInt32Array()
	seen.resize(COLS * ROWS)
	var queue := PackedInt32Array()
	queue.resize(COLS * ROWS)
	var head := 0
	var tail := 0

	seen[start_idx] = 1
	queue[tail] = start_idx
	tail += 1
	var visited := 0

	while head < tail:
		var cur := queue[head]
		head += 1
		visited += 1
		if visited > max_nodes:
			return {}
		var cc := cur % COLS
		var cr := (cur - cc) / COLS
		for i: int in 8:
			var off: Vector2i = NEIGHBOR_OFFSETS[i]
			var nc := cc + off.x
			var nr := cr + off.y
			if not in_bounds(nc, nr):
				continue
			var ni := cell_index(nc, nr)
			if seen[ni]:
				continue
			if blocked.call(nc, nr):
				continue
			seen[ni] = 1
			prev[ni] = cur
			queue[tail] = ni
			tail += 1
			if is_goal.call(nc, nr):
				return {"path": _reconstruct(prev, start_idx, ni), "goal": Vector2i(nc, nr)}
	return {}


static func _reconstruct(prev: PackedInt32Array, start_idx: int, end_idx: int) -> Array:
	var out := []
	var cur := end_idx
	while cur != start_idx and cur >= 0:
		var c := cur % COLS
		var r := (cur - c) / COLS
		out.append(Vector2i(c, r))
		cur = prev[cur]
	out.reverse()
	return out


## 找"能攻击到 target"的最近可站格，返回第一步；已在射程内返回 null（{}）。
## 目标脚下那格被显式排除 —— 走上目标格是占位表腐坏的源头。
static func step_toward_attack_position(from: Vector2i, target: Vector2i, range_: int, blocked: Callable) -> Variant:
	var res := bfs_to(
		from,
		func(c: int, r: int):
			return chebyshev(Vector2i(c, r), target) <= range_ and not (c == target.x and r == target.y),
		blocked,
	)
	if res.is_empty() or (res["path"] as Array).is_empty():
		return null
	return res["path"][0]
