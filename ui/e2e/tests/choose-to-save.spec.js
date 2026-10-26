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

// A receiver goes through the photos someone else shared, full screen, keeps
// two of three, and saves only those.
test('choose what to save: keep or skip each photo, then save the kept ones', async ({ browser }) => {
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

    // The sharer has nothing to choose: they shared them all.
    const choose = receiver.getByRole('button', { name: 'Choose what to save (3)' });
    await expect(choose).toBeVisible({ timeout: 60000 });
    await expect(sharer.getByRole('button', { name: /Choose what to save/ })).toHaveCount(0);

    // Wait until all three are here in full.
    await expect(receiver.locator('img[src^="blob:"]')).toHaveCount(3, { timeout: 60000 });
    await dismissDialogs(receiver);
    await choose.click();
    const dialog = receiver.getByRole('dialog', { name: 'Choose what to save' });
    await expect(dialog.getByTestId('choose-position')).toHaveText('1 of 3');
    await expect(dialog.getByTestId('media-stage').locator('img')).toBeVisible();

    await dialog.getByRole('button', { name: 'Keep', exact: true }).click();
    await expect(dialog.getByTestId('choose-position')).toContainText('2 of 3');
    await dialog.getByRole('button', { name: 'Skip' }).click();
    await dialog.getByRole('button', { name: 'Keep', exact: true }).click();

    await expect(dialog).toContainText('You kept 2 of 3');
    await expect(dialog.getByTestId('saved-where')).toHaveText('One zip file goes to the Downloads folder of this computer.');
    const saved = receiver.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Save 2 photos to this device' }).click();
    expect((await saved).suggestedFilename()).toMatch(/^photogroup-.*\.zip$/);
    await expect(dialog).toContainText('Saved 2 photos');
    await dialog.getByRole('button', { name: 'Close' }).last().click();

    // The skipped one is still there to choose.
    await expect(receiver.getByRole('button', { name: 'Choose what to save (1)' })).toBeVisible();
  } finally {
    await sharerContext.close();
    await receiverContext.close();
  }
});
