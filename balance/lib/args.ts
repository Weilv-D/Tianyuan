/** 命令行参数解析小件：有值旗标吃一个词，其余进 rest（位置参数）。 */

export interface ParsedArgs {
  /** 有值旗标（--name value / --name=value）；无值旗标存在时值为 '' */
  flags: Map<string, string>;
  rest: string[];
}

/**
 * 取一个「有值旗标」的实参。缺值即抛。
 *
 * 为什么必须抛而不是回落默认值：旗标写在末尾（`--n` 后无值）时，静默回落会让
 * 整条命令以默认样本量跑完并打印结果，读数被当成"指定参数下"的结论 ——
 * 与 DEVELOPMENT §2.6「失败可见」相悖，且事后无法从产物反推真实参数。
 */
export function requireValue(argv: readonly string[], index: number, name: string): string {
  const v = argv[index];
  if (v === undefined || v.startsWith('--')) {
    throw new Error(`--${name} 缺值（写法：--${name} <值> 或 --${name}=<值>）`);
  }
  return v;
}

export function parseArgs(argv: readonly string[], valued: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  const valuedSet = new Set(valued);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // 裸 `--` 是「选项结束」标记：npm 的透传形态
    // （`npm run balance -- -- matrix --seed 1`）会把它原样带给脚本。
    // 跳过而不计入位置参数 —— 否则这条**唯一能正确透传旗标**的调用会被
    // 多余位置参数判据拒绝。
    if (a === '--') continue;
    // `--name=value` 与 `--name value` 同为合法写法：工具链内两种写法并存
    //（shop 文档用 `--match=500`、其余命令用空格形态），只认一种会让另一种
    // 静默落进位置参数被忽略 —— 参数没生效却照常出结果。
    const eq = /^--([a-z][a-z0-9-]*)=(.*)$/i.exec(a);
    if (eq) {
      flags.set(eq[1], eq[2]);
      continue;
    }
    const m = /^--([a-z][a-z0-9-]*)$/i.exec(a);
    if (m) {
      if (valuedSet.has(m[1])) {
        flags.set(m[1], requireValue(argv, i + 1, m[1]));
        i++;
      } else {
        flags.set(m[1], '');
      }
      continue;
    }
    rest.push(a);
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
