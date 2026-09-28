/** 核心命令的公共旗标解析：--seed/--workers/--serial/--comps/--no-save + 位置参数 n。 */
import { parseArgs, requirePositiveInt } from './args';
import { loadComps } from './comps';
import { defaultWorkers, WORKERS_CAP } from './pool';
import { DEFAULT_SEED_BASE } from './seeds';
import type { CompSpec } from '../../src/game/comp';

export interface RunCtx {
  comps: CompSpec[];
  compsSource: string;
  n: number;
  seedBase: number;
  /** 0 = 串行；≥1 = fork 池并行度 */
  workers: number;
  save: boolean;
}

export function runCtx(argv: readonly string[], defaultN: number): RunCtx {
  const { flags, rest } = parseArgs(argv, ['seed', 'workers', 'comps']);
  // 只允许一个位置参数（每对局数）。多出来的位置参数必是**没被解析的旗标残值**：
  // npm 会把 `npm run balance -- matrix 200 --seed 7` 的 `--seed` 当自己的配置吃掉，
  // 只把值 `7` 透给脚本 —— 结果 argv 变成 ['200','7']。若这里静默取 rest[0]，
  // 命令会以默认种子跑完并打印断面，读数与用户指定的种子无关却看不出异常。
  // 明确拒绝并指出正确写法，是这条链路上唯一能把「参数没生效」暴露出来的地方。
  if (rest.length > 1) {
    throw new Error(
      `多余的位置参数：${rest.slice(1).join(' ')}\n` +
        `  经 npm 传旗标必须写第二个 --：npm run balance -- -- <command> [旗标]\n` +
        `  直接调用可省略 npm 层：node --import tsx balance/cli.ts <command> [旗标]`,
    );
  }
  const { comps, source, warnings } = loadComps(flags.get('comps'));
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  return {
    comps,
    compsSource: source,
    n: requirePositiveInt(rest[0], '每对局数', defaultN),
    seedBase: requirePositiveInt(flags.get('seed'), '种子基', DEFAULT_SEED_BASE),
    workers: flags.has('serial') ? 0 : Math.min(requirePositiveInt(flags.get('workers'), '并行度', defaultWorkers()), WORKERS_CAP),
    save: !flags.has('no-save'),
  };
}
