# 夜宴 · Godot 版变更日志（版本线 2.0.0）

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
