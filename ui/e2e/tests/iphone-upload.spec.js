const { test, expect } = require('@playwright/test');
const path = require('path');
const { createRoom } = require('../helpers/test-helpers');

/**
 * Safari on an iPhone removes the location from picked photos unless the
 * person turns it on, and makes clips smaller. The app keeps image/* in
 * the file input so HEIC stays HEIC, says how to keep the rest, and holds
 * back iPhone photos that arrive without a location.
 */

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const FIXTURES = path.join(__dirname, '../../src/share/gallery/metadata/embed/__fixtures__');

test('iPhone: explains how to keep originals and holds back photos without a location', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await createRoom(page);
  await expect(page.getByTestId('iphone-originals-note')).toContainText('tap Options and turn on Location');
  await expect(page.getByTestId('iphone-originals-note')).toContainText('Save to Files');
  await expect(page.locator('input#contained-button-file')).toHaveAttribute('accept', 'image/*,video/*,audio/*');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photos and clips', exact: true }).click();
  await (await chooser).setFiles([path.join(FIXTURES, 'gps.heic'), path.join(FIXTURES, 'iphone-no-gps.jpg')]);

  const held = page.getByRole('dialog', { name: 'No location' });
  await expect(held).toContainText('iphone-no-gps.jpg', { timeout: 30000 });
  await expect(held).toContainText('tap Options and turn on Location');
  await held.getByRole('button', { name: 'Share without location' }).click();
  await expect(held).toBeHidden();

  for (const name of ['gps.heic', 'iphone-no-gps.jpg']) {
    await expect(page.getByRole('button', { name: `View ${name}` })).toBeVisible({ timeout: 30000 });
  }

  await context.close();
});
