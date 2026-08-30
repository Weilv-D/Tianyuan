/**
 * 确定性伪随机数发生器 (mulberry32)。
 *
 * 战斗内核的**唯一**随机源。任何需要随机的逻辑都必须从这里取数，
 * 禁止使用 Math.random()，否则战斗结果不可复现、平衡模拟失去意义。
 *
 * 设计要点：
 * - 状态只有一个 uint32，可完整序列化 / 快照 / 回滚
 * - 跨平台位运算一致（全部 >>> 0 / | 0），不存在浮点差异导致的漂移
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [min, max] 整数 */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  /** [0, n) 整数 */
  intn(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.intn(arr.length)];
  }

  /** Fisher-Yates，原地洗牌 */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.intn(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * 不放回抽 n 个。用于商店 / 掉落池。
   * 权重数组与候选数组等长。
   */
  sampleWeighted<T>(items: readonly T[], weights: readonly number[], n: number): T[] {
    const pool = items.slice();
    const w = weights.slice();
    const out: T[] = [];
    const count = Math.min(n, pool.length);
    for (let k = 0; k < count; k++) {
      let total = 0;
      for (let i = 0; i < w.length; i++) total += w[i];
      let roll = this.next() * total;
      let chosen = w.length - 1;
      for (let i = 0; i < w.length; i++) {
        roll -= w[i];
        if (roll <= 0) {
          chosen = i;
          break;
        }
      }
      out.push(pool[chosen]);
      pool.splice(chosen, 1);
      w.splice(chosen, 1);
    }
    return out;
  }

  clone(): Rng {
    return new Rng(this.s);
  }

  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = v >>> 0;
  }
}

/** 由字符串生成稳定种子（对战 ID、房间号等） */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 快速非加密哈希，用于校验战斗事件流是否一致 */
export function hashNumbers(nums: readonly number[]): number {
  let h = 17 >>> 0;
  for (let i = 0; i < nums.length; i++) {
    h = (h * 31 + (nums[i] | 0)) >>> 0;
  }
  return h >>> 0;
}
