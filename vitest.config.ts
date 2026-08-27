import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Serialize all test files to prevent Postgres integration tests from
    // colliding on shared database state during parallel truncation.
    fileParallelism: false,
  },
});
