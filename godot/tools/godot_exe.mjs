// Godot 可执行路径唯一真源（原四工具逐字复制，漏改一处即门禁步骤 FAIL——2.4.1 收敛）。
// 环境约定见 README；本机开发路径可用 GODOT_EXE 环境变量覆盖（CI/换机不改码）。
import { existsSync } from 'node:fs';

const DEFAULT = 'C:/WORKSPACE/game/Godot_v4.7.1-stable_win64.exe';

export const GODOT_EXE = process.env.GODOT_EXE || DEFAULT;

if (!existsSync(GODOT_EXE)) {
  console.error(`[tools] Godot 可执行不存在：${GODOT_EXE}（设 GODOT_EXE 环境变量覆盖）`);
  process.exit(1);
}
