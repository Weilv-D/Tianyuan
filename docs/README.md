# 百战天元 · 文档索引

> 工程文档集中在此目录。项目入口、操作与架构总览见根目录 [README](../README.md)。

| 文档 | 定位 |
|---|---|
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 开发流程唯一入口：需求、边界、实现、验证、提交、同步、依赖与回退 |
| [DESIGN.md](./DESIGN.md) | 设计说明书：核心循环、经济、羁绊与克制环、装备、战斗内核契约、AI、平衡方法论与当前数据 |
| [QA.md](./QA.md) | QA 质量规范：风险分层、门禁命令、变更矩阵、测试边界与验收标准 |
| [adr/0001-risk-based-qa.md](./adr/0001-risk-based-qa.md) | QA 架构决策：风险驱动、快速默认与变更加严 |
| [ART_BIBLE.md](./ART_BIBLE.md) | 美术圣经：色板、字体、立绘与徽章体系、特效与 UI 规范 |
| [UPGRADE.md](./UPGRADE.md) | 五阶段重构升级计划（v3 定稿，2026-08-30 全部执行完毕的归档记录） |
| [VERSIONING.md](./VERSIONING.md) | 版本迭代规范：编号口径、锁版状态、正式发布与回退 |
| [CHANGELOG.md](./CHANGELOG.md) | 更新日志（1.0.0 起按版本归档，含里程碑 0/F/R/M1 的说明） |
| [plans/](./plans/) | 一次性执行计划的归档（进行中/已完成的审计与重构计划，不承载现行规则） |
| [screenshots/](./screenshots/) | 实拍截图：主菜单 / 备战 / 交战 |

## 文档间关系

- **DEVELOPMENT.md** 回答「一次改动怎么完成」，**DESIGN.md** 回答「为什么这么设计」，
  **QA.md** 回答「怎么证明它没坏」。
- **ART_BIBLE.md** 是视觉唯一真源，代码镜像在 `src/render/view/palette.ts`、`src/ui/kit.ts`、
  `src/render/view/hudLayout.ts` 与 `src/render/board/unitLayout.ts`，必须保持同步。
- **UPGRADE.md** 是 8 个阶段（0 / F / R / M1 / M2 / M3 / M4 / M5）升级的执行记录，已全部完成；
  发布历史以 **CHANGELOG.md** 为准，迭代纪律以 **VERSIONING.md** 为准。
- **plans/** 与 **adr/** 的边界：ADR 记录长期有效的架构决策，plans 记录一次性执行计划。

## 版本契约

运行时展示版本在 `src/version.ts`，分发版本在 `package.json`；`npm run release` 自动校验
两者与 CHANGELOG 顶部条目三处一致。
