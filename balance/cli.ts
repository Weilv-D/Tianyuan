/**
 * 平衡工具链统一入口（v1.13.0 重建，取代 scripts/sim* 散装脚本族）。
 *
 *   npm run balance -- <command> [args]
 *
 * 四维分析全覆盖：
 *   阵容维  matrix / sweep / ab / bigorigins   —— 断面、灵敏度、定向 A/B
 *   棋子维  units                              —— 逐单位伤害/承伤/构成/生存榜（随 matrix 入库）
 *   羁绊维  traits                             —— 逐羁绊 scale=0 压制的边际胜率贡献
 *   装备维  items                              —— 带装-裸装 CRN 配对边际 + 合成/堆叠曲线
 * 支撑：selftest（门禁）/ bench（吞吐与并行扩展性）/ trend（跨版本趋势）/ store = SQLite。
 *
 * 与游戏分离的保证：本目录只被 scripts 与测试引用，src/ 下没有任何文件 import
 * balance/（tests/balance-tools.test.ts 有断言看守）；vite 构建不触本目录。
 */
// node:sqlite 的实验提示只在无监听器时打印；注册过滤监听器（必须在动态 import
// store 之前 —— ESM 静态导入会提升，放 store.ts 顶部来不及），其余警告照常输出。
process.on('warning', (w) => {
  const s = typeof w === 'string' ? w : w.message;
  if (!s.includes('SQLite')) console.error(s);
});

const argv = process.argv.slice(2);
const command = argv[0];
const rest = argv.slice(1);

const HELP = `用法：npm run balance -- <command> [args]

核心（四维平衡分析）
  matrix [n]      阵容断面基线（默认 n=120，进程池并行，入库）
  sweep <spec|--> OAT 灵敏度扫描：spec JSON 或 --set path=v,...（入库）
  ab --set k=v    定向配对 A/B（CRN，聚焦阵容 --pairs 0,4）
  traits [n]      逐羁绊边际贡献（scale=0 压制 vs 基线，入库）
  items [n]       装备边际全表 + 合成增益 + 堆叠曲线（入库）
  units           最近一次 matrix/sweep 的单位榜（--run <id> --sort dealt|taken）
  bigorigins [n]  墨门/兵家天花板探针

  支撑
  selftest        门禁：数据自检/确定性/CRN/进程池与串行逐位一致/先手公平
  bench [n]       吞吐基准（--scaling 附进程池扩展性）
  trend [k]       跨版本矩阵断面趋势（读库）
  match [n]       整局模拟（局长/AI 原型差异，--set 覆盖）
  shop            商店概率与刷店成本（--t<级>=a,b,c,d,e --match=N）
  legend [n]      三星五费天命专项（镜像纪律）
  beast [round]   墨兽轮自检
  audit/roster/gold/diag/probe  数据速查与单场诊断
通用旗标：--seed S --workers W --serial --comps <file.json> --no-save`;

async function main(): Promise<void> {
  // 遗留迁移命令（match/shop/...）：原脚本按 `process.argv.slice(2)` 读位置参数，
  // 这里把 argv 改写成「node cli.ts <rest>」形态，脚本本体零改动即接入统一入口。
  const LEGACY = new Set(['match', 'shop', 'legend', 'beast', 'audit', 'roster', 'gold', 'diag', 'probe', 'bigorigins']);
  if (LEGACY.has(command)) {
    process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
    switch (command) {
      case 'match':
        await import('./commands/match');
        break;
      case 'shop':
        await import('./commands/shop');
        break;
      case 'legend':
        await import('./commands/legend');
        break;
      case 'beast':
        await import('./commands/beast');
        break;
      case 'audit':
        await import('./commands/audit');
        break;
      case 'roster':
        await import('./commands/roster');
        break;
      case 'gold':
        await import('./commands/gold');
        break;
      case 'diag':
        await import('./commands/diag');
        break;
      case 'probe':
        await import('./commands/probe');
        break;
      case 'bigorigins':
        await import('./commands/bigorigins');
        break;
    }
    return;
  }
  switch (command) {
    case 'matrix':
      await (await import('./commands/matrix')).run(rest);
      break;
    case 'sweep':
      await (await import('./commands/sweep')).run(rest);
      break;
    case 'ab':
      await (await import('./commands/ab')).run(rest);
      break;
    case 'traits':
      await (await import('./commands/traits')).run(rest);
      break;
    case 'items':
      await (await import('./commands/items')).run(rest);
      break;
    case 'units':
      await (await import('./commands/units')).run(rest);
      break;
    case 'selftest':
      await (await import('./commands/selftest')).run(rest);
      break;
    case 'bench':
      await (await import('./commands/bench')).run(rest);
      break;
    case 'trend':
      await (await import('./commands/trend')).run(rest);
      break;
    default:
      console.log(command ? `✗ 未知命令：${command}\n` : '' + HELP);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? `✗ ${err.message}` : err);
  process.exit(1);
});
