import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * 两种构建形态：
 *  - 默认（npm run build）  → dist/ 多块产物，供静态托管（phaser 独立分包，命中缓存）；
 *  - singlefile（npm run release 内部调用）→ 单文件 HTML，双击即玩、U 盘/聊天工具直发。
 *    全部 JS/CSS 内联进 index.html，内联 module 脚本在 file:// 下照常执行；
 *    素材两源：程序化烘焙（视觉/音效）+ 入库资产（AI 立绘 PNG、羁绊小篆
 *    22 字子集、典藏音乐 OGG），?url 导入在单文件形态下内联为 data URL，
 *    单文件形态无任何外部依赖。
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile';
  return {
    base: './',
    server: {
      port: 5199,
      host: true,
    },
    build: {
      target: 'es2022',
      outDir: 'dist',
      // 每次构建前清空：否则裸 npm run build 会堆积旧 hash 资产
      //（release 脚本自带 rmSync 清理，与本项无冲突）
      emptyOutDir: true,
      assetsInlineLimit: single ? 100_000_000 : 4096,
      chunkSizeWarningLimit: 1600,
      // 单文件形态必须关闭分包（全部内联）；托管形态保留 phaser 独立分包
      ...(single
        ? {}
        : {
            rollupOptions: {
              output: {
                manualChunks: {
                  phaser: ['phaser'],
                },
              },
            },
          }),
    },
    // vitest 不受构建形态影响
    ...(single ? { plugins: [viteSingleFile()] } : {}),
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
