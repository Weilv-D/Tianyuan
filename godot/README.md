# 百战天元 · 夜宴 —— Godot 版（版本线 2.5.x）

> Phaser 3 版（冻结于 1.20.0）的桌面重制线：Godot 4.7.1 标准版 + GDScript 单一内核，
> Windows 绿色 exe 分发。首验收点 = 与冻结版全功能对等（跨引擎逐事件对拍门禁背书），
> 已于 2.0.0 定版；其后 2.0.1~2.4.1 十五轮全库深度审查与四轮视觉/质感升级
> （2.1.0 纹理化 → 2.2.0 引擎独有表现 → 2.3.0 经营体感 → 2.4.0 夜宴器物谱 →
> 2.4.1 审查收敛 → 2.5.0 实机报障收敛：交互根修 + 图鉴三册）。当前版本 **2.5.0**。

## 目录结构

```
godot/
  project.godot          # 4.7，主场景 Boot，1920×1080 canvas_items/keep
  core/                  # 战斗内核（rng/battle/grid/unit/traits/skills/items/codec/spec/status）
  game/                  # 对局层（match/ai/pool/economy/adventure/undo/replay/save/daily/…）
  data/spec.json         # 冻结仓 src/data + src/core/config 单向导出（schema hash 门禁）
  render/                # 场景树 Boot/Menu/Game/Battle/Result/Codex + 视图/特效/布局真源
                         #   + 程序化材质工厂 atlas.gd（器物谱十一张烘焙纹理）
  ui/                    # palette（夜宴唯一色源）、artifacts（器物形制库）、micro_fx、设置面板
  audio/                 # bgm（CC0 四曲）/ sfx（14 具名合成音效 ×3 变体池）/ music_tracks（曲目真源）
  assets/                # 1024 口径立绘 64 角色 + 44 装备、篆体字体、图标
  headless/              # 对拍/平衡/性能探针（--script 入口，无窗口）
  tools/                 # node 工具链：spec 导出 / 三类对拍 / qa / balance / 影子导出
  tests/                 # GdUnit4 契约测试（含 HUD 几何二十一条）
  docs/                  # MILESTONES / CHANGELOG / PARITY_CODEC / UX_DELTAS
```

## 运行与门禁

```bash
# 编辑器（标准版 4.7.1；路径可用 GODOT_EXE 环境变量覆盖，见 tools/godot_exe.mjs）
C:/WORKSPACE/game/Godot_v4.7.1-stable_win64.exe --path .

# 质量门禁（11 步：import → 全树 parse → perf 回归 → spec 对账+幂等 → GdUnit4 →
#          rng/battle/codec/match 跨引擎对拍 → balance 冒烟）
npm run qa               # 在 godot/ 下；node ≥ 22.5（自带 package.json，与根目录硬隔离）

# 平衡工具链（CRN 配对矩阵，godot --headless 批次 worker + SQLite 工件）
node --import tsx tools/balance.mjs -- --pairs=36 --n=48 --db=out/balance.db

# 发布导出（影子目录防 MCP 注入；任何退出路径——含失败——都经 finally 清影子目录）
node tools/export_release.mjs   # → out/BaiZhanTianYuan.exe（自含 PCK）
```

实机冒烟钩子（`--` 后传参；**视觉探针必须窗口态跑**——headless dummy 渲染器不发射
`RenderingServer.frame_post_draw`，`--smoke` 截图段的 await 会永久挂起；功能探针
`--script` 模式不受影响）：

- `--autostart` 跳过序章直入对局（**必须放在 `--` 之后**，否则被当引擎参数吞掉）。
- `--smoke=<tag>,<frames>[,keyd|hover|perf|buy|drag|tab2|tab3]` 跑 N 帧截图到
  `.tmp-shots-godot/<tag>.png` 并退出；`keyd` 合成 D 键断言商店 digest（键盘层回归钉），
  `hover` 塞棋子+合成 Motion 断言详情卡 + 64 棋子技能描述全量回填，`buy` 第 40 帧触发
  首张商店卡、第 46 帧以「金币 40→38 + views=1」双值断言购买链，`perf` 报帧耗时/fx 峰值，
  `drag` 真实合成鼠标事件跑四链（拖拽落子/器匣选装/点棋子穿装/点选钉卡——
  `Window.push_input(ev, true)` 直收设计坐标，勿再用 parse_input_event 手工换算），
  `tab2`/`tab3` 实机点击图鉴页签截羁绊/装备册。
- `--battle-smoke` 快进到人类参战轮直进战斗场景，跑满 1200 帧截图 `battle.png`
  后退出 0（死亡/弹道/震屏/演出路径的窗口回归钉；boot 经 `Sess.battle_smoke`
  让路，不会被序章转发顶掉）。
- 冒烟一律验收退出码：`echo EXIT=$?` 必须为 0（只验 SMOKE_SHOT 打印是假绿）。

## 对等门禁（发布的定义）

跨引擎逐事件可对拍：同种子同配置下，TS 冻结版与 GDScript 版的事件流逐条一致。

- 编码协议见 [docs/PARITY_CODEC.md](./docs/PARITY_CODEC.md)（16 类事件显式紧凑编码，
  禁裸 JSON.stringify 比对）；
- rng 百万抽样逐值一致；battle 21 局逐事件；match 7 整局逐状态行（含快进/读档/撤销/
  恩赐/每日种子）；
- 数值单一真源：`data/spec.json` 全树仅 `core/spec.gd` 一处读取，显示/结算/估值共用
  （渲染层连「来金预告」的基数也走 Spec，不落字面量）。

## 表现层口径（2.4.x · 夜宴器物谱）

形制出 `ui/artifacts.gd`、色出 `ui/palette.gd`、纹出 `render/atlas.gd` 程序化烘焙，
三处真源合一：砚石（面板底，金星石眼+石理斑+鎏金器口）、墨玉（按钮三态）、绢面
（首页六折屏画心）、琉璃（器匣/装备背衬）、乌木（屏风抹头）、琢面宝石（费阶/星位/
星级/三甲）、朱砂方印（序位/落款）。禁圆角、禁荧光、禁紫；程序化纹理全部画成中性
亮度、modulate 定色（底已暗再乘深色会黑死）。首页「夜宴图」折屏：棋相墨影各守屏心，
遮挡由构图的间距问题变为结构上不存在。

- 棋子可视容器 `render/unit_view.gd`：星级 shader 描边 + 墨兽罩染 + 52×20 软椭圆
  投影（与 web UnitView.ts 手工同值，锚定脚位）+ 护盾覆条；合并升星 `flash_star()`。
- 字体分工：篆体只用于题字/印章/徽章单字，按钮与句子级文本一律宋体。
- 场景转场（墨晕吞没 shader）、2D 烛光、hit-stop 顿帧、镜头推拉为 Godot 独有表现层
  （web Canvas2D 无对应物），详见 CHANGELOG 2.2.0。

## 与 Phaser 版的关系（隔离铁律）

`../src`、`../public`、`../index.html`、`../vite.config.ts`、`../package.json`、
`../balance`、`../tests`、`../scripts`、`../docs` 一律零改动；唯一接触方式是工具链的
只读 import（`tools/export_spec.mjs` 经 tsx 加载冻结树导出 spec.json）。数据单向：
src → spec.json，Godot 侧永不反向引用。

## 文档

- [docs/MILESTONES.md](./docs/MILESTONES.md) —— M0→M5 里程碑执行记录与十五轮审查判例
- [docs/CHANGELOG.md](./docs/CHANGELOG.md) —— 2.x 版本记录（2.5.0 = 实机报障收敛）
- [docs/PARITY_CODEC.md](./docs/PARITY_CODEC.md) —— 对拍协议规格
- [docs/UX_DELTAS.md](./docs/UX_DELTAS.md) —— UI 局部优化清单（逐条过审）
- [AGENTS.md](./AGENTS.md) —— agent 协作守则（铁律/门禁/审查纪律，施工前必读）
