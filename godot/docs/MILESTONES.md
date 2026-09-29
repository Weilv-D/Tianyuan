# 夜宴 · Godot 版里程碑（版本线 2.0.0）

首验收点 = M4 全功能对等 v1.20.0。本文件是执行台账；决策快照见下（源自 2026-09-28 拷问）。

## 决策快照

| 维度 | 裁决 |
|---|---|
| 动机 | 美术上限 + 桌面发行 + 长期技术栈；Phaser 版冻结 v1.20.0 作规格参考 |
| 对等定义 | 跨引擎逐事件可对拍（同种子同配置 → 事件流逐条一致）为发布门禁 |
| 视觉 | 夜宴夜蓝体系升级；立绘暂不动（现役 PNG 复用，重制批次待另行发令） |
| 引擎/语言 | Godot 4.7.1 标准版 + GDScript（C:\WORKSPACE\game\Godot_v4.7.1-stable_win64.exe） |
| 内核 | GDScript 单一内核；平衡 = Node 编排 + godot --headless 常驻子进程池 |
| 布局 | 同仓双目录 godot/；对 ../src 只读；一切新增代码只进 godot/ |
| 发行 | Windows 绿色 exe（zip），不接商店 |
| UI/UX | 布局沿用 + 局部优化逐条过审（docs/UX_DELTAS.md，M3 起） |
| 音频 | 音乐全新重制（样曲过审制）+ 音效按引擎重制 |
| 存档 | 不迁移旧档；user:// 独立起档（沿用 v3 schema 骨架，不背 v2 包袱） |

## M0 骨架与对拍地基
- [x] godot/ 工程骨架（project.godot / 目录 / .gitignore / 占位 Boot）
- [x] tools/export_spec.mjs：只读加载 ../src 数据 → data/spec.json（64/44/17/36 对账 + fnv/sha256 + 幂等门禁）
- [x] core/rng.gd 精确移植（imul32 分半乘法 + uint32 掩码纪律；百万抽样×3 种子 + 派生方法序列×3 种子全绿）
- [x] docs/PARITY_CODEC.md + 双端编解码器（tools/codec.mjs / core/codec.gd）+ 合成事件往返 24 事件全等
- [x] GdUnit4 v6.2.1 接入（addons/ 提交入库；qa 门禁 6 步全绿：npm run qa）

### M0 实机教训（对拍管线维保必读）
1. 新增/改动 class_name 后必须先 `--import` 刷新全局类缓存，`--script` 探针才能解析（qa 第 1 步已固化）。
2. node 拉起 Godot：一律用标准版 exe + 正斜杠路径；`--path` 指到无 project.godot 的目录会让编辑器模式干等（=僵死）。
3. `path.dirname(fileURLToPath(new URL('..', url)))` 会多剥一层（URL 以 / 结尾）——必须 `path.resolve`。
4. spawnSync 必须带 timeout；个别启动会僵死，门禁要能 FAIL 而非挂死。
5. Godot `JSON.stringify` 默认按字母序排键——跨语言报告比对必须语义比较（逐字段），不能整串 diff。
6. GdUnit4 浮点断言有精度口径差异：浮点一律断言 f64 位型 hex；断言失败会中止该套件后续用例（先修先跑）。
7. `String.match` 是 glob 不是正则（字符集校验须用 RegEx）；`String.decode_hex` 在 4.7 不存在（用 hex_to_int 逐字节）。

## M1 战斗内核移植（src/core 4,698 行）✅ 2026-09-28 完成
rng → types → grid → unit → items → traits → skills → config → api → battle 全部落地（core/*.gd 九件套 + spec.gd 数据加载器）。
- [x] hooks 注册顺序契约（羁绊 id 字典序 → 装备固定序）、BattleApi 表面、settle-then-replay、30Hz 固定 tick 1:1 复刻
- [x] 验收：**1,023 局 × 370,474 事件跨引擎逐位一致**（3 阵容×340 种子 + 天命/墨兽 powMult/maxTicks 三特殊案；GDScript 38 局/秒）
- [x] conservation/determinism 契约 GdUnit4 化（tests/battle_test.gd：同种子同摘要/事件首尾契约/守恒不变量）
- [x] qa 门禁 7 步：import → spec 对账+幂等 → GdUnit4 → rng 对拍 → battle 对拍 → codec 往返

### M1 实机教训（GDScript 移植纪律，M2 前必读）
1. **`trait` 是 GDScript 保留字**（为未来特性预留）——Unit 的羁绊态字段更名 `tstate`。
2. **class_name 循环引用直接炸解析器且不报具体行**（unit↔items_core）：运行时 `load()` 打破编译期环。
3. **钩子 lambda 元数必须齐**：JS 惯用 `() => {}` 省参挂 onBattleStart；GDScript 严格元数，全部补占位参数。
4. **`var x: Dictionary = dict.get(k, null)` 在 null 时运行期报错**——可空取值一律无类型标注。
5. **`sort_custom` 方向曾写反**（true ≈ TS cmp<0 ≈ a 在前）：降序应写 `a.k > b.k` 而非 `b.k > a.k`——resurrect 选人与超时裁定两处中招，靠终局快照差分定位（事件四舍五入掩蔽了无 hp 漂移的纯结构分歧）。
6. **局部 lambda 不能自引用**（nova 连波/volley 自排程/连斩递归）：装箱进字典后经 `state["fn"]` 取自身。
7. **闭包按值捕获标量**：跨回调共享的可变计数（围攻 nowTick 等）必须装箱。
8. String 没有 `slice`（用 `substr`）；`decode_hex` 不存在（逐字节 `hex_to_int`）。

## M2 对局层移植（src/game 4,107 行）✅ 2026-09-28 完成
match/ai/pool/economy/adventure/undo/replay/beast/arrange/comp(computeTraits)/inventory/state/daily/save 全部落地
（godot/game/ 十四件套）。save/daily 改 user://（独立起档不背 v2）；pairings P0 契约（随档持久化 + sanitize
整表弃用兜底）复刻；from_json 全量清洗（槽位收敛/名单过滤/超长回池/iid 分域去重）移植，失败协议从 TS throw
改为返回 null（GDScript 无 try/catch）。
- [x] 验收：**7 整局（6 随机种子 + 1 每日模式）× 251 状态行跨引擎逐行一致**（qa 第 7 步，66s）——
      覆盖整局确定性 / 人类操作剧本（买·卖·刷·经验·移动·装备·卸装·恩赐点选与代选·撤销往返·一键布阵·
      自动装备）/ 交叉读档（GDScript 直接消费 TS 存档 JSON，每局 3 次）/ 每日种子口径（FNV 逐位一致）/
      终局 rank 结算；daily seed 0x8ad26c12 两引擎同值
- [x] GdUnit4 契约测试 15 用例（确定性/轮转自洽/级复合成/经济/卡池守恒/撤销/配对覆盖/器匣容量分层）
- [x] qa 门禁 8 步：import → spec 对账+幂等 → GdUnit4 → rng → battle → codec → **match**

### M2 实机教训（对拍调试方法论 + GDScript 新坑，M3 前必读）
1. **Dictionary int 键 vs str 键**：build_battle_config 内存构造 traits 用 int 键，battle 构造按
   `str(team)` 读 → 羁绊**全部静默丢失**（JSON 路径键天然字符串，掩盖了此坑；M1 夹具手填 traits 也测不到）。
   表现为「战斗面板数值全低一截」——首事件 start 的 hp 即分叉，逐事件对拍一步定位。
2. **Spec 静态字段直读不触发 ensure()**：CardPool._init 在首次 Spec.c() 之前构造，counts 建在空名单上
   （商店全 null）。所有直读 Spec.champions/item_by_id/cfg 的入口必须先调幂等 Spec.ensure()。
3. **`traitGain` 的 `else if (b)` 判存在性而非 tier>=0**：未激活羁绊（tier=-1）的推进也是 +3 —— 我写成
   `elif bt >= 0` 后 AI 对未激活羁绊的估值系统性偏低，买牌决策翻转 → rng 消费次数变 → 游标分叉但状态巧合
   一致。定位法：mulberry32 从共同游标逐步推演 next()，数出「多消费 2 步」再反向找消费点。
4. `String(int)` 构造不存在（用 str()）；`abs()` 返回 Variant（用 absi）——泛型数学内建在 `:=` 推断下
   触发「Warning treated as error」直接拒绝编译。
5. GDScript 三元是 `x if cond else y`（JS/Python 直觉会写反 —— state.gd 一轮 14 处全反，靠自查清单纠正）。
6. **JSON 读回的 number 是 float**：str(1.0)="1.0" 会污染编码行（必须先 int 化）；夹具侧 survivors 键也要
   int(team) 归一（M1 已知，M2 再证）。
7. 对拍 probe 的失败报告必须给「差异点 ± 窗口」而非固定前缀截断 —— 前缀相同会掩盖真实分叉位，白跑一轮。
8. 探针超时先查 SCRIPT ERROR：编译失败 → _initialize 崩 → 主循环空转假挂死（M0 教训 M2 重演一次）。
9. resolve_merges 每轮 while 只合一个组（break 重扫）：9 张 1★ 是 4 次 events（3×2★+1×3★），不是 2 次。
10. eventsDigest 的 JSON.stringify 键序是引擎内自洽口径（JS 插入序 vs Godot 字典序）——跨引擎不比该字段，
    事件流本身走 PARITY_CODEC（M1）/ 状态行（M2）；夹具 record_events=false 恒 '' 天然免疫。
11. comp.buildTeam / PRESET_COMPS（演示预设+配装注入）属 M4 平衡工具链面，登记延期；prefs 的
    prefers-reduced-motion 无 Godot 等价查询，calm 首启 false（用户手动开）。

## M3 表现层与美术升级（首批落地 2026-09-28，次批进行中）
首批：资产迁移（64 立绘 PNG / 44 物品图标 / 怡山北篆体 ttf / 印章 woff2 → godot/assets/）；
ui/palette.gd（夜宴五色唯一色源镜像）+ render/layout.gd + render/hud_layout.gd（几何真源）；
HUD 布局契约 **20 用例 GdUnit4 化全绿**（hud-layout.test.ts 十组不变量移植）；
场景树闭环 Boot→Menu→Game→Battle→Result（render/ 六场景）：大漆盘 _draw 程序化版、
UnitView（星级 shader 描边 + 墨兽罩染——不烘焙 576 张派生纹理，PNG 原样复用）、
拖拽布阵/买/卖/刷新/经验/一键布阵/撤销/开战 settle-then-replay 重演（事件→视图/飘字/音）；
音频三总线（BGM/SFX/UI + SFX 混响）与合成 blip 占位；实机截图冒烟钩子
（--smoke=<tag>,<frames> / --autostart，存 .tmp-shots-godot/ 不入库）。
- [x] 字体分级裁决（用户实机看图）：篆体只用于题字/印章/徽章单字，按钮与句子级文本宋体
- [x] 次批（2026-09-28 完成）：EffectsLayer 16 kind 墨迹特效（环/软光/线束/墨点迸溅/地面墨染五原语，
      FX_TINTS 槽位取色，静观模式吞震屏与全屏闪）+ projectile 弹道（arrow/bolt/orb）+ 震屏累加器 +
      飘字 9 分级（DamageText 参数表：size/rise/life/pop）+ 战报双列三色输出条（物理米金/法术夜蓝/真伤旧金，
      阵亡压暗 0.45，battle→game 统计带回）+ 器匣十分格/溢出分页/卸载流/装备流 + 操作列 2×3 六钮
      （D/F/E/Z 快捷键 + 锁定商店）+ 敌情/八方诸侯计分板/记事/战报/场上计数四栏 + 羁绊悬停笺（effectText
      按档取文案）+ 成员卡（5 列立绘网格钉住）+ 设置面板（三总线音量/静观/自动上场，user://prefs）+
      DebugConsole（Ctrl+~ 只读态，命令面登记下批）+ 武库图鉴（64 棋子网格+详情卡）
- [ ] 下批：漆纹噪声着色器版棋盘 / DebugConsole 命令面 / 侦查覆盖层细化 / 新音乐样曲过审（3 首先审再铺） /
      BGM 连续播放与场景路由

### M3 下批补记（2026-09-28）
- 漆纹着色器棋盘（lacquer.gdshader：笔触 fbm + 宣纸颗粒 + 清漆高光带 + 盘沿沉夜）；
  DebugConsole 命令面九命令（TS 同源纪律：作弊用 randi() 非对局随机流；满袋按 MAX_ITEMS_PER_UNIT 分发）；
  BGM 路由（四心境 menu/prep/battle/final，五声音阶 pad 占位——新音乐样曲过审前）。
- **实机事故：窗口拉伸没配 → 画面只剩右下角一小块**。场景按 1920×1080 中心坐标构建，
  缺 stretch 时默认窗口下中心点落在屏幕外。修复 = project.godot [display]：
  viewport 1920×1080 + stretch/mode="canvas_items" + aspect="keep" + 启动最大化
  （Phaser Scale.FIT+CENTER_BOTH 的 Godot 等价物）。新建工程第一步就该配。

### M3 首批实机教训
1. GDScript const 字典裸键不可跨 const 点引用（.key 折叠失败）——键一律字符串化 + 下标引用。
2.  是保留字（字典键 true 字符串化）；const 里不能调函数（LV_BUDGET 硬算）。
3. Camera2D 无 ANCHOR_MODE_CENTER；场景以中心坐标构建时用「根节点 position=(W/2,H/2)」最稳。
4. CanvasLayer 不随相机/根变换 —— 面板坐标必须用屏幕系（(W-x)/2 居中），与场景系区分。
5. GdUnit4 assert_float 不吃 int —— dict 取值一律 float() 包裹。
6. change_scene_to_file 在 autoload _ready 期需 call_deferred；autostart 走 boot 场景入口防 tween 竞态。
7. （非 get_datetime_dict）。
8. 截图前 await RenderingServer.frame_post_draw；viewport 截图目录用 res:// 相对 globalize。

### （原计划条目如下，逐项并入上表勾选）
场景树重写（布局沿用）、HUD 契约移植、棋盘/UI 着色器重制、立绘 shader 描边（不烘焙 576 纹理）、
17 类 FxKind 墨迹粒子、音频三总线+新音乐样曲过审、DebugConsole DEV 对等、UX_DELTAS.md 清单制。

## M4 对等验收 + 平衡工具链 + 发行（2026-09-28 完成主体）
- [x] 平衡工具链（tools/balance.mjs + headless/balance_worker.gd）：CRN 金锁种子
      （seedBase + pairIdx×104729 + k×7919，DEFAULT_SEED_BASE=20260829 原值）；
      PRESET 九套 × 72 配对全量 **3,600 局 400s（9 局/s）**，胜率榜 57%~38%（极差 19%），
      SQLite 四表同结构入库（node:sqlite）。**设计变更**：stdin 常驻 IPC → 批次包模式
      （Godot 4.7 子进程侧无 stdin 读取 API）；Node 异步管道下 godot print 永不 flush →
      spawnSync 同步批跑（shell 直跑与 spawn 行为差异实锤）
- [x] Windows 绿色单 exe 导出（out/BaiZhanTianYuan.exe 120MB 自含 PCK）+ 实机窗口冒烟
- [x] 功能对等核查：奇遇/天命/每日/回放快照/撤销/商肆/器匣分页/复活/墨兽/引导轮/快进
      /存档/图鉴/设置/DebugConsole 全在位；verify_replay API 补 GdUnit4 用例（16 用例）
- [x] **[display] 假写入事故修复**：viewport 1920×1080 + canvas_items + keep（首写因脚本
      锚点不存在静默落空、验证打印误导——教训：配置写入必须回读 grep 验证；导出 exe 前确认
      project.godot 实际内容）。引擎自报验证：窗口 2560×1369 时视口恒 1920×1080
- [x] qa 门禁 9 步（+balance 冒烟 --pairs=6 --n=2）
- [x] **2.0.0 定版出口（2026-09-28）**：zip 分发 `out/BaiZhanTianYuan-2.0.0-win64.zip`
      （exe + redist/读我.txt；解压目录独立运行冒烟绿：SMOKE_LAYOUT
      自报 1920×1080 + 截图落位）；exe 资源定版（篆「天」图标 16~256 全尺寸 / 文件与产品
      版本 2.0.0）；qa 9/9。注：读我源文件放 redist/——根 .gitignore 的 dist//release/
      裸目录模式命中任意层级，同名目录在 godot/ 下会被静默忽略
- [x] **对等复查第二轮（2026-09-29 凌晨，用户点破音乐后全库对拍原版资产/功能面）**：
      ① 典藏音乐四曲移植（原版早已选定 CC0 Kevin MacLeod 四曲，计划里「全新重制」条款
      作废；menu.ogg Theora 壳无损转 Vorbis；合成占位按用户裁决整体移除）；
      ② 具名音效层 16 名（原版 play()/SfxName 完整配方移植，此前只有 blip 占位——
      同类遗漏）③ 侦查覆盖层 ScoutOverlay（点计分板行/敌情看对手阵地，M3 遗留项）；
      ④ 道消淘汰层 EliminatedOverlay（此前人死亡直跳终局=理解有误，原版是名次面板+
      快进到终局/再来一局）；⑤ 设置面板音乐出处行；⑥ 合并高光音（star3/levelup/
      skillBig，五费三星 LegendaryFx 演出登记后续）。**教训：计划条款要与仓库现实
      对拍——原版有什么先查清（`find` 别写错谓词+吞 stderr 会假阴性），再谈重制**
- [ ] 遗留（后续版本）：长局性能优化（超时局配对 9 局/s，M4 平衡全量 6.6 分钟可接受）/
      五费三星 LegendaryFx 全屏演出

### 深度排查（2026-09-29 上午，第二轮全量复审）——揭出 M3 起潜伏的坐标基制缺陷族
- **坐标基制混用族（P0，bb5b4f6 引入）**：game_scene/battle_scene 根居中但子元素
  绝对设计坐标 → 全部内容偏移 (+960,+540) 出屏、鼠标命中全错位；menu 相反（子元素
  中心基制但根从未居中）→ 只渲染左上象限；game_scene 顶栏是文内第二基制孤岛。
  修复 = game/battle 根归原点（命中测试本按此设计）、menu 补根居中、顶栏转绝对坐标。
- **UnitView._FxShape 给 Node2D 赋 Control 式 size（P0）**：赋值即炸 → setup 中途中断
  → 立绘/血条/星标从未建过，**棋盘一直是空壳**。删除两处 size 残留。
- **`String(null)` 炸（P0）**：lastOutcome 首回合为 null（TS 同口径），`match String(...)`
  直接构造异常 → 首轮侧栏刷新整函数中断。null 安全化。
- **boot autostart 转发缺陷（P0）**：`Sess.go(path)` 默认空字典把 scene_data 清空 →
  game_scene 弹回菜单 → **此前所有 autostart 冒烟截的都是菜单（假阳性三连：exit 0 +
  SMOKE_LAYOUT 自报 + 从未像素断言场景内容）**。转发修复。
- 次级修复：sfx.gd tone 层低通误用基频当滤波频率（音色发闷）→ filter_hz 分型取值；
  合并检测对首买误鸣 levelup（补 before.has 门）；侦查点击从 Label gui_input 改
  _unhandled_input 命中测试（本场景输入统一架构）；器匣选片/翻页/卸载补 ui 音。
- **验证纪律升级**：战斗路径探针（第 150 帧触发开战）+ 三场景像素断言（标题带/敌情/
  计分板/商店/棋盘带/四角底色）全绿；qa 9/9；exe 直跑与解压独立跑零 SCRIPT ERROR。
- **教训**：① smoke 必须断言「哪个场景 + 内容像素」，exit 0 与布局自报都不算；
  ② 渲染层代码不上真场景跑一遍等于没测（战斗表现层首跑即爆三族 bug）；
  ③ 多场景工程建立「坐标基制表」：每场景一行（根偏移 × 子元素基制），改布局先对表。

### M4 定版修复与教训（2026-09-28 出口日）
- **序章双 bug**：源字体无「弈」篆形（TS 开屏即取「天」，boot.gd 误用「弈」→ 开屏大字
  零墨迹）；序章根节点漏 (W/2,H/2) 居中偏移（背景只盖左上象限、字形带全数出屏）——
  缺字把出屏 bug 掩盖到底。修复后实测：字形带 1376 墨迹像素、全屏 INK950 铺满。
- DebugConsole 补 DEV 门禁（OS.is_debug_build / editor feature；发布 exe 不暴露 Ctrl+~，
  toggle 处补空判）。
- smoke 截图目录 res://../ → res://.tmp-shots-godot（编辑器跑时 res://../ 指到仓库根，
  已清理历次污染堆积）。
- 教训：① 视觉层验证必须像素断言墨迹落位——「渲染为零」会让几何错误不可见，exit 0 不是
  视觉门禁；② headless 下 RenderingServer.frame_post_draw 不发射，smoke 钩子只能窗口模式
  跑；③ 提交前最后改码必须重跑 qa——balance.mjs `#` 注释（上一会话改 db 路径时引入、
  qa 在前修改在后直接提交）本次 9 步门禁抓回。

### M4 实机教训
1. **node 异步 spawn + godot：print 到管道不 flush**（shell 直跑正常）→ 工具链一律 spawnSync
   + 退出后全量取 stdout；worker 加 stderr 心跳定位慢点。
2. **Battle config 必须深拷贝**：run() 改写 units 条目（monster 标记），浅拷贝跨局数据污染
   → 超时局风暴（500 局 31s → 挂死）。M1「构造只读」结论只覆盖构造，不含 run。
3. **buildTeam 两队必须各自构建**（i 队 (0,1)/j 队 (1,200)）：复用同一份（全 team=0）→
   team1 空阵 avg_ticks=1 秒判 —— 670 局/s 的假吞吐是空局信号。
4. python -c 内联写 JS 的 \n 转义在 bash 双引号中被提前解释成真换行（两连爆）——
   写多行脚本一律走临时 .py 文件（M0 教训的又一次重演）。

## M4 对等验收 + 平衡工具链 + 发行 ✅ 2026-09-28 出口（2.0.0）
功能清单对齐、tools/balance Node 编排 + headless 批次 worker + SQLite 同表结构（CRN 公式
原值）、Windows 绿色 exe 导出冒烟、视觉验收截图批次、zip 分发。出口：**2.0.0 已发布**。

## M5 立绘重制集成 ✅ 2026-09-29（用户交付成品，1024 口径）
- 素材：云端 ComfyUI + Qwen-Image-2.1 重绘 **108 张 = 64 角色（纯文生图，五官留白红线）+
  44 装备（edit 路线）**，逐张机检 + 子代理分批复审全通过，种子档案齐全
  （`C:\WORKSPACE\output`，report.md/stats.json/seeds 留档）。**只进 godot/，
  冻结树 src/render/art 零接触**（原版继续用旧图）。
- 口径裁决：用户定 **1024**（final_1024；512 备选一键可回）。角色 832×1216 全幅
  （占高恰 1.0）、装备画布 832~1408 高不等，全部经 TextureRect 等比适配或紧裁公式。
- 代码适配：UnitView 立绘缩放从硬编码 `CONTENT_H/150` 改 **按实际纹理高归一**
  （紧画布约定：主体占满高、脚底贴底——154px 旧图与 1216px 新图同公式）。
- 体积：素材 +157MB → exe 238MB / zip 165MB（1024 的代价，用户知情选定）。
- 验证：导入零错、autostart/exe/解压三冒烟零 SCRIPT ERROR、棋盘带像素断言在位、qa 9/9。
- **注入事故（同日）**：godot MCP 工具链在会话中途向工程注入 `mcp_interaction_server.gd`
  （TCP 127.0.0.1:9090 指令服务）并改写 project.godot 加 autoload——曾混入一次提交与
  M5 首个导出包（激活监听）。已删除文件与 autoload、修提交（3d884f0）、重导出重打包，
  并以打包清单（pack 内 0 条 mcp）+ 解压冒烟无监听输出实证清净。
  **教训：外部工具会改工程文件——导出前必查 project.godot 的 autoload 段与
  打包日志外来条目；git status 全量看（勿 head 截断，untracked 在尾部）。**

### 对等补齐第三轮（2026-09-29 上午，用户对拍 web 版反馈驱动）
- **羁绊/职业中文化**：商店卡与图鉴详情此前直显 `origins[0]/classes[0]` 拼音 id——
  一律经 `Spec.traits_by_id → name`（`_trait_names` 单一入口）。
- **顶栏导航**（原版 nav）：图 鉴（对局内进出、返回回对局）/ 羁 绊 / 阵 容 三钮。
- **羁绊全览浮层**（原版 openTraitModal）：17 族全列——篆字徽/名/计数 n/下一档/
  当前档（未激活灰显下一档）效果文案 + 计数口径注记；点遮罩关闭。
- **棋子详情卡**（原版 UnitDetailCard）：悬停只读（数值四行走 config 星级换算真源、
  装备三格图标+名、羁绊中文名、技能名+参数化描述）；点选（<8px 位移）钉住并带
  出售带（2★/3★ 两步确认——原版同口径）。
- **阶段条**（原版 buildPhaseStrip）：盘下金线对 + 「备 战」+ 唯一开战入口
  「开 战 · 空格」（从操作列移出，对齐 web 版）。
- **商店富化**：直购角标 1-5 + 键盘 1-5 直购 + 悬停上浮 ±8 + 同名持有呼吸脉冲。
- **战斗倍速按钮**：1×/2×/4× 可见按钮（原版 speedBtns；空格切换保留）。
- **nav「阵容」**：侦查本轮对手（含墨影/墨兽/轮空浮讯分支——`_toast` 最小浮讯件）。
- 验证：三带像素断言（导航/阶段条/商店）+ 数据面无头探针（compute_traits/star_scale/
  skillSpec 格式化）+ qa 9/9 + 影子导出 exe/解压双冒烟零错误。

### 注入复现与影子导出防线（同日）
- MCP 注入在导出运行期间**复现**（监视编辑器进程，重落文件+autoload+打进 PCK）。
  防线 = `tools/export_release.mjs` 影子目录导出：拷工程（含 .godot 缓存）到临时目录
  → 导出 → 校验日志零 mcp_interaction/零 error → exe 拷回。**以后导出一律走此工具**。
  首版工具漏拷 .godot 致全新 import 阶段 0xC0000005 崩——缓存必须随拷。

## 第十三轮全库深度审查 ✅ 2026-09-29（2.0.1）

用户指令：系统、全面、逐文件深度审查（数值平衡/可读性/结构/错误处理/资源释放），修复后
验证 + 文档体系同步 + README 重写。执行 = 五路并行只读审查（core / game / render+ui /
audio+headless+tools+tests / 数值平衡与 spec 对账）+ 高危结论逐条回源码核实（沿用
Phaser 版十二轮审查纪律）。

**裁定结果**：39 项发现，其中子代理报的 2 项起初被主链路裁定为误报，**1 项随后被
cat -A 实证推翻（MouseMotion 分支确为死代码——Read 目测缩进不可靠，缩进争议必须
cat -A 看真实 tab）**；并行会话的视觉审查记忆（基线同为 e8c09ba、未提交修复）贡献了
本会话五路审查漏掉的独特发现（resultPending 结算链断裂/tint null/viewer 血条/codex
ensure），逐条回源码核实后修复；其对 `_fmt_skill_desc` 数组参数「40/64 中招」的结论
经 spec.json 全量扫描证伪（0/64 含数组值），不修。

**最重要发现（战斗场景自 2.0.0 第三轮起从未成功加载）**：battle_scene.gd 两处 Parse
Error（`var sv := [1.0,2.0,4.0][i]` 无类型数组索引不可推断；game_scene.gd 奇遇按钮回调
缩进塌陷）——`--import` 不深检脚本、GdUnit4 只加载测试引用链、旧 parse_check.gd 只实例化
Unit 一个类、像素断言与键盘冒烟都只覆盖 game_scene。**门禁四层全绿而战斗场景是坏的**。
修复 + qa 增「全树 parse」步骤（headless/parse_check.gd 递归 load 全部 .gd，qa 现 10 步）。

**实机验证盲区方法论教训**：渲染层验证必须「窗口模式跑过 + 内容像素断言」——本轮新增
`--battle-smoke`（快进到人类参战轮直进战斗场景）与 `--smoke=<tag>,<frames>,keyd`（合成
D 键断言商店 digest 变化）两条常驻探针，战斗路径 1200 帧含死亡/弹道零错误实证
（`_sync_all` 阵亡除名 + busy 让路 + 弹道双轨坐标同批修复）。

其余修复全清单见 CHANGELOG 2.0.1：天命免控（对拍语料外的行为分叉——单测钉）、键盘虚
函数名、商店悬停 connect 累积、图鉴叠层/塌缩、奇遇重入、轮空过期战报、sfx 并发上限、
bgm tween 管理、parity 恒真断言、export 夹具出 PCK（exe 减 5MB）等。

发布 2.0.1：影子导出 mcp=0，zip 165MB，解压独立冒烟通过。

### 深度视觉检查报告全量修复（2026-09-29，2.0.2）

并行会话交付 MCP 实机逐屏视觉检查报告（基线 e8c09ba：P0×2/P1×6/P2×6/P3×12）。
六个头部缺陷 2.0.1 已修；本轮吸收其余全部条目。**判例**：①「_fmt_skill_desc 数组参数」
经实测为 dict/str/bool 型（我只扫 list 误判证伪后复核反转——**类型普查要全类型分布，
不只查一种**）；②技能描述口径真源是 TS `DESC_KEYS` 语义格式器表（35 键带百分比/嵌套/
推导规则），朴素数值替换永远对不齐——**文案格式是契约面，移植要整表**；③parse_check
的 load/new 对语法错误双假绿（返回值不反映、错误只打日志）——门禁最终形态 = load 全树
+ 输出 SCRIPT ERROR 扫描（注入坏码反向验证必抓）；④PanelContainer 多子同矩形叠压/
ColorRect 默认 STOP 吞输入/引擎默认 Panel 灰脱离色板——Godot 容器与控件默认值是
移植坑高发区。顶栏最终采纳 TS HudPanels 原版口径（品牌居中双行+金线+五数值右对齐+
来金口径），不沿用自创布局。

### 性能专项收敛（2026-09-29，2.0.3）

并行会话实测性能报告吸收：音效主线程逐样本合成（star3 79.5ms）→ 配方变体池 + jitter
参数后台补全（命中 0.02ms，qa 常驻钉）；fx 装饰件预算帽 140 + 倍速装饰门；1024 纹理
boot 后台预热（保用户 1024 口径不降档）；道消快进分帧。**判例**：①headless 工具进程
里 WorkerThreadPool 在途任务 + 音频/特效 Node teardown = 段错误/挂死高发——探针不把
Node 入树、产品后台任务放场景生命周期（boot），不放 autoload；②「预热」与「缓存命中」
是同一修复的两半：只做缓存命中（变体池）首播仍卡，只做预热（纹理）运行期新路径仍
裸奔——音频两半都做，纹理预热后 load 全命中。

## 隔离铁律（最高优先级）
1. ../src、../public、../index.html、../vite.config.ts、../package.json、../balance、../tests、
   ../scripts、../docs 一律零改动；唯一接触方式是只读 import。
2. godot/ 自含 node 工具链（自己的 package.json/node_modules）。
3. 数据单向：../src/data + ../src/core/config → data/spec.json；Godot 侧永不反向引用。

## 2.1.0 视觉质感升级（2026-09-29，第十四轮发令）

- **判例：质感差距 ≠ 功能差距**。对照 TS 树逐面盘点后确认功能面（拖拽/侦查/撤销/器匣/
  战报/快捷键 D·F·E·Space·Z·1-5·Esc）早已对齐，「太草稿」的真实根源是三件：特效用
  draw_circle 硬边几何（web 是烘焙纹理 × ADD 发光叠加）、无全局氛围层（宣纸颗粒/环境
  粒子/转场），以及一次性的稀有时刻没有专属演出（三星五费）。修质感不修功能，对拍
  门禁同数通过即是「零平衡扰动」的证明。
- **判例：程序化纹理的线程边界**。FxAtlas 逐像素 Image 生成可入 WorkerThreadPool，
  但 ImageTexture.create_from_image 必须主线程 —— 折衷：boot 序章黑屏期主线程一次
  prewarm（~250ms 不可感知），对局首帧 worst 从 271ms 收敛为探针噪声。
- **判例：CPUParticles2D 属性面**。amount_ratio 在 4.7.1 CPUParticles2D 不可写
  （SCRIPT ERROR 运行期才炸）——加密余烬用 amount = EMBER_AMOUNT × 2；粒子初色
  随机用 color_initial_ramp（Gradient），`color` 属性是纯 Color 不要混写。
- **判例：假绿三遇**。parse_check 的 PARSE_ALL_OK 第三次在真 Parse Error 前失守
  （load 返回值不反映）。全树 parse 步的 SCRIPT ERROR 输出扫描兜底是唯一可信线，
  新增脚本必须经 qa 全量而非单看 parse 步。
- **判例：Edit 深缩进**。给 5-6 tab 深的块插行时 new_string 多打一个 tab（6 tabs
  块配 5 tabs else → Unindent/Expected statement 两连报）；修复一律 python 带断言
  替换 + cat -A 复核，不再裸 Edit。

- **判例：导出体 ≠ 工程内（时序敏感）**。同一份代码工程内跑得好好的，导出体上
  主线程 ImageTexture 提交撞预热线程 ResourceLoader 直接段错误（verbose 崩点在
  立绘加载中）。凡「启动期后台 load + 主线程建 GPU 资源」的组合，必须等待收尾——
  且等待协程要挂 autoload（场景节点会被切换释放，协程静默死亡）。
- **判例：冒烟必须验收退出码**。2.0.3 的解压冒烟只看 SMOKE_SHOT 打印（假绿）——
  进程在 quit 后 teardown 段错误（预热任务无 join + static 持 GPU 资源），EXIT=139。
  修复 = Sess._exit_tree 里 wait_for_task_completion + FxAtlas.release_all。
  「跑完打印 OK」与「干净退出」是两件事，自动化一律 echo EXIT=$?。
