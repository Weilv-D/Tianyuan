# 夜宴 · Godot 版变更日志（版本线 2.0.x）

## 2.0.1（2026-09-29，全库深度审查收敛）

五路并行只读审查（core / game / render+ui / audio+headless+tools+tests / 数值平衡与 spec 对账）
+ 主链路逐条回源码核实。39 项发现按严重度裁定：2 项误报驳回，其余全部修复。

### 战斗返回结算链与鼠标热区（第二批，交叉验证驱动）
- **战斗返回后结算链断裂**：battle_scene「返回」直跳 game_scene 而 `_ready` 无 from_battle
  检测——end_round 被跳过（快照/终局 rank1 丢失）、双列战报面板战斗路径永不可达（只有
  轮空弹）、阵亡被直送 result 绕过道消层。修复：非终局返回带 from_battle →
  `_after_settle`（end_round + 存档 + 战报面板，「继续」分流终局/道消/下回合）；终局直跳
  前补跑 end_round。
- **MouseMotion 分支死代码（P0）**：`elif event is InputEventMouseMotion` 缩进挂在
  `if e.button_index == MOUSE_BUTTON_LEFT:` 同级——event 已判定是 MouseButton，恒假。
  悬停笺/悬停详情卡/拖拽跟随三功能从未工作。修复挂到外层；并给详情卡与悬停笺加同
  iid/同徽章短路（Motion 逐帧触发不再重建卡体，悬停笺随 refresh 关闭防过期计数）。
- **静态装饰 Control 吞鼠标**：ColorRect/Panel 默认 mouse_filter=STOP，全屏背景/bench
  框/器匣框/出售印等挡在 `_unhandled_input` 命中测试热区上。修复：_ready 静态构建后
  根级遍历统一放行（浮层 dim/panel 与交互按钮不在遍历范围）。
- 图鉴首访补 Spec.ensure（进程首个触达 Spec 的场景网格全空）；EffectsLayer._tint_of
  对「存在但 null」的 tint 键回落默认色（GDScript get 不对 null 值键回落，战斗首个
  核心特效曾炸）；战斗血条改 viewer 相对色（swap 局敌我不再颠倒，低血提亮同步）。
- 冒烟探针扩容：`--smoke=<tag>,<frames>,hover`（塞棋子+合成 Motion+断言详情卡，窗口
  坐标按 win/design 换算——parse_input_event 收窗口像素坐标，设计坐标直发命中点会
  缩到左上别处）。

### 战斗场景失能与门禁盲区（本轮最重要发现）
- **battle_scene.gd 两处 Parse Error（`var sv :=` 数组索引不可推断 / game_scene.gd 奇遇按钮
  回调缩进塌陷）**：`--import` 与 GdUnit4 都不深检未被测试引用的渲染层脚本，qa 门禁全绿而
  战斗场景自 2.0.0 第三轮起从未成功加载。修复 + 门禁补洞：headless/parse_check.gd 升级为
  全树脚本逐个 load 检查并纳入 qa（步骤 1b，qa 现为 10 步）。
- **首个阵亡即崩的悬空引用**：battle_scene `_sync_all` 逐帧读 `views[uid]`，死亡动画
  queue_free 后字典残留 freed 实例 → 整个同步循环中止。修复：阵亡即除名 +
  `is_instance_valid` 双保险（窗口实机冒烟 1200 帧含多次死亡零错误实证）。
- 演出被逐帧覆写：`_sync_all` 无条件硬写 position 压死 hop/攻击突进/死亡下沉三套补间。
  修复：UnitView 增 busy 持有计数，位移补间期间同步让路。
- 弹道坐标基制混用：bolt 挂根空间 float_layer 却用棋盘局部坐标（偏移 ~board_view.position
  + 1/4 缩放）。修复：双轨换算（局部给 fx_layer._spark、根空间给 bolt）。

### 键盘层死亡
- `_unhandled_keyinput` 拼错 Godot 4 虚函数名（应为 `_unhandled_key_input`）→ D/F/E/Z/
  1-5/ESC/Ctrl+~ 整层从未被引擎调用；「开 战 · 空格」承诺的空格分支不存在。修复 + 补
  KEY_SPACE；session 冒烟钩子增 keyd 探针（合成 D 键断言商店 digest 变化，回归钉）。

### 内核对齐（对拍门禁未覆盖面）
- **天命 3★五费免控移植缺失**：TS `ccImmune: legend ? 1e9 : 0` 在 Unit 构造遗漏——3★五费
  可被眩晕/沉默/缴械/减速/嘲讽，与 TS 行为分流（对拍语料无天命局未覆盖）。修复 +
  battle_test 新增回归钉（含 1★ 对照与 add_status 直测）。
- 战斗输入校验 continue→整场拒建（对齐 TS throw：非整数 uid/格、重复 uid、越界/重叠格、
  未知棋子）；排序比较器与 cell 索引缺键容错；EFFECT_INTERVAL 从 Spec 推导消除双真源；
  MATCH_TUNING 兜底值对齐 config 真源（防 spec 损坏时处决曲线静默漂移）；Spec.mech/legend
  缺键由静默 0.0 改报错。
- 对局层：buy 负索引回绕守卫、can_place 备战席 -1 回绕守卫、死者名次并列 idx 决胜
  （对齐 JS 稳定排序）、clone_board 冗余双写合并。

### 表现层资源与状态
- 商店悬停 connect 在 refresh 循环内重复累积（常驻按钮不随刷新销毁）→ 挪到构建时一次，
  增 `_hover_shop` 换向 kill（对齐 web hoverTween 语义）。
- 图鉴详情叠层守卫（连点 N 格叠 N 层 dim）、九宫格 VBox 显式尺寸（Button 非容器，塌缩到
  最小内容高）、奇遇面板已开守卫（refresh 重入叠加且旧按钮仍连 resolve）、轮空回合清
  battle_stats 残留（不再显示上一场战报）、_toast 闭包捕获局部（旧 tween 不再误删新
  toast）、顶栏标题右置（居中大字与状态标签叠印）、羁绊轨渲染可见门与输入侧同源、
  计分行/详情卡几何常量化入 Layout/HudLayout（消除字面量双写）、血条低血提亮可恢复、
  立绘 _process 纹理 null 守卫、震屏连发先 kill 旧 tween、SceneTreeTimer 回调
  is_instance_valid 前置、fullscreen_flash 原点铺满并挂场景根（缩放子树内会被缩到 1/4）。
- 锁店动作对齐 web onToggleLock：不入撤销栈、走 afterAction 落盘（此前只刷新不落盘）。

### 音频与工具链
- sfx 增 24 声部并发上限（超限强停最旧，防大规模团战节点堆积）；bgm 淡切 tween 持引用
  管理（连切不叠）、stop() 同杀 pending 回调（0.45s 内 stop 不再被 _switch 复活）。
- parity_check 双端探针同殓恒真断言补 `__error(both)` 检查；extractTag 坏行容错（qa 同步）。
- export_release：data 只拷 spec.json（三份对拍夹具 4.5MB 曾打进发布 PCK）、try/finally
  保证任何退出路径清影子目录、删除永不触发的死代码兜底分支。
- balance.mjs：git_head 真正入库（DDL 声明列此前恒 NULL）、批次临时文件 exit 钩子统一
  清理（worker 失败路径同样覆盖）。
- 测试强化：hud_layout 恒真断言（数学恒等式）移除并注明理由、恩赐日程断言改循环外钉死
  （内嵌 if/else 分支在日程漂移时静默走假分支恒绿）、qa 增全树 parse 步骤。

### 数值平衡与单一真源审查结论
- spec.json 与冻结仓抽样 10 棋子逐值一致、fnv1a32/sha256 与文件头记录吻合、全树唯一消费口
  （core/spec.gd）；显示路径无平衡数值字面量；详情卡口径与 web 备战悬停卡一致（基础星级
  面板值，注释勘误为准确口径——原注释自称「同结算口径」不成立，结算含天命/登峰乘区）。
- 本轮 core 数值面改动（cc_immune/EFFECT_INTERVAL/MATCH_TUNING 兜底）全部不改变现役
  对拍与平衡读数：qa 10/10、battle 21/21、match 7/7 全绿。

### 发布
- `out/BaiZhanTianYuan-2.0.1-win64.zip`（165MB，exe 233MB——夹具出 PCK 后较 2.0.0 减
  ~5MB）；影子导出 mcp_entries=0 / errors=0；解压目录独立冒烟通过。
- 实机窗口验证矩阵：战斗路径 1200 帧含死亡/弹道零脚本错误（棋盘带 100% 内容渲染）、键盘
  D 键 reroll 生效（金 50→48 商店 digest 变化）、game 六带像素断言（导航 4500/阶段条
  10800/商店 44800/右置标题 4750/状态区 9250/棋盘 72000）。

## 2.0.0（2026-09-28，正式发布）

### 发布
- Windows 绿色分发包 `out/BaiZhanTianYuan-2.0.0-win64.zip`：exe 121MB 自含 PCK → 压缩 47MB，
  内含 读我.txt；解压目录独立运行冒烟通过（SMOKE_LAYOUT 自报 1920×1080、截图落位）
- exe 资源定版：应用图标（沉夜底 + 金线环 + 篆「天」，色值取 palette 唯一色源，
  16~256 全尺寸）/ 文件与产品版本 2.0.0
- qa 门禁 9/9（import / spec 对账 / GdUnit4 / rng / battle / codec / match / balance）

### 修复（定版扫出）
- **序章零墨迹双 bug**：源字体无「弈」篆形（TS 开屏即取「天」，boot.gd 误用「弈」）；
  且序章根节点漏 (W/2,H/2) 居中偏移——背景只盖左上象限、字形带出屏。修复后实测
  字形带 1376 墨迹像素、全屏 INK950 铺满
- DebugConsole 补 DEV 门禁（发布 exe 不再暴露 Ctrl+~）
- balance.mjs `#` 注释语法错（上一提交收尾改 db 路径时引入、改后未回归，本次门禁抓回）
- smoke 截图目录 res://../ → res://.tmp-shots-godot（编辑器跑时不再写仓库根）

### 对等补全（同日第二轮：原版资产/功能面复查，扫出即修）
- **典藏音乐四曲移植**：原版选定的 CC0-1.0 四曲（Kevin MacLeod，freepd.com）按四心境
  循环（audio/music_tracks.gd 单一真源 + bgm.gd 授权曲路径，同心境不重启、0.45s/0.7s
  淡切）；menu.ogg 从 Theora 封装无损转出纯 Vorbis；程序化五声音阶占位整体移除
  （用户裁决：不留合成兜底）；设置面板与读我带「音乐 4 曲 · Kevin MacLeod · CC0」出处行
- **具名音效层**（audio/sfx.gd）：原版 SfxName 16 名 + playPluck 配方逐参数移植
  （tone/noise/sweep 三基元 + RBJ biquad + 等功率声像，立体声现渲染）；全挂点接线——
  买 coin/warn、经验 levelup、合并二星 levelup/三星 star3、五费三星 star3+skillBig、
  开战 pluck 徵音 196Hz、战斗 heal/shield/cast/skillBig/shoot（贴命中瞬间）/death、
  回合结算 uiBig/warn、淘汰 defeat、终局冠军 victory、菜单/图鉴/倍速 ui；
  伤害事件保持无声（原版同口径）；倍速排水期不出战斗音
- **侦查覆盖层**（原版 ScoutOverlay）：点击计分板行/敌情查看对手阵地只读快照
  （8×4 立绘+星级+装备图标+激活羁绊行；墨影走 boardOfOpponent 出局阵容）
- **道消淘汰层**（原版 EliminatedOverlay）：玩家出局不再直跳终局——「道 消」面板
  （名次/回合/战绩 + defeat）+「快进到终局」（begin/settle/end ≤60 回路与原版同构）
  +「再来一局」（弃档新种开normal/daily 同模式）

### 修复（2026-09-29 深度排查——揭出 M3 起潜伏的坐标基制缺陷族）
- **场景坐标基制混用（P0）**：对局/战斗场景根误居中而子元素为绝对设计坐标，全部
  内容偏移出屏且点击全错位；主菜单相反（根未居中）只渲染左上象限；对局顶栏为文内
  第二基制孤岛。三处统一修复（对局/战斗根归原点、菜单补居中、顶栏转绝对坐标）
- **棋盘空壳（P0）**：UnitView 投影形状给 Node2D 赋 Control 式 size 即炸，setup 中断
  ——立绘/血条/星标从未渲染过；删除残留赋值
- **首轮侧栏刷新中断（P0）**：lastOutcome 首回合为 null，String() 构造直接异常
- **autostart 冒烟假阳性（P0）**：boot 转发 Sess.go 未带 scene_data，冒烟全部截的是
  菜单——修复转发并升级验证纪律（场景断言 + 内容像素断言 + 战斗路径探针）
- 音色勘误：tone 层低通误用基频当滤波频率（发闷）；合并检测对首次买入误鸣 levelup；
  器匣选片/翻页/卸载补 ui 音；侦查点击改 _unhandled_input 命中测试（输入统一架构）

### M5 立绘重制集成（2026-09-29，用户交付成品）
- 64 角色 + 44 装备全套重绘（云端 Qwen-Image-2.1 管线，逐张质检）按 **1024 口径**
  替换 godot/assets（仅 Godot 版，原版不受影响）；UnitView 缩放改按纹理高归一
  （旧 154px 与新 1216px 素材同公式）；exe 238MB / zip 165MB

### 对等补齐第三轮（2026-09-29，对拍 web 版反馈）
- 羁绊/职业全面中文化（商店卡/图鉴详情此前直显拼音 id）
- 顶栏导航三钮（图鉴/羁绊/阵容）+ 羁绊全览浮层（17 族全列带档位效果）
- 棋子详情卡：悬停只读 / 点选钉住带出售（2★ 两步确认）
- 阶段条与唯一开战入口「开 战 · 空格」；商店直购角标 1-5 + 键盘直购 + 持有脉冲；
  战斗倍速按钮 1×/2×/4×
- MCP 注入复现→影子目录导出防线工具化（tools/export_release.mjs）

### 已知事项
- 平衡模拟吞吐 ~9 局/s（工具链侧，不影响游玩）
- 五费三星 LegendaryFx 全屏演出未随 skillBig 移植（登记后续增强）

## 2.0.0-m4（2026-09-28，M4 进行中）

### 新增
- 平衡工具链（Node 编排 + Godot headless 批次 worker）：
  - `tools/balance.mjs`：PRESET_COMPS 九套 × 72 配对矩阵，CRN 金锁种子
    （`seedBase + pairIdx*104729 + k*7919`，DEFAULT_SEED_BASE=20260829 原值复刻）；
    SQLite 四表同结构入库（runs/configs/pair_results/unit_stats，node:sqlite）；
    胜率矩阵 + 极差汇总。默认单进程（多进程冷启动抢 .godot 缓存锁，--workers=N 错峰可用）
  - `headless/balance_worker.gd`：批次包模式（原 stdin 常驻方案在 Godot 4.7 不可行——
    子进程侧无 stdin 读取 API，登记设计变更）；逐单位聚合（dealt/taken/healed/absorbed/
    casts/三色构成，召唤物归 (summon) 桶）
- Windows 绿色单 exe 导出（`out/BaiZhanTianYuan.exe`，120MB 自含 PCK）
- qa 门禁第 8 步：balance 冒烟（n=2 → 72 配对 144 局 → SQLite）

### 修复
- **窗口不居中（只显示右下角一块）**：[display] 拉伸配置首次写入为假写入（脚本锚点
  不存在静默落空）；真正写入 viewport 1920×1080 + stretch canvas_items + aspect keep
  后由引擎自报验证（窗口 2560×1369 时视口恒 1920×1080）。**教训：配置写入必须回读
  验证，且导出 exe 前确认 project.godot 实际内容**
- 排除 GdUnit4/测试脚本进导出包（exclude_filter）

### M3 下批补记（同日）
- 漆纹噪声着色器棋盘（lacquer.gdshader）；DebugConsole 命令面九命令
  （作弊 randi() 非对局随机流纪律）；BGM 四心境路由（五声音阶 pad 占位）

## 2.0.0-m0 ~ m3（2026-09-28）

- M0 骨架与对拍地基（RNG 精确移植/PARITY_CODEC/GdUnit4）—— commit 22f72ee
- M1 战斗内核（1,023 局 × 370,474 事件跨引擎逐位一致）—— commit 09256f4
- M2 对局层（7 整局 × 251 状态行逐行一致，含交叉读档/撤销/每日）—— commit 4e92731
- M3 表现层三批（资产迁移/调色板/布局契约 20 用例/场景树闭环/16 类墨迹特效/
  战报双列/器匣分页/羁绊笺成员卡/设置/图鉴/DebugConsole）—— commits bb5b4f6, 9f88d68
