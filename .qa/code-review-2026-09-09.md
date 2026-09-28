# 2026-09-09 全库逐文件深度审查（v1.19.0 → v1.20.0）

> 范围：Git 跟踪文件全集。方法：八路只读并行审查（core+data 数值 / game / render / ui+audio+music
> / balance+scripts / 文档同步 / 测试有效性 / 棋子与装备数据完整性），主链路逐条回源复核定级，
> 探针实测取证（含正负对照），测试先行修复，分层验证闭环。
> 本文件是本轮审查的逐项证据索引；玩家可见的行为与口径以 README / DESIGN / CHANGELOG 为准。

## 一、审查范围

| 分区 | 数量 | 处理 |
|---|---|---|
| `src/` | 78 个 ts | 逐文件通读 + 分层边界核查 + 数值探针 |
| `balance/` | 38 项（cli/lib/commands/specs/README） | 逐文件通读 + selftest 五关 |
| `tests/` | 26 个 → 27 个 | 逐文件复核断言对象与有效性 |
| `scripts/` + 根配置 | 7 + package/tsconfig/vite/CI/start.*/.gitignore | 逐文件通读 |
| 文档 | docs/* + README + balance/README + design/* | 逐篇对照代码真源 |
| 二进制资产 | 立绘 64 + 装备图 44 + 音乐 4 + 字体 | 只查清单、引用与授权（audit:music） |
| 排除 | node_modules / dist / release / balance/out / 缓存 | 不审逻辑 |

基线（修复前，@5fc6b6a 干净树）：`npm run qa` ✓ / `npm test` ✓ 197 项 /
`balance -- selftest` ✓ 五关 / `audit:music` ✓。

## 二、发现清单（复核后定级）

### 已确认并修复

| # | 严重度 | 优先级 | 问题 | 根因位置 |
|---|---|---|---|---|
| C1 | High | P0 | 装备钩子参数按**键名全局**取 max：另一件装备改写本件数值（霜翎环回血 1.5%→18%、青圭杖盾 10%→45%、流星弩「至多 2 层」→5 层、缚龙爪封顶失效） | `core/items.ts` `paramOf` 无钩子命名空间 |
| C2 | High | P0 | `npm run balance -- <cmd> [旗标]` 在 npm 11 下旗标被当 npm 配置吃掉：命令照常跑完但种子/样本量未生效，`--no-save` 失效污染工件库 | 工具链只依赖 `npm run --` 透传且静默忽略多余位置参数 |
| C3 | High | P1 | 授权音乐：目标心境缺曲时旧曲不停（双源叠放、错心境、不可自愈）；切心境与关开关在总线满增益处硬切出爆点 | `startLicensed` 可用性早退排在 `stopLicensed` 之前；无源级增益节点 |
| C4 | Medium | P1 | 器匣分页先渲染后钳页：器匣显示为空而命中检测已用新页，点"空"槽可拖出真实装备 | `SceneRefresh.refreshItems` 钳页语句位于芯片写入循环之后 |
| C5 | Medium | P1 | 工件库开库清理把「summary 未写」当「进程已死」，会删并发会话正在跑的 run；`finishRun` 命中 0 行仍报「已入库」 | `store.ts` 无租约/年龄判据、未校验影响行数 |
| C6 | Medium | P1 | 狂血击杀续期按 kind 遍历，把公输/青禾给的全队攻速一并刷到 8 秒 | `skills.ts` selfBuff 未打本源标识、续期未按 src 过滤 |
| C7 | Medium | P2 | 存档 `mode` 未验型：未知值让写盘落到 localStorage 键 `"undefined"`（进度不可找回），错值触发跨模式覆盖 | `match.ts` `fromJSON` 信任 `data.mode` |
| C8 | Medium | P2 | 坏档清洗丢弃棋子不回池（卡池永久少卡）；整档作废路径零诊断 | `sanitizeUnitEntry` 纯函数拿不到 pool；`save.ts` catch 无 warn |
| C9 | Medium | P2 | `items --workers 8` 把 8 当每格种子数（采样量腰斩）；`shop --match=abc` 打印 NaN 后以 0 退出；`--t10` 静默无效 | 位置参数按「非 `--` + 全数字」猜测；`Number()` 未验型 |
| C10 | Medium | P2 | 发布脚本临时目录 `dist.tmp/`、`release.tmp/` 未 ignore → 一次失败锁死下一次发布的干净树门禁 | `.gitignore` 只收 `dist/`、`release/` |
| C11 | Medium | P2 | 演出偏好（伤害数字/镜头震动）落盘失败静默吞掉，刷新即丢 | `fxPrefs.persist` 无返回值、无消费方信号 |
| C12 | Medium | P2 | 不动明王「反弹所受伤害的 30%」自 v1.9 起从未触发（免疫短路早于 `onDamageTaken`，锚点又取同一 `invuln`） | `skills.ts` reflect 锚点与免疫互为否定 |
| C13 | Medium | P2 | 备战「暂停」浮层不冻结任何东西（无倒计时）却写「已暂停」，遮罩也不吃指针 | 倒计时移除后 `paused` 语义悬空 |
| C14 | Medium | P2 | 机关「围攻·破阵」与丹师 5 层攻速帽在玩家文案里完全缺失；7 名棋子只写「攻速」而 `slow` 同时压移速 | 机制后补未回填 effectText / 棋子文案 |
| C15 | Medium | P2 | 升级表末档 100 不可达，被文档读成「8→9 需 100 经验」（实为 80） | `XP_TO_NEXT` 保留越界档 + 文档错位 |
| C16 | Medium | P2 | `computeTraits` 零断言（档位映射/同名去重），历史缺陷「4 剑宗全队破甲叠 4 倍」回归测试被删 | 测试大清理未补回 |
| C17 | Medium | P2 | `equipItem`（自动合成 / 3 件上限 / 墨兽拒绝）零覆盖 | 装备测试只覆盖配方与钩子两端 |
| C18 | Low | P2 | 真快进期间每发远程攻击仍排 `delayedCall`（只在回调触发时判 ff） | ff 收敛纪律未覆盖 `after()` 排程 |
| C19 | Low | P3 | 死代码/死状态：`rng.hashNumbers`、`globalToLocalRow`、`removeUnit`、`equipItemsFor`、`humanRank`、`GameScene.paused`、`UnitView` 五个零调用成员 + 选中死分支、`e.crit ? '' : ''`、空 `update()`、音频 3 个零消费方法 | 历轮清理按「报告一条删一条」推进 |
| C20 | Low | P3 | 棋盘几何真源三处复制（`ROWS = 4`、`4 * BOARD_COLS`、行表字面量）；设置面板高度公式两处推导 | 重构只收敛了列序与纵深 |
| C21 | Low | P3 | `gainXp(NaN)` 把玩家直接顶到 9 级；读档接受 `players.length ≠ 8` / `settings` 非对象 | `economy.ts` 未纳入 core 侧 fail-loud 防线 |
| C22 | Low | P3 | 墨兽罩染色值硬编码绕过 palette；`Bar` 按帧数而非时间推进；`Button` 按下补间无句柄管理 | 与既有纪律（零硬编码色值 / 时间基准补间 / 换向先停旧）漂移 |
| C23 | Low | P3 | `check-boundaries` 先去注释再去字符串：字符串里的 `//` 会让同行代码被抹空（确定性扫描的假阴性通道） | 两步剥离的顺序缺陷 |
| C24 | Low | P3 | `subset-seal` 零可用字形时静默写出空字体覆盖可用资产；`beast` 快进二次生成配对；`trend` 把 0% 当缺失；`legend` 局数虚高；`units --run=5` 静默回落 | 工具链边角 |
| C25 | Low | P3 | 文档与代码漂移 20 处：ART_BIBLE 肖像/卡高/阶段条/镜像清单、README 包体承诺、DESIGN 结算 4.5s/六套预设/AI 参数、QA 内核模块计数、balance/README 命令表缺 10 条、发布授权清单不含已打包字体与立绘、package-lock 版本漂移 | 各处改动未回写真源 |

### 复核为误报或既定设计（不立项，留档防再报）

- **领域状态延续到领域消失之后（最多 `status.dur`）**：截断为「与领域同生共死」会让法爆/幽冥两条线
  整体塌 3~6 个百分点（实测极差 12.5%→20.9%），且文案「其中敌人」两种读法都成立 —— 维持 v1.9 起的
  既定口径，改为在 DESIGN 与内核注释里写明，并以回归断言钉住。
- **回放摘要 `eventsDigest` 生产路径恒为 `''`**：UPGRADE 阶段 M4 已明示「渲染不录事件流，digest 走 ''
  口径」，`verifyReplay` 的比对位设计本就允许空摘要；本轮只修正 replay.ts 头部与 DESIGN §二 的措辞
  （快照记的是胜负与时长，事件流指纹是显式录制通道的比对位），不新增生产期录制（会为无消费方付出
  每场 `JSON.stringify` 的代价）。
- **不动「反弹 30%」改为接通**：以「反弹原始伤害的 30%」接通会让 6 护卫线 +3.6p、全表极差 12.5%→16%
  （超 11~13% 验收带），需连带全表重平衡 —— 按「删掉做不到的承诺」收口，与假计时条同一裁决。
- **费用-面板预算离群 6 名（云杼法强 120 > 全部 4 费、辛环 160 > 六名五费、驰机 105 > 全部 3 费武将、
  墨岩 ≈ 2 费护卫等）**：属面板预算偏离而非机制缺陷，且改动任一数值都会移动断面 —— 按
  「有意的平衡变化须经模拟更新设计结论」的纪律，本轮只记录证据（`.qa` 与本文），不在审查中调数值。
- **术士真伤转化对 field/DoT 不生效**：转化只在 `skillDamage()` 出口；field 走 `source:'trait'`。
  改标签会连带移动多个钩子的触发面（方士溅射/术士重伤/机关围攻都按 source 判定），属机制重设计课题。
- **`computeTraits` 之外的对局层零散覆盖缺口**（`buyExp`/`reroll` 金币不足、`standings` 排序、
  `loadPrefs` 坏形状）：经复核属低风险且现有间接覆盖可发现回归，按 QA §5.1 不新增形式化用例。
- **渲染层 `Math.random()`**：边界门禁对 render 层不设 `forbiddenApis`，这些调用只影响演出抖动与
  DEV 作弊台，不进内核随机流 —— 符合 DEVELOPMENT §4.2。
- **音频 `AudioContext` 不 close / 常驻焦点监听**：文件内明示的页面级单例设计，与 QA §6 口径一致。
- **`balance.db` 被入库 / `sim:*` 别名缺 `units/traits/trend/selftest`**：前者 `git check-ignore`
  确认命中 `.gitignore`；后者是工具链重建后新增命令，不存在对应旧脚本名 —— 均非缺陷。

## 三、修复说明（根因 → 修法）

### C1 装备参数命名空间（P0）
`paramOf(u, key)` → `paramOf(u, hook, key)`：只统计**声明了该钩子**的装备，同钩多件仍取最大（原设计
口径）。30 处调用点全部补 hook 实参；`items-matrix` 新增三组战斗级断言（回血/施法盾/层数上限），
实测修复后霜翎环每次回血 = 1.5% maxHp、青圭杖施法盾 = 10% maxHp。

### C2 工具链参数链路（P0）
`parseArgs` 支持 `--k=v` 与空格两种形态、有值旗标缺值即抛、裸 `--` 视为选项结束标记；
`runCtx` 对多余位置参数直接报错并打印正确写法。实测：`npm run balance -- -- matrix 200 --seed 20260902`
种子生效、`--no-save` 生效；不带第二个 `--` 时以明确错误终止（不再静默按默认值跑）。

### C3 授权音乐源级淡出（P1）
每个授权源串一枚自有 GainNode；`stopLicensed` 先对源增益线性淡出再物理停止；`startLicensed` 把
「停旧源」提到两个可用性早退之前 —— 目标曲缺曲时旧曲先停再回落程序化，切心境与关开关都不再硬切。

### C4 器匣分页顺序（P1）
`refreshItems` 先 `clampItemPage` 再写芯片（`n` 只依赖 `p.items.length`，可前移）。

### C5 工件库并发安全（P1）
开库清理加 6 小时年龄阈值（正在跑的 run 的 summary 恒为空，年龄是唯一可靠判据）；
`finishRun` 校验影响行数，命中 0 行即抛。

### C6 狂血续期来源隔离（P1）
selfBuff 的自身状态打 `skill:<id>` 本源标识，续期只刷本源层。实测断面：机关 +0.3p / 幽冥 −0.3p
（噪声带内），其余七套逐位不变。

### C7~C9 读档与工具链边界
`fromJSON` 对 `mode` 走白名单、`settings` 只认布尔、`players.length` 收敛到 8；坏条目按 defId 回池；
整档作废补 warn；工具链位置参数排除有值旗标的取值、`--match`/`--t<级>` 验型。

### C12 不可达机制收口
不动明王移除 `reflect: 0.3` 与文案承诺（自 v1.9 起从未触发过；接通需全表重平衡），
内核与 `skills.ts` 注释写明免疫窗与反弹锚点互斥的事实。

### C13 假仪表移除
删除备战「暂停」浮层与 `GameScene.paused`、ESC 的暂停分支；`PauseScoutOverlay` 收窄为
`ScoutOverlay`（只保留侦查面板），空 `update()` 一并删除。

### C16/C17 测试面补齐
新增 `tests/traits-tier.test.ts`（档位映射 + 同名去重 + 剑宗全队破甲单次结算）；
`conservation` 补 `equipItem` 四条；`items-matrix` 补参数命名空间三条与免疫窗/领域时长口径；
`status-src` 补紫电镰端到端与坏条目回池、`mode` 白名单；`shop-odds` 补恒 5 格与档位抽空回落；
`battle-formula` 补整数/越界格四例；`hud-layout` 补器匣×卸载钮×记事栏三条不变量；
`replay` 补 FNV 标准向量与每日种子；`economy` 补 `gainXp` 守卫与升级表长度。

## 四、验证结果

| 层 | 命令 / 方式 | 结果 |
|---|---|---|
| 类型 | `npm run typecheck` | ✓ 0 错 |
| 边界 | `npm run check:boundaries` | ✓ 78 个 src 文件（新词法器与旧扫描面逐行对照：回归 0 处、新增命中 0 处） |
| 行为 | `npm test` | ✓ 220 项（基线 197 + 新增 23） |
| 构建 | `npm run build:app`（qa 内） | ✓ |
| 平衡门禁 | `npm run balance -- selftest` | ✓ 五关 |
| 平衡断面 | `npm run balance -- -- matrix 200 --seed 20260902` | ✓ 九套全部带内、极差 12.5%、超时 0.0%（机关 55.4 / 幽冥 47.3，归因狂血来源隔离，噪声带内） |
| 装备维 | `npm run balance -- items 48` | ✓ 69.12 万局、36/36 合成正收益、待调平项 0 |
| 整局 | `npm run balance -- match 120` | ✓ 31.8 回合、AI 名次极差 0.61、配置自检无异常 |
| 依赖/资产 | `npm run audit:deps` / `npm run audit:music` | ✓ 0 高危 / ✓ 授权清单含立绘与字体来源 |
| 定向探针 | 装备参数命名空间（回血/盾量/层数三组）、免疫窗正负对照、`check-boundaries` 新旧扫描面逐行对照 | ✓ 共持回血 = 1.5% maxHp、施法盾 = 10% maxHp、击杀层数 = 2；不动 skill 来源输出 0 且磐可达；78 文件回归 0 处 |
| 实机 | Canvas / Web Audio / 指针 | **未执行**（本轮为无头审查环境）；待办项已写入 `.qa/smoke-checklist.md`「待补：1.20.0」段 |

## 五、文档同步清单

- `README.md` —— 全量重写：1.20.0、资产构成（装备立绘已入库）、带旗标命令的正确写法、
  操作表（侦查行去掉「暂停」）、存档与偏好口径、文档导航。
- `docs/DESIGN.md` —— §二核心循环结算口径与回放快照口径、§三经验表、§四门槛口径、§六钩子参数
  取值面、§八 AI 性格参数表、§十二断面读数与装备维口径、验收快照 220 项。
- `docs/QA.md` —— §4 带旗标命令写法、§5 测试表（新增 `traits-tier` 与各条守卫）、§5.2 内核模块计数勘正。
- `docs/ART_BIBLE.md` —— §6.1 肖像体量、§9.3 阶段条、商肆卡高、镜像清单、字体脚本路径。
- `docs/DEVELOPMENT.md` —— §5 授权清单覆盖面（含立绘与字体来源的如实记录）。
- `docs/VERSIONING.md` —— §2 三处自动校验、§5 镜像清单、§3 平衡命令写法。
- `docs/README.md` —— 索引补 `plans/`、镜像清单、8 阶段口径、版本契约措辞。
- `docs/CHANGELOG.md` —— 新增 1.20.0 条目。
- `balance/README.md` —— 命令速查补全 19 条与带旗标写法。
- `scripts/audit-music.mjs` —— 授权清单新增「打包的图像与字体资产」节。
- `src/version.ts` + `package.json` + `package-lock.json` —— 1.20.0（玩家可见修复 + 平衡口径收敛，按 VERSIONING 计次版本）。
