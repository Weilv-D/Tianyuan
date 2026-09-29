# 百战天元 · TIAN YUAN

> 天地初分，墨与纸未判。有神将、荒兽、妖灵、鬼差共弈一局，胜者执笔，重写山河。

一款单机自走棋：八人同场，你与七名性格迥异的 AI 诸侯各执一族。64 名棋子、17 条羁绊
（10 地域＋7 职业）、8 种组件两两合成 36 件成品装备；墨兽轮供给装备、奇遇轮发放六类
恩赐、每日挑战全员同题，单局约 25–40 分钟。三星五费携带「天命护持」，是值得围绕构筑的
终局面额。视觉方向「夜宴 · 幽冥水墨」——夜蓝为底、米金为面、朱砂是唯一热色。

本仓库现为**双树结构**：

| 树 | 引擎 | 版本线 | 状态 |
|---|---|---|---|
| 根目录（`src/ public/ …`） | Phaser 3 + TypeScript + Vite | 1.20.0 | **冻结**：规格参考 + 可玩的 web 版，零改动铁律 |
| [`godot/`](./godot/) | Godot 4.7.1 标准版 + GDScript | 2.0.x | **现行开发**：桌面重制线，Windows 绿色 exe 分发 |

两树的关系与约束（隔离铁律、数据单向流 `src → godot/data/spec.json`、跨引擎逐事件
对拍门禁）见 [godot/AGENTS.md](./godot/AGENTS.md) 与
[godot/docs/MILESTONES.md](./godot/docs/MILESTONES.md)。

## Godot 版（现行开发线）

- 运行：Godot 4.7.1 标准版打开 `godot/`；或直接运行分发包 `godot/out/BaiZhanTianYuan-*.zip`
  解压后的 exe（自含 PCK，绿色免安装）。
- 门禁：`godot/` 下 `npm run qa`（10 步：全树 parse / spec 对账 / GdUnit4 / rng / battle /
  codec / match 跨引擎对拍 / balance 冒烟）。
- 发布：`node tools/export_release.mjs`（影子目录导出，防外部注入进 PCK）。
- 完整说明见 [godot/README.md](./godot/README.md)；版本记录见
  [godot/docs/CHANGELOG.md](./godot/docs/CHANGELOG.md)。

## Phaser 版（冻结于 1.20.0）

需要 Node ≥ 22.5（`start.bat` / `start.sh` 在入口探测 `node:sqlite`）：

```bash
npm ci          # 按锁文件安装依赖
npm run dev     # 开发服务器 → http://localhost:5199
npm test        # 核心行为测试
npm run build   # 类型检查 + 生产构建 → dist/
npm run qa      # 交付门禁：类型 + 架构边界 + 测试 + 构建
npm run balance -- selftest              # 平衡门禁五关
npm run balance -- -- matrix 200 --seed 20260902   # 平衡命令（第二个 -- 必写）
```

Windows 双击 `start.bat`（子命令 `stop` / `status` / `restart`）；Git Bash 用 `start.sh`。
`npm run release` 产出单文件 HTML / 静态目录 / 分发 zip 三样到 `release/`（构建前校验
干净树、版本三处一致、依赖与资源审计、外链扫描）。

## 玩法操作（行为即契约）

| 动作 | 方式与保证 |
|---|---|
| 买入 / 上阵 | 点商店卡买入，拖上棋盘；`1–5`（含小键盘）直购对应卡位；同名三张自动合成升星（含跨场上/备战席与级联），合成逐条记入对局日志；同名棋子可多张上场，羁绊按唯一棋子计数；拖拽落点实时染金/红边并说明原因 |
| 刷新 / 布阵 / 升级 / 开战 | `D` 刷新，`E` 一键布阵，`F` 买经验，`空格` 准备完毕（备战无倒计时，手动开战）；浮层打开时键盘、点按与悬停三路统一让路 |
| 撤销 | `Ctrl+Z` 或按钮，准备阶段内任意操作一步回退——棋盘、备战席、等级/经验、金币、商店、器匣、卡池、奇遇恩赐与随机流游标的完整快照（最多 30 步） |
| 装备 | 组件拖到棋子身上或器匣内另一组件上即合成；单棋子上限 3 件；主动卸装严守器匣容量、放不下整体拒绝，成品拆回两组件；系统回收路径守恒优先；器匣溢出自动分页 |
| 卖出 | 拖到朱印「售」区，或点选棋子后经详情卡出售；2★ / 3★ 需二次确认；返还按费用×星级（1★=费、2★=3×费−1、3★=9×费−1），卡按星级拆张回池 |
| 羁绊 | 左轨徽章悬停看当前档效果（高档文本自含绝对数值），点击钉住成员名单卡；轨内可滚动，滚出视口的徽章不再响应悬停与点选 |
| 侦查 | nav「阵容」直接查看本轮对手（墨兽轮提示无可侦；墨影轮侦查出局阵容快照） |
| 战斗演出 | `空格`/`ESC` 暂停，`1`/`2`/`4` 切换倍速，`F` 快进到底；结算面板盖住身后时指针与快捷键都不再穿透 |

存档在玩家本机（web 版浏览器 / Godot 版 `user://`，互不迁移）；普通对局与每日挑战分键
存取；损坏载荷读档入口逐字段清洗，整档作废同样落告警；配对随档持久化，备战期存读档不
重掷本轮对手；战斗回放快照随档保留最近 60 场。每日挑战以当日日期派生种子，全员同题。

## 文档（体系化入口）

- [docs/README.md](./docs/README.md) —— Phaser 版全部工程文档入口：
  [DESIGN.md](./docs/DESIGN.md)（玩法与数值的唯一出处）、
  [DEVELOPMENT.md](./docs/DEVELOPMENT.md)、[QA.md](./docs/QA.md)、
  [ART_BIBLE.md](./docs/ART_BIBLE.md)、[CHANGELOG.md](./docs/CHANGELOG.md)、
  [VERSIONING.md](./docs/VERSIONING.md)
- [balance/README.md](./balance/README.md) —— 平衡工具链命令与进程设计
- [godot/docs/](./godot/docs/) —— Godot 版里程碑、变更日志与对拍协议
- [godot/AGENTS.md](./godot/AGENTS.md) —— 双树协作守则（隔离铁律与门禁纪律）

开发模式（仅 dev 构建）下，web 版 `window.__arena` 暴露 Phaser 实例、`window.__qa` 采集
控制台报错、`Ctrl+~` 呼出实验控制台；Godot 版等价钩子为 `--smoke/--autostart/--battle-smoke`
命令行探针与 DEV 门禁的 DebugConsole。
