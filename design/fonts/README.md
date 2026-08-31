# 羁绊小篆字体来源

- 源文件：`YiShanBeiZhuanTi.ttf`（约 2.3MB，项目所有者 2026-08-31 提供，源包未附授权文书）
- 派生物：`src/assets/fonts/seal.woff2` —— 仅含羁绊字表 22 字（6.7KB），
  由 `scripts/subset-seal.mjs` 从源文件生成；源文件更新后重跑该脚本即可再生。
- 用途：羁绊徽章篆字（`src/render/board/traitIcons.ts`）。字体族名 `XiaoZhuan`，
  载入失败自动回退系统楷体。
