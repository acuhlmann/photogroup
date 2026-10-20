const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { createRoom } = require('../helpers/test-helpers');

/**
 * Photos shared into PhotoGroup from another app (the manifest's
 * share_target) are caught by the service worker, land in the room used
 * last, and go through the same steps as a pick from Share. So do files
 * dropped on the gallery. On Android that means zips are unpacked and
 * blanked locations held back.
 */

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const PHOTOS_ZIP = path.join(__dirname, '../../src/share/header/__fixtures__/photos.zip');
const PHOTO = path.join(__dirname, '../../src/share/gallery/metadata/embed/__fixtures__/photo.jpg');

async function androidContext(browser) {
  const context = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 412, height: 915 } });
  // Playwright's user agent override leaves client hints saying Linux.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'Android', mobile: true }) });
  });
  return context;
}

/** Open a room and wait until it is ready and the share worker controls the page. */
async function readyRoom(page) {
  const roomUrl = await createRoom(page);
  await expect(page.getByRole('button', { name: 'Share photos', exact: true })).toBeEnabled({ timeout: 30000 });
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 });
  return new URL(roomUrl).searchParams.get('room');
}

/** What Android does when someone shares files to PhotoGroup: a form POST to the share target. */
async function shareIntoApp(page, files) {
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/share-target';
    form.enctype = 'multipart/form-data';
    form.innerHTML = '<input type="file" name="media" multiple id="shared-media">';
    document.body.appendChild(form);
  });
  await page.setInputFiles('#shared-media', files);
  await page.evaluate(() => document.querySelector('form[action="/share-target"]').submit());
}

test('Android: photos shared from another app land in the last room, zips unpacked', async ({ browser }) => {
  const context = await androidContext(browser);
  const page = await context.newPage();
  const room = await readyRoom(page);

  await shareIntoApp(page, PHOTOS_ZIP);

  await page.waitForURL(url => url.searchParams.get('room') === room && !url.searchParams.has('shared'), { timeout: 30000 });
  const held = page.getByRole('dialog', { name: 'Location removed' });
  await expect(held).toContainText('Strand ü.jpg', { timeout: 30000 });
  await page.keyboard.press('Escape');
  for (const name of ['PXL_photo.jpg', 'PXL_gps.heic', 'PXL_clip.mp4']) {
    await expect(page.getByRole('button', { name: `View ${name}` })).toBeVisible({ timeout: 30000 });
  }

  await context.close();
});

test('Android: a zip dropped on the gallery is unpacked too', async ({ browser }) => {
  const context = await androidContext(browser);
  const page = await context.newPage();
  await readyRoom(page);

  const bytes = Array.from(fs.readFileSync(PHOTOS_ZIP));
  const dataTransfer = await page.evaluateHandle(data => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], 'photos.zip', { type: 'application/zip' }));
    return transfer;
  }, bytes);
  await page.dispatchEvent('.drop-target', 'drop', { dataTransfer });

  const held = page.getByRole('dialog', { name: 'Location removed' });
  await expect(held).toContainText('Strand ü.jpg', { timeout: 30000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'View PXL_photo.jpg' })).toBeVisible({ timeout: 30000 });

  await context.close();
});

test('desktop: a shared photo lands in the last room as it is', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const room = await readyRoom(page);

  await shareIntoApp(page, PHOTO);

  await page.waitForURL(url => url.searchParams.get('room') === room && !url.searchParams.has('shared'), { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'View photo.jpg' })).toBeVisible({ timeout: 30000 });

  await context.close();
});
