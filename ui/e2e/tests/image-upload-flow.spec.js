const { test, expect } = require('@playwright/test');
const path = require('path');
const { checkServerRunning, waitForImage, createRoom, uploadFile, setupSideBySideWindows, launchSideBySideBrowsers } = require('../helpers/test-helpers');

/**
 * Core E2E test: Upload image in one browser, receive in another
 * This test verifies the essential P2P photo sharing functionality.
 * 
 * Can run in:
 * - Headless mode (CI): npx playwright test
 * - Headed mode (local): npx playwright test --headed
 * - Side-by-side (local): SIDE_BY_SIDE=true npx playwright test --headed
 */
test('image upload and receive flow between two browsers', async ({ browser }) => {
  // Check if backend server is running (should be auto-started by Playwright config)
  const serverRunning = await checkServerRunning(8081);
  if (!serverRunning) {
    throw new Error(
      'Backend server is not running on port 8081. ' +
      'Please ensure the server is started or check Playwright webServer configuration.'
    );
  }

  let context1, context2, page1, page2, browser1, browser2;

  // For side-by-side mode, launch separate browser instances for true side-by-side windows
  if (process.env.SIDE_BY_SIDE === 'true') {
    const result = await launchSideBySideBrowsers();
    browser1 = result.browser1;
    browser2 = result.browser2;
    context1 = result.context1;
    context2 = result.context2;
    page1 = result.page1;
    page2 = result.page2;
  } else {
    // Normal mode: use contexts from the same browser
    context1 = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    page1 = await context1.newPage();

    context2 = await browser.newContext();
    page2 = await context2.newPage();
  }

  // Set up error logging
  page1.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('[Browser 1] Console error:', msg.text());
    }
  });
  page2.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('[Browser 2] Console error:', msg.text());
    }
  });

  page1.on('pageerror', error => {
    console.log('[Browser 1] Page error:', error.message);
  });
  page2.on('pageerror', error => {
    console.log('[Browser 2] Page error:', error.message);
  });

  try {
    // Step 1: Browser 1 - Create room
    console.log('Step 1: Browser 1 creating room...');
    const roomUrl = await createRoom(page1);
    expect(roomUrl).toContain('?room=');
    console.log(`Room created: ${roomUrl}`);

    // Close dialog if it opened
    try {
      const closeBtn = page1.locator('button[aria-label*="close" i], button:has-text("×"), button:has-text("Close")').first();
      if (await closeBtn.isVisible({ timeout: 2000 })) {
        await closeBtn.click();
        await page1.waitForTimeout(500);
      }
    } catch (e) {
      // Dialog might not be open, that's fine
    }

    // Step 2: Browser 2 - Join room
    console.log('Step 2: Browser 2 joining room...');
    await page2.goto(roomUrl);
    await expect(page2).toHaveURL(new RegExp('\\?room='), { timeout: 10000 });
    await page2.waitForTimeout(2000); // Wait for room to initialize
    console.log('Browser 2 joined room');

    // Step 3: Browser 1 - Upload image
    console.log('Step 3: Browser 1 uploading image...');
    const testImagePath = path.join(__dirname, '../fixtures/test-image.jpg');
    await uploadFile(page1, testImagePath);
    console.log('Image upload initiated in Browser 1');

    // Step 4: Browser 2 - Wait for image to appear
    console.log('Step 4: Browser 2 waiting for image...');
    
    // Wait for either image to appear or loading indicator
    let imageFound = false;
    let loadingFound = false;
    const maxWaitTime = 90000; // 90 seconds for P2P transfer
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime && !imageFound) {
      // Check for actual content images (blob: or data: URLs, not UI icons)
      const images = await page2.locator('img').all();
      for (const img of images) {
        const src = await img.getAttribute('src') || '';
        if (src.startsWith('blob:') || src.includes('data:')) {
          // Verify it's a substantial image (not just a small icon)
          const rect = await img.boundingBox();
          if (rect && rect.width > 50 && rect.height > 50) {
            imageFound = true;
            console.log('✅ Image received in Browser 2!');
            break;
          }
        }
      }

      if (!imageFound) {
        // Check for loading indicators
        const loadingElements = await page2.locator('text=/%/').all();
        if (loadingElements.length > 0) {
          const loadingText = await loadingElements[0].textContent();
          if (!loadingFound) {
            loadingFound = true;
            console.log(`⏳ Download in progress: ${loadingText?.trim()}`);
          }
        }
      }

      if (!imageFound) {
        await page2.waitForTimeout(2000);
      }
    }

    // Verify image was received
    expect(imageFound).toBeTruthy();
    console.log('✅ Test passed: Image successfully shared from Browser 1 to Browser 2 via P2P');

  } finally {
    // Clean up
    if (process.env.SIDE_BY_SIDE === 'true') {
      // Close separate browser instances
      await browser1.close();
      await browser2.close();
    } else {
      // Close contexts from shared browser
      await context1.close();
      await context2.close();
    }
  }
});

