import type { Cell, DamageType, Star, TeamId } from './types';

/**
 * 战斗事件流 —— 逻辑层与渲染层之间**唯一**的接口。
 *
 * 内核只负责产出带 tick 时间戳的事件，完全不知道像素、补间、音效的存在。
 * 渲染层（或回放器、录制器、平衡分析器）消费同一条流。
 * 这样保证了：无头模拟 === 画面表现，且战斗可被完整录制回放。
 */
export type BattleEvent =
  /** 战斗开始：所有单位就位 */
  | { t: 'start'; tick: number; units: SpawnInfo[] }
  /** 吟唱起手：单位满蓝，开始读条（渲染层播"蓄力预兆"） */
  | { t: 'castStart'; tick: number; uid: number; skillId: string; windup: number }
  /** 技能生效：特效主体 + 命中判定的那一刻 */
  | { t: 'cast'; tick: number; uid: number; skillId: string; targetUid?: number; cell?: Cell; params?: Record<string, number> }
  /** 攻击前摇开始（渲染层播挥砍预备动作） */
  | { t: 'attackStart'; tick: number; uid: number; targetUid: number; windup: number; isRanged: boolean }
  /** 远程弹道生成 */
  | { t: 'projectile'; tick: number; uid: number; targetUid: number; from: Cell; to: Cell; dur: number; kind: 'arrow' | 'bolt' | 'orb' }
  /** 伤害结算（前摇结束 / 弹道命中那一刻） */
  | { t: 'damage'; tick: number; srcUid: number; dstUid: number; amount: number; type: DamageType; crit: boolean; kill: boolean; source: 'attack' | 'skill' | 'dot' | 'trait' | 'item' }
  /** 治疗 */
  | { t: 'heal'; tick: number; srcUid: number; dstUid: number; amount: number }
  /** 法力变化：攻击回蓝 / 施法清空 / 羁绊回蓝 */
  | { t: 'mana'; tick: number; uid: number; mp: number; maxMp: number }
  /** 护盾变化 */
  | { t: 'shield'; tick: number; uid: number; amount: number; total: number }
  /** 单位移动（渲染层用 dur 做插值，得到"步伐感"） */
  | { t: 'move'; tick: number; uid: number; from: Cell; to: Cell; dur: number }
  /** 位移类技能（突进 / 击退） */
  | { t: 'blink'; tick: number; uid: number; from: Cell; to: Cell; dur: number }
  /** 状态施加 / 移除。src = 叠层来源标识（addStatus 的 srcTag），仅供回放/分析
   *  归因；未打标的条目为 undefined（外来层，不参与任何 maxStacks 计数） */
  | { t: 'status'; tick: number; uid: number; kind: string; dur: number; value: number; added: boolean; src?: string }
  /** 死亡退场 */
  | { t: 'death'; tick: number; uid: number; killerUid: number }
  /** 纯粹的表现层特效（不携带逻辑结果） */
  | { t: 'fx'; tick: number; kind: FxKind; uid?: number; cell?: Cell; targetUid?: number; radius?: number; team?: TeamId; params?: Record<string, number> }
  /** 战斗结束 */
  | { t: 'end'; tick: number; winner: TeamId | null; timeout: boolean };

export interface SpawnInfo {
  uid: number;
  defId: string;
  team: TeamId;
  star: Star;
  cell: Cell;
  maxHp: number;
  hp: number;
}

/** 表现层特效种类。渲染层按种类走不同的"墨迹语言"。 */
export type FxKind =
  | 'slash' // 斩击弧
  | 'pierce' // 突刺
  | 'impact' // 命中爆点
  | 'castRing' // 蓄力法阵
  | 'burst' // 范围爆发
  | 'beam' // 光束
  | 'nova' // 环爆
  | 'healWave' // 治疗波纹
  | 'shieldWall' // 护盾壁
  | 'dashTrail' // 突进残影
  | 'summon' // 召唤
  | 'buffAura' // 增益光环
  | 'debuffMark' // 减益印记
  | 'burnTick' // 灼烧跳
  | 'bleedTick' // 流血跳
  | 'groundMark'; // 地面法阵（持续）

/** 事件消费者 */
export type EventSink = (e: BattleEvent) => void;
