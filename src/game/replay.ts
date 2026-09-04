/**
 * 回放（M4）· 契约与校验。
 *
 * 每场战斗在结算时记录 BattleSnapshot（种子 + 双方完整配置 + 结果指纹），
 * 随存档持久化（保留窗口 BATTLE_SNAPSHOT_KEEP，超窗裁最旧 —— 载荷有界）；
 * verifyReplay 用同一种子与配置重跑战斗，逐字节比对事件流。
 *
 * 摘要口径：eventsDigest = 事件流 JSON 的同步字符串指纹（FNV-1a 十六进制，
 * 实现于本文件 —— 必须同步可算，禁止 crypto.subtle 等异步源），
 * 仅在战斗以 recordEvents=true 运行时记录；无头批量模拟（recordEvents=false）记 ''，
 * 校验时跳过摘要位、只比 winner / ticks。
 *
 * 摘要的计算方式（录制方与校验方必须一致）：
 *   fnv1aHex(JSON.stringify(battle.events))
 * 其中 battle.events 是 run() 结束后的完整事件流（含 start 与 end）。
 */
import type { BattleConfig } from '../core/types';
import { Battle } from '../core/battle';

export interface BattleSnapshot {
  /** 对局回合号（奇遇/墨兽/普通轮通吃） */
  round: number;
  /** 传入 Battle 的完整配置（含 seed、双方 units 与 traits），回放按原样重跑 */
  config: BattleConfig;
  winner: 0 | 1 | null;
  ticks: number;
  /** 事件流 JSON 的 FNV-1a 十六进制指纹；'' = 未记录事件流 */
  eventsDigest: string;
}

export interface ReplayReport {
  checked: number;
  failed: number;
  failures: { round: number; field: 'winner' | 'ticks' | 'eventsDigest' }[];
}

// ───────────────── FNV-1a 32 位同步指纹 ─────────────────

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32 位哈希，输出 8 位小写十六进制（空串 = offset basis「811c9dc5」）。
 *
 * 口径：输入按 UTF-8 字节流逐字节哈希 —— 与 FNV-1a 标准测试向量一致
 * （'' → 811c9dc5、'a' → e40c292c、'foobar' → bf9cf968）。TextEncoder 同步可算、
 * 输出由规范钉死，任何环境结果一致；不依赖 crypto.subtle 等异步源。
 * 录制方与校验方都必须走本函数 —— 它是全项目唯一定义点。
 */
const UTF8 = new TextEncoder();

export function fnv1aHex(s: string): string {
  let h = FNV_OFFSET_BASIS;
  for (const b of UTF8.encode(s)) {
    h = Math.imul(h ^ b, FNV_PRIME);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ───────────────── 校验 ─────────────────

/**
 * 对快照逐条重跑战斗并比对；返回全部不一致项。
 *
 * 规则：
 * - 重跑 = `new Battle(snap.config, null, snap.eventsDigest !== '')` 后 run()。
 *   eventsDigest 非 '' 才记录事件流并比对摘要；'' 为无头批量模拟的快照，
 *   跳过摘要位、只比 winner / ticks。
 * - 一条快照可以产生多个 failure（winner / ticks / eventsDigest 各查各的）。
 * - 纯同步、无 I/O；只读快照，不修改任何字段（Battle 构造器对 config
 *   只做只读展开 —— createUnit / applyTraits 均不写输入，重跑不改快照）。
 * - config 无法构造或重跑中途抛错（如棋子 id 不存在）：该快照的所有比对位
 *   记为不一致，不让单条坏档炸掉整批校验。
 */
export function verifyReplay(snapshots: BattleSnapshot[]): ReplayReport {
  const failures: ReplayReport['failures'] = [];
  let checked = 0;
  for (const snap of snapshots) {
    checked++;
    const record = snap.eventsDigest !== '';
    let winner: number | null | undefined;
    let ticks: number | undefined;
    let digest: string | undefined;
    try {
      const battle = new Battle(snap.config, null, record);
      const result = battle.run();
      winner = result.winner;
      ticks = result.ticks;
      if (record) digest = fnv1aHex(JSON.stringify(battle.events));
    } catch {
      // 构造 / 重跑失败：winner 与 ticks 保持 undefined（必然不一致），
      // digest 保持 undefined —— 若要求摘要位，同样记为不一致
    }
    if (snap.winner !== winner) failures.push({ round: snap.round, field: 'winner' });
    if (snap.ticks !== ticks) failures.push({ round: snap.round, field: 'ticks' });
    if (record && digest !== snap.eventsDigest) {
      failures.push({ round: snap.round, field: 'eventsDigest' });
    }
  }
  return { checked, failed: failures.length, failures };
}
