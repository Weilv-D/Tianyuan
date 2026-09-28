## 墨兽（PvE 轮次，src/game/beast.ts 对齐版）。
## 装备独立产出渠道 + 节奏起伏。阵容复用现有棋子，只换墨色剪影。
class_name Beast
extends RefCounted

## 分层候选池：按「第几回合开始出现」
const BEAST_TIERS: Array = [
	{ "fromRound": 0, "ids": ["pan", "canghao", "budong", "lingxiao", "muji"] },
	{ "fromRound": 7, "ids": ["xuanwu", "gongshu", "zhuyan", "jiuying", "zhenyue"] },
	{ "fromRound": 15, "ids": ["canglan", "haotian", "shidian", "yinglong", "qingqiu"] },
]


static func pool_for(round: int) -> Array:
	var out: Array = []
	for tier: Dictionary in BEAST_TIERS:
		if round >= int(tier["fromRound"]):
			out.append_array(tier["ids"])
	if out.size() > 0:
		return out
	return BEAST_TIERS[0]["ids"].duplicate()


## 首回合引导墨兽的攻击力倍率：只留威胁之形，去威胁之实
const BEAST_INTRO_POW_MULT := 0.08

## 墨兽的展示名
const BEAST_NAME := "墨兽"


## 生成一场墨兽战的阵容（rng 消费序：shuffle 一次 → 每只先 threeStarChance 后 twoStarChance）
static func generate_beast_board(round: int, rng: Rng) -> Array:
	Spec.ensure()
	var board: Array = []
	board.resize(GameState.board_cells())
	board.fill(null)
	var pool := pool_for(round)

	# 数量：首回合 1 只（引导只留一形），此后 2~8 只逐段增长
	var count := 1 if round == 1 else int(min(8, 2 + floor(round / 4.0)))
	# 星级：8 回合前全 1★；8~15 出现 2★；16 回合起出现 3★
	var two_star_chance := 0.0 if round < 8 else (0.45 if round < 16 else 0.6)
	var three_star_chance := 0.0 if round < 16 else (0.12 if round < 24 else 0.3)

	# 站位：从后排往前排铺，前排优先（墨兽是冲脸的）
	var slots: Array = []
	for row: int in 4:
		var order := [3, 2, 4, 1, 5, 0, 6, 7] if row % 2 == 0 else [4, 3, 5, 2, 6, 1, 7, 0]
		for c in order:
			slots.append(row * 8 + c)

	var picked: Array = rng.shuffle(pool.duplicate())
	var used := {}
	# 先生成入列（去重 + 名单校验），再连续占位 —— 候选重名/未知 id 时不留站位空洞
	var chosen: Array = []
	for i: int in count:
		var id: Variant = picked[i % picked.size()]
		if used.has(id) or not Spec.champion_by_id.has(id):
			continue
		used[id] = true
		chosen.append(id)
	for i: int in chosen.size():
		var star := 1
		if rng.chance(three_star_chance):
			star = 3
		elif rng.chance(two_star_chance):
			star = 2
		var u: Dictionary = GameState.create_unit(chosen[i], star)
		u["isBeast"] = true
		if round == 1:
			u["powMult"] = BEAST_INTRO_POW_MULT
		board[slots[i]] = u
	return board
