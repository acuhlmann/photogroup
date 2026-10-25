const { test, expect } = require('@playwright/test');
const path = require('path');
const { createRoom, uploadFile } = require('../helpers/test-helpers');

/**
 * Short clips are shared like photos: the sender's browser grabs a frame of
 * the clip and sends it ahead as its poster, so the people waiting see what
 * is coming, and simple mode can play the clip once it is here.
 */

const CLIP = path.join(__dirname, '../fixtures/clip.webm');

test('a shared clip arrives with its poster frame and plays in simple mode', async ({ browser }) => {
  const senderContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const roomUrl = await createRoom(sender);
  await expect(sender.getByRole('button', { name: 'Add photos and clips', exact: true })).toBeEnabled({ timeout: 30000 });

  const receiverContext = await browser.newContext();
  await receiverContext.addInitScript(() => localStorage.setItem('photogroup.uiMode', 'simple'));
  const receiver = await receiverContext.newPage();
  await receiver.goto(roomUrl);
  await expect(receiver.getByText(/people here|Just you so far/)).toBeVisible({ timeout: 30000 });

  await uploadFile(sender, CLIP);

  // The sender's own player shows the frame it grabbed.
  await expect(sender.locator('video[poster^="blob:"]').first()).toBeAttached({ timeout: 30000 });

  // The receiver sees the clip by its poster, counted as a clip, and can play it.
  await expect(receiver.getByText('1 clip')).toBeVisible({ timeout: 60000 });
  const play = receiver.getByRole('button', { name: 'Play this clip' });
  await expect(play).toBeVisible({ timeout: 60000 });
  const poster = play.locator('img');
  await expect(poster).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => poster.evaluate(img => img.naturalWidth), { timeout: 15000 }).toBeGreaterThan(0);

  await play.click();
  const video = receiver.getByRole('dialog').locator('video');
  await expect(video).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => video.evaluate(el => el.videoWidth), { timeout: 15000 }).toBe(320);

  await senderContext.close();
  await receiverContext.close();
});
