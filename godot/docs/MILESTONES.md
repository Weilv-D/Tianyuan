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

## M4 对等验收 + 平衡工具链 + 发行
功能清单对齐、tools/balance Node 编排 + headless 常驻池 + SQLite 同表结构（CRN 公式原值）、
Windows 绿色 exe 导出冒烟、视觉验收截图批次。出口：2.0.0 发布。

## M5（待令）立绘 512 重制批次
8 张样稿过审 → 64 张量产 → 集成。本次不实施。

## 隔离铁律（最高优先级）
1. ../src、../public、../index.html、../vite.config.ts、../package.json、../balance、../tests、
   ../scripts、../docs 一律零改动；唯一接触方式是只读 import。
2. godot/ 自含 node 工具链（自己的 package.json/node_modules）。
3. 数据单向：../src/data + ../src/core/config → data/spec.json；Godot 侧永不反向引用。
