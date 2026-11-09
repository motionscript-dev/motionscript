import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Node tests: the pure logic (frame selectors, option validation), the
        // engine's lifecycle against a stand-in for Playwright, and a few cases
        // that boot a real headless Chromium. packages/e2e covers the render
        // path pixel for pixel.
        environment: 'node',
        include: ['src/**/*.test.ts'],
        // One Chromium at a time: the cases that launch one share a machine
        // with the rest of the workspace's suites.
        fileParallelism: false,
    },
});
