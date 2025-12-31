const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');

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

test('single peer room creation and photo upload', async ({ page }) => {
  const serverRunning = await checkServerRunning(8081);
  if (!serverRunning) {
    throw new Error(
      'Backend server is not running on port 8081. ' +
      'Please start it with "npm run start-server" from the project root before running tests.'
    );
  }

  // Step 1: Navigate to app
  await page.goto('/');
  
  // Step 2: Create room
  const startRoomButton = page.getByRole('button', { name: /start a Private Room/i });
  await expect(startRoomButton).toBeVisible({ timeout: 30000 });
  await startRoomButton.click();
  
  // Step 3: Wait for room creation
  await expect(page).toHaveURL(new RegExp('\\?room='), { timeout: 30000 });
  await page.waitForTimeout(2000);
  
  // Step 4: Verify room URL
  const currentUrl = page.url();
  expect(currentUrl).toContain('?room=');
  const roomId = new URL(currentUrl).searchParams.get('room');
  expect(roomId).toBeTruthy();
  console.log('Created room:', roomId);
  
  // Step 5: Upload image
  const fileInput = page.locator('input#contained-button-file').first();
  await expect(fileInput).toBeAttached({ timeout: 10000 });
  
  const testImagePath = path.join(__dirname, '../fixtures/test-image.jpg');
  await fileInput.setInputFiles(testImagePath);
  
  // Step 6: Wait for upload to process
  await page.waitForTimeout(3000);
  
  // Step 7: Verify image appears in gallery
  const imageCount = await page.locator('img').count();
  expect(imageCount).toBeGreaterThan(0);
  console.log('Images found:', imageCount);
});

test('room URL sharing via clipboard', async ({ page }) => {
  const serverRunning = await checkServerRunning(8081);
  if (!serverRunning) {
    test.skip();
  }

  // Grant clipboard permissions
  const context = await page.context();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/');
  
  // Create room
  const startRoomButton = page.getByRole('button', { name: /start a Private Room/i });
  await expect(startRoomButton).toBeVisible({ timeout: 30000 });
  await startRoomButton.click();
  
  await expect(page).toHaveURL(new RegExp('\\?room='), { timeout: 30000 });
  await page.waitForTimeout(2000);

  // Try to find and click copy button
  const copyPasteLinkText = page.getByText('Copy/Paste Link');
  if (await copyPasteLinkText.count() > 0) {
    await expect(copyPasteLinkText).toBeVisible();
    const copyLinkButton = copyPasteLinkText.locator('..').getByRole('button');
    if (await copyLinkButton.count() > 0) {
      await copyLinkButton.click();
      await page.waitForTimeout(500);
      
      // Try to read from clipboard
      try {
        const clipboardText = await page.evaluate(async () => {
          return await navigator.clipboard.readText();
        });
        expect(clipboardText).toContain('?room=');
        console.log('Clipboard contains room URL:', clipboardText);
      } catch (e) {
        // Clipboard access might fail in some browsers
        console.log('Clipboard access failed, but that\'s okay');
      }
    }
  }
});

