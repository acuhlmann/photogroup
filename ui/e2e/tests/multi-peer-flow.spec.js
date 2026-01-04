const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');
const { launchSideBySideBrowsers3 } = require('../helpers/test-helpers');

// Helper function to check if server is running
async function checkServerRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/rooms`, (res) => {
      resolve(res.statusCode !== undefined);
      res.on('data', () => {});
      res.on('end', () => {});
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

test('three browser P2P photo sharing flow', async ({ browser }) => {
  // Skip in CI or headless environments - P2P tests require real WebRTC connections which are unreliable in headless environments
  const isHeadless = !process.env.HEADED && process.env.SIDE_BY_SIDE !== 'true';
  test.skip(!!process.env.CI || isHeadless, 'Skipping P2P test in CI/headless - requires real WebRTC connections');
  
  // Check if backend server is running
  const serverRunning = await checkServerRunning(8081);
  if (!serverRunning) {
    throw new Error(
      'Backend server is not running on port 8081. ' +
      'Please start it with "npm run start-server" from the project root before running tests.'
    );
  }

  let context1, context2, context3, page1, page2, page3, browsers;

  // For side-by-side mode, launch separate browser instances
  if (process.env.SIDE_BY_SIDE === 'true') {
    const result = await launchSideBySideBrowsers3();
    browsers = result.browsers;
    context1 = result.contexts[0];
    context2 = result.contexts[1];
    context3 = result.contexts[2];
    page1 = result.pages[0];
    page2 = result.pages[1];
    page3 = result.pages[2];
  } else {
    // Normal mode: use contexts from the same browser
    context1 = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    context2 = await browser.newContext();
    context3 = await browser.newContext();
    
    page1 = await context1.newPage();
    page2 = await context2.newPage();
    page3 = await context3.newPage();
  }

  // Step 1: Browser 1 - Create room
  await page1.goto('/');
  
  const startRoomButton = page1.getByRole('button', { name: /start a Private Room/i });
  await expect(startRoomButton).toBeVisible({ timeout: 30000 });
  await startRoomButton.click();
  
  await expect(page1).toHaveURL(new RegExp('\\?room='), { timeout: 30000 });
  await page1.waitForTimeout(2000);

  // Get room URL
  let roomUrl = page1.url();
  expect(roomUrl).toContain('?room=');
  console.log('Room URL:', roomUrl);

  // Step 2: Browser 2 and 3 - Join room
  await page2.goto(roomUrl);
  await page3.goto(roomUrl);
  
  await expect(page2).toHaveURL(new RegExp('\\?room='), { timeout: 10000 });
  await expect(page3).toHaveURL(new RegExp('\\?room='), { timeout: 10000 });
  
  await page2.waitForTimeout(2000);
  await page3.waitForTimeout(2000);

  // Step 3: Browser 1 - Upload image
  const fileInput = page1.locator('input#contained-button-file').first();
  await expect(fileInput).toBeAttached({ timeout: 10000 });
  
  const testImagePath = path.join(__dirname, '../fixtures/test-image.jpg');
  await fileInput.setInputFiles(testImagePath);
  await page1.waitForTimeout(2000);

  // Step 4: Browser 2 and 3 - Wait for P2P download
  let downloaded2 = false;
  let downloaded3 = false;
  const maxWaitTime = 30000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime && (!downloaded2 || !downloaded3)) {
    if (!downloaded2) {
      const status2 = await page2.evaluate(() => {
        if (window.client && window.client.torrents && window.client.torrents.length > 0) {
          const t = window.client.torrents[0];
          return { progress: Math.round(t.progress * 100), peers: t.numPeers };
        }
        return null;
      });
      if (status2 && status2.progress === 100) {
        downloaded2 = true;
        console.log(`Browser 2: Downloaded 100%, peers: ${status2.peers}`);
      } else if (status2) {
        console.log(`Browser 2: Progress ${status2.progress}%, peers: ${status2.peers}`);
      }
    }

    if (!downloaded3) {
      const status3 = await page3.evaluate(() => {
        if (window.client && window.client.torrents && window.client.torrents.length > 0) {
          const t = window.client.torrents[0];
          return { progress: Math.round(t.progress * 100), peers: t.numPeers };
        }
        return null;
      });
      if (status3 && status3.progress === 100) {
        downloaded3 = true;
        console.log(`Browser 3: Downloaded 100%, peers: ${status3.peers}`);
      } else if (status3) {
        console.log(`Browser 3: Progress ${status3.progress}%, peers: ${status3.peers}`);
      }
    }

    if (!downloaded2 || !downloaded3) {
      await page2.waitForTimeout(1000);
    }
  }

  expect(downloaded2).toBeTruthy();
  expect(downloaded3).toBeTruthy();
  console.log('All browsers successfully received the image via P2P!');

  // Clean up
  // Clean up
  if (process.env.SIDE_BY_SIDE === 'true') {
    await Promise.all(browsers.map(b => b.close()));
  } else {
    await context1.close();
    await context2.close();
    await context3.close();
  }
});

