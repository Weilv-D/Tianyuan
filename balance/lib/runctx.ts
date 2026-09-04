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
