const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { createRoom, dismissDialogs } = require('../helpers/test-helpers');

// Three different photos: the test image with different bytes after its end
// marker, which image readers ignore.
const photo = index => ({
  name: `photo-${index}.jpg`,
  mimeType: 'image/jpeg',
  buffer: Buffer.concat([fs.readFileSync(path.join(__dirname, '../fixtures/test-image.jpg')), Buffer.alloc(1024, index)]),
});

// In Photographer mode, a receiver selects two of three photos with the
// row boxes and saves both with one Save.
test('select several photos in the list and save them at once', async ({ browser }) => {
  test.setTimeout(120000);
  const sharerContext = await browser.newContext();
  const receiverContext = await browser.newContext({ acceptDownloads: true });
  const sharer = await sharerContext.newPage();
  const receiver = await receiverContext.newPage();
  try {
    const roomUrl = await createRoom(sharer);
    await receiver.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await receiver.waitForTimeout(2000);
    await sharer.locator('input#contained-button-file').first().setInputFiles([photo(1), photo(2), photo(3)]);

    // All three here in full: a row's thumbnail opens the photo only then.
    await expect(receiver.locator('[data-testid="photo-row"] button[aria-label^="View "]')).toHaveCount(3, { timeout: 60000 });
    await dismissDialogs(receiver);

    await receiver.getByRole('checkbox', { name: 'Select photo-1.jpg' }).check();
    await receiver.getByRole('checkbox', { name: 'Select photo-3.jpg' }).check();
    const bar = receiver.getByTestId('selection-bar');
    await expect(bar).toContainText('2 selected');
    await expect(bar).toContainText('One zip file goes to the Downloads folder of this computer.');

    const saved = receiver.waitForEvent('download');
    await bar.getByRole('button', { name: 'Save 2' }).click();
    expect((await saved).suggestedFilename()).toMatch(/^photogroup-.*\.zip$/);
    await expect(bar.getByRole('button', { name: 'Saved' })).toBeVisible();

    await bar.getByRole('button', { name: 'Clear the selection' }).click();
    await expect(bar).toHaveCount(0);

    // "Select all 3" selects every photo shown.
    await receiver.getByLabel('Select all 3').check();
    await expect(receiver.getByTestId('selection-bar')).toContainText('3 selected');
  } finally {
    await sharerContext.close();
    await receiverContext.close();
  }
});
