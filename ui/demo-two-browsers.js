const { chromium } = require('playwright');
const path = require('path');

(async () => {
  // Launch browser with two contexts (two separate browser windows)
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--start-maximized']
  });

  // Browser 1: Create room and upload
  const context1 = await browser.newContext({
    viewport: { width: 375, height: 667 },
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page1 = await context1.newPage();

  // Browser 2: Join room and receive
  const context2 = await browser.newContext({
    viewport: { width: 375, height: 667 }
  });
  const page2 = await context2.newPage();

  console.log('Opening Browser 1 (left)...');
  await page1.goto('http://localhost:3000');
  await page1.waitForTimeout(2000);

  // Position browser 1 on the left
  const page1Window = await page1.evaluateHandle(() => window);
  // Note: Window positioning might not work in all browsers, but viewport size will

  console.log('Creating room in Browser 1...');
  const startRoomButton = page1.getByRole('button', { name: /start a Private Room/i });
  await startRoomButton.waitFor({ timeout: 30000 });
  await startRoomButton.click();

  // Wait for room creation
  await page1.waitForURL(/\?room=/, { timeout: 30000 });
  await page1.waitForTimeout(2000);

  const roomUrl = page1.url();
  console.log('Room created:', roomUrl);

  // Close dialog if it opened
  try {
    const closeButton = page1.locator('button[aria-label*="close" i], button:has-text("×")').first();
    if (await closeButton.isVisible({ timeout: 1000 })) {
      await closeButton.click();
      await page1.waitForTimeout(500);
    }
  } catch (e) {
    // Dialog might not be open, that's fine
  }

  console.log('Opening Browser 2 (right) with room URL...');
  await page2.goto(roomUrl);
  await page2.waitForTimeout(3000);

  console.log('Uploading image in Browser 1...');
  const testImagePath = path.join(__dirname, 'e2e/fixtures/test-image.jpg');
  const fileInput = page1.locator('input#contained-button-file').first();
  await fileInput.waitFor({ timeout: 10000 });
  await fileInput.setInputFiles(testImagePath);

  console.log('Waiting for image to appear in Browser 2...');
  
  // Wait up to 60 seconds for image to appear in browser 2
  let imageFound = false;
  const startTime = Date.now();
  const maxWaitTime = 60000;

  while (Date.now() - startTime < maxWaitTime && !imageFound) {
    const imageCount = await page2.locator('img').count();
    if (imageCount > 0) {
      // Check if it's an actual content image (not just UI icons)
      const images = await page2.locator('img').all();
      for (const img of images) {
        const src = await img.getAttribute('src');
        if (src && (src.startsWith('blob:') || src.includes('data:'))) {
          imageFound = true;
          console.log('✅ Image received in Browser 2!');
          break;
        }
      }
    }
    
    if (!imageFound) {
      await page2.waitForTimeout(1000);
      const loadingIndicators = await page2.getByText(/%/).count();
      if (loadingIndicators > 0) {
        const loadingText = await page2.getByText(/%/).first().textContent();
        console.log(`Browser 2: Downloading... ${loadingText}`);
      }
    }
  }

  if (imageFound) {
    console.log('✅ SUCCESS: Image sharing works!');
    console.log('Both browsers are visible - you can see the image in Browser 2');
  } else {
    console.log('⚠️ Image not found in Browser 2 within timeout');
  }

  // Keep browsers open for 30 seconds so user can see
  console.log('Keeping browsers open for 30 seconds for inspection...');
  await page1.waitForTimeout(30000);

  await browser.close();
})();

