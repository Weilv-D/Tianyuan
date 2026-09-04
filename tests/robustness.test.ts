import { describe, expect, it } from 'vitest';
import { createUnit as createBattleUnit, createMinion } from '../src/core/unit';
import { TRAITS } from '../src/data/traits';
import { autoArrange } from '../src/game/arrange';
import { boardIdx, createUnit, powerScore, recallUnit } from '../src/game/state';
const createCoreUnit = createBattleUnit;
import { makePlayer, mkBattle, unitInput } from './helpers';
import { Rng } from '../src/core/rng';
import { CHAMPIONS, CHAMPION_BY_ID, formatSkillDesc } from '../src/data/champions';
import { generateBeastBoard } from '../src/game/beast';
import { autoPlace } from '../src/game/comp';
import { CardPool } from '../src/game/pool';
import { Match } from '../src/game/match';

describe('损坏输入与极端阵容', () => {
  it('自动站位在棋盘满员时截断而不是冻结或重叠', () => {
    const ids = Array.from({ length: 33 }, (_, index) => CHAMPIONS[index % CHAMPIONS.length].id);
    const placed = autoPlace(ids, 1);
    const cells = new Set([...placed.values()].map((cell) => `${cell.c},${cell.r}`));
    expect(placed.size).toBe(32);
    expect(cells.size).toBe(32);
  });

  it('非法星级和损坏卡池不会生成无效资源', () => {
    const input = { uid: 1, defId: 'ajiu', team: 0 as const, cell: { c: 0, r: 0 } };
    expect(() => createCoreUnit({ ...input, star: 0 as never })).toThrow();
    expect(() => createCoreUnit({ ...input, star: Number.NaN as never })).toThrow();
    // 数值入口：NaN/Infinity 穿过 `??` 合并会写进面板并沿伤害链静默传播，
    // 必须在 createUnit 边界终止（fail loud）
    expect(() => createCoreUnit({ ...input, star: 1, powMult: Number.NaN })).toThrow();
    expect(() => createCoreUnit({ ...input, star: 1, bonus: { hp: Number.NaN } })).toThrow();
    expect(() => createCoreUnit({ ...input, star: 1, bonus: { atk: Number.POSITIVE_INFINITY } })).toThrow();

    const pool = new CardPool();
    const full = pool.snapshot();
    // 脏键逐键清洗（v3.1 口径）：负数钳 0、未知 id 丢弃，其余未损坏的键
    // 按档保留 —— 整池重置会让一张坏键把全池膨胀回满池（凭空造卡）
    pool.restore({ ajiu: -1, __unknown__: 3 });
    const washed = pool.snapshot();
    expect(washed.ajiu).toBe(0);
    expect(washed.__unknown__).toBeUndefined();
    for (const [k, v] of Object.entries(full)) {
      if (k === 'ajiu' || k === '__unknown__') continue;
      expect(washed[k], k).toBe(v);
    }

    // 超池容钳到满池，不产生超额资源
    pool.restore({ ...full, ajiu: full.ajiu + 1 });
    expect(pool.snapshot()).toEqual(full);
  });

  it('自动布阵允许同名多张上场（1.9.1 同名放开）：distinct 优先、余位补重复、不撤玩家堆场', () => {
    const player = makePlayer({ level: 5 });
    // 同一张名字 3 份（模拟同名堆场）+ 两张其他名
    const ids = ['pan', 'pan', 'pan', 'ajiu', 'ajiu'];
    ids.forEach((defId, index) => {
      const unit = createUnit(defId);
      if (index < 3) player.board[boardIdx(index, 0)] = unit;
      else player.bench[index - 3] = unit;
    });
    autoArrange(player, new CardPool());
    const onBoard = player.board.filter(Boolean) as ReturnType<typeof createUnit>[];
    // 3 张 pan 全部保留在盘/席（不被撤下或卖出），且人口允许时同名可同场
    const panOnBoard = onBoard.filter((u) => u.defId === 'pan').length;
    expect(onBoard.length).toBeGreaterThan(0);
    const totalPan = [...player.board, ...player.bench].filter((u) => u?.defId === 'pan').length;
    expect(totalPan).toBe(3);
    // 5 张全数保留（level 5 人口 8 + 席 9 > 5，不应有任何卖出）
    const totalAll = [...player.board, ...player.bench].filter(Boolean).length;
    expect(totalAll).toBe(5);
    expect(panOnBoard).toBeGreaterThanOrEqual(1);
  });

  it('三星四费「登峰」：数值 ×1.15（无机制包），墨兽 3★ 四费不享受', () => {
    // 选一个带法强的四费（sp>0），否则 sp 比例是 0/0
    const base4 = CHAMPIONS.find((c) => c.cost === 4 && c.base.sp > 0)!;
    const mk = (star: 1 | 2 | 3) =>
      createBattleUnit({ uid: 1, defId: base4.id, team: 0, star, cell: { c: 0, r: 6 } });
    const two = mk(2);
    const three = mk(3);
    // 星级倍率 1.8→3.24 / 1.45→2.1 之上，3★ 再乘 1.15。
    // 面板是整数（Math.round 取整），低基数下比例偏差可达 ~0.01 —— 容差取 1 位小数
    expect(three.maxHp / two.maxHp).toBeCloseTo((3.24 / 1.8) * 1.15, 1);
    expect(three.atk / two.atk).toBeCloseTo((2.1 / 1.45) * 1.15, 1);
    expect(three.sp / two.sp).toBeCloseTo((2.1 / 1.45) * 1.15, 1);
    // 无天命机制包：无免控（ccImmune 为 0）
    expect(three.ccImmune).toBe(0);
  });

  it('AI 战力估值与结算星级刻度同源：四费 3★ 含登峰 ×1.15、五费 3★ 含天命包', () => {
    const cost4 = CHAMPIONS.find((c) => c.cost === 4)!;
    const cost5 = CHAMPIONS.find((c) => c.cost === 5)!;
    const p2 = powerScore(createUnit(cost4.id, 2));
    const p3 = powerScore(createUnit(cost4.id, 3));
    // 登峰生效参照：星级倍率 2.1/1.45 之上若不再乘 1.15，估值应约为 p3 的 1/1.15。
    // hp 折算项与 range 加分在 3★ 同样被乘区放大，故用整体比率而非逐项复算
    const naive = (p2 - 12) * (2.1 / 1.45) + 18; // 无登峰乘区的对照
    expect(p3 / naive).toBeGreaterThan(1.14); // ≈1.15：登峰乘区计入估值
    expect(p3).toBeGreaterThan(naive);
    // 五费 3★ 天命包：星级 ×2.1 与天命 ×2.0 之上再叠机制包常量 ——
    // 估值相对 1★ 至少 ×4（若漏天命包则只有 ×2.1）
    const q1 = powerScore(createUnit(cost5.id, 1));
    const q3 = powerScore(createUnit(cost5.id, 3));
    expect(q3).toBeGreaterThan(q1 * 4.0);
    expect(q3).toBeGreaterThan(q1 * 2.1 * 2.0 * 0.9); // 机制包 90 使总倍率更高
  });

  it('17 条羁绊的每个档位都可激活（unique 棋子数 ≥ 最高档）', () => {
    for (const trait of TRAITS) {
      const unique = new Set(
        CHAMPIONS.filter((c) => c.origins.includes(trait.id) || c.classes.includes(trait.id)).map((c) => c.id),
      ).size;
      const maxTier = Math.max(...trait.breakpoints);
      expect(unique, `${trait.id} 最高档 ${maxTier} 不可达（仅 ${unique} 名 unique 棋子）`).toBeGreaterThanOrEqual(maxTier);
    }
  });

  it('墨兽阵容在各阶段都按宣告数量实际落地', () => {
    for (let round = 0; round <= 30; round += 3) {
      const board = generateBeastBoard(round, new Rng(1000 + round));
      const expected = round === 1 ? 1 : Math.min(8, 2 + Math.floor(round / 4));
      expect(board.filter(Boolean).length).toBe(round === 0 ? 2 : expected);
    }
  });

  it('自动布阵在同纵深拥挤溢出时不会覆写已落子单位，棋子不丢失', () => {
    const player = makePlayer({ level: 9 });
    // 9 名后排单位（全都是丹师或方士，其 preferred 均为 row 3），单行容量 8
    const backrowDef = CHAMPIONS.find((c) => c.cls === 'support')!.id;
    for (let i = 0; i < 9; i++) {
      player.board[i] = createUnit(backrowDef);
    }
    const pool = new CardPool();
    autoArrange(player, pool);
    const onBoard = player.board.filter(Boolean);
    expect(onBoard.length).toBe(9);
    // 所有 9 名棋子都在棋盘上，没有因为同一行满而互相覆盖丢失
    const total = [...player.board, ...player.bench].filter(Boolean).length;
    expect(total).toBe(9);
  });

  it('recallUnit 严格限制在备战席有效槽位内', () => {
    const player = makePlayer();
    player.board[0] = createUnit('pan');
    // 备战席全满
    for (let i = 0; i < 9; i++) player.bench[i] = createUnit('ajiu');
    expect(recallUnit(player, player.board[0]!.iid)).toBe(false);
    expect(player.board[0]).not.toBeNull();
  });

  it('createUnit 保持 isMinion 输入状态，createMinion 严守有限性校验', () => {
    const baseInput = { uid: 10, defId: 'pan', team: 0 as const, star: 1 as const, cell: { c: 0, r: 0 } };
    const minionUnit = createCoreUnit({ ...baseInput, isMinion: true });
    expect(minionUnit.isMinion).toBe(true);

    const normalUnit = createCoreUnit({ ...baseInput, isMinion: false });
    expect(normalUnit.isMinion).toBe(false);

    expect(() => createMinion(11, normalUnit, { c: 0, r: 1 }, Number.NaN, 0.5)).toThrow();
    expect(() => createMinion(11, normalUnit, { c: 0, r: 1 }, 0.5, Number.POSITIVE_INFINITY)).toThrow();

    const m = createMinion(12, normalUnit, { c: 0, r: 1 }, 0.5, 0.5);
    expect(m.isMinion).toBe(true);
    expect(m.maxHp).toBeGreaterThanOrEqual(1);
    expect(m.atk).toBeGreaterThanOrEqual(1);
  });

  it('技能描述模板化覆盖 falloff 参数（敖姻与禹算）', () => {
    const aoyin = CHAMPION_BY_ID['aoyin'];
    const aoyinDesc = formatSkillDesc(aoyin.skillSpec.desc, aoyin.skillSpec.params);
    expect(aoyinDesc).toContain('每跳衰减 15%');
    expect(aoyinDesc).not.toContain('{falloff}');

    const yusuan = CHAMPION_BY_ID['yusuan'];
    const yusuanDesc = formatSkillDesc(yusuan.skillSpec.desc, yusuan.skillSpec.params);
    expect(yusuanDesc).toContain('每跳衰减 12%');
    expect(yusuanDesc).not.toContain('{falloff}');
  });

  it('Battle.teleport 对越界目标格安全防御', () => {
    const b = mkBattle([unitInput('pan', 0, { c: 0, r: 6 }), unitInput('jingyu', 1, { c: 7, r: 1 })]);
    const u = b.units[0];
    const initialCell = { ...u.cell };
    // 传入越界目标格
    b.teleport(u, { c: -1, r: 10 }, 0.5);
    // 坐标未变（安全取消），没有抛出异常或破坏占位表
    expect(u.cell).toEqual(initialCell);
  });

  it('Match.fromJSON 对损坏的玩家数值和非法阶段抛错防御', () => {
    const match = new Match(12345, '测试');
    match.beginRound();
    const json = match.toJSON();

    // 损坏玩家 gold
    const badGoldJson = JSON.parse(JSON.stringify(json));
    badGoldJson.players[0].gold = Number.NaN;
    expect(() => Match.fromJSON(badGoldJson)).toThrow();

    // 损坏 round
    const badRoundJson = JSON.parse(JSON.stringify(json));
    badRoundJson.round = -1;
    expect(() => Match.fromJSON(badRoundJson)).toThrow();
  });
});
