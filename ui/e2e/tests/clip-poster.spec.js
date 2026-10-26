const { test, expect } = require('@playwright/test');
const path = require('path');
const { createRoom, dismissDialogs } = require('../helpers/test-helpers');

// A browser that can't decode any video: like a Linux laptop with an iPhone's HEVC clip.
const noVideoDecoder = () => {
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    configurable: true,
    get() { return this.getAttribute('src') || ''; },
    set(value) {
      this.setAttribute('src', value);
      setTimeout(() => this.dispatchEvent(new Event('error')), 0);
    },
  });
};

// The sharer can't make a poster frame, so the clip arrives without one. The
// receiver can decode it, grabs a frame and gives it to the room, and the
// sharer then shows it, with a note that this browser can't play the clip.
test('a clip the sharer cannot decode gets its poster from a device that can', async ({ browser }) => {
  test.setTimeout(120000);
  const sharerContext = await browser.newContext();
  await sharerContext.addInitScript(noVideoDecoder);
  const receiverContext = await browser.newContext();
  const sharer = await sharerContext.newPage();
  const receiver = await receiverContext.newPage();
  try {
    const roomUrl = await createRoom(sharer);
    const roomId = new URL(roomUrl).searchParams.get('room');
    await receiver.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await receiver.waitForTimeout(2000);
    await sharer.locator('input#contained-button-file').first().setInputFiles(path.join(__dirname, '../fixtures/clip.webm'));

    await expect(sharer.getByText('This browser cannot play this clip.', { exact: false })).toBeVisible({ timeout: 60000 });
    const poster = async () => ((await (await sharer.request.get(`/api/rooms/${roomId}`)).json()).photos[0] || {}).poster;
    await expect.poll(poster, { timeout: 60000 }).toMatch(/^data:image\/jpeg;base64,/);
    await dismissDialogs(sharer);
    await expect.poll(() => sharer.evaluate(() => document.querySelector('video')?.poster || ''), { timeout: 30000 })
      .toMatch(/^data:image\/jpeg;base64,/);
  } finally {
    await sharerContext.close();
    await receiverContext.close();
  }
});
