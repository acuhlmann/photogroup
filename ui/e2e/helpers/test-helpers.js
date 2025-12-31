const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { expect, chromium } = require('@playwright/test');

let serverProcess = null;

/**
 * Check if the backend server is running on the specified port
 * @param {number} port - The port to check
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} - True if server is running
 */
async function checkServerRunning(port = 8081, timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/rooms`, (res) => {
      resolve(res.statusCode !== undefined);
      res.on('data', () => {});
      res.on('end', () => {});
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Check server health with retries
 * @param {number} port - The port to check
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} retryDelay - Delay between retries in milliseconds
 * @returns {Promise<boolean>} - True if server is healthy
 */
async function checkServerHealth(port = 8081, maxRetries = 10, retryDelay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    const isRunning = await checkServerRunning(port, 2000);
    if (isRunning) {
      return true;
    }
    if (i < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  return false;
}

/**
 * Start backend server programmatically
 * @param {number} port - The port to start the server on
 * @returns {Promise<void>} - Resolves when server is started
 */
async function startBackendServer(port = 8081) {
  if (serverProcess) {
    console.log('Server already started');
    return;
  }

  const serverDir = path.join(__dirname, '../../../server');
  serverProcess = spawn('npm', ['start'], {
    cwd: serverDir,
    stdio: 'pipe',
    env: { ...process.env, PORT: port.toString() }
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[Server] ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server Error] ${data.toString().trim()}`);
  });

  // Wait for server to be ready
  const isReady = await checkServerHealth(port, 30, 2000);
  if (!isReady) {
    throw new Error(`Server failed to start on port ${port} within timeout`);
  }

  console.log(`Backend server started on port ${port}`);
}

/**
 * Stop backend server
 * @returns {Promise<void>}
 */
async function stopBackendServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    console.log('Backend server stopped');
  }
}

/**
 * Wait for an image to appear in the page (content image, not UI icons)
 * @param {Page} page - Playwright page object
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @returns {Promise<boolean>} - True if content image found
 */
async function waitForImage(page, timeout = 60000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const images = await page.locator('img').all();
    for (const img of images) {
      const src = await img.getAttribute('src') || '';
      if (src.startsWith('blob:') || src.includes('data:')) {
        // Verify it's a substantial image (not just a small icon)
        const rect = await img.boundingBox();
        if (rect && rect.width > 50 && rect.height > 50) {
          return true;
        }
      }
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

/**
 * Wait for loading indicator to appear
 * @param {Page} page - Playwright page object
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @returns {Promise<boolean>} - True if loading indicator found
 */
async function waitForLoadingIndicator(page, timeout = 60000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const loadingCount = await page.getByText(/%/).count();
    if (loadingCount > 0) {
      return true;
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

/**
 * Create a room and return the room URL
 * @param {Page} page - Playwright page object
 * @returns {Promise<string>} - The room URL
 */
async function createRoom(page) {
  await page.goto('/');
  const startRoomButton = page.getByRole('button', { name: /start a Private Room/i });
  await startRoomButton.waitFor({ timeout: 30000 });
  await startRoomButton.click();
  await page.waitForURL(new RegExp('\\?room='), { timeout: 30000 });
  await page.waitForTimeout(2000);
  return page.url();
}

/**
 * Upload a file to the page
 * @param {Page} page - Playwright page object
 * @param {string} filePath - Path to the file to upload
 */
async function uploadFile(page, filePath) {
  const fileInput = page.locator('input#contained-button-file').first();
  // File inputs are typically hidden, so we check for attachment (existence in DOM) not visibility
  await expect(fileInput).toBeAttached({ timeout: 10000 });
  await fileInput.setInputFiles(filePath);
  await page.waitForTimeout(2000);
}

// Global tracker for window positions to ensure no overlap
const windowPositions = new Map();

/**
 * Position browser window side-by-side (for local viewing)
 * Uses CDP to position windows when running in headed mode
 * @param {Page} page - Playwright page object
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} width - Window width
 * @param {number} height - Window height
 */
async function positionWindow(page, x, y, width, height) {
  try {
    const context = page.context();
    const browser = context.browser();
    if (!browser) {
      console.log(`⚠️  No browser instance found for window positioning`);
      return;
    }
    
    // Get CDP session
    const client = await context.newCDPSession(page);
    
    // Enable Browser domain
    await client.send('Browser.enable');
    
    // Get context index to use as window identifier
    const contexts = browser.contexts();
    const contextIndex = contexts.indexOf(context);
    
    // Try to get the actual window ID
    let windowId = contextIndex + 1; // Default fallback
    
    try {
      // Method 1: List all windows and find the one for this context
      const { windows } = await client.send('Browser.getWindowForTarget', {
        targetId: (await page.evaluateHandle(() => window)).toString()
      }).catch(() => ({}));
      
      if (windows && windows.length > contextIndex) {
        windowId = windows[contextIndex].windowId;
      }
    } catch (e) {
      // Method 2: Try to get window ID from the target
      try {
        const targetInfo = await page.evaluate(() => {
          // Try Chrome API
          if (window.chrome && window.chrome.runtime) {
            return window.chrome.windowId;
          }
          return null;
        });
        if (targetInfo) windowId = targetInfo;
      } catch (e2) {
        // Use context index as fallback
      }
    }
    
    // Store position to track
    const positionKey = `${contextIndex}-${windowId}`;
    windowPositions.set(positionKey, { x, y, width, height });
    
    // Position the window
    await client.send('Browser.setWindowBounds', {
      windowId: windowId,
      bounds: { 
        left: x, 
        top: y, 
        width: width, 
        height: height, 
        windowState: 'normal' 
      }
    });
    
    // Verify the position was set
    await page.waitForTimeout(300);
    
    // Try to verify position (optional)
    try {
      const bounds = await client.send('Browser.getWindowBounds', { windowId });
      if (Math.abs(bounds.bounds.left - x) > 50) {
        console.log(`⚠️  Window position may not have been set correctly. Expected ${x}, got ${bounds.bounds.left}`);
      }
    } catch (e) {
      // Verification failed, but that's okay
    }
    
  } catch (e) {
    // Fallback: Try simpler approach with context index
    try {
      const context = page.context();
      const browser = context.browser();
      if (!browser) return;
      
      const contexts = browser.contexts();
      const contextIndex = contexts.indexOf(context);
      const client = await context.newCDPSession(page);
      
      await client.send('Browser.enable');
      
      // Use context index + 1 as window ID
      const windowId = contextIndex + 1;
      
      await client.send('Browser.setWindowBounds', {
        windowId: windowId,
        bounds: { 
          left: x, 
          top: y, 
          width: width, 
          height: height, 
          windowState: 'normal' 
        }
      });
      
      await page.waitForTimeout(300);
    } catch (e2) {
      console.log(`⚠️  Could not auto-position window at (${x}, ${y}). Error: ${e2.message}`);
      console.log(`   You may need to manually position this window.`);
    }
  }
}

/**
 * Launch separate browser instances for side-by-side viewing
 * This ensures each browser gets its own window that can be positioned independently
 * @returns {Promise<{browser1: Browser, browser2: Browser, context1: BrowserContext, context2: BrowserContext, page1: Page, page2: Page}>}
 */
async function launchSideBySideBrowsers() {
  const windowWidth = 420;
  const windowHeight = 750;
  const padding = 50; // Increased padding so windows are fully visible with no overlap
  const startX = 50;
  const startY = 50;
  
  const window1X = startX;
  const window2X = startX + windowWidth + padding;

  // Launch separate browser instances with positioned windows
  const browser1 = await chromium.launch({
    headless: false,
    args: [
      `--window-size=${windowWidth},${windowHeight}`,
      `--window-position=${window1X},${startY}`
    ]
  });

  const browser2 = await chromium.launch({
    headless: false,
    args: [
      `--window-size=${windowWidth},${windowHeight}`,
      `--window-position=${window2X},${startY}`
    ]
  });

  // Create contexts with mobile viewport
  const context1 = await browser1.newContext({
    viewport: { width: 375, height: 667 },
    permissions: ['clipboard-read', 'clipboard-write']
  });

  const context2 = await browser2.newContext({
    viewport: { width: 375, height: 667 }
  });

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  console.log(`📱 Launched separate browser instances side-by-side:`);
  console.log(`   Browser 1: (${window1X}, ${startY}) - ${windowWidth}x${windowHeight}`);
  console.log(`   Browser 2: (${window2X}, ${startY}) - ${windowWidth}x${windowHeight}`);
  console.log(`   Spacing: ${padding}px between windows (no overlap)`);

  return { browser1, browser2, context1, context2, page1, page2 };
}

/**
 * Launch three separate browser instances for side-by-side viewing
 * @returns {Promise<{browsers: Browser[], contexts: BrowserContext[], pages: Page[]}>}
 */
async function launchSideBySideBrowsers3() {
  const windowWidth = 400;
  const windowHeight = 700;
  const padding = 50; // Increased padding so windows are fully visible with no overlap
  const startX = 50;
  const startY = 50;
  
  const window1X = startX;
  const window2X = startX + windowWidth + padding;
  const window3X = startX + (windowWidth + padding) * 2;

  const browsers = [];
  const contexts = [];
  const pages = [];
  const positions = [window1X, window2X, window3X];

  for (let i = 0; i < 3; i++) {
    const browser = await chromium.launch({
      headless: false,
      args: [
        `--window-size=${windowWidth},${windowHeight}`,
        `--window-position=${positions[i]},${startY}`
      ]
    });
    browsers.push(browser);

    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      permissions: i === 0 ? ['clipboard-read', 'clipboard-write'] : []
    });
    contexts.push(context);

    const page = await context.newPage();
    pages.push(page);
  }

  console.log(`📱 Launched 3 separate browser instances side-by-side:`);
  positions.forEach((x, i) => {
    console.log(`   Browser ${i + 1}: (${x}, ${startY}) - ${windowWidth}x${windowHeight}`);
  });
  console.log(`   Spacing: ${padding}px between windows (no overlap)`);

  return { browsers, contexts, pages };
}

/**
 * Setup side-by-side browser windows for local viewing
 * For side-by-side mode, launches separate browser instances
 * @param {BrowserContext} context1 - First browser context (from shared browser)
 * @param {BrowserContext} context2 - Second browser context (from shared browser)
 * @param {Page} page1 - First page
 * @param {Page} page2 - Second page
 * @returns {Promise<{browser1: Browser, browser2: Browser, context1: BrowserContext, context2: BrowserContext, page1: Page, page2: Page}>}
 */
async function setupSideBySideWindows(context1, context2, page1, page2) {
  // Close the original contexts and launch separate browsers
  await context1.close().catch(() => {});
  await context2.close().catch(() => {});
  
  // Launch separate browser instances for true side-by-side viewing
  return await launchSideBySideBrowsers();
}

module.exports = {
  checkServerRunning,
  checkServerHealth,
  startBackendServer,
  stopBackendServer,
  waitForImage,
  waitForLoadingIndicator,
  createRoom,
  uploadFile,
  positionWindow,
  setupSideBySideWindows,
  launchSideBySideBrowsers,
  launchSideBySideBrowsers3
};

