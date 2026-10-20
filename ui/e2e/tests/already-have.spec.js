const { test, expect } = require('@playwright/test');
const path = require('path');
const { createRoom } = require('../helpers/test-helpers');

/**
 * Download room only offers what each person doesn't already have: the
 * photos they shared, or saved before, are left out. Fingerprints travel
 * with each photo through the room, so the receiver can tell too.
 */

const FIXTURES = path.join(__dirname, '../../src/share/gallery/metadata/embed/__fixtures__');
const PHOTOS = [path.join(__dirname, '../fixtures/test-image.jpg'), path.join(FIXTURES, 'photo.jpg')];

const card = (page, name) => page.locator('.media-card').filter({ has: page.getByRole('button', { name: `View ${name}` }) });
const downloadButton = page => page.getByRole('button', { name: /^(Download|You have)/ }).first();

test('Download room leaves out photos you shared or already saved', async ({ browser }) => {
  const sender = await browser.newContext();
  const receiver = await browser.newContext();
  const page1 = await sender.newPage();
  const page2 = await receiver.newPage();

  try {
    const roomUrl = await createRoom(page1);
    await page2.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(2000);

    await page1.locator('input#contained-button-file').setInputFiles(PHOTOS);

    // The sender has both originals.
    for (const name of ['test-image.jpg', 'photo.jpg']) {
      await expect(card(page1, name).getByTestId('already-have')).toHaveText('You shared this', { timeout: 30000 });
    }
    await expect(downloadButton(page1)).toHaveText('You have them all');
    await expect(downloadButton(page1)).toBeDisabled();

    // The receiver has neither, until it saves one.
    const first = card(page2, 'test-image.jpg');
    const firstSave = first.getByRole('button', { name: /^Save/ });
    await expect(firstSave).toBeEnabled({ timeout: 60000 });
    await expect(card(page2, 'photo.jpg').getByRole('button', { name: /^Save/ })).toBeEnabled({ timeout: 60000 });
    await expect(downloadButton(page2)).toHaveText('Download room');
    await expect(page2.getByTestId('already-have')).toHaveCount(0);

    const saved = page2.waitForEvent('download');
    await firstSave.click();
    expect((await saved).suggestedFilename()).toBe('test-image.jpg');
    await expect(first.getByTestId('already-have')).toHaveText('You saved this');
    await expect(downloadButton(page2)).toHaveText('Download 1 new');

    const zipped = page2.waitForEvent('download');
    await downloadButton(page2).click();
    expect((await zipped).suggestedFilename()).toMatch(/^photogroup-.+\.zip$/);
    await expect(page2.getByRole('status').filter({ hasText: 'Saved 1 photo' })).toHaveText('Saved 1 photo · 1 you have, left out');
    await expect(downloadButton(page2)).toHaveText('You have them all');
  } finally {
    await sender.close();
    await receiver.close();
  }
});
