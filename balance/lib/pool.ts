/**
 * fork 进程池 —— 框架的算力层（32 核机器上矩阵扫描从分钟级压到秒级）。
 *
 * 为什么是进程池而不是 GPU / worker_threads（决策记录全文见 balance/README.md）：
 *  - 战斗内核是分支密集的 TS（技能/羁绊/装备钩子事件流），移植 WGSL 等于
 *    维护第二套引擎，必然漂移 —— 违反「单一真源」纪律，否决；
 *  - Node WebGPU 处于实验态且 Windows 无头驱动不可靠，否决；
 *  - worker_threads 与 tsx 加载器组合实测不识别 .ts（实验记录在案），fork 子进程
 *    经 ['--import','tsx'] 独立加载 TS，实测可用；
 *  - 平衡模拟的并行轴本来就是「局与局独立」的数据并行 —— 进程池吃满全部
 *    物理核即已饱和，GPU 在此形态下没有额外增益空间。
 *
 * 两类作业：
 *  - pair：一个 (配置覆盖, 配对方向) 跑 n 局（矩阵/sweep/ab/traits 用）；
 *  - item：一个 (装备组合, 配对) 的带装-裸装 CRN 配对（装备维 items 用）。
 */
import { fork, type ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { PairRun } from './engine';
import type { Overrides } from './patch';
import type { CompSpec } from '../../src/game/comp';

export interface PairJob {
  kind: 'pair';
  configIdx: number;
  i: number;
  j: number;
  n: number;
  seedBase: number;
  overrides: Overrides;
}

export interface ItemJob {
  kind: 'item';
  /** 结果归拢键（装备 id 或 stack:2 / mix:3 这类曲线档键） */
  itemKey: string;
  items: string[];
  i: number;
  j: number;
  n: number;
  seedBase: number;
}

export type PoolJob = PairJob | ItemJob;

export interface PairResult extends PairRun {
  kind: 'pair';
  configIdx: number;
  i: number;
  j: number;
}

export interface ItemResult {
  kind: 'item';
  itemKey: string;
  i: number;
  j: number;
  diff: number;
  withRate: number;
  withoutRate: number;
}

export type PoolResult = PairResult | ItemResult;

const CHILD_URL = new URL('./poolChild.ts', import.meta.url);

/** 默认并行度：留 2 个核给系统与父进程聚合。上限 32（更多进程只会抢内存） */
export function defaultWorkers(): number {
  return Math.max(1, Math.min(32, availableParallelism() - 2));
}

/**
 * 把工作单元分发到 N 个 fork 子进程，按完成序收拢、按提交序返回。
 * workers=1 时退化为单子进程（调试口径）；零进程串行路径在各命令里
 * 走 withOverrides / 直接调用 engine，与池子结果的逐位一致由 selftest 断言。
 */
export function runPool(
  jobs: readonly PoolJob[],
  opts: { comps: readonly CompSpec[]; workers: number; onProgress?: (done: number, total: number) => void },
): Promise<PoolResult[]> {
  const { comps, onProgress } = opts;
  if (jobs.length === 0) return Promise.resolve([]);
  const workerCount = Math.max(1, Math.min(opts.workers, jobs.length));
  const results: (PoolResult | undefined)[] = new Array(jobs.length);
  const ordered = jobs.map((job, idx) => ({ job, idx }));
  let next = 0;
  let done = 0;

  return new Promise((resolve, reject) => {
    const children: ChildProcess[] = [];
    let settled = false;
    const killAll = (): void => {
      for (const p of children) p.kill();
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      for (const p of children) p.send({ type: 'shutdown' });
      // 兜底强杀：shutdown 消息丢失时别让命令挂住（unref 不阻塞进程退出）
      const t = setTimeout(killAll, 2000);
      t.unref?.();
      resolve(results as PoolResult[]);
    };
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      killAll();
      reject(err);
    };

    const dispatch = (proc: ChildProcess): void => {
      if (settled) return;
      const item = ordered[next++];
      if (!item) {
        if (done === jobs.length) finish();
        return;
      }
      const { job, idx } = item;
      proc.send({ type: 'job', ...job });
      proc.once('message', (msg: Record<string, unknown> & { type: string }) => {
        if (settled) return;
        if (msg.type === 'error') {
          fail(new Error(`池子作业失败 (${String(msg.itemKey ?? msg.configIdx)} pair ${String(msg.i)}v${String(msg.j)})：${String(msg.message)}`));
          return;
        }
        if (msg.type !== 'result') return;
        if (msg.kind === 'item') {
          results[idx] = {
            kind: 'item', itemKey: String(msg.itemKey), i: Number(msg.i), j: Number(msg.j),
            diff: Number(msg.diff), withRate: Number(msg.withRate), withoutRate: Number(msg.withoutRate),
          };
        } else {
          results[idx] = {
            kind: 'pair', configIdx: Number(msg.configIdx), i: Number(msg.i), j: Number(msg.j),
            n: Number(msg.n), topWins: Number(msg.topWins), bottomWins: Number(msg.bottomWins), draws: Number(msg.draws),
            totalTicks: Number(msg.totalTicks), timeouts: Number(msg.timeouts),
            top: (msg.top as PairRun['top']) ?? [], bottom: (msg.bottom as PairRun['bottom']) ?? [],
          };
        }
        done += 1;
        onProgress?.(done, jobs.length);
        dispatch(proc);
      });
    };

    for (let w = 0; w < workerCount; w++) {
      const proc = fork(fileURLToPath(CHILD_URL), [], {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        cwd: process.cwd(),
      });
      children.push(proc);
      proc.on('error', fail);
      proc.on('exit', (code) => {
        if (!settled && code !== 0 && code !== null) fail(new Error(`池子子进程异常退出（code ${code}）`));
      });
      proc.once('message', (msg: { type: string }) => {
        if (msg.type !== 'ready') return;
        dispatch(proc);
      });
      // 每个作业自携带种子基（pair = CRN 矩阵口径，item = 装备配对口径，本就不同源）
      proc.send({ type: 'init', comps });
    }
  });
}
