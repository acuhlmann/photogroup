const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;

(async () => {
  console.log('🚀 Starting two-browser image sharing demonstration...\n');

  // Launch browser
  const browser = await chromium.launch({ 
    headless: false
  });

  // Browser 1: Will create room and upload
  const context1 = await browser.newContext({
    viewport: { width: 375, height: 667 },
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page1 = await context1.newPage();

  // Browser 2: Will join and receive
  const context2 = await browser.newContext({
    viewport: { width: 375, height: 667 }
  });
  const page2 = await context2.newPage();

  try {
    // Step 1: Browser 1 - Navigate and create room
    console.log('📱 Browser 1: Opening app...');
    await page1.goto('http://localhost:3000');
    await page1.waitForTimeout(2000);
    await page1.screenshot({ path: 'demo-browser1-step1-initial.png', fullPage: true });
    console.log('   ✓ Screenshot: demo-browser1-step1-initial.png');

    console.log('📱 Browser 1: Creating room...');
    const startRoomButton = page1.getByRole('button', { name: /start a Private Room/i });
    await startRoomButton.waitFor({ timeout: 30000 });
    await startRoomButton.click();

    await page1.waitForURL(/\?room=/, { timeout: 30000 });
    await page1.waitForTimeout(2000);
    const roomUrl = page1.url();
    console.log(`   ✓ Room created: ${roomUrl}`);
    await page1.screenshot({ path: 'demo-browser1-step2-room-created.png', fullPage: true });
    console.log('   ✓ Screenshot: demo-browser1-step2-room-created.png');

    // Close dialog if open
    try {
      const closeBtn = page1.locator('button[aria-label*="close" i], button:has-text("×"), button:has-text("Close")').first();
      if (await closeBtn.isVisible({ timeout: 1000 })) {
        await closeBtn.click();
        await page1.waitForTimeout(500);
      }
    } catch (e) {}

    // Step 2: Browser 2 - Join room
    console.log('\n📱 Browser 2: Joining room...');
    await page2.goto(roomUrl);
    await page2.waitForTimeout(3000);
    await page2.screenshot({ path: 'demo-browser2-step1-joined.png', fullPage: true });
    console.log('   ✓ Screenshot: demo-browser2-step1-joined.png');

    // Step 3: Browser 1 - Upload image
    console.log('\n📤 Browser 1: Uploading image...');
    const testImagePath = path.join(__dirname, 'e2e/fixtures/test-image.jpg');
    const fileInput = page1.locator('input#contained-button-file').first();
    await fileInput.waitFor({ timeout: 10000 });
    await fileInput.setInputFiles(testImagePath);
    await page1.waitForTimeout(2000);
    await page1.screenshot({ path: 'demo-browser1-step3-uploading.png', fullPage: true });
    console.log('   ✓ Screenshot: demo-browser1-step3-uploading.png');

    // Step 4: Browser 2 - Wait for image
    console.log('\n📥 Browser 2: Waiting for image to arrive via P2P...');
    let imageFound = false;
    const startTime = Date.now();
    const maxWaitTime = 60000;

    while (Date.now() - startTime < maxWaitTime && !imageFound) {
      await page2.waitForTimeout(1000);
      
      // Check for images
      const images = await page2.locator('img').all();
      for (const img of images) {
        const src = await img.getAttribute('src');
        if (src && (src.startsWith('blob:') || src.includes('data:') || src.includes('test-image'))) {
          const alt = await img.getAttribute('alt') || '';
          const parent = await img.evaluateHandle(el => el.closest('[class*="tile"], [class*="gallery"], [class*="content"]'));
          if (parent) {
            imageFound = true;
            console.log('   ✅ IMAGE RECEIVED!');
            await page2.screenshot({ path: 'demo-browser2-step2-image-received.png', fullPage: true });
            console.log('   ✓ Screenshot: demo-browser2-step2-image-received.png');
            break;
          }
        }
      }

      // Check for loading indicators
      if (!imageFound) {
        const loadingText = await page2.getByText(/%/).first().textContent().catch(() => null);
        if (loadingText) {
          console.log(`   ⏳ Downloading... ${loadingText}`);
        }
      }
    }

    // Final screenshots
    await page1.screenshot({ path: 'demo-browser1-final.png', fullPage: true });
    await page2.screenshot({ path: 'demo-browser2-final.png', fullPage: true });

    if (imageFound) {
      console.log('\n✅ SUCCESS! Image sharing works across two browsers!');
      console.log('\n📸 Screenshots saved:');
      console.log('   - demo-browser1-step1-initial.png');
      console.log('   - demo-browser1-step2-room-created.png');
      console.log('   - demo-browser1-step3-uploading.png');
      console.log('   - demo-browser2-step1-joined.png');
      console.log('   - demo-browser2-step2-image-received.png');
      console.log('   - demo-browser1-final.png');
      console.log('   - demo-browser2-final.png');
      console.log('\n👀 Both browser windows are visible - you can see the image in Browser 2!');
    } else {
      console.log('\n⚠️ Image not received within timeout, but browsers are still open for inspection');
    }

    // Keep open for user to see
    console.log('\n⏳ Keeping browsers open for 60 seconds for inspection...');
    console.log('   (You can see both browser windows side by side)');
    await page1.waitForTimeout(60000);

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page1.screenshot({ path: 'demo-error-browser1.png', fullPage: true });
    await page2.screenshot({ path: 'demo-error-browser2.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();

