/** 命令行参数解析小件：有值旗标吃一个词，其余进 rest（位置参数）。 */

export interface ParsedArgs {
  /** 有值旗标（--name value）；无值旗标存在时值为 '' */
  flags: Map<string, string>;
  rest: string[];
}

export function parseArgs(argv: readonly string[], valued: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  const valuedSet = new Set(valued);
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z][a-z0-9-]*)$/i.exec(argv[i]);
    if (m) {
      if (valuedSet.has(m[1])) flags.set(m[1], argv[++i] ?? '');
      else flags.set(m[1], '');
    } else rest.push(argv[i]);
  }
  return { flags, rest };
}

export function requirePositiveInt(v: string | undefined, name: string, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`✗ ${name} 必须是正整数，收到：${v}`);
  }
  return n;
}

/** 整数参数（含下界与可选上界 [min, max)）：probe/diag/match 等命令的入参门，
 *  非法即 throw（cli.ts 统一打印退出）—— 与 requirePositiveInt 同一失败口径。 */
export function requireIntArg(v: string | undefined, name: string, min: number, fallback: number, max?: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n >= max)) {
    throw new Error(`✗ ${name} 必须为 ≥${min} 的整数${max !== undefined ? ` 且小于 ${max}` : ''}，收到：${v}`);
  }
  return n;
}
