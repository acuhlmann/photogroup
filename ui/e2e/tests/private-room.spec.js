const { test, expect } = require('@playwright/test');
const path = require('path');
const { waitForImage } = require('../helpers/test-helpers');

// With "Private rooms" on, a new room gets a key in its link. Photos are
// encrypted on the phone, so the server only knows sealed names, and someone
// with the full link still sees the photo under its real name.
test('a private room shares a photo the server cannot read', async ({ browser }) => {
  const context1 = await browser.newContext();
  await context1.addInitScript(() => localStorage.setItem('encrypt', 'true'));
  const page1 = await context1.newPage();
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();

  await page1.goto('/', { waitUntil: 'domcontentloaded' });
  await page1.getByRole('button', { name: /Start a room/i }).click();
  await expect(page1).toHaveURL(/\?room=[^#]+#k=[A-Za-z0-9_-]{43}$/, { timeout: 30000 });
  const roomUrl = page1.url();
  const roomId = new URL(roomUrl).searchParams.get('room');

  await page2.goto(roomUrl, { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(2000);

  await page1.locator('input#contained-button-file').first()
    .setInputFiles(path.join(__dirname, '../fixtures/test-image.jpg'));

  expect(await waitForImage(page2, 60000)).toBe(true);
  await expect(page2.getByText('test-image.jpg').first()).toBeVisible({ timeout: 15000 });

  const room = await (await page1.request.get(`http://localhost:8081/api/rooms/${roomId}`)).json();
  expect(room.settings.private).toBe(true);
  expect(room.photos.length).toBeGreaterThan(0);
  room.photos.forEach(photo => {
    expect(photo.secure).toBe(true);
    expect(photo.fileName).toMatch(/^photo-/);
    expect(JSON.stringify(photo)).not.toContain('test-image');
  });

  // After a reload, the photo comes back from this browser's cache, opened.
  await page2.waitForTimeout(1500);
  await page2.reload({ waitUntil: 'domcontentloaded' });
  expect(await waitForImage(page2, 30000)).toBe(true);
  await expect(page2.getByText('test-image.jpg').first()).toBeVisible({ timeout: 15000 });

  // Without the key, the room says so and shows no photo.
  const context3 = await browser.newContext();
  const page3 = await context3.newPage();
  await page3.goto(roomUrl.split('#')[0], { waitUntil: 'domcontentloaded' });
  await expect(page3.getByText(/This room is private/).first()).toBeVisible({ timeout: 20000 });

  await page1.screenshot({ path: 'test-results/private-room-sharer.png' });
  await page2.screenshot({ path: 'test-results/private-room-receiver.png' });
  await page3.screenshot({ path: 'test-results/private-room-no-key.png' });

  await context1.close();
  await context2.close();
  await context3.close();
});
