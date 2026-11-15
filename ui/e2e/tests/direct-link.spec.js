const { test, expect } = require('@playwright/test');
const path = require('path');
const { createRoom, uploadFile, waitForImage } = require('../helpers/test-helpers');
const { fakeCamera, serverAway, link } = require('../helpers/nearby-helpers');

// Two phones link with two QR codes and no server: each shows a code and the
// other's camera reads it. Then the photos go over that link. The camera
// here is a canvas that the test draws the other page's code on, so the
// app's own code writer, code reader and WebRTC connection do the work.

const TEST_IMAGE = path.join(__dirname, '../fixtures/test-image.jpg');

// No WebRTC through the app's usual way: relay only, and the relay is not there.
async function blockP2P(context) {
  await context.route('**/api/__rtcConfig__', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      iceTransportPolicy: 'relay',
      iceServers: [{ urls: 'turn:127.0.0.1:9', username: 'none', credential: 'none' }],
    }),
  }));
}

// The code reader and writer load a few seconds after a room opens, so that
// they are there when the server is not.
async function nearbyCodeLoaded(page) {
  await expect(page.locator('html')).toHaveAttribute('data-nearby-code', 'ready', { timeout: 30000 });
}

test.describe('direct link', () => {
  test('two phones link by QR codes; a photo and a star rating go over the link with no server', async ({ browser }) => {
    test.setTimeout(180000);
    const sharerContext = await browser.newContext();
    const receiverContext = await browser.newContext();
    for (const context of [sharerContext, receiverContext]) await fakeCamera(context);
    await blockP2P(receiverContext);
    const sharer = await sharerContext.newPage();
    const receiver = await receiverContext.newPage();
    try {
      const roomUrl = await createRoom(sharer);
      await uploadFile(sharer, TEST_IMAGE);
      expect(await waitForImage(sharer, 30000)).toBeTruthy();

      await receiver.goto(roomUrl, { waitUntil: 'domcontentloaded' });
      await expect(receiver.getByText('test-image.jpg').first()).toBeVisible({ timeout: 20000 });

      await nearbyCodeLoaded(sharer);
      await nearbyCodeLoaded(receiver);
      // The server goes away for both phones, before it can help with a copy.
      // (The browser's own "offline" switch also stops WebRTC, which a
      // server that is down does not.)
      for (const context of [sharerContext, receiverContext]) await serverAway(context);
      // Each phone asks the server when its connection changes, and sees that it is away.
      for (const page of [sharer, receiver]) {
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));
        await expect(page.getByTestId('server-away')).toBeVisible({ timeout: 15000 });
      }

      await link(sharer, receiver);

      await expect(sharer.getByTestId('direct-link-line')).toHaveText('1 photo sent · 0 photos received', { timeout: 30000 });
      await expect(receiver.getByTestId('direct-link-line')).toHaveText('0 photos sent · 1 photo received', { timeout: 30000 });
      await receiver.getByRole('button', { name: 'Close' }).click();
      expect(await waitForImage(receiver, 20000)).toBe(true);

      // A star rating with no server: it is kept, and the link carries it to the other phone.
      await receiver.getByRole('button', { name: '4 stars' }).first().click();
      await expect(receiver.getByText(/No connection to the server\. Your change is kept\./)).toBeVisible({ timeout: 10000 });
      await sharer.getByRole('button', { name: 'Close' }).click();
      await expect(sharer.getByRole('button', { name: '4 stars' }).first()).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });

      // The server is back: the kept rating goes to the room.
      const room = new URL(roomUrl).searchParams.get('room');
      await receiverContext.unroute('**/api/**');
      await receiver.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect.poll(async () => {
        const { photos } = await (await receiver.request.get(`http://localhost:8081/api/rooms/${room}`)).json();
        return photos[0]?.details?.rating;
      }, { timeout: 15000 }).toBe(4);
    } finally {
      await sharerContext.close();
      await receiverContext.close();
    }
  });
});
