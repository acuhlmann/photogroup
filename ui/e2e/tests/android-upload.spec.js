const { test, expect } = require('@playwright/test');
const path = require('path');
const { createRoom } = require('../helpers/test-helpers');

/**
 * Android blanks locations in photos a browser picks, so there the app
 * explains how to keep them (Material Files, or a zip), unpacks zips into
 * the originals inside, and holds back photos that arrive blanked.
 * Other platforms are left as they were.
 */

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const PHOTOS_ZIP = path.join(__dirname, '../../src/share/header/__fixtures__/photos.zip');

test('Android: shares the photos in a zip and explains how to keep locations', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 412, height: 915 } });
  // Playwright's user agent override leaves client hints saying Linux.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'Android', mobile: true }) });
  });
  const page = await context.newPage();

  await createRoom(page);
  await expect(page.getByTestId('android-location-note')).toContainText('choose Material Files');
  await expect(page.locator('input#contained-button-file')).toHaveAttribute('accept', /\.zip/);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Share photos', exact: true }).click();
  await (await chooser).setFiles(PHOTOS_ZIP);

  // The one photo that was blanked before it was zipped is held back.
  const held = page.getByRole('dialog', { name: 'Location removed' });
  await expect(held).toContainText('Strand ü.jpg', { timeout: 30000 });
  await expect(held).toContainText('share the zip');
  await page.keyboard.press('Escape');
  await expect(held).toBeHidden();

  for (const name of ['PXL_photo.jpg', 'PXL_gps.heic', 'PXL_clip.mp4']) {
    await expect(page.getByRole('button', { name: `View ${name}` })).toBeVisible({ timeout: 30000 });
  }
  await expect(page.getByRole('button', { name: 'View Strand ü.jpg' })).toHaveCount(0);

  await context.close();
});

test('desktop: no note, no zips', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await createRoom(page);
  await expect(page.locator('input#contained-button-file')).toHaveAttribute('accept', 'image/*,video/*,audio/*');
  await expect(page.getByTestId('android-location-note')).toHaveCount(0);

  await context.close();
});
