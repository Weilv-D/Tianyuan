# 百战天元 · 夜宴 —— Godot 版（版本线 2.0.x）

> Phaser 3 版（冻结于 1.20.0）的桌面重制线：Godot 4.7.1 标准版 + GDScript 单一内核，
> Windows 绿色 exe 分发。首验收点 = 与冻结版全功能对等（跨引擎逐事件对拍门禁背书），
> 已于 2.0.0 定版；2.0.1 为全库深度审查收敛。

## 目录结构

```
godot/
  project.godot          # 4.7，主场景 Boot，1920×1080 canvas_items/keep
  core/                  # 战斗内核（rng/battle/grid/unit/traits/skills/items/codec/spec）
  game/                  # 对局层（match/ai/pool/economy/adventure/undo/replay/save/daily）
  data/spec.json         # 冻结仓 src/data + src/core/config 单向导出（schema hash 门禁）
  render/                # 场景树 Boot/Menu/Game/Battle/Result/Codex + 视图/特效/布局真源
  ui/                    # palette（夜宴唯一色源）与设置面板
  audio/                 # bgm（CC0 四曲）/ sfx（16 具名合成音效）/ music_tracks（曲目真源）
  assets/                # 1024 口径立绘 64 角色 + 44 装备、篆体字体
  headless/              # 对拍/平衡探针与 worker（stdin/stdout IPC）
  tools/                 # node 工具链：spec 导出 / 三类对拍 / qa / balance / 影子导出
  tests/                 # GdUnit4 契约测试
  docs/                  # MILESTONES / CHANGELOG / PARITY_CODEC / UX_DELTAS
```

## 运行与门禁

```bash
# 编辑器（标准版 4.7.1）
C:/WORKSPACE/game/Godot_v4.7.1-stable_win64.exe --path .

# 质量门禁（10 步：import → 全树 parse → spec 对账 → 幂等 → GdUnit4 →
#           rng/battle/codec/match 跨引擎对拍 → balance 冒烟）
npm run qa               # 在 godot/ 下；node ≥ 22.5（自带 package.json，与根目录硬隔离）

# 平衡工具链（CRN 配对矩阵，godot --headless 子进程池 + SQLite 工件）
node --import tsx tools/balance.mjs -- --pairs=36 --n=48 --db=out/balance.db

# 发布导出（影子目录防 MCP 注入；任何路径都会清理影子目录）
node tools/export_release.mjs   # → out/BaiZhanTianYuan.exe（自含 PCK）
```

实机冒烟钩子（`--` 后传参）：`--smoke=<tag>,<frames>[,keyd]` 跑 N 帧截图到
`.tmp-shots-godot/`（keyd 追加合成 D 键断言，键盘层回归钉）；`--autostart` 直进对局；
`--battle-smoke` 快进到人类参战轮直进战斗场景（死亡/弹道路径回归钉）。

## 对等门禁（发布的定义）

跨引擎逐事件可对拍：同种子同配置下，TS 冻结版与 GDScript 版的事件流逐条一致。

- 编码协议见 [docs/PARITY_CODEC.md](./docs/PARITY_CODEC.md)（17 类事件显式紧凑编码，
  禁裸 JSON.stringify 比对）；
- rng 百万抽样逐值一致；battle 21 局逐事件；match 7 整局逐状态行（含快进/读档/撤销/
  恩赐/每日种子）；
- 数值单一真源：`data/spec.json` 全树仅 `core/spec.gd` 一处读取，显示/结算/估值共用。

## 与 Phaser 版的关系（隔离铁律）

`../src`、`../public`、`../index.html`、`../vite.config.ts`、`../package.json`、
`../balance`、`../tests`、`../scripts`、`../docs` 一律零改动；唯一接触方式是工具链的
只读 import（`tools/export_spec.mjs` 经 tsx 加载冻结树导出 spec.json）。数据单向：
src → spec.json，Godot 侧永不反向引用。

## 文档

- [docs/MILESTONES.md](./docs/MILESTONES.md) —— M0→M5 里程碑执行记录与十三轮审查判例
- [docs/CHANGELOG.md](./docs/CHANGELOG.md) —— 2.0.x 版本记录
- [docs/PARITY_CODEC.md](./docs/PARITY_CODEC.md) —— 对拍协议规格
- [docs/UX_DELTAS.md](./docs/UX_DELTAS.md) —— UI 局部优化清单（逐条过审）
- [AGENTS.md](./AGENTS.md) —— agent 协作守则（铁律/门禁/审查纪律）
