import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
    test: {
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        // This package is re-export files with no logic of its own. Its test checks that each `/v1` path is its
        // bare path; what the names are is core's to test (`src/sdk/tests/v1-freeze.test.ts`).
        environment: 'node',
    },
});
