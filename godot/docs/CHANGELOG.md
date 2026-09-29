# 夜宴 · Godot 版变更日志（版本线 2.x）

## 2.2.0（2026-09-29，超越 web 版 —— Godot 独有表现层）

用户裁决「质感表现要远远超越 web 版本」——2.1.0 完成对齐后，本版启用 web (Canvas2D)
做不到的引擎能力：打击感顿帧、真 2D 光照、镜头语言、材质化 UI、墨晕转场。零平衡/内核
改动（对拍门禁同数通过）。

- **打击感三件套（battle_scene 相机语言）**：
  - hit-stop 顿帧——暴击 50ms / 处决 140ms，判定时钟冻结（acc 停推）而粒子/飘字补间
    照飞，「时间被砸停一瞬」；
  - zoom punch——暴击 1.2% / 处决 3% 缩放猛压（以棋盘中心为锚，position 补偿防漂移）；
  - 处决慢镜——kill 且伤>0 时判定时钟以 0.35 倍推进 400ms（内核慢放，演出原速）。
  静观模式全部旁路（fx_layer.calm）。
- **施法推镜**：castStart 时画面向施法者缓推聚焦（普通 6% / 五费 10%，入 0.24s →
  驻 0.42s → 回 0.4s）——「谁在吟唱」的镜头语言。
- **死亡墨晕溶解（render/dissolve.gdshader）**：噪声阈值吞没立绘 + 裁切缘染墨 + 整体
  微沉，同时九珠朱黑墨点四散下沉——「人化墨而去」（web 版只有整体淡出）。
- **夜宴烛光（board_view 2D 光照层）**：棋盘两盏米金 PointLight2D（energy 呼吸 + 灯位
  异频微晃 = 烛光摇曳，blend ADD 在漆面点出暖光池）；施法瞬间施法者脚下动态光骤亮
  （board_view.flash_light）。
- **漆面流光（lacquer.gdshader）**：一道窄亮带沿对角 45s 巡行（TIME 内置），静态包浆
  变成「活的」漆面。
- **攻击 squash & stretch（unit_view）**：攻击蓄力纵向压 0.9、突进时 BACK 弹回；
  落子弹性 place_pop（自上 22px 弹落 + 触地尘点）接入布阵首建。
- **墨晕转场（render/ink_transition.gdshader + session.gd）**：场景切换改为「墨渍吞没」
  ——分形噪声打散的不规则前沿自四周向中心吞没再散开，替代纯 alpha 淡入淡出。
- **UI 漆面材质化（FxAtlas.PANEL + panel_box）**：三大浮层 / 菜单按钮 / 设置面板 /
  图鉴大面板换 9-slice 漆面 StyleBoxTexture（中性亮度纹理 × modulate 染色——底已暗
  再乘深色会黑死，第一次实现翻车实证）；图鉴小卡保 Flat（稀有度色边是信息载体）。
- 判例入 MILESTONES：StyleBoxTexture 无 border_*（运行期才炸）；「底色已暗 × 深色
  modulate = 黑死」的染色数学。
- 验证：qa 11/11；menu/battle 探针零脚本错误；截图目视（漆面按钮/战斗演出落位）；
  版本号 2.2.0（并行会话在途 2.1.1 修复轮避让，minor 语义归属本版）。

## 2.1.1（2026-09-29，第十四轮全库深度审查收敛）

用户实机报告「人物脚底的黑色圆有问题，乱飘」驱动，随后对 godot/ 全树做逐文件深度审查
（69 个 .gd + 11 个 .mjs + 6 个 .tscn + 夹具/配置，约 1.7 万行；core 六件套对照 TS 冻结树
逐点抽验）。10 项发现全部修复，4 项判例登记不修；全部改动对拍零影响（qa 11/11 同数通过）。

### P1 脚底投影错位（用户报告项，视觉缺陷）
- **根因**：`unit_view.gd` 旧投影 `_soft_circle` 内置校正偏移（`position=(-r,-r·1.3)`，
  使 `_draw` 的圆心 `(r, r·1.3)` 恰好落在父节点原点）被 `setup()` 的
  `shadow.position = Vector2(0, 2)` **覆写**——绘制圆心落到脚位 (+26,+35.8)·scale
  （1★≈右下方 +23/+32）：黑圆整体漂浮错位，并随 hop/攻击突进在格间滑移（「乱飘」的
  实机观感）。且形状为 52×52 硬边正圆，而 web 冻结版规格（UnitView.ts:134）是
  **52×20 软椭圆**（glow 纹理压扁、染黑、alpha 0.5、贴脚 (0,0)）。2.0.2 只软化了
  边缘（三层同心），位置与椭圆形状两项背离原样存在。
- **修复前探针实证**：shadow 全局 = view + (+0.5,+3.9 / -2.7,+0.9 …) 逐帧漂移；
  红圈标注截图显示每个角色的黑圆都散落在右下方格间（绿圈=脚位）。
- **修复**：改为 Sprite2D + 程序化径向渐变纹理（64×64 smoothstep 衰减，一次生成
  static 复用），52×20、染黑 alpha 0.5、锚定脚位 (0,+2)；删除 `_soft_circle` 与
  `_FxShape` 的 kind 0 分支（与 web 手工同步关系写入常量注释）。
- **修复后验证**：独立探针 dx≡0.000、dy≡2×scale（1★/2★/3★ 0.9/1.02/1.16 三档
  逐一复核）；战斗场景帧内采样 worst_dx=0.000（12 单位、含移动/战斗/死亡路径）；
  独立截图 + 战斗中段截图像素复核（椭圆贴脚、软边、无漂浮）。

### P2 `--battle-smoke` 探针被 boot 转发架空（门禁回归钉失效）
- **根因**：`session._battle_smoke()` 注册 deferred battle_scene 换场后，
  `boot._ready` 见 scene_data 非空又注册 deferred game_scene——**后注册者胜出**，
  探针永远落在 game/menu（本轮首跑实证：落菜单）。AGENTS.md 规定的战斗路径
  窗口实机冒烟因此从未真正进入过战斗场景。
- **修复**：Sess 增 `battle_smoke` 标志，boot 检测到即整段让路；探针自包含化
  （1200 帧 → 截图 `.tmp-shots-godot/battle.png` → quit 0），可自动化。
- **验证**：单参数全链实测（进战斗场景 → 跑完整场 → 截图落位 → exit 0，零脚本错误）。

### P2 显示路径平衡字面量
- **来金预览字面量**：`game_scene.refresh_all` 的 `5 + interest + streak` 中 5 是
  INCOME_BASE 字面量（TS 冻结版同处亦为字面量；本文纪律：显示路径不落平衡数值，
  spec 调参时预告会与实际收入静默背离）。改走 `Spec.c("INCOME_BASE")`。
- **验证**：game 探针 37 金档顶栏「来金 +8」= 5+3（兴趣档），D 键 reroll 全链零错误。

### P2 GdUnit4 打进发布包
- `export_presets.cfg` exclude_filter 未列 `addons/*` → 整套测试框架进发布 PCK
  （运行时零引用，tests/* 已排除）。补排除；exe 体积收益以下次出包实证为准。

### P3 批（DEV 面/工具链/纵深防御）
- `debug_console` level 命令硬编码 `mini(9, …)` → 读 `Spec.c("MAX_LEVEL")`；
  legend 命令 `merged == null` 时 `bench[-1]` 负索引静默写末格（GD 负索引不报错）
  → 补 else 分支 push_warning 兜底。
- `balance.mjs` runs.label 硬编码 `godot-2.0.2`（发版即漂移）→ 从 project.godot
  派生 `godot-<version>`；`balance_worker` 心跳误打引擎启动累计 ms（原注释意旨
  定位卡点）→ 改打本配对耗时。
- `match.damage_of` / `economy.streak_gold` / `xp_to_next`：空表时负索引读空数组
  直接崩（TS 侧是 NaN 静默传播，同样不可接受）→ 空表守卫 + push_error（spec 对账
  门禁下不可达，属纵深防御）。
- `game_scene` 详情卡横向 clamp 上界硬编码 1920 → `Layout.W`。

### 审查纪律与误报裁定
- spec.json 计数与 hash 全对（64/44/17/36，fnv1a32=b586ca3c，幂等两次导出字节一致）；
  数值单一消费口仅 `core/spec.gd` 一处（grep 全树实证）。
- core 六件套对 TS 冻结树逐点抽验全部一致：warrior/guardian 档位默认表（含 tier≥3
  回落 0.2/0.14）、marksman 第三击 forceCrit、resurrect 费用降序+uid 决胜、
  execute 处决量（hp+shield+1 豁免真伤帽）、chain 衰减式、applyTraits 钩子注册序
  （羁绊 id 字典序 → 装备固定序）、商店权重抽样（严格小于+跳过零权重+末位兜底）。
- **登记不修判例**：① `codec.str_tok` 越界字符 TS throw vs GD push_error 的行为差
  仅存在于脏数据路径（对拍夹具不覆盖，显式报错优于静默）；② debug_console items
  命令的 6 个硬编码装备 id 实测全部在名单内（DEV 面零风险）；③ 空表守卫修的是
  「GD 崩 vs TS NaN」的共同坏结局，不改变任何现行数值路径。
- **并行会话对账**：本审期间并行会话落地 2.0.3 性能轮与本审 2.1.1 前的 2.1.0 视觉轮；
  本审修复（unit_view/session/boot/game_scene/export_presets/debug_console/balance）
  曾以在途态被其收口提交带入历史，内容逐条回核无失真。最终验证树 = 3bc6d05（2.1.0）
  + 本审未提交三件（economy/match/balance_worker）。

### 验证汇总
- `npm run qa` **11/11**（import / 全树 parse / perf 回归 / spec 导出+幂等 / GdUnit4
  4 用例 / rng 6 组合 / battle 21 局逐事件 / codec 24 事件 / match 7 整局逐行 /
  balance 冒烟）。
- 窗口探针：battle-smoke 全链、战斗投影锚定（worst_dx=0.000）、game 顶栏与 reroll
  路径，零 SCRIPT ERROR；修复前后同探针对照（红圈标注截图留档 .tmp，不入库）。

## 2.1.0（2026-09-29，视觉质感全面升级 —— M3 表现层收官）

用户裁决「现有渲染和 UI 太草稿」驱动：对照 TS 冻结树（渲染 12,402 行 vs Godot 版 4,856 行）
逐面补齐质感层差距。功能面（拖拽/侦查/撤销/器匣/战报/快捷键）本已对齐，本版全部火力
集中在「读得懂 → 看得爽」的表现升级；零平衡/内核改动（对拍门禁同数通过）。

- **程序化材质工厂（render/atlas.gd，新增）**：九张白色系烘焙纹理（灵光径向/墨点晕散/
  法环/火星/斩击月牙/六边盾/宣纸纤维/全屏颗粒/暗角）—— 首次取用逐像素生成 + static
  缓存，boot 序章黑屏期一次成型（把 ~250ms 烘焙尖刺从对局首帧挪走）。材质语言与
  textures.ts 同源：宣纸纤维、墨点晕染、鎏金描边、灵光渐隐。
- **特效层全面重写（render/effects_layer.gd）**：原语从 draw_circle 硬边几何换装
  「烘焙纹理 × ADD 混合」软光（发光叠加是 web 版质感的核心，此前缺失是「草稿感」
  主根源）；补齐 TS 全部形态分化——命中六芒/正十字墨花、暴击第二重金环+界格放射线、
  法阵八段虚线弧、治疗灵青菱形符点、六边盾面四符点、召唤界格方阵+四道墨涡、增益描边
  扫环、减损墨滴下坠、地面法阵 telegraph 放射线、光束脉冲节点。渲染预算（140 帽）与
  倍速装饰门保持。
- **伤害飘字九级全对齐**：dot 两系/技能/真伤/暴击/处决/护盾/治疗各有 size/color/
  outline/pop/life；处决（kill 且伤>0）36px 鎏金光、暴击/处决 ADD 发光+横抖顿帧、
  描边色走 DAMAGE_OUTLINE 真源、同目标 110ms 错峰防叠字。
- **天命之印（render/legendary_fx.gd，新增）**：三星五费全屏演出——夜色压暗 → 巨型
  剪影升起 → 196px 朱砂方印携名将竖排篆名盖落（双环印框）→ 落款浮现 → 鎏金尘埃迸散
  + 印身 squash；静观模式自动缩短。发光只此一处，全场最稀有的瞬间独享唯一的 ADD 光。
- **氛围层（render/atmosphere.gd，新增）**：灵尘（盘底缓浮）/ 余烬（战斗朱金、决赛圈
  加密转亮）双 CPUParticles2D 系 + 全屏宣纸颗粒（0.02，数码感的天敌）；倍速联动
  deco_suppressed。
- **棋盘重制（render/board_view.gd）**：分层重构——盘体（鎏金双线框+四角饰+虚线中线+
  星位天元+敌营纱幕）→ 盘心呼吸微光（包浆）→ 格线层（四角刻痕，入场 460ms 次第浮现）
  → 悬停/落点层（金线框语义化）。
- **主菜单「夜色山海」（render/menu_bg.gd，新增）**：index.html #bg 烘焙语言对齐——
  夜空渐变/月晕呼吸/云絮/三层值噪声水墨远山/雾带横移/星尘上浮 + 剪影长卷（五棋子墨影
  点将意象）+ 标题鎏金光晕。对局/战斗背景复用远山算法（夜空渐变 + 两层山影）。
- **场景转场（session.gd）**：Sess.go 走 160ms 淡出夜色 → 切场 → 200ms 淡入（硬切是
  草稿感来源之一）；淡出期间吞输入防误点。
- **UI 微动效（ui/micro_fx.gd，新增）**：按钮悬停微涨/按下微缩（菜单/操作列/开战），
  五浮层（奇遇/结算/侦查/战报/羁绊全览）统一入场（淡入+上浮），金币「跳字」滚动。
- **合成升星反馈**：任何升星立绘白闪+底座金环迸散；五费三星追加天命之印。
- **battle-smoke 探针增注**：空阵直胜修复后空场 0 秒速败截不到战斗——探针先塞三枚
  上场棋子（渲染路径回归钉仍然成立）。
- **进程退出段错误修复（基线 2.0.3 即有的既有问题）**：boot 预热后台任务无 join +
  static 材质缓存持 GPU 资源，退出期 teardown 段错误（Sess._exit_tree 统一收口：
  在途任务 wait_for_task_completion + FxAtlas.release_all 先于引擎拆除）。冒烟口令
  补退出码验收——2.0.3 的「解压冒烟绿」未查退出码，属假绿。
- **导出体启动竞态修复**：boot 主线程 FxAtlas 烘焙与预热线程 ResourceLoader 并发
  在导出体上段错误（verbose 日志崩在立绘加载中）——烘焙收口到 Sess.start_atlas_bake
  协程（等预热完成再烘焙；挂常驻 Sess，boot 场景直切路径协程不死）。
- 验证：qa 11/11；三场景窗口探针（menu 900 帧/game 90 帧/battle-smoke）零脚本错误；
  三截图目视验收（山海菜单/氛围对局/ADD 软光战斗全部落位）；perf avg 7.4ms p95 10.1ms
  （worst 为 boot 黑屏期设计内烘焙）；对拍门禁同数通过（battle 21/21、match 7/7）。

## 2.0.3（2026-09-29，性能专项深度排查收敛）

并行会话性能实测报告（RTX 4070 窗口模式：star3 合成 79.5ms / fx 峰值 224/397 节点 /
图鉴首开 1.1s 冻结 / 上场 146ms 尖刺 / 内核快进 239ms/回合）驱动。报告快照早于 2.0.2，
其中 P3-2（奇遇守卫）与 tint 崩已在先期修复；四实质项全部确认并修：

- **P1-1 音效合成（最重项）**：16 具名配方加变体池——首播同步合成 1 变体（首载不退化），
  命中轮播，且本次重掷的 jitter 参数不浪费：后台 WorkerThreadPool 用它补合成入池
  （每配方至多 3 变体，防固定音色机械化）；`play()` 主线程恒命中缓存。
  实测（qa 新步骤 1c 常驻钉）：star3 首合成 87ms → 预热后重放 **0.02ms**。
  boot 场景后台线程启动即预热 16 配方，对局首批 cast/hit/shoot 也不吃首载尖刺。
- **P1-2 fx 渲染预算**：装饰件（墨点/火花——单次命中 ~16-21 节点的主要构成）在存活
  fx 超 140 帽后跳过，主体 glow/ring 保留（命中感知不丢）；倍速（>1×）下装饰门
  `deco_suppressed` 联动开（4× 此前只关声音不关视觉）。门控在原语层（_burst_dots/
  _spark 入口），play() 分支零侵入。headless 探针实证：300 次 impact 装饰 114≤140、
  suppress 下 50 次仅主体 150。
- **P2-1 纹理冻结**：boot 场景后台线程预热 64 立绘 + 44 装备（1024 无压缩纹理首载
  同步解码是图鉴首开 ~1.1s 冻结与买子/合成 146ms 尖刺的根因）——此后任何 load()
  都是缓存命中零解码。保 1024 口径不降档（用户裁决），用启动后台时间换运行时零尖刺。
- **P3-1/3 快进响应**：道消快进每回合 `await process_frame` 让渲染一帧（内核结算
  239ms/回合不再整窗冻结 5-6s）+「推演中…」浮讯。
- **门禁扩容**：qa 增「perf 回归」步骤（headless/perf_probe.gd：音效池缓存契约三断言），
  现为 11 步。探针纪律教训：headless 下音频/特效节点 teardown 不稳定（WorkerThreadPool
  在途任务 + 假驱动析构 → 段错误/挂死，spawnSync 管道环境复现）——探针不把 Node
  加进树、只走纯合成层；产品预热放 boot 场景（headless 工具进程天然隔离）。
- 无恙面复核一致：refresh_all 2.8ms、存档 ≤6.4ms、4× 实时比 0.25、快照 60 上限、
  fx 节点战斗结束回落无泄漏——帧循环纪律未动。
- 验证：qa 11/11（perf 步 87.0ms→0.02ms 实证）；窗口三探针（battle perf avg 9.3ms/
  p95 12.6ms、hover、keyd）零脚本错误；解压独立冒烟绿；zip 165MB 重打。

## 2.0.2（2026-09-29，深度视觉检查报告全量修复）

基线 e8c09ba 的 MCP 实机逐屏视觉检查报告（14 截图、逐项回源码核验、对照 TS 冻结树口径）
驱动。报告六个头部缺陷（战斗场景 Parse Error / tint null / 键盘层 / 悬停层 / 结算链 /
血条色）已在 2.0.1 先行修复；本版收敛报告其余全部条目并对两处裁定复核：

- **P1-2 复核反转（成立）**：技能描述 `_fmt_skill_desc` 对非数值型 params 必炸——实测
  spec 中 dict×42/str×49/bool×8（此前只扫 list 误判 0 中招）。按 TS `DESC_KEYS` 语义
  格式器表全表移植（35 键：百分比键 ×100 加 %、嵌套键从 status/summon/extraStatus 取值、
  volleySpan/vulnDur 与实现同式推导、整值不带小数尾），同时修掉 P2-3 裸小数口径。
  64 棋子全量探针：零崩溃、零未替换占位（进 hover 探针常驻）。
- **P1-3 顶栏按 TS 口径重排**：品牌居中双行（题字 + NIGHT FEAST 微注 + 两侧金线），
  五数值右对齐分列 1340..1780（值纯数字、标签进小注），hp/xp 微条与 xp 进度文本，
  streak 改「来金 +N」口径（5+利息+连胜，小注动态连胜/连败）。
- **门禁再补洞**：parse_check 的 load 对语法错误返回值不反映（load/new 双假绿实证——
  本轮括号失衡又过了它）；qa「全树 parse」步骤增加输出 SCRIPT ERROR 扫描兜底，注入
  坏码验证必抓。
- P2 批：奇遇面板夜宴样式 + autowrap（desc 超宽三卡互叠）；羁绊成员卡改
  MarginContainer+VBox 纵排（PanelContainer 多子同矩形叠压）；`_ground_stain` z 误赋
  特效层自身（首个墨染后整层沉底）；记事长行 CJK 按字断行；侦查/回合结算/羁绊全览
  Panel 与设置面板（含 CheckBox/HSlider）全部色板化——引擎默认灰出清。
- P3 批：战斗计时「ticks」→「%.1f 秒」；prefs/存档空串判空（首开引擎 ERROR 日志）；
  投影三层同心软边；商店售罄「—」留痕；详情卡/图鉴 name==title 去重；敌情入口墨兽
  轮补浮讯（两入口一致）；侦查「X 的阵地」句式改宋体（篆体只用于题字）；计分板 CJK
  显示宽对齐；备战框上沿加高容纳头签。
- **战斗左右羁绊面板**（TS renderMatchTraitPanel 口径）：config.traits 每队激活羁绊——
  我方夜蓝/敌方朱砂标题带玩家名，激活羁绊【名】+ 计数·档位 + 效果文案按字换行，
  未激活提示；两侧对称落位 40/1460（此前 1920 宽两侧空置）。
- P1-1 根治：Sess._ready 进程级 Spec.ensure()（图鉴等先发场景不再依赖调用顺序）。
- 验证：qa 10/10（对拍全程未破）；窗口探针 battle 1200 帧零错误 + 左右面板各 30100
  内容像素、keyd/hover/desc 三探针绿、解压独立冒烟绿。

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
