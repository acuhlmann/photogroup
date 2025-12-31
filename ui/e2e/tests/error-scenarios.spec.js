const { test, expect } = require('@playwright/test');
const http = require('http');

// Helper function to check if server is running
async function checkServerRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/rooms`, (res) => {
      resolve(res.statusCode !== undefined);
      res.on('data', () => {});
      res.on('end', () => {});
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

test('handles invalid room URL gracefully', async ({ page }) => {
  const serverRunning = await checkServerRunning(8081);
  if (!serverRunning) {
    test.skip();
  }

  // Try to access a non-existent room
  await page.goto('/?room=non-existent-room-id-12345');
  
  // App should still load (not crash)
  await expect(page).toHaveURL(new RegExp('\\?room='), { timeout: 10000 });
  
  // Wait for app to initialize
  await page.waitForTimeout(2000);
  
  // App should still be functional - check that main app structure exists
  const appLoaded = await page.locator('.App').count();
  expect(appLoaded).toBeGreaterThan(0);
  
  // Should not show a full error page (like a 404 page)
  // But it's okay if there's a snackbar/notification with error text
  // We just want to ensure the app doesn't crash completely
  const bodyText = await page.locator('body').textContent();
  // Check that we're not on a generic error page (no "404" or "Page Not Found" as main content)
  expect(bodyText).not.toMatch(/^404|Page Not Found|Error Page/i);
});

test('handles network disconnection gracefully', async ({ page }) => {
  const serverRunning = await checkServerRunning(8081);
  if (!serverRunning) {
    test.skip();
  }

  await page.goto('/');
  
  // Wait for app to load
  const startRoomButton = page.getByRole('button', { name: /start a Private Room/i });
  await expect(startRoomButton).toBeVisible({ timeout: 30000 });
  
  // Simulate offline mode
  await page.context().setOffline(true);
  await page.waitForTimeout(1000);
  
  // App should still be responsive (not crash)
  const appLoaded = await page.locator('.App').count();
  expect(appLoaded).toBeGreaterThan(0);
  
  // Restore online mode
  await page.context().setOffline(false);
});

test('handles room creation failure', async ({ page }) => {
  const serverRunning = await checkServerRunning(8081);
  if (!serverRunning) {
    test.skip();
  }

  await page.goto('/');
  
  const startRoomButton = page.getByRole('button', { name: /start a Private Room/i });
  await expect(startRoomButton).toBeVisible({ timeout: 30000 });
  
  // Monitor for console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  // Click button (if server is down, this might fail)
  await startRoomButton.click();
  
  // Wait a bit to see if errors occur
  await page.waitForTimeout(3000);
  
  // App should not crash even if room creation fails
  const appLoaded = await page.locator('.App').count();
  expect(appLoaded).toBeGreaterThan(0);
});

test('handles large file upload', async ({ page }) => {
  const serverRunning = await checkServerRunning(8081);
  if (!serverRunning) {
    test.skip();
  }

  // Create a room first
  await page.goto('/');
  const startRoomButton = page.getByRole('button', { name: /start a Private Room/i });
  await expect(startRoomButton).toBeVisible({ timeout: 30000 });
  await startRoomButton.click();
  await expect(page).toHaveURL(new RegExp('\\?room='), { timeout: 30000 });
  await page.waitForTimeout(2000);

  // Create a large file (simulate - in real test would use actual large file)
  // Note: This is a placeholder - actual large file testing would require a test file
  const fileInput = page.locator('input#contained-button-file').first();
  await expect(fileInput).toBeAttached({ timeout: 10000 });
  
  // For now, just verify the input exists and is ready
  // In a real scenario, you'd upload a large file and verify it handles it
  expect(await fileInput.count()).toBeGreaterThan(0);
});

