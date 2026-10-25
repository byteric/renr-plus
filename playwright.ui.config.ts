import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

// Isolated presentation checks: synthetic HTTP fixtures, no database or cloud access.
export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'foundation', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort',
    cwd: resolve(__dirname, 'apps/web'),
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
