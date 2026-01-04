const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');
const { launchSideBySideBrowsers } = require('../helpers/test-helpers');

// Helper function to check if server is running
async function checkServerRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/rooms`, (res) => {
      // Any status code means the server is running (even 404 is OK)
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

test('two browser P2P photo sharing flow', async ({ browser }) => {
  // Skip in CI or headless environments - P2P tests require real WebRTC connections which are unreliable in headless environments
  const isHeadless = !process.env.HEADED && process.env.SIDE_BY_SIDE !== 'true';
  test.skip(!!process.env.CI || isHeadless, 'Skipping P2P test in CI/headless - requires real WebRTC connections');
  
  // Check if backend server is running (required for room creation)
  const serverRunning = await checkServerRunning(8081);
  if (!serverRunning) {
    throw new Error(
      'Backend server is not running on port 8081. ' +
      'Please start it with "npm run start-server" from the project root before running tests.'
    );
  }
  let context1, context2, page1, page2, browser1, browser2;

  // For side-by-side mode, launch separate browser instances
  if (process.env.SIDE_BY_SIDE === 'true') {
    const result = await launchSideBySideBrowsers();
    browser1 = result.browser1;
    browser2 = result.browser2;
    context1 = result.context1;
    context2 = result.context2;
    page1 = result.page1;
    page2 = result.page2;
  } else {
    // Normal mode: use contexts from the same browser
    context1 = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    page1 = await context1.newPage();
    
    context2 = await browser.newContext();
    page2 = await context2.newPage();
  }

  // Set up console logging for both browsers
  page1.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('[B1 error]', msg.text());
    }
  });
  
  page1.on('pageerror', error => {
    console.log('[B1 pageerror]', error.message);
  });
  
  page2.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      console.log('[B2 error]', text);
    } else if (text.includes('addMediaToDom') || text.includes('getBlob') || text.includes('blobDone')) {
      console.log('[B2]', text);
    }
  });
  
  page2.on('pageerror', error => {
    console.log('[B2 pageerror]', error.message);
  });

  // Step 1: Browser 1 - Navigate to app
  await page1.goto('/');
  
  // Wait for the app to load - look for the "start a Private Room" button
  // The button text is "start a Private Room" (case sensitive in the code)
  const startRoomButton = page1.getByRole('button', { name: /start a Private Room/i });
  await expect(startRoomButton).toBeVisible({ timeout: 30000 });
  
  // Step 2: Browser 1 - Click "start a Private Room" button
  // This triggers openRoom() which calls findExistingContent and createRoom (API call)
  await startRoomButton.click();
  
  // Wait a moment for the click to register and any async operations to start
  await page1.waitForTimeout(1000);
  
  // Step 3: Browser 1 - Wait for room creation to complete
  // First, wait for the URL to change (which happens in openRoom after createRoom)
  // Note: This requires the backend server to be running for the API call to succeed
  // If the server isn't running, this will timeout
  try {
    await expect(page1).toHaveURL(new RegExp('\\?room='), { timeout: 30000 });
  } catch (e) {
    // If URL doesn't change, the room creation might have failed
    // Check for errors in the page
    const currentUrl = page1.url();
    console.log('Current URL after clicking:', currentUrl);
    
    // Take a screenshot for debugging
    await page1.screenshot({ path: 'test-results/debug-room-creation-failed.png', fullPage: true });
    
    // Check if there are any error messages visible
    const errorMessages = await page1.locator('text=/error|Error|failed|Failed/i').count();
    if (errorMessages > 0) {
      const errorText = await page1.locator('text=/error|Error|failed|Failed/i').first().textContent();
      console.log('Error message found:', errorText);
    }
    
    throw new Error('Room creation failed - URL did not change. This likely means the backend server is not running. Please start the server with "npm run start-server" from the project root.');
  }
  
  // Wait a bit for the dialog to open (openRoomEnd event sets open: true)
  // The dialog should open automatically, but we might need to wait for React to render
  await page1.waitForTimeout(2000);
  
  // Step 3b: Browser 1 - Wait for room creation dialog to open
  // The dialog should appear after room is created (openRoomEnd event)
  // Try multiple approaches to find the dialog content
  let shareDialogText = null;
  let dialogFound = false;
  
  // First, try to find the dialog by looking for Material-UI Dialog (it has role="dialog")
  const dialog = page1.locator('[role="dialog"]');
  const dialogCount = await dialog.count();
  
  if (dialogCount > 0) {
    // Dialog exists, now look for the text inside it
    shareDialogText = dialog.getByText('Share this room via either...');
    try {
      await expect(shareDialogText).toBeVisible({ timeout: 10000 });
      dialogFound = true;
    } catch (e) {
      console.log('Dialog found but text not visible yet, waiting...');
    }
  }
  
  // If dialog not found or text not visible, try clicking AddPeersView button
  if (!dialogFound) {
    console.log('Dialog not automatically visible, trying to open it via AddPeersView button...');
    // Look for the AddPeersView button (IconButton with GroupAddRounded icon)
    // It's in the AppBar toolbar
    const addPeersButtons = page1.locator('button[aria-haspopup="true"]');
    const buttonCount = await addPeersButtons.count();
    
    if (buttonCount > 0) {
      // Click the first button that might be AddPeersView
      await addPeersButtons.first().click();
      await page1.waitForTimeout(1000);
      
      // Now look for the dialog text again
      shareDialogText = page1.getByText('Share this room via either...');
      await expect(shareDialogText).toBeVisible({ timeout: 10000 });
      dialogFound = true;
    }
  }
  
  if (!dialogFound) {
    // Last resort: take a screenshot for debugging
    await page1.screenshot({ path: 'test-results/debug-dialog-not-found.png', fullPage: true });
    throw new Error('Dialog did not open after room creation. Screenshot saved.');
  }
  
  // Step 4: Browser 1 - Click "Copy/Paste Link" button
  // The button is an IconButton with LinkRounded icon, next to "Copy/Paste Link" text
  // Structure: span.horizontal > Typography "Copy/Paste Link" + IconButton
  const copyPasteLinkText = page1.getByText('Copy/Paste Link');
  await expect(copyPasteLinkText).toBeVisible();
  
  // Find the IconButton that is a sibling in the same horizontal container
  // Get the parent span, then find the button within it
  const copyLinkButton = copyPasteLinkText.locator('..').getByRole('button');
  await expect(copyLinkButton).toBeVisible();
  
  // Click the copy button
  await copyLinkButton.click();
  
  // Wait a moment for clipboard to be updated
  await page1.waitForTimeout(500);
  
  // Step 5: Browser 1 - Extract URL from clipboard or page URL
  // First try to get URL from clipboard, but fallback to page URL if clipboard fails
  let copiedUrl = '';
  try {
    // Try reading from clipboard (requires permission)
    copiedUrl = await page1.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch (e) {
        // If clipboard fails, get URL from page
        return window.location.href;
      }
    });
  } catch (e) {
    // If clipboard access fails entirely, get URL directly from page
    console.log('Clipboard access failed, using page URL instead');
    copiedUrl = page1.url();
  }
  
  // If clipboard didn't work, get URL from page directly
  if (!copiedUrl || !copiedUrl.includes('?room=')) {
    copiedUrl = page1.url();
  }
  
  // Verify we got a URL with room parameter
  expect(copiedUrl).toContain('?room=');
  console.log('Copied URL:', copiedUrl);
  
  // Step 6: Browser 2 - Open with copied URL
  await page2.goto(copiedUrl);
  
  // Step 7: Browser 2 - Wait for room to load
  // The room should load and the FrontView should be hidden (hasRoom() returns true)
  // We can verify by checking that the URL has the room parameter
  await expect(page2).toHaveURL(new RegExp('\\?room='), { timeout: 10000 });
  
  // Wait a bit for the room to fully initialize
  await page2.waitForTimeout(2000);
  
  // Step 8: Browser 1 - Click Uploader button and upload image
  // The uploader is an IconButton with CloudUploadRounded icon
  // It's a label for a hidden input with id "contained-button-file"
  // There may be multiple uploaders (one in header, one in dialog), so use the first one
  const fileInput = page1.locator('input#contained-button-file').first();
  
  // Verify the input exists (it may be hidden, so we check for existence)
  await expect(fileInput).toBeAttached({ timeout: 10000 });
  
  // Get the path to the test image
  const testImagePath = path.join(__dirname, '../fixtures/test-image.jpg');
  
  // Set the file input (this works even if the input is hidden)
  await fileInput.setInputFiles(testImagePath);
  
  // Wait for upload to start - the file input should trigger the upload
  // We can verify by checking for loading indicators or image appearing in gallery
  await page1.waitForTimeout(2000);
  
  // Step 9: Browser 2 - Wait for image to appear in gallery
  // Images appear in the gallery as <img> tags or in ContentTile components
  // We should wait for either:
  // - An image element to appear
  // - Loading indicators (progress percentage like "50%")
  // - ContentTile with the image
  
  // Wait for image to start loading - look for img tag or loading indicators
  // The gallery renders images, so we'll look for img elements
  // We'll use a longer timeout since P2P operations can take time (60 seconds)
  
  // Try to find either:
  // 1. Image element (img tag)
  // 2. Loading indicator (progress percentage text like "50%")
  // 3. Any indication that content is being loaded
  
  let imageFound = false;
  let torrentDownloaded = false;
  
  // Wait up to 30 seconds for torrent download or image
  const maxWaitTime = 30000;
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime && !imageFound && !torrentDownloaded) {
    // Check for torrent download progress (most reliable)
    const torrentStatus = await page2.evaluate(() => {
      if (window.client && window.client.torrents && window.client.torrents.length > 0) {
        const torrent = window.client.torrents[0];
        return {
          infoHash: torrent.infoHash,
          progress: Math.round(torrent.progress * 100),
          numPeers: torrent.numPeers
        };
      }
      return null;
    });
    
    if (torrentStatus && torrentStatus.progress === 100) {
      torrentDownloaded = true;
      console.log(`Browser 2: Torrent downloaded 100% - ${torrentStatus.infoHash}, peers: ${torrentStatus.numPeers}`);
      break;
    } else if (torrentStatus) {
      console.log(`Browser 2: Download progress: ${torrentStatus.progress}%, peers: ${torrentStatus.numPeers}`);
    }
    
    // Check for images as backup
    const imageCount = await page2.locator('img[src^="blob:"]').count();
    if (imageCount > 0) {
      imageFound = true;
      console.log(`Browser 2: Found ${imageCount} blob image(s)`);
      break;
    }
    
    // Wait a bit before checking again
    await page2.waitForTimeout(1000);
  }
  
  // Verify that P2P transfer completed successfully
  expect(imageFound || torrentDownloaded).toBeTruthy();
  
  if (torrentDownloaded) {
    console.log('Browser 2: P2P torrent transfer completed successfully');
  }
  if (imageFound) {
    console.log('Browser 2: Image rendered in gallery');
  }
  
  // Check if actual image is visible in Browser 2
  const hasVisibleImage = await page2.evaluate(() => {
    const imgs = document.querySelectorAll('img[src^="blob:"], img[src^="data:image"]');
    return imgs.length > 0;
  });
  console.log('Browser 2: Has visible blob/data image:', hasVisibleImage);
  
  // Wait 500ms so user can see the result
  console.log('Waiting 500ms for visual inspection...');
  await page2.waitForTimeout(500);
  
  // Clean up
  if (process.env.SIDE_BY_SIDE === 'true') {
    await browser1.close();
    await browser2.close();
  } else {
    await context1.close();
    await context2.close();
  }
});

