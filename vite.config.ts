import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相對路徑：GitHub Pages 子路徑 /warGame/ 與本機都能用
  base: './',
  server: { port: 5200, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/tmp/**', 'node_modules/**'] },
});
