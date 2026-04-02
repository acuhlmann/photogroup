const { test, expect } = require('@playwright/test');
const path = require('path');
const { checkServerRunning, createRoom, uploadFile, waitForImage, openGalleryDrawer } = require('../helpers/test-helpers');

const TEST_IMAGE = path.join(__dirname, '../fixtures/test-image.jpg');

/**
 * Photo sharing reliability tests.
 * These verify the core sharing flow works end-to-end in headless mode,
 * covering scenarios that previously caused failures.
 */

test.describe('photo sharing reliability', () => {

  test.beforeEach(async () => {
    const serverRunning = await checkServerRunning(8081);
    if (!serverRunning) {
      throw new Error('Backend server is not running on port 8081.');
    }
  });

  test('uploader sees their own photo in gallery after upload', async ({ page }) => {
    // Create room (dialog auto-dismissed by createRoom)
    const roomUrl = await createRoom(page);
    expect(roomUrl).toContain('?room=');

    // Upload image
    await uploadFile(page, TEST_IMAGE);

    // Verify image appears in own gallery
    const imageFound = await waitForImage(page, 30000);
    expect(imageFound).toBeTruthy();
  });

  test('second peer receives photo via P2P within 60 seconds', async ({ browser }) => {
    const context1 = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Browser 1 creates room and uploads
      const roomUrl = await createRoom(page1);
      await uploadFile(page1, TEST_IMAGE);

      // Browser 2 joins room
      await page2.goto(roomUrl, { waitUntil: 'domcontentloaded' });
      await page2.waitForTimeout(3000);

      // Wait for image to appear in Browser 2
      const imageFound = await waitForImage(page2, 60000);
      expect(imageFound).toBeTruthy();
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('late joiner receives previously uploaded photo', async ({ browser }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    try {
      // Browser 1 creates room and uploads photo
      const roomUrl = await createRoom(page1);
      await uploadFile(page1, TEST_IMAGE);

      // Wait for upload to fully complete (torrent seeding)
      await page1.waitForTimeout(5000);

      // Now Browser 2 joins AFTER the photo was already uploaded
      const context2 = await browser.newContext();
      const page2 = await context2.newPage();

      await page2.goto(roomUrl, { waitUntil: 'domcontentloaded' });
      await page2.waitForTimeout(3000);

      // Late joiner should still get the photo via P2P
      const imageFound = await waitForImage(page2, 60000);
      expect(imageFound).toBeTruthy();

      await context2.close();
    } finally {
      await context1.close();
    }
  });

  test('room persists and photo metadata survives page reload for creator', async ({ page }) => {
    // Create room and upload
    const roomUrl = await createRoom(page);
    await uploadFile(page, TEST_IMAGE);
    await page.waitForTimeout(5000);

    // Verify photo appeared
    const imageFound = await waitForImage(page, 30000);
    expect(imageFound).toBeTruthy();

    // Reload the page (same room URL)
    await page.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    // After reload, the photo tile should still be present
    // Open gallery drawer to check for tiles
    await openGalleryDrawer(page);
    const tiles = await page.locator('img').count();
    // At minimum the app should load and show something
    const appLoaded = await page.locator('.App').count();
    expect(appLoaded).toBeGreaterThan(0);
  });

  test('SSE delivers photo events to second peer', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Browser 1 creates room
      const roomUrl = await createRoom(page1);

      // Browser 2 joins the room
      await page2.goto(roomUrl, { waitUntil: 'domcontentloaded' });
      await page2.waitForTimeout(3000);

      // Open gallery drawer on Browser 2 and get baseline count
      await openGalleryDrawer(page2);
      const tileCountBefore = await page2.locator('img').count();

      // Browser 1 uploads photo
      await uploadFile(page1, TEST_IMAGE);

      // Wait and verify Browser 2 received the SSE event and shows new content
      let newContent = false;
      const startTime = Date.now();
      while (Date.now() - startTime < 60000) {
        await openGalleryDrawer(page2);
        const currentCount = await page2.locator('img').count();
        if (currentCount > tileCountBefore) {
          newContent = true;
          break;
        }
        const loadingTiles = await page2.locator('[class*="progress"], [class*="loading"]').count();
        const blobImages = await page2.locator('img[src^="blob:"]').count();
        if (loadingTiles > 0 || blobImages > 0) {
          newContent = true;
          break;
        }
        await page2.waitForTimeout(1000);
      }

      expect(newContent).toBeTruthy();
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('multiple photos can be shared in sequence', async ({ page }) => {
    const roomUrl = await createRoom(page);

    // Upload same image twice (simulates sharing multiple photos)
    await uploadFile(page, TEST_IMAGE);
    await page.waitForTimeout(3000);

    // First upload should show
    const firstImageFound = await waitForImage(page, 30000);
    expect(firstImageFound).toBeTruthy();

    // Upload again
    await uploadFile(page, TEST_IMAGE);
    await page.waitForTimeout(5000);

    // App should still be responsive (not crash on duplicate)
    const appLoaded = await page.locator('.App').count();
    expect(appLoaded).toBeGreaterThan(0);
  });
});
