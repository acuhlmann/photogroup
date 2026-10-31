const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createRoom, dismissDialogs } = require('../helpers/test-helpers');

// The test image with 2 MB after its end marker, so it spans many pieces.
const buffer = Buffer.concat([fs.readFileSync(path.join(__dirname, '../fixtures/test-image.jpg')), Buffer.alloc(2 * 1024 * 1024, 7)]);
const bigPhoto = { name: 'big-photo.jpg', mimeType: 'image/jpeg', buffer };

/** The app's fingerprint (gallery/fingerprint.js): size, plus a SHA-256 of the start, middle and end. */
function fingerprint(bytes) {
  const SAMPLE = 256 * 1024;
  const size = bytes.length;
  const middle = Math.floor(size / 2 - SAMPLE / 2);
  const sample = Buffer.concat([bytes.subarray(0, SAMPLE), bytes.subarray(middle, middle + SAMPLE), bytes.subarray(size - SAMPLE)]);
  return `${size}:${crypto.createHash('sha256').update(sample).digest('hex')}`;
}

const originalProgress = page => page.evaluate(() => window.client.torrents
  .flatMap(torrent => torrent.files)
  .filter(file => !file.name.startsWith('Thumbnail '))
  .map(file => file.progress));

// A photo this browser already has comes as a preview only, and the
// original transfers only when the person asks for it.
test('a photo you already have transfers only its preview', async ({ browser }) => {
  test.setTimeout(120000);
  const sharerContext = await browser.newContext();
  const receiverContext = await browser.newContext();
  await receiverContext.addInitScript(have => {
    localStorage.setItem('photogroup.alreadyHave', JSON.stringify([[have, 'saved']]));
  }, fingerprint(buffer));
  const sharer = await sharerContext.newPage();
  const receiver = await receiverContext.newPage();
  try {
    const roomUrl = await createRoom(sharer);
    const roomId = new URL(roomUrl).searchParams.get('room');
    await receiver.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await receiver.waitForTimeout(2000);
    await sharer.locator('input#contained-button-file').first().setInputFiles(bigPhoto);

    const anyway = receiver.getByRole('button', { name: /Download anyway/ });
    await expect(anyway).toBeVisible({ timeout: 60000 });
    await expect(receiver.getByText('You saved this · preview only')).toBeVisible();

    const receiverId = await receiver.evaluate(() => window.client.peerId);
    const owners = async () => {
      const room = await (await receiver.request.get(`/api/rooms/${roomId}`)).json();
      return (room.photos[0]?.owners || []).filter(owner => owner.peerId === receiverId);
    };
    await receiver.waitForTimeout(3000);
    expect(await owners()).toEqual([]);
    const [before] = await originalProgress(receiver);
    expect(before).toBeLessThan(0.1);

    await dismissDialogs(receiver);
    await anyway.click();
    await expect(anyway).toBeHidden({ timeout: 60000 });
    await expect.poll(async () => (await owners()).map(owner => owner.loading), { timeout: 60000 }).toEqual([false]);
    expect(await originalProgress(receiver)).toEqual([1]);
  } finally {
    await sharerContext.close();
    await receiverContext.close();
  }
});
