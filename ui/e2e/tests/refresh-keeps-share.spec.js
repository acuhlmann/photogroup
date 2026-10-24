const { test, expect } = require('@playwright/test');
const path = require('path');
const { createRoom, uploadFile, dismissDialogs } = require('../helpers/test-helpers');

const CLIP = path.join(__dirname, '../fixtures/clip.webm');

/**
 * Refreshing the page must not cost the sharer their clip or the Share button.
 * Clips aren't in the image cache, so they come back from the torrent kept in
 * this browser, or from the room's server copy when that is gone too.
 */

function shareInput(page) {
  return page.locator('input#contained-button-file');
}

async function shareClip(page) {
  const roomUrl = await createRoom(page);
  await expect(shareInput(page)).toBeEnabled({ timeout: 30000 });
  await uploadFile(page, CLIP);
  await expect(page.locator('video[poster^="blob:"]').first()).toBeAttached({ timeout: 30000 });
  return new URL(roomUrl).searchParams.get('room');
}

async function videoWidth(page) {
  return page.locator('video').first().evaluate(el => el.videoWidth).catch(() => 0);
}

test('after a refresh the sharer can still share and still has their clip', async ({ page }) => {
  await shareClip(page);
  // The torrent is saved for the next visit once the room has the clip.
  await page.waitForTimeout(2000);

  await page.reload();
  await expect(shareInput(page)).toBeEnabled({ timeout: 30000 });
  await expect.poll(() => videoWidth(page), { timeout: 30000 }).toBe(320);
});

test('a clip this browser lost comes back from the server copy after a refresh', async ({ page }) => {
  test.setTimeout(120000);
  const roomId = await shareClip(page);

  await dismissDialogs(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const toggle = page.getByLabel(/Keep Copies for Latecomers/);
  await toggle.check();
  await expect(toggle).toBeChecked();
  await page.keyboard.press('Escape');

  await expect.poll(async () => {
    const room = await (await page.request.get(`/api/rooms/${roomId}`)).json();
    return !!room.photos[0]?.hasServerCopy;
  }, { timeout: 30000 }).toBe(true);

  // The browser drops everything it kept of the clip, as when storage is short.
  await page.evaluate(async () => {
    await Promise.all(window.client.torrents.map(torrent => new Promise(resolve => torrent.destroy({ destroyStore: true }, resolve))));
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('torrents');
      open.onerror = reject;
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction([...db.objectStoreNames], 'readwrite');
        [...db.objectStoreNames].forEach(name => tx.objectStore(name).clear());
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = reject;
      };
    });
  });

  await page.reload();
  await expect(shareInput(page)).toBeEnabled({ timeout: 30000 });
  await expect.poll(() => videoWidth(page), { timeout: 60000 }).toBe(320);
});
