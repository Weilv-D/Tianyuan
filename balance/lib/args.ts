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
