import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * 两种构建形态：
 *  - 默认（npm run build）  → dist/ 多块产物，供静态托管（phaser 独立分包，命中缓存）；
 *  - singlefile（npm run release 内部调用）→ 单文件 HTML，双击即玩、U 盘/聊天工具直发。
 *    全部 JS/CSS 内联进 index.html，内联 module 脚本在 file:// 下照常执行；
 *    本工程零外部素材（视觉音频全程序化；唯一打包字体是羁绊小篆 22 字子集，
 *    ?url 导入在单文件形态下内联为 data URL），单文件形态无任何外部依赖。
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile';
  return {
    base: './',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5199,
      host: true,
    },
    build: {
      target: 'es2022',
      outDir: 'dist',
      // 沙箱环境下清空目录会被安全策略拦下，改为由调用方（release 脚本）自行清理
      emptyOutDir: false,
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
