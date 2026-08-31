# 全库代码审查报告（2026-08-31）

> 范围：`src/` 71 文件约 2.03 万行 + `scripts/` 19 文件 + `tests/` 22 文件 + 根配置。
> 方法：5 路并行逐文件深审（core / game / scenes+panels / board+view+audio / ui+scripts+tests+config），
> 全部 P0/P1 结论逐条回到源码复核；对存疑结论查证了 Phaser 3.80 源码（InputPlugin / Clock 生命周期）。
> 基线：`tsc --noEmit` 0 错误；vitest 21 文件 233 用例全绿；数据层 64 棋子 / 17 羁绊 / 22 装备 id 交叉引用零悬空。

## 0. 结论速览

| 严重度 | 数量 | 说明 |
|---|---|---|
| P0 | **0** | 子代理报告的 2 条 P0 经核实均为误报（见 §5） |
| P1 | **4** | 1 条自查 + 3 条核实确认 |
| P2 | 12 | 边界缺陷 / 健壮性缺口 / 资源卫生 |
| P3 | 25+ | 可读性 / 一致性 / 工具脚本健壮性 |

审查过程证伪了子代理的 6 条高危误报（详见 §5），未证伪的结论均已注明核实状态。

---

## 1. P1（特定条件功能错误 / 明确缺陷，建议本迭代修复）

### P1-1 自定义光标悬停桥接在首次场景切换后永久失效
- 位置：`src/main.ts:178-184`
- 现象：进入第一场战斗（Menu→Game→Battle 任一 `scene.stop/start`）后，金环光标的悬停放大态（`body.cur-hover`）在全场景永久失效。
- 根因：桥接监听只在 `game.events.once('ready')` 里对各场景 `scene.input` 注册一次；Phaser `InputPlugin.shutdown()` 会执行 `removeAllListeners()`（已核实 `node_modules/phaser/src/input/InputPlugin.js:3134`），场景每次 stop 都清空监听，而重启后无人重挂。Scene 实例复用、`game.events.ready` 只发一次，于是逐场景失聪。
- 修复方向：监听各场景 `sys.events` 的 `START/CREATED` 事件重挂桥接，或改为轮询 `input.hitTest` 的单一全局入口。

### P1-2 发布脚本 `--skip-typecheck` 失效 + 非原子发布
- 位置：`scripts/release.mjs:26-34`
- 现象：① 传 `--skip-typecheck` 仍会跑整仓 tsc（第一个 `run('npx tsc --noEmit')` 写在分支外无条件执行；不跳过时更是连跑两遍）；② `[2/5]` 先物理删除 `dist/` 与 `release/` 再构建，`vite build` 一旦失败，上一版可分发产物已被删除，无回滚。
- 根因：分支包错了对象（意图跳过的是第一遍而非第二遍）；清理→构建→提交不是原子序列，无临时目录、无 try/catch。
- 修复方向：把首个 tsc 移入分支；构建到 `release.tmp` 成功后原子 rename 替换。另：文件头部 `--skip-typecheck` 注释重复两行（笔误）。

### P1-3 `autoPlace` 在 mage/support/assassin ≥9 人阵容下死循环（现网不可达，地雷级）
- 位置：`src/game/comp.ts:81-89`
- 现象：一个队伍中纵深 ≥0.75（`DEPTH`：mage .78 / support .88 / assassin .95）的单位达到 9 个时，第 9 个单位落位流程卡死：行溢出回退 `rowIdx = Math.min(3, rowIdx+1)` 在已是第 3 行时原地踏步，guard 耗尽后 `COL_ORDER.find(...) ?? 0` 落回 0，`while (used.has(String(c))) c = (c+1) % BOARD_COLS` 在整行 8 列全占时永不退出 —— 同步死循环，页面冻结。
- 根因：行满处理没有"换下一行"的真实出口，`guard < 4` 只循环不解决问题；列搜索的第二层 while 无全局兜底。
- 可达性：已核实现网路径不可达——真实对局走 `buildBattleConfig`（玩家自摆格子，不经 autoPlace）；`buildTeam`（演习模式，BattleScene:310）用的 `PRESET_COMPS` 均为 7 人混职业；`randomComp` 无调用方。**但任何未来把预设扩到 9 人法系队、或让 `randomComp` 回到对局路径的改动都会引爆。**
- 修复方向：行满时保证 rowIdx 单调移动到下一个未满行（含回扫全表），列搜索失败时断言抛错而非死循环。

### P1-4 WebAudio 节点零 disconnect：长会话音频图退化风险
- 位置：`src/audio/AudioEngine.ts:156-273`（`wireGain`/`tone`/`noise`/`sweep`/`drum`）
- 现象：每次发声新建 `Gain → (Panner) → bus` 与 `Gain → Send → reverb` 链，仅对源节点 `stop()`，全文件 0 处 `disconnect`/`onended`（已 grep 确认）。超长会话在部分浏览器上存在节点累积、混响图变复杂、CPU 渐增的风险。
- 机制澄清（诚实定级）：按 Web Audio 规范，源节点结束后无 JS 引用的链在现代浏览器通常可整链回收，因此子代理"数千活节点必现"的说法过重；但连接进入 `ConvolverNode`（尾部时间节点）的 send 路径会延长存活判定，规范做法仍是 `osc.onended = () => { g.disconnect(); panner?.disconnect(); send?.disconnect(); }`。定 P1 是因为它是对局内每秒都在发生的唯一系统性资源卫生缺口。

---

## 2. P2（边界缺陷 / 健壮性缺口）

### P2-1 revive 满盘兜底直接覆盖占位，可造成 occ 不变量腐坏
- 位置：`src/core/battle.ts:753`
- 现象/根因：两轮 `nearestFreeCell` 扫描都失败后，兜底 `this.occ[cellIndex(u.cell.c, u.cell.r)] = u.uid` 无条件覆盖——该格当前死者 cell 上若已被他人占据，occ 表指向复活者、占据者的 cell 仍指此格，双双幽灵化（寻路可穿透、BFS 失真）。触发需 32 格全满（极难），但 summon/teleport 均有防护而 revive 独缺拒绝路径，属不变量漏洞。修复：兜底改为放弃复活并记日志。

### P2-2 启动期三个 preload 无超时：弱网下 boot 序章永久滞留
- 位置：`src/main.ts:125-130`；`src/render/board/traitIcons.ts:56-66`、`src/render/art/piece/aiBake.ts:39-55`、`src/render/board/itemIcons.ts:24-40`
- 已核实：三个 preload 全部吞错（try/catch 或 `onerror=>resolve`），**不会**使顶层 await 抛错——白屏阻断不成立；但均无超时，字体/图片请求 TCP 挂起时 `await` 永久挂起，`#boot` 永不退场且无任何提示。修复：`Promise.race([preload, timeout(3s)])`。

### P2-3 内核边界未校验 star：脏数据下 NaN 全链路静默传播
- 位置：`src/core/unit.ts:97-107`
- `STAR_HP_SCALE[si]` 等未校验 `si∈[0,2]`；`star=0/4/NaN` 时 `maxHp/atk/sp` 全 NaN，伤害/结算静默失效不抛错。上游 `Star` 类型与配表路径目前安全，但 `noUncheckedIndexedAccess:false` 使内核对越界索引零防线（本仓 30+ 处索引访问的共同根因，见 §4）。修复：`createUnit` 入口对 `star` 做 `Number.isInteger + 范围断言`。

### P2-4 装备参数聚合与钩子取参口径分裂
- 位置：`src/core/items.ts:42-44`（聚合取 `Math.max`）vs `paramOf`（取首个命中件）
- 同一单位穿两件同钩不同参装备时，`itemEffects` 认大者、钩子实取首件：`momentum` 提前封顶、`thorns` 反伤偏小。单件场景无感，机制埋雷。修复：统一为 max 口径。

### P2-5 `withOverrides` 嵌套/零覆盖时仍无条件 `resetTuning()`
- 位置：`scripts/lib/patch.ts:106-115`
- `finally { p.reset() }` 恒定 `resetTuning()`：嵌套调用时内层 reset 会清掉外层已打的补丁，后续扫描轴基线漂移；零覆盖调用也有全局副作用。修复：仅 `journal.length>0` 时还原，`resetTuning` 收敛到真正 apply 过的路径。

### P2-6 卡池跨版本恢复无校验
- 位置：`src/game/pool.ts:63-67`
- `restore` 对旧档中已删除棋子静默丢弃、新版本新增棋子按满池重置——跨版本守恒不成立（凭空造卡/消卡）。修复：快照带版本号，不匹配时按版本迁移或整体重置并提示。

### P2-7 `saveMeta` 全量反序列化整个 Match 只取 2 个字段
- 位置：`src/game/save.ts:121-130`
- 每次调用完整 `JSON.parse` 全存档（含 battleSnapshots）仅为取 `round/humanHp`；`savedAt: Date.now()` 属非模拟路径可接受，但建议读存档摘要层而非整局。另 `save.ts:92` 迁移成功判定用 `getItem(...)!==null`，配额异常写半截时判定为成功，下次启动重复迁移（能自愈，浪费且日志混淆）。

### P2-8 暴击第二环在 `clear()` 后仍新建
- 位置：`src/render/board/EffectsLayer.ts:192-205`
- 80ms 延迟回调未判 `layer.active/scene`，战斗收尾瞬间暴击会在已清空战场上新建金环并自驱 320ms（场景未 shutdown，Clock 不清理）。同类：`LegendaryFx.ts:106-113` 收场 tween 对已销毁 root 的二次 destroy（Phaser 幂等，浪费回调）。修复：回调头补 `if (!this.scene) return`。

### P2-9 `deployUnit` 是死代码且口径与 `canPlace` 相反
- 位置：`src/game/state.ts:346-368`
- 全仓零调用方（已 grep）；其同名判定无条件拒绝，而 `canPlace:446` 允许同名对位交换（i!==slot 排除自身）。UI 实际走 `canPlace → moveToSlot`（InputController:298-306 已核实闭环），行为正确；留着这具口径相反的死函数必误人。建议删除或改为薄封装。

### P2-10 切图/子集脚本无原子写、无输入预检
- 位置：`scripts/subset-seal.mjs`、`scripts/slice-sheet.mjs`、`scripts/slice-item-sheet.mjs`
- 相对 `process.cwd()` 的路径在不同工作目录下行为漂移；`readFileSync` 无 existsSync 预检（裸 ENOENT）；`writeFileSync` 覆盖写非原子（进程被杀留半截产物）。另 `slice-sheet.mjs:42` 存在 `y0+y===0`（应为 `cy0+y===0`）的笔误，恰好首行等价而被掩盖；`slice-item-sheet.mjs` 浮点格宽逐格取整可累积 ±1px、切出空图仅 `empty.push` 静默继续。

### P2-11 `Bar` 销毁时 updateList 移除可能静默失败
- 位置：`src/ui/kit.ts:308-320`
- `destroy()` 里 `scene?.sys.updateList.remove(this)`：若 Scene 先亡，`scene` 已空导致移除失败。当前调用序未触发，属时序脆弱点。

### P2-12 座位公平性复测未携带 overrides（工具脚本）
- 位置：`scripts/sim-match.ts:188-204`
- `--set` 实验时，前 120 局公平环在补丁作用域外新建 Match，读数反映基线而非补丁态，可能误导"无位置优势"结论。同类：`sim-items.ts:109` 每件实际 4 场却按 2 场计数，局/秒与总量虚高一倍。

---

## 3. P3（可读性 / 一致性 / 低风险健壮性，择要）

**内核确定性边际**（回放/每日挑战依赖逐字节一致，建议统一 tie-break 口径）：
- `grid.ts:135-152` `nearestFreeCell` 浮点等距平局无 uid/格坐标二级键；`skills.ts:336` `healBurst` 候选按 `hp/maxHp` 排序无二级键；`traits.ts:548` 刺客落点 `Math.hypot` 平局同理。
- `rng.ts:38` `intn(n)` 未拒 n≤0（静默返 0）；`rng.ts:76-93` `sampleWeighted` 回退分支反向扫描，与 `pool.ts` 的前向 `roll<=0` 口径不一。
- `battle.ts:84` `maxTicks=0` 不钳（`??` 只挡 null/undefined）；`battle.ts:515` 护盾吸收量计入受击回蓝（与 TFT 同款行为，若为有意设计建议注释钉死）。
- `battle.ts:805-813` scheduled 每 tick filter+sort、`unitByUid` 线性扫描——当前规模可接受。
- `traits.ts:305-328` gangAtk 记录器不过滤伤害类型（dot/zone 也算"先动了手"）；默认档被 `gangTargetT2` 结构性收口为 2v4 专用，语义欠精确但有 CRN 定档注释背书。

**渲染层**：
- `BattleScene.ts:789/915`、`ResultScene.ts:199-211`、`GameScene.ts:485/599`、`RoundResultOverlay.ts:126` 等游离 `delayedCall`：已核实 Phaser `Clock.shutdown()` 会清除场景定时器（`node_modules/phaser/src/time/Clock.js:436`），且各回调均有 `active` 守卫，实害有限；但与 `BattleScene.after()` 托管体系口径不一，建议统一。
- `BattleScene.ts` 无 `SHUTDOWN` 统一清理（依赖下次 startBattle 的 clearBattle，中间窗口持死引用）；`clearBattle` 不 `killTweensOf(views)`，重开瞬间补间推动已销毁 UnitView（属性写安全，onComplete 二次 destroy 为幂等 no-op）。
- `UnitView.ts:585-590` `destroy()` 只杀 sprite/base/aura 的 tween，漏 shadow/ghost；`blinkTo:218-232` ghost 漏乘星级缩放（3★残影偏小）。
- `cards.ts:80` `'__chrome'` 键先建图后烘焙（redraw 才 bake），因立即 `setVisible(false)` 无视觉影响，但依赖"先烘后建"以外的巧合，建议调序。
- `HudPanels.ts:513` traitModal 遮罩 `setInteractive()` 却不响应点击关闭；`tooltip.ts:45-50` 超高卡钳制退化为恒 12px；`viewScale.ts:13` `VIEW_K` 一次性采样 DPR，跨屏拖动后失糊（边缘场景）。
- `aiBake.ts:156-165` 星级描边 shadowBlur 光晕被 `scanCanvasBounds` 计入内容包围盒，3★ 实际显示体量被稀释；`silhouetteFactory.ts:142-157` 首次烘焙同步扫描约 192×43k 像素（一次性几十 ms，可延帧）。
- `GameScene.ts:125` `debug.panel` 跨局残留：双 destroy 幂等自愈，建议 create 时复位（与 settingsPanel 同待遇）。
- `state.ts:327` `resolveMerges` 与被弃单位共享 items 数组引用（当前无外部持有者，理论别名）。

**工具链 / 配置**：
- `version.ts` 与 `package.json` 版本三处手工同步无校验，release.mjs 不核对（易出"zip 1.4.0 / 界面 1.4.1"）。
- `start.bat:38` `netstat tokens=5` 非英文系统列错位风险；`start.sh:30` IPv6 `:::5199` 形态漏匹配（stop 误判未运行 → 双实例）；`timeout /t 4` 固定等待竞态。
- `vite.config.ts:30` `emptyOutDir:false` 绕沙箱但直接 `vite build` 时旧产物残留（release.mjs 有清理兜底）。
- `tsconfig.json` `noUncheckedIndexedAccess:false` —— §2/§3 多条"静默 undefined"问题的共同根因，建议专开一次改造（改后 tsc 报错量即为现患清单）。
- `.gitignore:7` `sweep-out/*` 不含子目录；仓库根部两个 0 字节垃圾文件 **`console.log(x[0].slice(0`** 与 **`x[1])`**（shell 重定向事故产物，已入 git status），建议删除。
- `roster.ts:24` 引用 `c.cls`（旧单职业口径）与数据模型 `classes[]` 漂移风险；`audit.ts` 无退出码（CI 不阻断）；`check-beast.ts` 快进循环与非兽轮真实主循环口径有偏移。

---

## 4. 整体质量评估

**架构与结构（优）**：分层清晰且纪律被执行——`core` 纯确定性内核（无 DOM/时钟依赖）、`game` 对局状态机、`render/ui` 表现层、`data` 单一真源、`scripts` 平衡工具链。目录按职责分组（render/board、render/game、render/view），`palette/layout/hudLayout/config` 等常量单一真源化彻底。注释密度罕见地高，且大量是"为什么"（历史事故、CRN 定档依据、顺序契约），这是本项目最值钱的资产之一。

**正确性（良）**：233 测试覆盖守恒、确定性、撤销、回放、布局契约；内核确定性契约（唯一 RNG、字典序钩子注册、固定 BFS 邻域、tick 奇偶遍历）落实到位且有注释锁定。剩余风险集中在浮点平局 tie-break 缺失与 `noUncheckedIndexedAccess:false` 放行的静默 undefined 面。

**错误处理（良，两处短板）**：数据层（save/pool/daily）的损坏回退总体完备；短板在启动链路无超时（P2-2）与 Node 脚本普遍缺输入预检（P2-10）。

**资源管理（良，一处系统性缺口）**：无数据库/网络服务；纹理烘焙全部幂等（`bakedTexture` 哨兵、exists 检查），DamageText 池化、BattleScene `after()`/pendingTimers 托管体系均为良好实践。系统性缺口仅 WebAudio 节点卫生（P1-4）；文件句柄面的问题集中在发布/切图脚本的原子性（P1-2/P2-10）。

**测试盲区**：渲染层零覆盖（本轮确认的全部 P1 渲染/生命周期问题都在盲区）、`autoPlace` 类纯函数无边界用例（9 人同纵深即可暴露 P1-3）。

**综合评级：B+（良好，可维护性高）**。问题密度约 0.9 个/千行（P1+P2 计），且无 P0。历史两次专项修复（2026-08 体检、27 处复核）的质量可见——本轮发现的 P1 多为"体系建立时遗漏的个别逃逸点"，而非系统性缺陷。

## 5. 已证伪的子代理高危误报（防止后续误修）

| 误报 | 证伪依据 |
|---|---|
| P0：CodexScene `screenToWorld` 未导入即调用，悬停必崩 | `CodexScene.ts:14` 已显式导入（tsc 全绿亦佐证） |
| P0：`match.ts` 淘汰名次 `aliveCount()+1` 差一 | `p.alive=false` 先执行再计数，首汰=8 名正确，注释已钉口径（match.ts:800-804） |
| P1：beast.ts 去重跳过致墨兽缺员 | `count≤8` 恒 ≤ 唯一池长度（5/10/15），`i % picked.length` 不会回绕，去重分支为死代码（beast.ts:64 注释已自证） |
| P1：SettingsPanel close 先写盘后销毁，配额满卡死 | `savePrefs` 内部 try/catch 吞错（save.ts:172-178），不可能抛出 |
| P1：arena.ts 跨局复用 BattleUnitInput 污染 CRN | Battle 构造期 `createUnit(input)` 拷贝进内部 Unit，不回写输入对象；sweep 同种子一致性测试持续绿 |
| P1：buy 满席 2★×2 可买被误挡 | 2★×2 + 新买 1★ 无法合成（星级不同），满席拒买正确 |

## 6. 资源泄漏风险汇总（专项）

| 类别 | 结论 |
|---|---|
| 数据库/网络连接 | 不适用（纯前端 + localStorage；Node 脚本无长连接） |
| 内存-音频 | **唯一系统性风险**：AudioEngine 节点零 disconnect（P1-4），规范做法 onended 后断链 |
| 内存-纹理 | 健康：全部烘焙幂等（exists 哨兵），无重复生成路径（已逐文件核实） |
| 内存-对象池 | 健康：DamageText give/clear 双保险无累积；EffectsLayer strays 追踪到位（个别延迟回调缺守卫 P2-8） |
| 内存-无界集合 | `match.ts battleSnapshots` 线性增长——为回放完整性有意为之（P3，长局内存可预估，不建议加限额破坏回放）；`daily` 记录、noiseBufCache(24) 均有界 |
| 文件句柄 | 发布/切图脚本非原子写、无预检（P1-2/P2-10）；无句柄泄漏（全部同步 API） |
| 事件监听 | main.ts 光标桥接被 InputPlugin.shutdown 清除后不重挂（P1-1，表现是功能失效而非泄漏）；kit `enableScroll` 依赖手动 destroy 契约（当前调用方合规）；kit `Bar` 销毁序脆弱（P2-11） |
| 定时器 | Phaser Clock 在场景 shutdown 时清空（已核实源码）；BattleScene `after()` 托管体系健康；游离 delayedCall 均有 active 守卫（P3 统一口径即可） |
| 线程 | 不适用（无 Worker） |


---

## 7. 处置记录（2026-08-31 · v1.6.0 闭环）

### P1 全部修复

| 项 | 处置 | 落点 |
|---|---|---|
| P1-1 光标桥接失效 | 桥接场景自持：create 挂、START 重挂、SHUTDOWN 复位标记，与 main.ts 初始桥接并存（classList 幂等） | `ui/kit.ts resetCursorOnShutdown` |
| P1-2 发布脚本 | 首个 tsc 已在分支内（E 段修）；本轮补齐：构建写 `dist.tmp`/`release.tmp` 原子替换 + 版本三处一致性门禁 | `scripts/release.mjs` |
| P1-3 autoPlace 死循环 | 行选择单调前进（偏好行起找第一个未满行，到头回扫全表）；超容量抛错；回归测试锁死 | `game/comp.ts` + `tests/review-fixes.test.ts` |
| P1-4 WebAudio 断链 | 全部发声源 onended 后整链 disconnect（含 drum 的声像支路）；wireGain 返回旁支清单供拆除 | `audio/AudioEngine.ts` |

### P2 处置

| 项 | 处置 |
|---|---|
| P2-1 revive 覆盖占位 | ✅ 满盘放弃复活（return），occ 不变量优先 |
| P2-2 preload 无超时 | ⚠️ 部分：aiBake / itemIcons 加 3s 超时；main.ts 字体与 traitIcons 在用户未提交文件中，按不动在途改动纪律顺延 |
| P2-3 star 未校验 | ✅ createUnit 入口 `Number.isInteger + [1,3]` 断言，测试锁定 |
| P2-4 装备参数口径分裂 | ✅ paramOf 改 max 口径，与 itemEffects.params 聚合一致 |
| P2-5 withOverrides 嵌套 | ✅ reset 仅在 journal 非空（真正 apply 过）时还原 + resetTuning |
| P2-6 卡池跨版本恢复 | ✅ 未知 id / 负数 / 非整数 → 整池重置回满池（与新开局同基线）；缺项 id 按满池计入（口径已记录） |
| P2-7 saveMeta 全量解析 | ➖ 不处理（读取频度低、缓存引入一致性问题）；迁移成功判定已改回读校验，重复迁移窗口消除 |
| P2-8 暴击环 clear 后新建 | ✅ gen 守卫（前轮已加）+ 场景非活跃守卫；LegendaryFx 双 destroy 为 Phaser 幂等，不处理 |
| P2-9 deployUnit 死代码 | ✅ 删除（全仓零调用方核实） |
| P2-10 切图脚本 | ✅ slice-sheet 笔误修正 + 存在预检 + 原子写；slice-item-sheet 同待遇；subset-seal 在用户未提交文件中顺延；浮点格宽 ±1px 累积不处理（成品已入库，重切反引入像素漂移） |
| P2-11 Bar 销毁序 | ✅ destroy 守卫 scene.sys 存在 |
| P2-12 sim 工具读数 | ✅ sim-match 座位公平环纳入 withOverrides；sim-items 总量口径 2→4（每种子实际 4 场） |

### P3 处置（安全项即修，基线移动项顺延）

- ✅ 已修：rng intn 非正守卫、maxTicks 钳制、resolveMerges 装备数组拷贝、UnitView
  blink 残影星级缩放 + destroy 补全、clearBattle 先杀补间、start.sh IPv6（实测
  现行模式已覆盖，无需改）、.gitignore sweep-out 目录级、audit.ts 失败非零退出、
  BattleScene SHUTDOWN 统一清理（C4 段已建，复核确认存在）、GameScene debug 面板
  create 复位（已存在）、羁绊浮层遮罩点空白关闭、cards.ts `__chrome` 先烘后建
  （现序已正确，复核确认）。
- ➖ 顺延（记录理由）：`nearestFreeCell`/`healBurst`/刺客落点 tie-break 二级键 ——
  任何 tie-break 变更都移动对局基线（金种子与回放全量漂移），须并入下一次数值
  迭代统一执行；`noUncheckedIndexedAccess` 专开改造 —— 30+ 处索引访问，独立任务；
  `noUncheckedIndexedAccess` 之外的 `viewScale` 静态 VIEW_K 为 D5 ADR 既定口径；
  tooltip 超高卡恒 12px 钳制为可接受降级。
