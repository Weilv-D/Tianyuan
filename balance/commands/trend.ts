/**
 * 跨版本趋势 —— SQLite 工件库的查询面（数据库存在的第一理由）。
 *
 * 旧形态（sweep-out/*.json 散落文件）回答不了的问题，在这里一句查询：
 *  - 这版到下版，九套阵容的胜率各自移动了多少？
 *  - 极差（平衡断面）随版本是收敛还是发散？
 *
 * 用法：balance trend [k] [--command matrix|sweep]   （k = 看最近几次 run，默认 8）
 */
import { Store } from '../lib/store';
import { requirePositiveInt } from '../lib/args';

interface Summary {
  comps?: string[];
  winRate?: number[];
  spread?: number;
  meanBottom?: number;
}

export async function run(argv: string[]): Promise<void> {
  const cmdIdx = argv.indexOf('--command');
  const command = cmdIdx >= 0 ? (argv[cmdIdx + 1] ?? 'matrix') : 'matrix';
  const posN = argv.find((a) => !a.startsWith('--') && /^\d+$/.test(a));
  const k = requirePositiveInt(posN, '次数', 8);

  const store = new Store();
  try {
    const runs = store.recentRuns(command, k).reverse(); // 时间正序
    if (runs.length === 0) {
      console.log(`库中还没有 ${command} 类型的完成 run —— 先跑一次 balance matrix。`);
      return;
    }
    console.log(`═════════ 断面趋势（${command}，最近 ${runs.length} 次） ═════════\n`);

    // 列 = 阵容名（以最新一次 run 的 roster 为准；历史 run 缺席的阵容标 —）
    const latest = JSON.parse(runs[runs.length - 1].summary_json ?? '{}') as Summary;
    const roster = latest.comps ?? [];
    const short = (n: string): string => n.split(' · ')[0];
    const head = '  日期              版本    run  极差';
    console.log(head + roster.map((c) => short(c).padStart(7)).join(''));
    console.log('  ' + '─'.repeat(head.length + roster.length * 7));
    for (const r of runs) {
      const s = JSON.parse(r.summary_json ?? '{}') as Summary;
      const wr = s.winRate ?? [];
      const cells = roster.map((name) => {
        const idx = (s.comps ?? []).indexOf(name);
        if (idx < 0 || wr[idx] === undefined) return '      —';
        return `${(wr[idx] * 100).toFixed(1).padStart(6)}%`;
      });
      console.log(
        `  ${r.started_at.slice(0, 16).replace('T', ' ')}  ${r.game_version.padEnd(6)}  #${String(r.id).padStart(3)}  ${((s.spread ?? 0) * 100).toFixed(1).padStart(5)}%${cells.join('')}`,
      );
    }

    // 最新一次相对上一次的移动
    if (runs.length >= 2) {
      const a = JSON.parse(runs[runs.length - 2].summary_json ?? '{}') as Summary;
      const b = JSON.parse(runs[runs.length - 1].summary_json ?? '{}') as Summary;
      console.log('\n【最新移动】（上一次 → 最新，按阵容名对齐）');
      for (const name of roster) {
        const ia = (a.comps ?? []).indexOf(name);
        const ib = (b.comps ?? []).indexOf(name);
        if (ia < 0 || ib < 0 || !a.winRate?.[ia] || b.winRate?.[ib] === undefined) continue;
        const d = b.winRate[ib] - a.winRate[ia];
        console.log(`  ${short(name).padEnd(8)} ${(a.winRate[ia] * 100).toFixed(1)}% → ${(b.winRate[ib] * 100).toFixed(1)}%   Δ${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}p`);
      }
      const sa = a.spread ?? 0;
      const sb = b.spread ?? 0;
      console.log(`\n  极差 ${(sa * 100).toFixed(1)}% → ${(sb * 100).toFixed(1)}%  ${sb < sa ? '✓ 收敛' : sb > sa ? '⚠ 发散' : '持平'}`);
    }
  } finally {
    store.close();
  }
}

