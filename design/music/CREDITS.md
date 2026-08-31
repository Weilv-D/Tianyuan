# 典藏音乐 · 授权与来源清单

四首环境音乐（menu / prep / battle / final），全部 **CC0-1.0（公有领域贡献）**，
单文件分发与商用均无署名义务。尽管如此，出处仍按工程纪律完整记录于此，
并由 `scripts/audit-music.mjs`（随 `npm run release` 门禁）校验文件存在性与
sha256，生成 `release/THIRD_PARTY_LICENSES.txt` 随包分发。

## 曲目

| 心境 | 曲名 | 作者 | 来源 | sha256（入库 OGG） |
|---|---|---|---|---|
| menu | Night Vigil | Kevin MacLeod | FreePD（已关站，经 Internet Archive Wayback Machine 取回） | `8b9f0b1352b307d82143e6df4b9e886ee67b65b7a988dda29c563c80ffb5e8bd` |
| prep | Think About It | Kevin MacLeod | 同上 | `77099c323efe51707013bff77be4cf323019a74da5310f7fddfcf32557e9a372` |
| battle | Battle Ready | Kevin MacLeod | 同上 | `695bc17267f9654b93c93829ca2e8544936ad5dd1c8e1675db4fb74e55d911d8` |
| final | Epic Boss Battle | Kevin MacLeod | 同上 | `e1cdca99b6e0f0bfcfe3dcd563f765070de979feb0ed23e13e4c430794dc2b25` |

- 原站：<https://freepd.com/>（2025 年关站；FreePD 全站内容以 CC0-1.0 发布，
  授权不随站点关闭失效）
- 曲目页：<https://freepd.com/epic.php>（存档：`https://web.archive.org/web/2024/https://freepd.com/epic.php`）
- 源文件下载（存档直链，URL 空格为 `%20`）：
  `https://web.archive.org/web/2024/https://freepd.com/music/<Track%20Name>.mp3`

## 入库编码

源 MP3（160~320 kbps CBR）→ Ogg Vorbis，句首尾 10ms 静音填充保证循环接缝无爆点：

```
ffmpeg -y -i "<源>.mp3" -af "apad=pad_dur=0.01" -c:a libvorbis -b:a 160k -ar 44100 -ac 2 src/music/tracks/<mood>.ogg
```

（执行于 2026-08-31，ffmpeg 8.0.1；产物约 11.6 MB / 四曲。）

## 兜底契约

任何曲目文件缺失、sha256 不符或浏览器解码失败时，游戏自动回落到程序化
五声音阶合成 BGM（AudioEngine 原路径）——授权层永远不是运行依赖。
设置面板「典藏音乐」开关（默认开）可随时切回程序化配乐。
