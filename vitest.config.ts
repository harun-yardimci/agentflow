import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Global test settings
    globals: true,
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'server/**/__tests__/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'dist-server'],

    // Coverage
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts', 'mcp/**/*.ts'],
      exclude: ['server/index.ts', 'mcp/index.ts', '**/*.d.ts'],
      reporter: ['text', 'text-summary'],
    },

    // Timeout for slow tests (executor tests etc.)
    testTimeout: 10000,

    // Isolation — each test file gets its own DB
    pool: 'forks',
  },
});
