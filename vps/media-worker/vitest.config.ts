import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Tests spawn nothing and touch no network except 127.0.0.1 (HTTP server test).
    testTimeout: 10_000,
    restoreMocks: true,
  },
});
