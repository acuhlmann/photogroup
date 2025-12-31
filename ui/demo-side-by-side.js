const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Check if test image exists
function checkTestImage() {
  const testImagePath = path.join(__dirname, 'e2e/fixtures/test-image.jpg');
  if (!fs.existsSync(testImagePath)) {
    throw new Error(`Test image not found at: ${testImagePath}`);
  }
  console.log(`✓ Test image found: ${testImagePath}`);
  return testImagePath;
}

// Position window using CDP (Chrome DevTools Protocol)
async function positionWindow(page, x, y, width, height) {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Browser.setWindowBounds', {
      windowId: (await page.evaluate(() => window.chrome?.windowId)) || 1,
      bounds: { left: x, top: y, width: width, height: height, windowState: 'normal' }
    });
  } catch (e) {
    // Fallback: Try using browser window positioning
    try {
      const context = page.context();
      const pages = context.pages();
      // Note: Direct window positioning may not work, but we'll try
    } catch (e2) {
      console.log('   Note: Automatic window positioning not available, please position manually');
    }
  }
}

(async () => {
  console.log('🚀 Starting side-by-side browser demonstration...\n');
  
  // Check test image exists
  const testImagePath = checkTestImage();
  console.log('');

  console.log('📱 Opening two browser windows (mobile size: 375x667)...\n');

  // Launch two separate browser instances for better window control
  const browser1 = await chromium.launch({ 
    headless: false,
    args: [
      '--window-size=375,667',
      '--window-position=100,100'
    ]
  });

  const browser2 = await chromium.launch({ 
    headless: false,
    args: [
      '--window-size=375,667',
      '--window-position=500,100'  // Position second window to the right
    ]
  });

  // Browser 1: Left side (will upload)
  const context1 = await browser1.newContext({
    viewport: { width: 375, height: 667 },
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page1 = await context1.newPage();

  // Browser 2: Right side (will receive)
  const context2 = await browser2.newContext({
    viewport: { width: 375, height: 667 }
  });
  const page2 = await context2.newPage();

  console.log('   ✓ Two browser windows opened');
  console.log('   👀 Please position them side by side if needed (they should be at different positions)\n');

  try {
    console.log('📱 Browser 1 (LEFT): Opening app...');
    await page1.goto('http://localhost:3000');
    await page1.waitForTimeout(3000);
    console.log('   ✓ App loaded - check Browser 1 window\n');

    console.log('📱 Browser 1: Creating room...');
    console.log('   👀 Watch Browser 1 - clicking "start a Private Room" button...');
    const startRoomButton = page1.getByRole('button', { name: /start a Private Room/i });
    await startRoomButton.waitFor({ timeout: 30000 });
    await page1.waitForTimeout(1000); // Pause so user can see the button
    await startRoomButton.click();
    console.log('   ✓ Button clicked - waiting for room creation...');

    await page1.waitForURL(/\?room=/, { timeout: 30000 });
    await page1.waitForTimeout(3000); // Longer delay to see the room
    const roomUrl = page1.url();
    const roomId = roomUrl.substring(roomUrl.indexOf('room=') + 5);
    console.log(`   ✓ Room created! Room ID: ${roomId}`);
    console.log('   👀 Check Browser 1 - you should see the room interface\n');

    // Close dialog if open
    try {
      const closeBtn = page1.locator('button[aria-label*="close" i], button:has-text("×"), button:has-text("Close"), button[aria-label="Close"]').first();
      if (await closeBtn.isVisible({ timeout: 2000 })) {
        console.log('   Closing share dialog...');
        await closeBtn.click();
        await page1.waitForTimeout(1000);
      }
    } catch (e) {}

    console.log('📱 Browser 2 (RIGHT): Joining room...');
    console.log('   👀 Watch Browser 2 - it will join the same room...');
    await page2.goto(roomUrl);
    await page2.waitForTimeout(4000); // Longer delay to see the join
    console.log('   ✓ Browser 2 joined the room!');
    console.log('   👀 Check Browser 2 - it should show the room interface\n');

    console.log('📤 Browser 1: Preparing to upload image...');
    console.log('   👀 Watch Browser 1 - looking for upload button...');
    const fileInput = page1.locator('input#contained-button-file').first();
    await fileInput.waitFor({ timeout: 10000 });
    console.log('   ✓ Upload button found');
    console.log(`   📷 Uploading test image: ${path.basename(testImagePath)}`);
    console.log('   👀 Watch Browser 1 - the image will be selected and uploaded...');
    await page1.waitForTimeout(2000); // Pause before upload
    await fileInput.setInputFiles(testImagePath);
    console.log('   ✓ Image file selected and upload started!');
    console.log('   👀 Check Browser 1 - you should see the image appear in the gallery\n');
    await page1.waitForTimeout(5000); // Longer delay to see upload progress

    console.log('📥 Browser 2: Waiting for image via P2P...');
    console.log('   👀 WATCH BROWSER 2 (right window) - the image will appear here!');
    console.log('   This is the P2P transfer - Browser 2 downloads from Browser 1\n');
    
    let imageFound = false;
    let lastProgress = '';
    const startTime = Date.now();
    const maxWaitTime = 90000; // 90 seconds

    while (Date.now() - startTime < maxWaitTime && !imageFound) {
      await page2.waitForTimeout(2000); // Check every 2 seconds
      
      // Check for images
      const images = await page2.locator('img').all();
      for (const img of images) {
        const src = await img.getAttribute('src') || '';
        if (src.startsWith('blob:') || src.includes('data:')) {
          const rect = await img.boundingBox();
          if (rect && rect.width > 50 && rect.height > 50) {
            imageFound = true;
            console.log('\n   ✅✅✅ SUCCESS! IMAGE RECEIVED IN BROWSER 2! ✅✅✅');
            console.log('   👀👀👀 CHECK BROWSER 2 (right window) - THE IMAGE IS THERE! 👀👀👀');
            console.log('   The image was transferred via P2P from Browser 1 to Browser 2!');
            break;
          }
        }
      }

      if (!imageFound) {
        // Check for loading indicators
        const loadingElements = await page2.locator('text=/%/').all();
        if (loadingElements.length > 0) {
          const loadingText = await loadingElements[0].textContent();
          if (loadingText !== lastProgress) {
            lastProgress = loadingText;
            console.log(`   ⏳ Downloading... ${loadingText.trim()} - Watch Browser 2!`);
          }
        } else {
          // Check for any loading tiles
          const loadingTiles = await page2.locator('[class*="Loading"], [class*="loading"]').count();
          if (loadingTiles > 0) {
            console.log('   ⏳ Image is loading... Watch Browser 2 for progress!');
          }
        }
      }
    }

    if (imageFound) {
      console.log('\n\n🎉🎉🎉 DEMONSTRATION COMPLETE! 🎉🎉🎉');
      console.log('✅ Image sharing via P2P works perfectly!');
      console.log('\n📊 Summary:');
      console.log('   📱 Browser 1 (LEFT): Created room and uploaded image');
      console.log('   📱 Browser 2 (RIGHT): Joined room and received image via P2P');
      console.log('\n👀 Both browser windows are visible - you can see:');
      console.log('   - Browser 1: The uploaded image in the gallery');
      console.log('   - Browser 2: The same image received via peer-to-peer transfer');
    } else {
      console.log('\n⚠️ Image not received within timeout');
      console.log('   But you can still see both browsers - check Browser 2 manually');
    }

    console.log('\n⏳ Keeping browsers open for 90 seconds for inspection...');
    console.log('   👀 You can see both windows side by side');
    console.log('   📱 Browser 1 (left): Shows the uploaded image');
    console.log('   📱 Browser 2 (right): Shows the received image');
    await page1.waitForTimeout(90000);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    console.log('\n🔒 Closing browsers...');
    await browser1.close();
    await browser2.close();
  }
})();

