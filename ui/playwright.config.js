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
  /* Global timeout for all tests - longer for P2P tests */
  timeout: isCI ? 120000 : 60000, // 2 minutes in CI, 1 minute locally
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
    trace: isCI ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
    video: isCI ? 'retain-on-failure' : 'off',
    /* Grant clipboard permissions for copy/paste operations */
    permissions: ['clipboard-read', 'clipboard-write'],
    /* Headless mode - always true in CI, configurable locally */
    headless: isCI ? true : !isHeaded,
    /* CI-specific browser args for better stability */
    ...(isCI && {
      launchOptions: {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      },
    }),
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        /* For side-by-side viewing, use smaller viewport */
        viewport: isSideBySide ? { width: 375, height: 667 } : devices['Desktop Chrome'].viewport,
        /* Launch args - merge CI args with side-by-side args if needed */
        launchOptions: isCI ? {
          // CI-specific args (already set in use section, but ensure they're here too)
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
          ],
        } : isSideBySide ? {
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
      timeout: isCI ? 180 * 1000 : 120 * 1000, // Longer timeout in CI
      stdout: isCI ? 'ignore' : 'pipe', // Reduce noise in CI logs
      stderr: isCI ? 'ignore' : 'pipe',
      env: {
        BROWSER: 'none',
        CI: 'true',
        NODE_ENV: 'test',
        // Disable React dev server optimizations in CI for faster startup
        ...(isCI && {
          SKIP_PREFLIGHT_CHECK: 'true',
          DISABLE_ESLINT_PLUGIN: 'true',
        }),
      },
    },
    /* Backend server (Node.js API server) */
    {
      command: 'npm start',
      cwd: path.resolve(__dirname, '../server'), // Use cwd instead of cd in command
      url: 'http://localhost:8081/api/__rtcConfig__',
      reuseExistingServer: !isCI,
      timeout: isCI ? 120 * 1000 : 60 * 1000, // Increased timeout in CI to 120s
      stdout: 'pipe', // Enable logging to see startup issues
      stderr: 'pipe', // Enable logging to see startup errors
      env: {
        PORT: '8081',
        WS_PORT: '9000',
        NODE_ENV: isCI ? 'test' : 'development',
      },
      // Ignore port conflicts - if server is already running, that's fine
      ignoreHTTPSErrors: true,
    },
  ],
});

