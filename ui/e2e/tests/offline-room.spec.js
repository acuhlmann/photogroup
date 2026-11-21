const { test, expect } = require('@playwright/test');
const path = require('path');
const { uploadFile, waitForImage } = require('../helpers/test-helpers');
const { fakeCamera, serverAway, link, showCodes } = require('../helpers/nearby-helpers');

// The app with no server at all, as on an airplane: a room starts on one
// phone, another phone opens it, they link by two QR codes, and a photo
// goes across. When the server answers again, the room and its photo go to it.
// (The page itself comes from the development server here. In a build, the
// service worker keeps it: see src/share/shareTarget.test.js.)

const TEST_IMAGE = path.join(__dirname, '../fixtures/test-image.jpg');
const CLIP = path.join(__dirname, '../fixtures/clip.webm');

test.describe('with no server', () => {
  test('a room starts, a second phone opens it and gets a photo over a link; later the server gets the room', async ({ browser }) => {
    test.setTimeout(180000);
    const sharerContext = await browser.newContext();
    const receiverContext = await browser.newContext();
    for (const context of [sharerContext, receiverContext]) {
      await fakeCamera(context);
      await serverAway(context);
    }
    const sharer = await sharerContext.newPage();
    const receiver = await receiverContext.newPage();
    try {
      await sharer.goto('/', { waitUntil: 'domcontentloaded' });
      await sharer.getByRole('button', { name: /Start a room/i }).click();
      await expect(sharer).toHaveURL(/\?room=/, { timeout: 30000 });
      await expect(sharer.getByTestId('server-away')).toContainText('No connection to the server.', { timeout: 15000 });
      const roomUrl = sharer.url();
      const room = new URL(roomUrl).searchParams.get('room');

      await uploadFile(sharer, TEST_IMAGE);
      expect(await waitForImage(sharer, 30000)).toBe(true);

      // The second phone opens the room's address: an empty room, with no server.
      await receiver.goto(roomUrl, { waitUntil: 'domcontentloaded' });
      await expect(receiver.getByTestId('server-away')).toBeVisible({ timeout: 30000 });

      await link(sharer, receiver);
      await expect(receiver.getByTestId('direct-link-line')).toHaveText('0 photos sent · 1 photo received', { timeout: 30000 });
      await receiver.getByRole('button', { name: 'Close' }).click();
      await expect(receiver.getByText('test-image.jpg').first()).toBeVisible({ timeout: 20000 });
      expect(await waitForImage(receiver, 20000)).toBe(true);

      // After a refresh with no server, the room opens from the copy on the phone.
      await receiver.reload({ waitUntil: 'domcontentloaded' });
      await expect(receiver.getByTestId('server-away')).toBeVisible({ timeout: 30000 });
      expect(await waitForImage(receiver, 20000)).toBe(true);

      // The server answers the second phone again: it gets the room and the photo.
      await receiverContext.unroute('**/api/**');
      await receiver.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect.poll(async () => {
        const response = await receiver.request.get(`http://localhost:8081/api/rooms/${room}`);
        if (!response.ok()) return 0;
        return (await response.json()).photos?.length || 0;
      }, { timeout: 30000 }).toBe(1);
      await expect(receiver.getByTestId('server-away')).toBeHidden({ timeout: 15000 });
      expect(await waitForImage(receiver, 20000)).toBe(true);
    } finally {
      await sharerContext.close();
      await receiverContext.close();
    }
  });

  test('photos go from the front page by camera: previews first, then the photo that was picked', async ({ browser }) => {
    test.setTimeout(180000);
    const senderContext = await browser.newContext();
    const receiverContext = await browser.newContext({ acceptDownloads: true });
    for (const context of [senderContext, receiverContext]) {
      await fakeCamera(context);
      await serverAway(context);
    }
    const sender = await senderContext.newPage();
    const receiver = await receiverContext.newPage();
    try {
      await sender.goto('/', { waitUntil: 'domcontentloaded' });
      await receiver.goto('/', { waitUntil: 'domcontentloaded' });

      await sender.getByRole('button', { name: /Send or get photos by camera/i }).click();
      await expect(sender.getByRole('button', { name: 'Send photos by camera' })).toBeVisible({ timeout: 10000 });
      await sender.getByTestId('nearby-files').setInputFiles([TEST_IMAGE, CLIP]);
      await expect(sender.getByTestId('light-many-step')).toHaveAttribute('data-step', 'sheet', { timeout: 20000 });

      await receiver.getByRole('button', { name: /Send or get photos by camera/i }).click();
      await receiver.getByRole('button', { name: 'Get photos by camera' }).click();
      // The receiver's camera reads the previews off the sender's screen.
      const sheet = receiver.getByTestId('light-sheet');
      expect(await showCodes(sender, receiver, () => sheet.isVisible())).toBe(true);
      await expect(sheet.getByRole('button')).toHaveCount(2);
      // The clip has a preview too: one frame of it.
      await expect(sheet.locator('img')).toHaveCount(2);

      // The person picks the photo. The sender's camera reads the choice.
      await sheet.getByRole('button', { name: /test-image\.jpg/ }).click();
      await expect(receiver.getByTestId('light-chosen')).toContainText('1 photo');
      // A photo that is small already goes as it is, in either size.
      await expect(receiver.getByTestId('size-small')).toContainText('4.');
      await receiver.getByRole('button', { name: 'Get these photos' }).click();
      const step = sender.getByTestId('light-many-step');
      expect(await showCodes(receiver, sender, async () => (await step.getAttribute('data-step')) === 'photos',
        { selector: '[data-testid="pick-code"]' })).toBe(true);

      // The photo in full: with no room, it is saved on the phone.
      const download = receiver.waitForEvent('download', { timeout: 90000 });
      await receiver.getByRole('button', { name: 'The other phone has my choice' }).click();
      const progress = receiver.getByTestId('light-progress');
      expect(await showCodes(sender, receiver, async () => /saved/.test(await progress.textContent()), { timeout: 90000 })).toBe(true);
      await expect(progress).toHaveText('test-image.jpg is not in this room. It is saved on this phone.');
      expect((await download).suggestedFilename()).toBe('test-image.jpg');
    } finally {
      await senderContext.close();
      await receiverContext.close();
    }
  });

  test('a large photo goes by camera in small size first, and in full size when the person picks it', async ({ browser }) => {
    test.setTimeout(240000);
    const senderContext = await browser.newContext();
    const receiverContext = await browser.newContext({ acceptDownloads: true });
    for (const context of [senderContext, receiverContext]) {
      await fakeCamera(context);
      await serverAway(context);
    }
    const sender = await senderContext.newPage();
    const receiver = await receiverContext.newPage();
    try {
      await sender.goto('/', { waitUntil: 'domcontentloaded' });
      await receiver.goto('/', { waitUntil: 'domcontentloaded' });
      // A photo as large as a phone's: 2400 x 1800 with fine detail.
      const big = await sender.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 2400;
        canvas.height = 1800;
        const pen = canvas.getContext('2d');
        const image = pen.createImageData(2400, 1800);
        let seed = 7;
        for (let i = 0; i < image.data.length; i += 4) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          const x = (i / 4) % 2400;
          image.data[i] = (x / 10 + (seed & 63)) & 255;
          image.data[i + 1] = ((i / 9600) + (seed >> 8 & 63)) & 255;
          image.data[i + 2] = (seed >> 16) & 255;
          image.data[i + 3] = 255;
        }
        pen.putImageData(image, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        return [...new Uint8Array(await blob.arrayBuffer())];
      });
      expect(big.length).toBeGreaterThan(1024 * 1024);

      await sender.getByRole('button', { name: /Send or get photos by camera/i }).click();
      await sender.getByTestId('nearby-files').setInputFiles([
        { name: 'beach.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(big) },
        { name: 'test-image.jpg', mimeType: 'image/jpeg', buffer: require('fs').readFileSync(TEST_IMAGE) },
      ]);
      await expect(sender.getByTestId('light-many-step')).toHaveAttribute('data-step', 'sheet', { timeout: 20000 });

      await receiver.getByRole('button', { name: /Send or get photos by camera/i }).click();
      await receiver.getByRole('button', { name: 'Get photos by camera' }).click();
      const sheet = receiver.getByTestId('light-sheet');
      expect(await showCodes(sender, receiver, () => sheet.isVisible())).toBe(true);
      await sheet.getByRole('button', { name: /beach\.jpg/ }).click();

      // Small size is the default: about 100 kB in well under a minute, not minutes.
      const small = receiver.getByTestId('size-small');
      const full = receiver.getByTestId('size-full');
      await expect(small).toHaveAttribute('aria-pressed', 'true');
      await expect(small).toContainText(/up to 100 kB · about \d+ seconds/);
      await expect(full).toContainText(/MB · about \d+ minutes/);
      await receiver.getByRole('button', { name: 'Get these photos' }).click();
      const step = sender.getByTestId('light-many-step');
      expect(await showCodes(receiver, sender, async () => (await step.getAttribute('data-step')) === 'photos',
        { selector: '[data-testid="pick-code"]' })).toBe(true);
      await expect(sender.getByText('1 photo in small size', { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(sender.getByTestId('size-small')).toHaveAttribute('aria-pressed', 'true');
      // Now that it is made, the sender knows its exact size.
      await expect(sender.getByTestId('size-small')).toContainText(/^Small size[\d.]+ kB · about \d+ seconds$/);

      const download = receiver.waitForEvent('download', { timeout: 120000 });
      await receiver.getByRole('button', { name: 'The other phone has my choice' }).click();
      const progress = receiver.getByTestId('light-progress');
      expect(await showCodes(sender, receiver, async () => /saved/.test(await progress.textContent()), { timeout: 150000 })).toBe(true);
      await expect(progress).toHaveText('beach.jpg is not in this room. It is saved on this phone in small size.');
      const saved = await download;
      expect(saved.suggestedFilename()).toBe('beach (small).jpg');
      const bytes = require('fs').readFileSync(await saved.path());
      expect(bytes.length).toBeLessThanOrEqual(100 * 1024);
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]).toBe(0xd8);

      // The sender can change to full size: the codes start again with the whole file.
      await sender.getByTestId('size-full').click();
      await expect(sender.getByText('1 photo in full size', { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(sender.getByTestId('size-full')).toContainText(/MB · about \d+ minutes$/);
    } finally {
      await senderContext.close();
      await receiverContext.close();
    }
  });
});
