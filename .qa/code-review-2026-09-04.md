# 2026-09-04 全库逐文件深度审查（v1.16.6 → v1.17.0）

> 范围：Git 跟踪文件全集（332 项）。方法：三路只读探索（架构与规范 / 代码风险 /
> 平衡-测试-文档）建立候选清单，主链路回源码复核定级，测试先行修复，分层验证闭环。
> 本文件是本轮审查的逐项证据索引；玩家可见的行为与口径以 README / DESIGN / CHANGELOG 为准。

## 一、审查范围

| 分区 | 数量 | 处理 |
|---|---|---|
| `src/` | 78 个 ts（含本轮新增 `render/game/itemPaging.ts`） | 逐文件通读 + 分层边界核查 |
| `balance/` | 37 个（cli/lib/commands/specs） | 逐文件通读 + selftest 五关 |
| `tests/` | 24 个 | 逐文件复核断言对象与有效性 |
| `scripts/` + 根配置 | 8 + package/tsconfig/vite/CI/start.* | 逐文件通读 |
| 文档 | docs/* + balance/README + .qa/* | 逐篇对照代码真源 |
| 二进制资产 | 立绘 64 + 装备图 44 + 音乐 4 + 字体 | 只查清单、引用与授权（audit:music） |
| 排除 | node_modules / dist / release / balance.out / 缓存 | 不审逻辑；balance.db 经 `git check-ignore` 确认被忽略 |

基线（修复前，@c5f3fcb 干净树）：`npm run qa` ✓（160 项）/ `audit:deps` ✓ 0 高危 /
`audit:music` ✓ / `balance -- selftest` ✓ 五关。

## 二、发现清单（复核后定级）

### 已确认并修复

| # | 严重度 | 优先级 | 问题 | 根因位置 |
|---|---|---|---|---|
| C1 | High | P0 | 备战期存档丢失本回合配对：读档后开战重掷，rng 流分叉、交手史双记、侦查对手改变 | `match.ts` toJSON/fromJSON 缺 `pairings`；`GameScene.startBattlePhase` 兜底重掷放大为可观察故障 |
| C2 | Medium | P1 | 器匣系统回收溢出（>10 格）资产不可见不可操作，与「一键装备可遍历全部」分裂 | `inventory.addItem` 守恒发放无 UI 对应面；`HudPanels` 固定 2×5 渲染 |
| C3 | Medium | P2 | 真快进（240×排水）下弹道按墙钟推进，途中对象单调积压至结算面板之下 | `BattleScene.onEvent` 'projectile' 无 ff 守卫；`fastForward` 不清在途弹道 |
| C7 | Low | P2 | 空阵直败链中，开战的同一次空格会级联跳过回合结算面板 | `RoundResultOverlay.show` 在同一次 keydown 派发中途注册键盘监听，Phaser 对同事件后续发射仍送达 |
| C8 | Low | P3 | CI Node 版本写死 `22`，与 `engines >=22.5` 及 `node:sqlite` 要求可漂移 | `.github/workflows/qa.yml` |
| C9 | Low | P3 | DoT 致死后同 tick 余留 fx 与全队增益「非减益即施加」口径（审查判接受，收尾前并行修复落地并复验纳入） | `src/core/battle.ts` / `src/core/skills.ts` |

### 复核为误报或既定设计（不立项，留档防再报）

- **死亡单位同 tick 余留 DOT 特效（S1）**：审查时判定为 1 tick 表现噪声、接受不改；
  本轮收尾前该守卫已并行落地（`tickDots` 内层 `!u.alive` 即 break，死亡即停），
  经全量测试与 selftest 复验后一并纳入本发布。
- **授权音乐切心境双源叠音（S3）**：`startLicensed` 先 `stopLicensed(0)` 同步物理停止旧源再起新源，
  源级无叠音；`fadeMs>0` 的 `setTimeout` 为一次性自清理句柄，fired 即 GC，非泄漏 —— 误报。
- **balance.db 被入库（S4）**：`git check-ignore -v` 确认命中 `.gitignore:7 balance/out/` —— 误报。
- **整局模拟 60 轮墙告警语义（S5）**：现役调参下整局均值 32 回合、超时 0.00%（selftest 与抽检一致）；
  告警仅在加时机制被削弱时才有触发面 —— 记录，不改。
- **满席买入的 `bench.length` 截断（C4）**：语义被 `conservation.test.ts` 钉死且注释明确（溢出槽显式建模属重构偏好）—— 已有防护。
- **release 外链扫描黑名单盲区（C5-release）**：现 `src/` 无 `new URL/WebSocket/EventSource` 类动态外链；
  黑名单 + data:/blob: 白名单组合是当前发布承诺的边界 —— 记录，新增外链形态时需同步扩充扫描。
- **墨兽候选池静默缩水（C6）**：现役池 5/10/15 ≥ 最大 count 8，不触发；新增档位时应补告警 —— 记录。
- **`powerScore` 天命 +90 与配装三轴系数不在 `cfg.*` 扫参面**：模拟器与实机共用同一文件同一函数，
  不存在两侧脱节；纳入扫参面属平衡工具链演进项 —— 记录。
- **数值平衡**：selftest 五关 + `matrix`(n=60 换种) / `match` / `beast` 抽检无回归
  （超时 0%、AI 名次极差 0.70、装备守恒 ✓），§十二 canonical 断面（seed 20260902, n=200）无需移动。

## 三、修复说明

### C1 存档持久化本回合配对（P0）

- **根因**：配对在 `beginRound()` 末尾生成（消耗洗牌 rng 并写入双方 `opponents` 交手史），
  但 `Match.toJSON()/fromJSON()` 均不携带；读档后 `pairings` 为空，`startBattlePhase`
  的兜底 `if (pairings.length === 0) makePairings()` 重新消费 rng 并二次 push 交手史。
- **修法**：`toJSON` 携带 `pairings`（逐条浅拷贝）；`fromJSON` 逐条验型（`a` 必须为真实玩家下标，
  `b/ghost ∈ [-1, n)`，`swap/beast` 必须为布尔），任一条非法**整体弃用**回落重掷（残缺表比空表危险）；
  旧档缺字段按旧版行为回落，存档键与载荷版本不变。`GameScene` 侧零改动（配对非空即不重掷）。
- **测试**（`tests/match-resume.test.ts`，先 RED 后 GREEN）：
  备战期（第 2 回合 PvP 轮）存档 → 读档：配对逐位相等、rng 游标不推进、交手史不双记；
  读档路径与连续路径 `settleRound` 结果与 `battleSnapshots` 逐位一致；坏配对整体弃用。

### C2 器匣溢出分页（P1）

- **根因**：系统回收（卖出/合成吃子/淘汰/墨兽掉落）按守恒口径允许器匣超过 10 格
  （`stripItems`/`rollItemDrops`，裁决 2026-09-01），但 HUD 固定渲染 2×5=10 格，
  `hitItemChip` 只覆盖 10 格 —— 溢出部分「一键装备摸得到、玩家摸不到」。
- **修法**：保留守恒发放不变，新增纯映射模块 `src/render/game/itemPaging.ts`
  （页数 / 页码钳制 / 视觉格→绝对索引）；`GameScene.itemAt/itemPage` 按页取件，
  `onCombineInBar` 合成消费本页两个绝对格位；`HudPanels` 在「器匣」签与「卸载」钮同带
  空闲区新增 ◀ 页码 ▶ 控件（仅溢出时出现，命中区与卸载钮互不相触）；
  `SceneRefresh.refreshItems` 每刷先钳页（撤销/卖出后自愈）并驱动控件；翻页清选中态与卸载模式，
  拖拽进行中拒绝翻页（防 `dragItemFrom` 错页映射）。几何（layout/hitTest）零改动。
- **测试**：`tests/item-paging.test.ts` 钉死三条换算口径（页数进位 / 钳制含 NaN / 绝对索引单射）；
  实机断言控件出现-翻页-点选-清空隐藏全链与命中区无重叠。

### C3 真快进弹道收敛（P2）

- **根因**：`update()` 快进帧 `acc += 1/60*240` 逻辑排水，而 `updateProjectiles(dt)` 用真实 dt，
  一帧数十发 projectile 事件只前进 ~16ms 弹道，对象持续堆积到 `clearBattle` 终局兜底。
- **修法**：`fastForward()` 启用时销毁全部在途弹道；`onEvent` 'projectile' 在 ff 期间不创建对象。
  战斗结果、伤害飘字、终局结算不变（渲染层不参与判定）。
- **验证**：实机 PvP 开战 2.6s 按 F：`ff=true`、`projectiles.length===0`、战斗打至终局出结果面板。

### C7 回合结算面板键盘语义（P2，实机发现）

- **根因**：`RoundResultOverlay.show()` 在开战按键的同一 DOM keydown 派发中途执行
  （空阵直败链：`startBattlePhase → settleRound → finishRound → afterBattle → show`），
  Phaser 事件发射器会把同一事件的后续发射送达中途新注册的监听 —— 一次物理空格
  同时完成「开战」与「推进面板」。
- **修法**：面板键盘监听延一帧（`scene.time.delayedCall(0)`）注册，注册前已销毁则跳过；
  `panel.once('destroy')` 对称摘除不变。空格/回车回归「再按一次才推进」。
- **验证**：实机断言开战后 `round` 停在 1、`phase='battle'`，面板等待下一次显式推进。

### C8 CI Node 版本同源（P3）

- `setup-node` 改读 `.nvmrc`（22.5），与 `engines` 字段、`node:sqlite` 要求三处一致。

## 四、验证结果

| 层 | 命令 / 方式 | 结果 |
|---|---|---|
| 类型 | `npm run typecheck` | ✓ 0 错 |
| 边界 | `npm run check:boundaries` | ✓ 78 个 src 文件（覆盖计数断言含新文件） |
| 行为 | `npm test` | ✓ 166 项（基线 160 + 新增 6：配对往返×2、坏配对弃用、分页映射×3） |
| 构建 | `npm run build:app`（qa 内） | ✓ |
| 平衡门禁 | `balance -- selftest` | ✓ 五关（数据/确定性/CRN/进程池一致/先手公平 50.5%±4.1p） |
| 平衡抽检 | `matrix 60 --seed 20260904` / `match` / `beast` | ✓ 超时 0%；n=60 极差 15.4% 在 ±4.3p 噪声带口径内（§十二 n=200 canonical 断面 11.4% 不变）；整局 32 回合、AI 极差 0.70；装备守恒 ✓ |
| 依赖/资产 | `audit:deps` / `audit:music` | ✓ 0 高危 / ✓ 授权哈希一致 |
| 实机 | headless Chrome + CDP 可信事件，25/25 断言 | ✓ 器匣分页（控件/页码/映射/翻页点选/清空隐藏/命中区无重叠）、存读档配对（逐位还原/游标不推进/交手史不双记/侦查不变/开战不重掷）、结算面板键盘语义、真快进弹道清场、控制台零报错零警告（`__qa` + Runtime 双通道） |
| 发布 | `npm run release` | 版本三处一致（1.17.0）、双形态产物、外链扫描、zip 与授权清单（结果见 CHANGELOG 1.17.0 验证节） |

实机截图存 `.tmp-shots/`（gitignore）：`smoke-paging-page2.png`（分页控件与第 2 页件目）、
`smoke-after-battle.png`（战后结算链）。

## 五、文档同步清单

- `README.md` —— 全量重写至最终代码状态：1.17.0 / 78 文件 / 166 项 / 器匣分页操作行 /
  侦查行 / 存档配对随档段。
- `docs/DESIGN.md` —— §二配对规则补持久化契约；§四商店口径换 canonical 命令并指引 §十三为历史基线；
  §六装备断面收敛到 §十二单一真源（消除 31/36 与 36/36 两快照并读）；§十二验收快照 78/166；
  §十三标题自明化为历史断面存档。
- `docs/QA.md` —— §4 变更矩阵改 `npm run balance -- <command>` canonical（`sim:*` 降为别名注），
  补器匣分页行与存档配对口径；§5 交互安全行补 `item-paging`。
- `docs/DEVELOPMENT.md` —— §4.2 补「存读档不重掷已生成的回合随机」纪律。
- `docs/CHANGELOG.md` —— 新增 1.17.0 条目（含审查方法、四项修复、验证存证）；
  1.8.0 掉落金 96 加编者注（现行 98，不改历史数字）。
- `src/version.ts` + `package.json` —— 1.17.0（器匣分页为玩家可见体验改动，按 VERSIONING 计次版本）。
- `.github/workflows/qa.yml` —— `node-version-file: .nvmrc`。
- `.qa/smoke-checklist.md` —— 增 1.17.0 已验段（仅记录真实执行项）。
- `docs/VERSIONING.md` / `docs/ART_BIBLE.md` / `balance/README.md` —— 本轮无真源变化，未动
  （balance 命令计数 19 与 `cli.ts` HELP 逐项核对一致）。
