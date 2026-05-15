import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['**/__tests__/**'],
      provider: 'v8',
    },
  },
});
