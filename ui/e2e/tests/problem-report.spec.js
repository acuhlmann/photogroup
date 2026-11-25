const { test, expect } = require('@playwright/test');
const path = require('path');
const { waitForImage } = require('../helpers/test-helpers');

// "Send a problem report" is a link on the front page and an item in the room
// menu, in every mode. It posts the app log and the session to the server,
// and the person gets the report's number.

async function sendFromDialog(page, note) {
  const dialog = page.getByRole('dialog', { name: 'Send a problem report' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('What went wrong?').fill(note);
  const posted = page.waitForRequest(request => request.url().endsWith('/api/reports') && request.method() === 'POST');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  const report = JSON.parse((await posted).postData());
  await expect(dialog.getByText(/The report is sent\. Its number is [A-Z2-9]{4}-[A-Z2-9]{4}\./)).toBeVisible({ timeout: 15000 });
  return { dialog, report };
}

test('the front page sends a problem report and shows its number', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Send a problem report' }).click();
  const { dialog, report } = await sendFromDialog(page, 'The room does not start');
  expect(report).toMatchObject({ app: 'PhotoGroup', kind: 'problem-report', inRoom: false, note: 'The room does not start' });
  expect(report.appLog.length).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('a private room report has the log but not the names', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/^Private room/).check();
  await page.getByRole('button', { name: /Start a room/i }).click();
  await expect(page).toHaveURL(/\?room=[^#]+#k=/, { timeout: 30000 });
  await page.locator('input#contained-button-file').first()
    .setInputFiles(path.join(__dirname, '../fixtures/test-image.jpg'));
  expect(await waitForImage(page, 60000)).toBe(true);

  await page.getByRole('button', { name: /^Room: .*Room menu/ }).click();
  await page.getByRole('menuitem', { name: /Send a problem report/ }).click();
  await expect(page.getByText(/This room is private\. The report does not include/)).toBeVisible();
  const { report } = await sendFromDialog(page, 'Testing the report');
  expect(report).toMatchObject({ inRoom: true, private: true, mode: 'default' });
  expect(report.photos.length).toBeGreaterThan(0);
  expect(report.peers.length).toBeGreaterThan(0);
  const text = JSON.stringify(report);
  expect(text).not.toContain('test-image');
  expect(text).not.toContain('#k=');
});
