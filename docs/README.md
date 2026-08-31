# 百战天元 · 文档索引

> 工程文档集中在此目录。项目入口、操作与架构总览见根目录 [README](../README.md)。

| 文档 | 定位 |
|---|---|
| [DESIGN.md](./DESIGN.md) | 设计说明书：核心循环、经济、羁绊与克制环、装备、战斗内核契约、AI、平衡方法论与当前数据 |
| [QA.md](./QA.md) | 质量手册：测试分层、不变量、性能包络、稳定性、复现命令 |
| [ART_BIBLE.md](./ART_BIBLE.md) | 美术圣经：色板、字体、立绘与徽章体系、特效与 UI 规范 |
| [UPGRADE.md](./UPGRADE.md) | 五阶段重构升级计划（v3 定稿，2026-08-30 全部执行完毕的归档记录） |
| [VERSIONING.md](./VERSIONING.md) | 版本迭代规范：编号口径、三处一致性门禁、发布流程与文档同步责任 |
| [CHANGELOG.md](./CHANGELOG.md) | 更新日志（1.0.0 起按版本归档，含里程碑 0/F/R/M1 的说明） |
| [screenshots/](./screenshots/) | 实拍截图：主菜单 / 备战 / 交战 |

## 文档间关系

- **DESIGN.md** 回答「为什么这么设计」，**QA.md** 回答「怎么证明它没坏」——
  二者交叉引用（如 QA §10 已知限制 → DESIGN §十三）。
- **ART_BIBLE.md** 是视觉唯一真源，代码镜像在 `src/render/view/palette.ts` 与 `src/ui/kit.ts`，二者必须保持同步。
- **UPGRADE.md** 是 v3 升级的执行记录（决策 → 阶段 → 验证门），已全部完成；
  发布历史以 **CHANGELOG.md** 为准，迭代纪律以 **VERSIONING.md** 为准。

## 版本契约

版本唯一真源在 `src/version.ts`（`GAME_VERSION` / `GAME_BUILD`），
发版时与 `package.json` 的 `version` 字段、`CHANGELOG.md` 顶部条目三处同步，一致即为锁版。
