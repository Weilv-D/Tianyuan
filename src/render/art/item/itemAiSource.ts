/** 装备 AI 图注册表：文件名即装备 id（scripts/slice-item-sheet.mjs 切分入库） */
export const ITEM_AI_URL: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('./ai/*.png', { eager: true, query: '?url', import: 'default' }),
  ).map(([path, url]) => [path.replace('./ai/', '').replace('.png', ''), url]),
);
