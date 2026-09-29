# HUD 几何契约测试（tests/hud-layout.test.ts 全量不变量的 GdUnit4 移植；
# 计数随 TS 侧 20 个 it 同步，另有一条跨契约净距钉为 Godot 侧增补）。
# 遮挡不变量回归：文字不出容器、元素两两不相交、轨不出栏。
extends GdUnitTestSuite


# ── 羁绊轨几何 ────────────────────────────────────────────

func test_rail_view_never_overlaps_log() -> void:
	assert_bool(HudLayout.rail_overlaps_log()).is_false()


func test_all_17_badge_hits_fit_in_scroll_view() -> void:
	var hit := HudLayout.rail_badge_hit()
	# 视口世界系左缘 RAIL_X-24；命中区相对环心，环心挂 RAIL_X（横向收进视口；
	# 纵向内容高于视口由滚动承接，视口底不得进记事栏）
	assert_float(float(Layout.RAIL_X + hit["x"])).is_greater_equal(Layout.RAIL_X - 24.0)
	assert_float(float(Layout.RAIL_X + hit["x"] + hit["w"])).is_less_equal(Layout.RAIL_X - 24.0 + HudLayout.RAIL_VIEW_W)
	assert_float(float(Layout.RAIL_Y - 20.0 + HudLayout.RAIL_VIEW_H)).is_less_equal(Layout.LOG_Y - 12.0)


func test_hit_zone_covers_ring_and_count_ink() -> void:
	var hit := HudLayout.rail_badge_hit()
	# 圆环左/上界（环心在局部 0,0，半径 BADGE_R）
	assert_float(float(hit["x"])).is_less_equal(-HudLayout.BADGE_R)
	assert_float(float(hit["y"])).is_less_equal(-HudLayout.BADGE_R)
	# 计数串右缘（RAIL_COUNT_DX + RAIL_COUNT_W）
	assert_float(float(hit["x"] + hit["w"])).is_greater_equal(HudLayout.RAIL_COUNT_DX + HudLayout.RAIL_COUNT_W)


func test_adjacent_badge_hits_do_not_stack() -> void:
	var hit := HudLayout.rail_badge_hit()
	assert_int(Layout.RAIL_PITCH).is_greater_equal(int(hit["h"]))


func test_popup_keeps_clearance_and_clamps_to_screen() -> void:
	# 最坏情形：最末徽章 + 最高笺（五行效果 + 三行描述）
	var layout := HudLayout.rail_popup_layout(5, 3)
	var pos := HudLayout.rail_popup_pos(HudLayout.rail_badge_world_y(16), layout["h"])
	# 左缘净距（贴计数串右缘外 3px）
	assert_float(float(pos["x"])).is_equal(Layout.RAIL_X + HudLayout.RAIL_COUNT_DX + HudLayout.RAIL_COUNT_W + 3.0)
	# 钳位后不越屏底（CAH_Y_MAX = 860）
	assert_float(float(pos["y"]) + layout["h"]).is_less_equal(HudLayout.CAH_Y_MAX + 0.001)


func test_badge_world_y_counts_scroll_offset() -> void:
	assert_float(float(HudLayout.rail_badge_world_y(0, Layout.RAIL_Y - 300.0))).is_equal(Layout.RAIL_Y - 300.0)


func test_badge_world_hit_follows_container_y() -> void:
	var container_y := Layout.RAIL_Y - 120.0
	for i: int in [0, 5, 16]:
		var hit: Dictionary = HudLayout.rail_badge_world_hit(i, container_y)
		assert_float(float(hit["y"])).is_equal(container_y + HudLayout.rail_badge_y(i) - 20.0)


# ── 计分板行几何 ──────────────────────────────────────────

func test_report_row_fits_side() -> void:
	assert_bool(HudLayout.report_row_fits_side()).is_true()
	assert_float(float(HudLayout.REPORT_ROW["streakX"] + HudLayout.REPORT_ROW["streakMaxW"])).is_less_equal(Layout.SIDE_W)


func test_seven_cjk_name_and_streak_do_not_overlap() -> void:
	var r := HudLayout.report_row_rects(7)
	assert_float(float(r["name"]["x"] + r["name"]["w"])).is_less_equal(r["bar"]["x"])
	assert_float(float(r["bar"]["x"] + r["bar"]["w"])).is_less_equal(r["lv"]["x"])
	assert_float(float(r["lv"]["x"] + r["lv"]["w"])).is_less_equal(r["streak"]["x"])
	assert_float(float(r["streak"]["x"] + r["streak"]["w"])).is_less_equal(Layout.SIDE_W)


func test_long_name_clipped_to_budget() -> void:
	var r := HudLayout.report_row_rects(12)
	assert_float(float(r["name"]["w"])).is_less_equal(HudLayout.REPORT_ROW["nameMaxW"])
	assert_float(float(r["streak"]["x"] + r["streak"]["w"])).is_less_equal(Layout.SIDE_W)


# ── 器匣 / 卸载钮 / 记事栏相互不重叠（1.7.0 修复回归） ──

const BTN_H := 26
const BTN_HIT_PAD := 5
const UNLOAD_BTN_W := 84
const FRAME_TOP_PAD := 24


func test_unload_btn_hit_keeps_clearance_from_item_frame() -> void:
	var hit_bottom: float = Layout.ITEM_BAR_Y + Layout.UNLOAD_BTN_DY + BTN_H + BTN_HIT_PAD
	assert_float(float(Layout.ITEM_BAR_Y - FRAME_TOP_PAD - hit_bottom)).is_greater_equal(1.0)


func test_unload_btn_within_item_bar_width() -> void:
	var btn_left: float = Layout.ITEM_BAR_X + Layout.ITEM_BAR_W - UNLOAD_BTN_W
	assert_float(float(btn_left)).is_greater_equal(Layout.ITEM_BAR_X)
	assert_float(float(btn_left + UNLOAD_BTN_W)).is_less_equal(Layout.ITEM_BAR_X + Layout.ITEM_BAR_W)


func test_item_bar_keeps_clearance_from_log() -> void:
	assert_float(float(Layout.ITEM_BAR_X - 10.0 - (Layout.LOG_X + Layout.LOG_W))).is_greater_equal(4.0)


# ── 羁绊成员卡几何 ────────────────────────────────────────

func test_golden_values_pinned() -> void:
	assert_int(HudLayout.trait_member_card_w()).is_equal(484)
	assert_int(HudLayout.TRAIT_MEMBER_X).is_equal(124)
	assert_int(HudLayout.TRAIT_MEMBER_GRID_Y).is_equal(66)
	var layout := HudLayout.rail_popup_layout(0, 1)
	var pos := HudLayout.rail_popup_pos(HudLayout.rail_badge_world_y(0), layout["h"])
	assert_float(float(pos["x"])).is_equal(112.0)


func test_member_card_clears_rail_scroll_view() -> void:
	assert_int(HudLayout.TRAIT_MEMBER_X).is_greater_equal(Layout.RAIL_X - 24 + HudLayout.RAIL_VIEW_W + 3)


func test_member_grid_fits_card_worst_case() -> void:
	var w := HudLayout.trait_member_card_w()
	for n: int in [5, 9, 24]:
		var last := HudLayout.trait_member_cell(n - 1)
		assert_int(HudLayout.TRAIT_MEMBER_GRID_X + int(last.x) + HudLayout.TRAIT_MEMBER_SIZE).is_less_equal(w)
		assert_int(HudLayout.TRAIT_MEMBER_GRID_Y + int(last.y) + HudLayout.TRAIT_MEMBER_SIZE).is_less_equal(HudLayout.trait_member_card_h(n))
		# 网格容量契约由上一行末格界内断言完整承载
		#（曾有一条 mini(n,COLS)*ceil(n/COLS)>=n 的恒等式断言，对被测代码零约束力，已移除）


func test_member_card_clamps_into_cah_band() -> void:
	var h := HudLayout.trait_member_card_h(24)
	var py := HudLayout.trait_member_clamp_y(HudLayout.rail_badge_world_y(16), h)
	assert_float(float(py + h)).is_less_equal(float(HudLayout.CAH_Y_MAX))
	assert_float(float(py)).is_greater_equal(float(HudLayout.CAH_Y_MIN))
	assert_int(h).is_less_equal(HudLayout.CAH_MAX_H)
	# 滚动后徽章锚在视口高处：卡钳位仍收在带内
	var scrolled := HudLayout.trait_member_clamp_y(HudLayout.rail_badge_world_y(0, Layout.RAIL_Y - 300.0), h)
	assert_float(float(scrolled + h)).is_less_equal(float(HudLayout.CAH_Y_MAX))
	assert_float(float(scrolled)).is_greater_equal(float(HudLayout.CAH_Y_MIN))


## 跨契约：成员卡底沿与器匣卸载/分页钮带顶的净距（CAH 域定立早于器匣加钮，
## 860 旧值曾压带 16px 吞点击——2.4.1 修复的回归钉）
func test_member_card_bottom_clears_item_btn_band() -> void:
	var band_top: float = Layout.ITEM_BAR_Y + Layout.UNLOAD_BTN_DY
	var h := HudLayout.trait_member_card_h(24)
	var worst: float = HudLayout.trait_member_clamp_y(1e9, h) + h  # 任意低锚 → 钳到上界
	assert_float(band_top - worst).is_greater_equal(6.0)
	# 悬停笺同域同理
	var pw := HudLayout.RAIL_POPUP_W
	var popup_bottom: float = HudLayout.rail_popup_pos(1e9, HudLayout.rail_popup_layout(1, 1)["h"])["y"] + HudLayout.rail_popup_layout(1, 1)["h"]
	assert_float(band_top - popup_bottom).is_greater_equal(0.0)


func test_member_pitch_ge_size_plus_gap() -> void:
	assert_int(HudLayout.TRAIT_MEMBER_PITCH).is_greater_equal(HudLayout.TRAIT_MEMBER_SIZE + 4)


# ── 信息字号下限 ──────────────────────────────────────────

func test_report_row_min_font_size() -> void:
	assert_int(HudLayout.REPORT_ROW["lvSize"]).is_greater_equal(12)
	assert_int(HudLayout.REPORT_ROW["streakSize"]).is_greater_equal(12)


func test_hit_zone_geometry_self_consistent() -> void:
	var hit := HudLayout.rail_badge_hit()
	assert_float(float(hit["x"] + hit["w"])).is_equal(float(HudLayout.RAIL_COUNT_DX + HudLayout.RAIL_COUNT_W))
