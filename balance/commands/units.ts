/**
 * 单位榜 —— 「棋子维」的读数面：把最近一次 matrix/sweep 入库的逐单位统计拉出来。
 *
 * 回答的问题：哪颗棋子在它的阵容里贡献垫底？谁的承伤/吸收异常？伤害构成
 * 是否符合职业定位（武将该物理为主、方士该法术为主）？召唤物桶的占比？
 *
 * 用法：balance units [--run <id>] [--label 基准（无覆盖）] [--sort dealt|taken] [--comps f.json]
 *   --run 缺省取库里最近一次有单位数据的 run；--label 选 sweep 里的某个配置。
 */
import { PRESET_COMPS, type CompSpec } from '../../src/game/comp';
import { loadComps } from '../lib/comps';
import { printUnitBoard } from '../lib/report';
import { Store } from '../lib/store';

export async function run(argv: string[]): Promise<void> {
  const runIdx = argv.indexOf('--run');
  const labelIdx = argv.indexOf('--label');
  const sortIdx = argv.indexOf('--sort');
  const compsIdx = argv.indexOf('--comps');
  const label = labelIdx >= 0 ? argv[labelIdx + 1] : '基准（无覆盖）';
  const sort = sortIdx >= 0 && argv[sortIdx + 1] === 'taken' ? 'taken' : 'dealt';
  let comps: CompSpec[] = [...PRESET_COMPS];
  if (compsIdx >= 0) {
    // 走 loadComps 统一校验（棋子存在/星级合法），裸 JSON.parse 会在排行打印时
    // 才以 undefined.name 崩出来，或静默错位
    comps = loadComps(argv[compsIdx + 1]).comps;
  }

  const store = new Store();
  try {
    let runId: number | null = runIdx >= 0 ? Number(argv[runIdx + 1]) : null;
    // 显式传 --run 而解析失败 → 立即抛错：静默回落「最近一次 run」会让用户
    // 看着别人的断面而不自知（与 loadComps 引用不存在即抛的 fail-fast 同口径）
    if (runIdx >= 0 && (runId === null || !Number.isInteger(runId))) {
      throw new Error(`--run 需要整数 run id，收到：${argv[runIdx + 1] ?? '（缺值）'}`);
    }
    if (runId === null) {
      // 最近一次有 unit 数据的 matrix/sweep run
      for (const r of store.recentRuns(null, 30)) {
        if (r.command !== 'matrix' && r.command !== 'sweep') continue;
        runId = r.id;
        break;
      }
    }
    if (runId === null) throw new Error('库里没有可用的 matrix/sweep run —— 先跑 balance matrix');

    const rows = store.unitRows(runId, label);
    if (rows.length === 0) {
      throw new Error(`run #${runId} 里没有配置「${label}」的单位数据（sweep 的轴配置标签形如 trait.xxx.scale=0）`);
    }
    const meta = store.runById(runId);
    console.log(`═════════ 百战天元 · 单位榜 ═════════`);
    console.log(`run #${runId}${meta ? `（v${meta.game_version} · ${meta.command} · ${meta.started_at.slice(0, 10)}）` : ''}  配置「${label}」  ${rows.length} 行\n`);
    printUnitBoard(comps, rows, sort);
  } finally {
    store.close();
  }
}
