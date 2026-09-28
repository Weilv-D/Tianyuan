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

## M1 战斗内核移植（src/core 4,698 行）
rng → types → grid → unit → items → traits → skills → config → api → battle；
hooks 注册顺序（羁绊 id 字典序 → 装备固定序）、BattleApi 表面、settle-then-replay、
30Hz 固定 tick 必须 1:1。验收：≥1,000 种子单场逐事件对拍绿 + conservation/determinism 契约 GdUnit4 化。

## M2 对局层移植（src/game 4,107 行）
match/ai/pool/economy/adventure/undo/replay；save/daily 改 user://；pairings P0 契约复刻。
验收：整局（快进/读档/回放摘要/每日种子）跨引擎对拍绿。

## M3 表现层与美术升级
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
