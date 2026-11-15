const { test, expect } = require('@playwright/test');
const path = require('path');
const { createRoom, uploadFile, waitForImage, dismissDialogs } = require('../helpers/test-helpers');

// Two phones link with two QR codes and no server: each shows a code and the
// other's camera reads it. Then the photos go over that link. The camera
// here is a canvas that the test draws the other page's code on, so the
// app's own code writer, code reader and WebRTC connection do the work.

const TEST_IMAGE = path.join(__dirname, '../fixtures/test-image.jpg');
const MENU = 'Connect to a phone near you';

// A camera whose picture the test controls: window.__showToCamera(dataUrl).
async function fakeCamera(context) {
  await context.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    const pen = canvas.getContext('2d');
    pen.imageSmoothingEnabled = false;
    let picture = null;
    const draw = () => {
      pen.fillStyle = '#fff';
      pen.fillRect(0, 0, 640, 640);
      if (picture) pen.drawImage(picture, 60, 60, 520, 520);
      // A changing corner, so the stream gives a new frame each time.
      pen.fillStyle = Date.now() % 2 ? '#fefefe' : '#fdfdfd';
      pen.fillRect(0, 0, 2, 2);
    };
    draw();
    setInterval(draw, 100);
    window.__showToCamera = dataUrl => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => { picture = image; draw(); resolve(); };
      image.onerror = reject;
      image.src = dataUrl;
    });
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);
  });
}

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

async function openLinkDialog(page) {
  await dismissDialogs(page);
  await page.getByRole('button', { name: /Room menu/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(MENU) }).click();
  await expect(page.getByTestId('link-step')).toHaveAttribute('data-step', 'offer', { timeout: 20000 });
}

/** The code on a page's screen, as a picture. */
async function codeOn(page, kind) {
  const code = page.locator(`[data-testid="link-code"][data-kind="${kind}"]`);
  await expect(code).toBeVisible({ timeout: 20000 });
  // The canvas is drawn a moment after the step changes.
  await page.waitForTimeout(500);
  return code.evaluate(canvas => canvas.toDataURL());
}

async function link(first, second) {
  await openLinkDialog(first);
  await openLinkDialog(second);
  // The second phone reads the first phone's code and shows its answer.
  await second.evaluate(url => window.__showToCamera(url), await codeOn(first, 'offer'));
  await expect(second.getByTestId('link-step')).toHaveAttribute('data-step', 'answer', { timeout: 20000 });
  // The first phone reads the answer.
  await first.evaluate(url => window.__showToCamera(url), await codeOn(second, 'answer'));
  await expect(first.getByTestId('direct-link')).toContainText('Connected to', { timeout: 30000 });
  await expect(second.getByTestId('direct-link')).toContainText('Connected to', { timeout: 30000 });
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
      for (const context of [sharerContext, receiverContext]) await context.route('**/api/**', route => route.abort());

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
