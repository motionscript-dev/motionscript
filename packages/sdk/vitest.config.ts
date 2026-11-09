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
        // Recorded exemption (RULES.md VI): this package is four re-export
        // files, with no logic of its own, and no test file here yet. Its names
        // are checked by core's `sdk-parity.test.ts`. A surface and pack test of
        // its own does not exist; until one lands, an empty include has to pass,
        // and the first test file ends this.
        passWithNoTests: true,
        environment: 'node',
    },
});
