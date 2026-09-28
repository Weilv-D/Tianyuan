extends Node2D
## 占位 Boot：M3 表现层里程碑时整体重写。
## 现阶段仅用于验证工程可导入、可运行。

func _ready() -> void:
	print("[boot] 百战天元 · 夜宴 (Godot) 工程就绪 version=",
		ProjectSettings.get_setting("application/config/version"))
