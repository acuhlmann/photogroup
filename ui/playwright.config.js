// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const isCI = !!process.env.CI;
const isHeaded = process.env.HEADED === 'true' || process.argv.includes('--headed');
const isSideBySide = process.env.SIDE_BY_SIDE === 'true';

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './e2e/tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: isCI,
  /* Retry on CI only */
  retries: isCI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: isCI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: isCI ? [['html'], ['github']] : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /* Grant clipboard permissions for copy/paste operations */
    permissions: ['clipboard-read', 'clipboard-write'],
    /* Headless mode - false for local development, true for CI */
    headless: isCI || !isHeaded,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        /* For side-by-side viewing, use smaller viewport */
        viewport: isSideBySide ? { width: 375, height: 667 } : devices['Desktop Chrome'].viewport,
        /* Launch args for side-by-side window positioning */
        launchOptions: isSideBySide ? {
          args: [
            '--window-size=400,700',
            '--window-position=50,50'
          ]
        } : undefined,
      },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: [
    /* Frontend server (React dev server) */
    {
      command: 'npm start',
      url: 'http://localhost:3000',
      reuseExistingServer: !isCI,
      timeout: 120 * 1000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        BROWSER: 'none',
        CI: 'true'
      },
    },
    /* Backend server (Node.js API server) */
    {
      command: 'cd ../server && npm start',
      url: 'http://localhost:8081/api/__rtcConfig__',
      reuseExistingServer: !isCI,
      timeout: 60 * 1000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: '8081',
        WS_PORT: '9000'
      },
      // Ignore port conflicts - if server is already running, that's fine
      ignoreHTTPSErrors: true,
    },
  ],
});

