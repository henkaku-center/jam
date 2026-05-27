import { defineConfig, devices } from '@playwright/test';

const chromeCanaryPath = process.env.CHROME_CANARY_PATH || '/usr/bin/google-chrome-canary';
const port = process.env.PORT || '3100';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    launchOptions: {
      executablePath: chromeCanaryPath,
      args: ['--no-sandbox']
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  webServer: {
    command: `CODEGEN_PROVIDER=mock AGENT_TERMINAL_PROVIDER=mock GEMINI_API_KEY= PORT=${port} npm start`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  }
});
