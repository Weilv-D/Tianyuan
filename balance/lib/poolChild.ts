/**
 * 进程池子进程入口。
 *
 * 通过 node:child_process.fork 拉起（execArgv 固定 ['--import','tsx']，与父进程
 * 处于 tsx CLI 还是 vitest 无关 —— 子进程独立经 tsx 加载 TS 源码，这正是
 * 「工具与游戏分离」的一部分：池子加载的是 src 的只读副本，任何补丁只落在
 * 子进程自己的模块实例上，跑完即弃，游戏侧零影响）。
 *
 * 协议（IPC 消息）：
 *   父 → 子 {type:'init', comps}                          初始化阵容表（必首条）
 *   父 → 子 {type:'job', kind:'pair', ...}                (配置,配对) 工作单元
 *   父 → 子 {type:'job', kind:'item', ...}                (装备组合,配对) 配对单元
 *   子 → 父 {type:'ready'}                                初始化完成
 *   子 → 父 {type:'result', kind:'pair'|'item', ...}      执行结果
 *   子 → 父 {type:'error', ..., message}                  作业失败（非法补丁等）
 *   父 → 子 {type:'shutdown'}                             退出
 *
 * 补丁管理：pair 作业按 overrides 的 JSON 键切换 —— 与上一个 job 相同则复用，
 * 不同则 reset 后重打（item 作业无补丁）。battle 种子是纯函数，与进程/调度无关，
 * 因此「并行结果 === 串行结果」由构造保证，并由 selftest 的逐位一致断言守护。
 */
import { pairedItemsDelta, runPair, type PairRun } from './engine';
import { Patcher, type Overrides } from './patch';
import type { CompSpec } from '../../src/game/comp';

interface InitMsg {
  type: 'init';
  comps: CompSpec[];
}
interface PairJobMsg {
  type: 'job';
  kind: 'pair';
  configIdx: number;
  i: number;
  j: number;
  n: number;
  seedBase: number;
  overrides: Overrides;
}
interface ItemJobMsg {
  type: 'job';
  kind: 'item';
  itemKey: string;
  items: string[];
  i: number;
  j: number;
  n: number;
  seedBase: number;
}
type InMsg = InitMsg | PairJobMsg | ItemJobMsg | { type: 'shutdown' };

if (!process.send) throw new Error('poolChild 必须经 fork 拉起（无 IPC 通道）');

let comps: readonly CompSpec[] = [];
let currentKey = '{}';
const patcher = new Patcher();

function ensureOverrides(ov: Overrides): void {
  const key = JSON.stringify(ov);
  if (key === currentKey) return;
  patcher.reset();
  if (Object.keys(ov).length > 0) patcher.apply(ov);
  currentKey = key;
}

process.on('message', (msg: InMsg) => {
  if (msg.type === 'init') {
    comps = msg.comps;
    process.send!({ type: 'ready' });
    return;
  }
  if (msg.type === 'job' && msg.kind === 'pair') {
    let run: PairRun;
    try {
      ensureOverrides(msg.overrides);
      run = runPair(msg.i, msg.j, msg.n, msg.seedBase, comps);
    } catch (err) {
      process.send!({ type: 'error', kind: 'pair', configIdx: msg.configIdx, i: msg.i, j: msg.j, message: err instanceof Error ? err.message : String(err) });
      return;
    }
    process.send!({ type: 'result', kind: 'pair', configIdx: msg.configIdx, i: msg.i, j: msg.j, ...run });
    return;
  }
  if (msg.type === 'job' && msg.kind === 'item') {
    try {
      const d = pairedItemsDelta(msg.i, msg.j, msg.items, msg.n, msg.seedBase, comps);
      process.send!({ type: 'result', kind: 'item', itemKey: msg.itemKey, i: msg.i, j: msg.j, ...d });
    } catch (err) {
      process.send!({ type: 'error', kind: 'item', itemKey: msg.itemKey, i: msg.i, j: msg.j, message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (msg.type === 'shutdown') {
    patcher.reset();
    process.exit(0);
  }
});

process.on('disconnect', () => {
  patcher.reset();
  process.exit(0);
});
