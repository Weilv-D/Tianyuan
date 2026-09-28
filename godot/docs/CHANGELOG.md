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

### 已知事项
- BGM 为五声音阶 pad 占位，正式曲目样曲过审后热替换
- 平衡模拟吞吐 ~9 局/s（工具链侧，不影响游玩）

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
