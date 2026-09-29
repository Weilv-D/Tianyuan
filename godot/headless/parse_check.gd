extends SceneTree
## 全树脚本加载检查（qa 步骤）：--import 与 GdUnit4 都不会深检未被引用的渲染层脚本，
## 战斗场景曾带 Parse Error 过全部门禁（2026-09-29 窗口冒烟实证）——本探针逐个 load。
func _initialize() -> void:
	var bad: Array = []
	for dir in ["res://core", "res://game", "res://render", "res://ui", "res://audio", "res://headless"]:
		_scan(dir, bad)
	if bad.is_empty():
		print("PARSE_ALL_OK")
		quit(0)
	else:
		for p: String in bad:
			print("PARSE_FAIL ", p)
		quit(1)


func _scan(dir_path: String, bad: Array) -> void:
	var d := DirAccess.open(dir_path)
	if d == null:
		return
	d.list_dir_begin()
	var name := d.get_next()
	while name != "":
		if d.current_is_dir() and not name.begins_with("."):
			_scan("%s/%s" % [dir_path, name], bad)
		elif name.ends_with(".gd"):
			# load 触发 parse：语法错误会打到进程输出（SCRIPT ERROR），返回值与
			# reload()/new() 均不反映（2026-09-29 实证 load/new 双假绿）——
			# 门禁由 qa 步骤扫描本探针输出的 SCRIPT ERROR 行兜底
			var script: Variant = load("%s/%s" % [dir_path, name])
			if script == null:
				bad.append("%s/%s" % [dir_path, name])
		name = d.get_next()
	d.list_dir_end()
