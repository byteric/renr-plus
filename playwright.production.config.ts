import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The same journeys run against built assets. The runner starts a fresh API per
// project to keep test logins within the real security budget without bypasses.
export default defineConfig({
  ...base,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: resolve(__dirname, 'apps/api'),
      url: 'http://127.0.0.1:3000/api/v1/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command:
        'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --strictPort',
      cwd: resolve(__dirname, 'apps/web'),
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
