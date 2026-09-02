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

/** 单个作业的硬超时：任何 (配置,配对) 作业都不该跑超过 120s —— 超过即视为子进程
 *  挂死（死循环 / 引擎异常空转），整池失败并给出定位信息，而不是永久等待。 */
const JOB_TIMEOUT_MS = 120_000;
/** 子进程初始化硬超时：fork 到 ready 之间只有 tsx 加载 + 阵容装载，正常 ≤ 数秒。
 *  loader 失败 / 导入抛错 / Windows 下 fork 启动异常都可能让子进程既不回 ready
 *  也不退出 —— 不给这一阶段上钟，父进程会永远等 dispatch，命令挂死。 */
const INIT_TIMEOUT_MS = 30_000;

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
    /** 正在执行作业的子进程（用于识别"作业中途退出"——code 0 的正常退出只发生在
     *  shutdown 之后；作业未回就先退出说明子进程异常死亡，必须整池失败而不是
     *  挂住它的队列）。 */
    const busy = new Set<ChildProcess>();
    let settled = false;
    // 全体待清定时器：settled（finish/fail）后一律清掉，不让超时/兜底句柄空转到自然触发
    const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
    const trackTimer = (t: ReturnType<typeof setTimeout>): void => {
      pendingTimers.add(t);
      t.unref?.();
    };
    const clearAllTimers = (): void => {
      for (const t of pendingTimers) clearTimeout(t);
      pendingTimers.clear();
    };
    const killAll = (): void => {
      for (const p of children) p.kill();
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearAllTimers();
      for (const p of children) p.send({ type: 'shutdown' });
      // 兜底强杀：shutdown 消息丢失时别让命令挂住（unref 不阻塞进程退出）
      const t = setTimeout(killAll, 2000);
      t.unref?.();
      resolve(results as PoolResult[]);
    };
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      clearAllTimers();
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
      busy.add(proc);
      proc.send({ type: 'job', ...job });
      // 每作业超时：子进程若在作业中途挂死（异常退出被 exit 监听捕获 → fail；
      // 死循环 / IPC 静默丢失则靠本定时器兜底），不让命令永久挂起。
      const timer = setTimeout(() => {
        if (settled) return;
        const kind = job.kind === 'item' ? `item ${String(job.itemKey)}` : `pair ${job.configIdx} ${job.i}v${job.j}`;
        fail(new Error(`池子作业超时（>${JOB_TIMEOUT_MS / 1000}s）：${kind}`));
      }, JOB_TIMEOUT_MS);
      trackTimer(timer);
      proc.once('message', (msg: Record<string, unknown> & { type: string }) => {
        clearTimeout(timer);
        pendingTimers.delete(timer);
        busy.delete(proc);
        if (settled) return;
        if (msg.type === 'error') {
          fail(new Error(`池子作业失败 (${String(msg.itemKey ?? msg.configIdx)} pair ${String(msg.i)}v${String(msg.j)})：${String(msg.message)}`));
          return;
        }
        if (msg.type !== 'result') { dispatch(proc); return; }
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
        try { onProgress?.(done, jobs.length); } catch { /* progress 回调不该中断分发 */ }
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
      // fork → ready 阶段上钟：超时即整池失败，防止 tsx 加载/启动卡死挂住命令。
      // 声明必须先于 error/exit/message 监听 —— fork 同步抛错时这些监听会立刻
      // 触发，若 initTimer 仍在 TDZ（let 声明在后）会先抛 ReferenceError，
      // 把"子进程启动失败"的真实错误掩盖成更隐蔽的崩溃（Windows spawn 失败路径）。
      let initTimer: ReturnType<typeof setTimeout> | null = null;
      const startInitTimer = (): void => {
        initTimer = setTimeout(() => {
          if (settled) return;
          fail(new Error(`池子子进程初始化超时（>${INIT_TIMEOUT_MS / 1000}s，fork 后未回 ready）`));
        }, INIT_TIMEOUT_MS);
        trackTimer(initTimer);
      };
      const clearInitTimer = (): void => {
        if (initTimer !== null) {
          clearTimeout(initTimer);
          pendingTimers.delete(initTimer);
          initTimer = null;
        }
      };
      proc.on('error', (err) => {
        clearInitTimer();
        fail(err);
      });
      proc.on('exit', (code) => {
        clearInitTimer();
        if (settled) return;
        // 作业未回就退出 = 子进程异常死亡：code 0 的正常退出只发生在 shutdown /
        // disconnect 之后，作业中途 code 0 同样异常（如子进程自己 process.exit）。
        // 此时若不失败，该 worker 队列上未完成作业会永远挂住 —— 见 dispatch 超时
        if (busy.has(proc) || code !== 0) {
          fail(new Error(`池子子进程异常退出（code ${String(code)}${busy.has(proc) ? '，作业中途' : ''}）`));
        }
      });
      proc.once('message', (msg: { type: string }) => {
        if (msg.type !== 'ready') return;
        clearInitTimer();
        dispatch(proc);
      });
      // 每个作业自携带种子基（pair = CRN 矩阵口径，item = 装备配对口径，本就不同源）
      proc.send({ type: 'init', comps });
      startInitTimer();
    }
  });
}
