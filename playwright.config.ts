import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

export const apiTestEnvironment = {
  PASSWORD_RECOVERY_ASSISTED_ENABLED: 'true',
  MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
  MFA_REQUIRE_GLOBAL_ADMINS: 'false',
  RISK_COLLABORATION_WRITES_ENABLED: 'true',
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @renr/api start',
      env: apiTestEnvironment,
      url: 'http://127.0.0.1:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: 'pnpm --filter @renr/web dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
});
