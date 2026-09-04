# 全项目深度审查与修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 对仓库内全部自有前后端/核心/工具链代码建立逐文件证据链，修复所有经复核确认的问题，并让测试、构建、平衡结论与项目文档保持一致。

**Architecture:** 以 Git 跟踪文件为审查全集，先建立架构、领域不变量与验证基线，再按 core/data、game、render/ui/audio、balance/scripts/tests/docs 分区逐文件审查。所有候选问题先交叉验证根因和可观察故障，再用最小回归测试保护修复；最终通过默认 QA、领域专项模拟、依赖/资源审计和必要实机冒烟闭环。

**Tech Stack:** TypeScript 5.6、Phaser 3、Vite 5、Vitest 2、Node.js 22、无头平衡模拟工具链、GitHub Actions。

---

### Task 1: 固定审查全集与基线

**Files:**
- Create: `docs/plans/2026-09-04-full-project-audit.md`
- Create: `.qa/code-review-2026-09-04.md`
- Inspect: all files returned by `git ls-files`

**Step 1: Record repository state**

Run: `git status --short --branch && git log --oneline -10`
Expected: 当前分支与既有工作区差异被明确记录，不覆盖非本次改动。

**Step 2: Build the review manifest**

Run: `git ls-files`
Expected: 自有源码、测试、脚本、配置和活文档全部进入分区清单；依赖、构建物、缓存和二进制资源只做边界/授权/完整性检查。

**Step 3: Run baseline gates**

Run: `npm run qa && npm run audit:deps && npm run audit:music`
Expected: 记录每条命令的退出码、测试数、构建结果和任何已有失败；不得把基线失败归因于本次修复。

### Task 2: 建立架构与领域不变量基线

**Files:**
- Inspect: `README.md`
- Inspect: `docs/README.md`
- Inspect: `docs/DEVELOPMENT.md`
- Inspect: `docs/DESIGN.md`
- Inspect: `docs/QA.md`
- Inspect: `docs/ART_BIBLE.md`
- Inspect: `docs/VERSIONING.md`
- Inspect: `docs/adr/*.md`
- Inspect: `package.json`
- Inspect: `tsconfig.json`
- Inspect: `vite.config.ts`
- Inspect: `.github/workflows/*.yml`

**Step 1: Extract project contracts**

记录唯一真源、层级依赖、确定性、资产守恒、固定槽位、存档兼容、错误可见、资源释放、视觉与发布规则。

**Step 2: Map architecture and data flow**

输出入口 → 对局状态 → 战斗内核 → 事件流 → 渲染/音频，以及平衡 CLI → 进程池 → 工件库的数据流和失败模式。

**Step 3: Identify documentation contradictions**

把代码、测试、README、设计文档、QA 文档之间的数字、命令、文件计数和行为描述差异列为候选问题，等待代码真源复核。

### Task 3: 逐文件审查战斗内核与数据

**Files:**
- Inspect: `src/core/*.ts`
- Inspect: `src/data/*.ts`
- Inspect: related `tests/*.test.ts`

**Step 1: Review every file**

逐文件检查公式、边界、随机消费顺序、事件完整性、状态机、目标/落点、羁绊与装备叠加、配置真源、无效数据和可读性。

**Step 2: Verify balance semantics**

把规则文本、配置、运行实现、测试锚点和平衡工具消费路径逐项对齐，区分机制缺陷、数值失衡和统计噪声。

**Step 3: Record findings**

每项包含文件与行、故障表现、触发条件、根因、影响、严重程度、优先级、建议验证。

### Task 4: 逐文件审查对局层

**Files:**
- Inspect: `src/game/*.ts`
- Inspect: related `tests/*.test.ts`

**Step 1: Review state transitions**

检查经济、商店、卡池、AI、冒险、配对、回合、每日挑战、存档、回放、撤销和恢复的原子性及跨模块一致性。

**Step 2: Review resource conservation and malformed input**

验证金币、经验、卡牌、棋子、装备、奇遇和随机状态不生成、不吞没；损坏存档和非法调用在边界被拒绝或安全清洗。

**Step 3: Review lifecycle failures**

检查存储配额、序列化、恢复、淘汰、重复结算和中途异常是否留下部分提交状态。

### Task 5: 逐文件审查表现层与浏览器资源

**Files:**
- Inspect: `src/render/**/*.ts`
- Inspect: `src/ui/*.ts`
- Inspect: `src/audio/*.ts`
- Inspect: `src/music/*.ts`
- Inspect: `src/main.ts`
- Inspect: `index.html`
- Inspect: related `tests/*.test.ts`

**Step 1: Review render/input/UI code**

检查坐标换算、浮层互斥、拖拽和键盘一致性、显示对象生命周期、定时器/监听器/纹理/音频节点释放、错误回落、可访问性和热路径分配。

**Step 2: Review scene transitions**

确认场景销毁或重启时事件、句柄、音频、窗口监听、动画和缓存均有对称清理，不发生重复订阅或悬空引用。

**Step 3: Run browser smoke checks for changed behavior**

按 `.qa/smoke-checklist.md` 只勾选实际执行项，记录浏览器、分辨率、K 值、控制台和操作结果。

### Task 6: 逐文件审查平衡工具链、脚本、配置和测试

**Files:**
- Inspect: `balance/**/*.ts`
- Inspect: `balance/specs/*.json`
- Inspect: `scripts/*.mjs`
- Inspect: `tests/**/*.ts`
- Inspect: root configuration and launcher files

**Step 1: Review tooling correctness**

检查参数解析、补丁恢复、并发进程池、超时/取消、数据库连接与语句释放、临时目录、错误传播、退出码、原子写入和跨平台行为。

**Step 2: Review statistical rigor**

检查双向对拍、CRN、种子、样本量、先手偏差、造价带、超时裁定、指标口径与报告聚合，防止把工具偏差误判为游戏平衡。

**Step 3: Review tests as evidence**

定位缺口、脆弱断言、未被执行的文件、错误的测试契约、过时钉值和无法覆盖的真实浏览器风险。

### Task 7: 复核、分级并锁定修复集合

**Files:**
- Update: `.qa/code-review-2026-09-04.md`

**Step 1: Deduplicate candidates**

合并同根因问题，排除仅属风格偏好、无可观察风险或已有设计依据的项目。

**Step 2: Assign severity and priority**

严重程度使用 Critical / High / Medium / Low；优先级使用 P0 / P1 / P2 / P3。所有结论给出证据和公平的反证考虑。

**Step 3: Define regression test per confirmed issue**

每个确认问题至少指定一个可失败的自动测试或可重复专项验证；无法自动化的视觉/音频问题指定实机步骤。

### Task 8: 测试先行修复全部确认问题

**Files:**
- Modify: exact files identified by Tasks 3–7
- Test: exact related files under `tests/`

**Step 1: Write the failing regression test**

Run: `npm test -- tests/<target>.test.ts`
Expected: 测试以问题的玩家可观察结果失败，而不是因语法或夹具错误失败。

**Step 2: Implement the minimal root-cause fix**

保持现有分层、确定性和真源纪律；涉及资产的多步修改必须先验证后提交或具备完整回滚。

**Step 3: Run the targeted test**

Run: `npm test -- tests/<target>.test.ts`
Expected: PASS，且相邻风险用例不回归。

**Step 4: Perform immediate self-review**

检查异常路径、资源释放、随机消费、事件同步、边界值和文档影响，不保留临时日志与探针。

### Task 9: 执行全量与专项验证

**Files:**
- Update: `.qa/code-review-2026-09-04.md`
- Update: `.qa/smoke-checklist.md` only for actually executed smoke checks

**Step 1: Run full default gate**

Run: `npm run qa`
Expected: typecheck、boundaries、Vitest、Vite build 全部退出 0，无 only/skip/retry。

**Step 2: Run balance and integrity gates**

Run: `npm run balance -- selftest`
Expected: 数据、确定性、CRN、进程池一致性和先手公平全部通过。

Run: `npm run sim && npm run sim:items && npm run sim:match`
Expected: 统计流程完成，无超时/崩溃；结果位于设计包络，任何有意移动均有解释。

**Step 3: Run dependency and media audits**

Run: `npm run audit:deps && npm run audit:music`
Expected: 高危生产依赖漏洞为 0，媒体文件、清单和授权一致。

**Step 4: Run release-path verification when affected**

Run: `npm run release`
Expected: 版本一致、双形态产物可生成、单文件无外链、zip 和授权清单完整；仅在发布路径或文档结论需要验证时执行。

### Task 10: 体系化同步文档并重写 README

**Files:**
- Replace: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/DESIGN.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/QA.md`
- Modify: `docs/ART_BIBLE.md` if visual rules changed
- Modify: `docs/VERSIONING.md` if release behavior changed
- Modify: `balance/README.md`
- Modify: `docs/CHANGELOG.md` only for the current unreleased version and player-visible changes
- Update: `.qa/code-review-2026-09-04.md`

**Step 1: Re-establish document ownership**

把每条规则放回唯一真源，其他文档只保留必要摘要和链接，删除过时、重复、快照式数字。

**Step 2: Rewrite README from final code**

README 只描述最终可运行状态：产品定位、环境与命令、操作入口、架构导航、验证和分发；所有数量和行为从代码/自动化证据重新核对。

**Step 3: Check links and consistency**

Run: `npm run qa && git diff --check`
Expected: 文档引用路径有效，命令存在，版本/文件计数/玩法口径与最终代码一致，差异无空白错误。

### Task 11: 最终独立复核与交付报告

**Files:**
- Finalize: `.qa/code-review-2026-09-04.md`

**Step 1: Re-read every changed file**

确认改动解决根因、不引入隐式行为变化，测试描述与代码实现一致。

**Step 2: Compare final repository against the manifest**

确认每个自有代码文件都有已审查状态，未审文件只能是明确列出的二进制/生成物/第三方资产。

**Step 3: Produce ordered final report**

按“审查发现 → 修复说明 → 验证结果 → 更新文档清单”顺序给出最终结果；每项附文件证据、严重度、优先级和验证方式，明确任何无法执行的实机或环境验证。
