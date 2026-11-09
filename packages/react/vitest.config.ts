import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

// The hook is tested against a fake engine, but it is still React in a DOM, so
// the tests run in a real browser rather than adding a DOM emulator. The plugin
// is for `stage.tsx`, which the tsconfig leaves as JSX.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
      provider: playwright(),
    },
  },
});
