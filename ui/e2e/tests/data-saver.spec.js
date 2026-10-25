const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { createRoom, dismissDialogs } = require('../helpers/test-helpers');

// A photo big enough to span many pieces: the test image with 2 MB after
// its end marker, which image readers ignore.
const bigPhoto = () => ({
  name: 'big-photo.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.concat([fs.readFileSync(path.join(__dirname, '../fixtures/test-image.jpg')), Buffer.alloc(2 * 1024 * 1024, 7)]),
});

const originalProgress = page => page.evaluate(() => window.client.torrents
  .flatMap(torrent => torrent.files)
  .filter(file => !file.name.startsWith('Thumbnail '))
  .map(file => file.progress));

// "Data saver": a receiver gets the preview first, and the photo only when
// it asks. Until then it is not an owner, so nobody counts it as waiting.
test('with Data saver on, a photo comes only after a tap', async ({ browser }) => {
  test.setTimeout(120000);
  const sharerContext = await browser.newContext();
  const receiverContext = await browser.newContext();
  await receiverContext.addInitScript(() => localStorage.setItem('photogroup.dataSaver', 'true'));
  const sharer = await sharerContext.newPage();
  const receiver = await receiverContext.newPage();
  try {
    const roomUrl = await createRoom(sharer);
    const roomId = new URL(roomUrl).searchParams.get('room');
    await receiver.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await receiver.waitForTimeout(2000);
    await sharer.locator('input#contained-button-file').first().setInputFiles(bigPhoto());

    const getIt = receiver.getByRole('button', { name: /Get the full photo/ });
    await expect(getIt).toBeVisible({ timeout: 60000 });
    const receiverId = await receiver.evaluate(() => window.client.peerId);
    const owners = async () => {
      const room = await (await receiver.request.get(`/api/rooms/${roomId}`)).json();
      return (room.photos[0]?.owners || []).filter(owner => owner.peerId === receiverId);
    };
    const peers = async () => (await (await receiver.request.get(`/api/rooms/${roomId}`)).json()).peers;
    await receiver.waitForTimeout(3000);
    expect(await owners()).toEqual([]);
    const [before] = await originalProgress(receiver);
    expect(before).toBeLessThan(0.1);
    expect((await peers()).find(peer => peer.peerId === receiverId)?.dataSaver).toBe(true);

    await dismissDialogs(receiver);
    await getIt.click();
    await expect(getIt).toBeHidden({ timeout: 60000 });
    await expect.poll(async () => (await owners()).map(owner => owner.loading), { timeout: 60000 }).toEqual([false]);
    expect(await originalProgress(receiver)).toEqual([1]);
  } finally {
    await sharerContext.close();
    await receiverContext.close();
  }
});
