# AGENTS.md —— agent 协作守则（godot/ 树）

任何 agent（或协作者）在本目录施工前必读。目的：双树共存不出事、门禁不退化、
审查结论可追溯。

## 1. 隔离铁律（最高优先级，违反即回滚）

- `../src`、`../public`、`../index.html`、`../vite.config.ts`、`../package.json`、
  `../balance`、`../tests`、`../scripts`、`../docs` **零改动**。Phaser 版冻结于 1.20.0，
  是规格参考不是施工面。
- 对冻结树唯一合法接触：工具链只读 import（`tools/export_spec.mjs` 等经 tsx）。
- 数据单向：`src/data + src/core/config` → `data/spec.json`；Godot 侧永不反向引用。
- 一切新增只进 `godot/`；`godot/package.json` 是独立 node 工具链。

## 2. 数据与数值纪律

- 数值单一消费口 `core/spec.gd`：全树只它读 spec.json；渲染/对局显示不得出现平衡数值
  字面量或第二套副本（视觉参数如体型缩放除外，需注释标注与 web 的手工同步关系）。
- 内核机制常量一律走 `Spec.c/mech/legend/tune`；不落字面量双真源（`EFFECT_INTERVAL`
  从 Spec 推导是判例）。
- 改数值必回写 DESIGN（冻结仓文档只读时，落在 godot/docs 对应篇目）。

## 3. 门禁（改码后必跑，缺一不可）

```bash
npm run qa    # 11 步：import / 全树 parse / perf 回归 / spec 对账+幂等 / GdUnit4 /
              # rng / battle / codec / match 对拍 / balance 冒烟
```

- 「全树 parse」步骤是 2.0.1 教训产物：`--import` 与 GdUnit4 都不深检未被引用的渲染层
  脚本，战斗场景曾带 Parse Error 过全部门禁。改了 class_name 签名（如静态函数形参）
  必须先 `--import` 刷新全局类缓存，否则 parse 门报陈旧签名错误。
- 渲染层改动加做窗口实机探针：`--smoke=<tag>,<frames>[,keyd|hover|buy|drag]`（键盘/悬停/
  购买链/**鼠标四链：拖拽落子/选装/穿装/钉卡**）、`--battle-smoke`（战斗死亡/弹道路径）。
  **视觉探针必须窗口态**（headless dummy 渲染器不发射 `RenderingServer.frame_post_draw`，
  `--smoke` 截图 await 永久挂起 EXIT=124），`--autostart` 必须放 `--` 之后；一律验收
  退出码（只验 SMOKE_SHOT 打印是假绿）。合成鼠标事件用 `Window.push_input(ev, true)`
  直收设计坐标——`parse_input_event` 收窗口像素，手工换算在最大化窗口下有黑边偏移。
- 发布导出一律 `node tools/export_release.mjs`（影子目录防 MCP 注入），导出日志必须
  `mcp_entries=0 && errors===0`；失败路径走 `exitCode + throw` 让 finally 清影子目录。

## 4. 审查纪律（十二+轮判例沉淀）

- 子代理高危结论**必须回源码核实**再动手；只读审查用 Explore 型代理，派发前后
  `git status` 对照（「禁止编辑」对通用代理不可靠）。
- 已知误报模式：缩进层级目测错误（MouseMotion 判例）、web 同款口径误判为缺陷（详情卡
  乘区判例）、场景 shutdown 自动清理类（Phaser 侧判例）。恒真断言三模式：双端同殓
  比对、数学恒等式、内嵌 if/else 分支断言。
- 并行会话可能同时施工：动手前重核 `git log`/`git status` 基线；发现集先对账再修。
- MCP 注入威胁常在（编辑器进程运行期间向工程落 `mcp_interaction_server.gd` + 改
  autoload）：提交前检查 autoload 与新增可疑文件，导出必走影子工具。
- 并行施工期间验证前先跑 `parse_check` 并数输出里的 SCRIPT ERROR 行：`load()` 对
  语法/类型错误返回非空（假绿），共享树可能被在途改动打断（2.1.1 实证两次）。
- 装饰节点的「内置校正偏移 + 调用方覆写」是静默错位高发模式（黑圆乱飘根因）：
  corrective offset 与外部赋值只能留一处。autoload 与主场景都注册 deferred 换场时
  后注册者胜出——多入口换场用优先级标志，不靠注册顺序（battle-smoke 被 boot 顶掉）。
- 装饰 Control（ColorRect/TextureRect/Panel）**在创建处**显式 `mouse_filter=IGNORE`，
  不靠上层遍历兜底——game_scene 的放行循环只盖直接子级，孙辈（board_view 漆纹层）
  漏网曾吞掉整张棋盘的输入（2.5.0 判例）。演出补间基准必须绝对（STAR_SCALE/_home 锚），
  捕获当时 scale/position 在交叠下级联衰减（压扁/漂移）。布局改动整带复算：常量各自
  有据仍可能合起来撞带（bench 框 × 开战钮判例）。
- TS→GDScript 移植三类副产物做定向扫描：无异常系统里 try/catch 承诺无对应物（坏档
  run-time error 中断整链而非降级记失败）、truthy 判空直译强类型赋值（守卫变不可达）、
  注释宣称口径与实现分叉。静态标志必须答「节点死了谁复位」（_exit_tree 兜底）。
- 门禁判据对 0/空/部分数据显式表态：GdUnit4 零用例判 FAIL、对拍 `__error` 哨兵非空、
  balance 部分矩阵空行记 null 不产 NaN。几何审查做「域 × 域」交叉断言（钳位域 vs
  控件带各自有测试也互不失守）。

## 5. 提交纪律

- 修复批次对应 CHANGELOG 条目 + MILESTONES 判例段（含误报裁定与验证方式）。
- 版本号三处一致：`project.godot config/version`、`export_presets.cfg` file/product
  version、CHANGELOG 顶部；发布三锁 = CHANGELOG + 干净树 + 版本登记。
