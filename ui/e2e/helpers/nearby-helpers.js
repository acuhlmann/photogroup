const { expect } = require('@playwright/test');
const { dismissDialogs } = require('./test-helpers');

// For tests of the nearby channels: a camera whose picture the test
// controls, and the exchange of the two codes that links two phones.

const LINK_BUTTON = 'Connect to a phone near you';

/** A camera whose picture the test controls: window.__showToCamera(dataUrl). */
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

/** The server does not answer: every request to it fails. */
async function serverAway(context) {
  await context.route('**/api/**', route => route.abort());
}

/** The code on a page's screen, as a picture. */
async function codeOn(page, kind) {
  const code = page.locator(`[data-testid="link-code"][data-kind="${kind}"]`);
  await expect(code).toBeVisible({ timeout: 20000 });
  // The canvas is drawn a moment after the step changes.
  await page.waitForTimeout(500);
  return code.evaluate(canvas => canvas.toDataURL());
}

/** Open the dialog that links two phones: from the bar that shows with no server, or from the room menu (geek mode). */
async function openLinkDialog(page) {
  await dismissDialogs(page);
  const bar = page.getByTestId('server-away').getByRole('button', { name: LINK_BUTTON });
  if (await bar.isVisible().catch(() => false)) {
    await bar.click();
  } else {
    await page.getByRole('button', { name: /Room menu/ }).click();
    await page.getByRole('menuitem', { name: new RegExp(LINK_BUTTON) }).click();
  }
  await expect(page.getByTestId('link-step')).toHaveAttribute('data-step', 'offer', { timeout: 20000 });
}

/** Link two pages: each shows a code and the other's camera reads it. */
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

/**
 * Show the codes on one page's screen to the other page's camera, until
 * `done` says that it is enough.
 */
async function showCodes(from, to, done, { timeout = 60000, selector = '[data-testid="light-code"]' } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await done()) return true;
    const url = await from.locator(selector).evaluate(canvas => canvas.toDataURL()).catch(() => null);
    if (url && url.length > 200) await to.evaluate(dataUrl => window.__showToCamera(dataUrl), url);
    await to.waitForTimeout(120);
  }
  return done();
}

module.exports = { fakeCamera, serverAway, codeOn, openLinkDialog, link, showCodes, LINK_BUTTON };
