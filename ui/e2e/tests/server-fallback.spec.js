const { test, expect } = require('@playwright/test');
const path = require('path');
const { checkServerRunning, createRoom, uploadFile, waitForImage, dismissDialogs } = require('../helpers/test-helpers');

const TEST_IMAGE = path.join(__dirname, '../fixtures/test-image.jpg');

/**
 * The server-copy fallback: photos go phone to phone, and the server keeps
 * a temporary copy only when someone can't get one directly.
 */

// Relay-only ICE with an unreachable TURN server: this browser can't make any
// WebRTC connection, like a phone behind CGNAT on isolated venue Wi-Fi.
async function blockP2P(context) {
  await context.route('**/api/__rtcConfig__', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      iceTransportPolicy: 'relay',
      iceServers: [{ urls: 'turn:127.0.0.1:9', username: 'none', credential: 'none' }]
    })
  }));
}

// Phones freeze pages in the background; desktop tabs keep running.
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

async function roomPhoto(page, roomId) {
  const res = await page.request.get(`/api/rooms/${roomId}`);
  const room = await res.json();
  return { photo: room.photos[0], peers: room.peers };
}

async function keepCopiesForLatecomers(page) {
  await dismissDialogs(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const toggle = page.getByLabel(/Keep Copies for Latecomers/);
  await toggle.check();
  await expect(toggle).toBeChecked();
  await page.keyboard.press('Escape');
}

test.describe('server-copy fallback', () => {
  test.beforeEach(async () => {
    if (!(await checkServerRunning(8081))) {
      throw new Error('Backend server is not running on port 8081.');
    }
  });

  test('pins a copy only when a receiver that P2P cannot reach asks for one', async ({ browser }) => {
    test.setTimeout(180000);
    const sharerContext = await browser.newContext();
    const receiverContext = await browser.newContext();
    await blockP2P(receiverContext);
    const sharer = await sharerContext.newPage();
    const receiver = await receiverContext.newPage();
    try {
      const roomUrl = await createRoom(sharer);
      const roomId = new URL(roomUrl).searchParams.get('room');
      await uploadFile(sharer, TEST_IMAGE);
      expect(await waitForImage(sharer, 30000)).toBeTruthy();

      // Nobody needs it yet: nothing goes to the server.
      await sharer.waitForTimeout(3000);
      expect((await roomPhoto(sharer, roomId)).photo.hasServerCopy).toBeFalsy();

      await receiver.goto(roomUrl, { waitUntil: 'domcontentloaded' });
      let asked = false;
      const watch = setInterval(async () => {
        const { photo } = await roomPhoto(sharer, roomId).catch(() => ({}));
        if (photo?.serverCopyRequestedAt || photo?.hasServerCopy) asked = true;
      }, 500);
      try {
        // Stalls, asks, the sharer uploads, the receiver downloads.
        expect(await waitForImage(receiver, 90000)).toBeTruthy();
      } finally {
        clearInterval(watch);
      }
      expect(asked).toBeTruthy();
    } finally {
      await sharerContext.close();
      await receiverContext.close();
    }
  });

  test('leaves a copy on the way into the background for someone still waiting', async ({ browser }) => {
    test.setTimeout(180000);
    const sharerContext = await browser.newContext({ userAgent: PHONE_UA });
    const receiverContext = await browser.newContext();
    await blockP2P(receiverContext);
    const sharer = await sharerContext.newPage();
    const receiver = await receiverContext.newPage();
    try {
      const roomUrl = await createRoom(sharer);
      const roomId = new URL(roomUrl).searchParams.get('room');
      await uploadFile(sharer, TEST_IMAGE);
      expect(await waitForImage(sharer, 30000)).toBeTruthy();

      await receiver.goto(roomUrl, { waitUntil: 'domcontentloaded' });
      await expect.poll(async () => (await roomPhoto(sharer, roomId)).peers.length, { timeout: 30000 }).toBe(2);

      // The sharer's phone switches to another app.
      await sharer.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(async () => (await roomPhoto(receiver, roomId)).photo.hasServerCopy, { timeout: 15000 }).toBe(true);
      const { photo, peers } = await roomPhoto(receiver, roomId);
      // Left by the sharer going away, before the receiver asked for it.
      expect(photo.serverCopyRequestedAt).toBeUndefined();
      expect(peers.find(peer => peer.peerId === photo.peerId).away).toBeGreaterThan(0);

      // Its phone freezes for good: the copy still gets the photo across.
      await sharerContext.close();
      expect(await waitForImage(receiver, 90000)).toBeTruthy();
    } finally {
      await sharerContext.close().catch(() => {});
      await receiverContext.close();
    }
  });

  test('with copies kept for latecomers, a late joiner gets the photo after the sharer left', async ({ browser }) => {
    test.setTimeout(180000);
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    const roomUrl = await createRoom(page1);
    const roomId = new URL(roomUrl).searchParams.get('room');
    await keepCopiesForLatecomers(page1);
    await uploadFile(page1, TEST_IMAGE);
    expect(await waitForImage(page1, 30000)).toBeTruthy();

    await expect.poll(async () => (await roomPhoto(page1, roomId)).photo?.hasServerCopy, { timeout: 30000 }).toBe(true);

    // Sharer closes the tab: the only seeder is gone.
    await context1.close();

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    try {
      await page2.goto(roomUrl, { waitUntil: 'domcontentloaded' });
      // P2P can never succeed here; delivery must come from the server copy.
      expect(await waitForImage(page2, 90000)).toBeTruthy();
    } finally {
      await context2.close();
    }
  });
});
