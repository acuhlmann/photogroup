const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { createRoom } = require('../helpers/test-helpers');

/**
 * On Android, Share must open the system Files picker (showOpenFilePicker)
 * rather than the file input, whose chooser offers gallery apps and the
 * photo picker that hand over copies with the location removed. Files that
 * still arrive without their location are held back.
 */

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const FIXTURES = path.join(__dirname, '../../src/share/gallery/metadata/embed/__fixtures__');
const fixture = name => Array.from(fs.readFileSync(path.join(FIXTURES, name)));

/** Stand in for the system Files picker; it returns whatever `queuePick` set. */
async function stubFilesPicker(context, android) {
  await context.addInitScript(isAndroid => {
    window.__pickerCalls = 0;
    window.__nextPick = [];
    window.showOpenFilePicker = async () => {
      window.__pickerCalls += 1;
      return window.__nextPick.map(({ name, bytes }) => ({
        getFile: async () => new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' }),
      }));
    };
    if (isAndroid) {
      Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'Android', mobile: true }) });
    }
  }, android);
}

const queuePick = (page, files) => page.evaluate(next => { window.__nextPick = next; }, files);
const pickerCalls = page => page.evaluate(() => window.__pickerCalls);

test('Android: Share opens the Files picker and holds back files without their location', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 412, height: 915 } });
  await stubFilesPicker(context, true);
  const page = await context.newPage();
  let nativeChooser = 0;
  page.on('filechooser', () => { nativeChooser += 1; });

  await createRoom(page);
  await queuePick(page, [{ name: 'PXL_stripped.jpg', bytes: fixture('blank-gps.jpg') }]);
  await page.getByRole('button', { name: 'Share photos', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Location removed' });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await expect(dialog).toContainText('PXL_stripped.jpg');
  await expect(dialog).toContainText('internal storage, then DCIM › Camera');
  expect(await pickerCalls(page)).toBe(1);

  await queuePick(page, [{ name: 'PXL_original.jpg', bytes: fixture('photo.jpg') }]);
  await dialog.getByRole('button', { name: 'Pick again' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'View PXL_original.jpg' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'View PXL_stripped.jpg' })).toHaveCount(0);
  expect(await pickerCalls(page)).toBe(2);
  expect(nativeChooser).toBe(0);

  await context.close();
});

test('desktop: Share keeps the regular file chooser', async ({ browser }) => {
  const context = await browser.newContext();
  await stubFilesPicker(context, false);
  const page = await context.newPage();

  await createRoom(page);
  const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
  await page.getByRole('button', { name: 'Share photos', exact: true }).click();
  await chooser;
  expect(await pickerCalls(page)).toBe(0);

  await context.close();
});
