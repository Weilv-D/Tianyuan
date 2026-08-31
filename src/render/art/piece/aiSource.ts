/**
 * AI 生成棋子图 · 资源注册
 *
 * 约定：AI 产出的 PNG 放在 `src/render/art/piece/ai/` 下，文件名 = 棋子 defId
 * （如 `duanyue.png`）。构建期由 vite 收集为 URL，缺图不报错 ——
 * 缺哪张，哪位棋子继续走矢量/旧版剪影兜底。
 */

const files = import.meta.glob<string>('./ai/*.png', { eager: true, query: '?url', import: 'default' });

export const AI_PIECE_URL: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  const id = path.split('/').pop()!.replace(/\.png$/i, '');
  AI_PIECE_URL[id] = url;
}
