## 状态效果（src/core/types.ts StatusEffect 的 GDScript 化）。
## dtype 为 "" 表示非 DoT（TS 的 undefined）；src 为 "" 表示外来层（不参与 maxStacks 计数）。
class_name Status
extends RefCounted

var kind: String
var ticks: int
var value: float
var src_uid: int
var dtype: String = ""
var src: String = ""
