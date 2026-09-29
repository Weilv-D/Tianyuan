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
npm run qa    # 10 步：import / 全树 parse / spec 对账+幂等 / GdUnit4 /
              # rng / battle / codec / match 对拍 / balance 冒烟
```

- 「全树 parse」步骤是 2.0.1 教训产物：`--import` 与 GdUnit4 都不深检未被引用的渲染层
  脚本，战斗场景曾带 Parse Error 过全部门禁。
- 渲染层改动加做窗口实机探针：`--smoke=<tag>,<frames>[,keyd]`（键盘层）、
  `--battle-smoke`（战斗死亡/弹道路径），并配截图内容像素断言（exit 0 + SMOKE_LAYOUT
  自报不算通过）。
- 发布导出一律 `node tools/export_release.mjs`（影子目录防 MCP 注入），导出日志必须
  `mcp_entries=0 && errors===0`。

## 4. 审查纪律（十二+轮判例沉淀）

- 子代理高危结论**必须回源码核实**再动手；只读审查用 Explore 型代理，派发前后
  `git status` 对照（「禁止编辑」对通用代理不可靠）。
- 已知误报模式：缩进层级目测错误（MouseMotion 判例）、web 同款口径误判为缺陷（详情卡
  乘区判例）、场景 shutdown 自动清理类（Phaser 侧判例）。恒真断言三模式：双端同殓
  比对、数学恒等式、内嵌 if/else 分支断言。
- 并行会话可能同时施工：动手前重核 `git log`/`git status` 基线；发现集先对账再修。
- MCP 注入威胁常在（编辑器进程运行期间向工程落 `mcp_interaction_server.gd` + 改
  autoload）：提交前检查 autoload 与新增可疑文件，导出必走影子工具。

## 5. 提交纪律

- 修复批次对应 CHANGELOG 条目 + MILESTONES 判例段（含误报裁定与验证方式）。
- 版本号三处一致：`project.godot config/version`、`export_presets.cfg` file/product
  version、CHANGELOG 顶部；发布三锁 = CHANGELOG + 干净树 + 版本登记。
