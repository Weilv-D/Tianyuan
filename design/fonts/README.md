# 羁绊小篆字体来源

- 源文件：`YiShanBeiZhuanTi.ttf`（约 2.3MB，项目所有者 2026-08-31 提供，源包未附授权文书）
- 派生物：`src/assets/fonts/seal.woff2` —— 仅含羁绊字表 22 字（6.7KB），
  由 `scripts/subset-seal.mjs` 从源文件生成；源文件更新后重跑该脚本即可再生。
  字表以源字体篆形为界：「弈」在源字体中为楷形，故不在字表内。
- 用途：羁绊徽章篆字（`src/render/board/traitIcons.ts`）与开屏「天」
  （`index.html` #boot .glyph，篆体就绪后才起笔）。
  字体族名 `XiaoZhuan`，载入失败自动回退系统楷体。
