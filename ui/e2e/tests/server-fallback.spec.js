const { test, expect } = require('@playwright/test');
const path = require('path');
const { checkServerRunning, createRoom, uploadFile, waitForImage } = require('../helpers/test-helpers');

const TEST_IMAGE = path.join(__dirname, '../fixtures/test-image.jpg');

/**
 * The travelling scenario: you show a friend a photo, lock your phone and
 * walk away. Your browser (the only P2P seeder) is gone, so the friend can
 * only receive the photo via the server copy left behind as insurance.
 */
test.describe('server-copy fallback', () => {
  test.beforeEach(async () => {
    if (!(await checkServerRunning(8081))) {
      throw new Error('Backend server is not running on port 8081.');
    }
  });

  test('late joiner still receives the photo after the sharer has left', async ({ browser }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    const roomUrl = await createRoom(page1);
    await uploadFile(page1, TEST_IMAGE);
    expect(await waitForImage(page1, 30000)).toBeTruthy();

    // Give the fire-and-forget server copy time to land, then verify via
    // the API that it actually did before simulating the sharer leaving.
    const roomId = new URL(roomUrl).searchParams.get('room');
    await expect.poll(async () => {
      const res = await page1.request.get(`/api/rooms/${roomId}`);
      const room = await res.json();
      return room.photos.some(photo => photo.hasServerCopy);
    }, { timeout: 30000 }).toBe(true);

    // Sharer locks their phone / closes the tab: the only seeder is gone.
    await context1.close();

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    try {
      await page2.goto(roomUrl, { waitUntil: 'domcontentloaded' });
      // P2P can never succeed here; delivery must come from the server
      // copy after the stall window.
      expect(await waitForImage(page2, 90000)).toBeTruthy();
    } finally {
      await context2.close();
    }
  });
});
