extends SceneTree
func _initialize() -> void:
	var u := Unit.new()
	print("PARSE_OK unit=", u != null)
	quit(0)
