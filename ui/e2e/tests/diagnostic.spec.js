const { test, expect } = require('@playwright/test');

test('diagnostic test - check for blank screen and errors', async ({ page }) => {
  // Collect console errors
  const consoleErrors = [];
  const consoleWarnings = [];
  const consoleLogs = [];
  
  const failedRequests = [];
  page.on('requestfailed', request => {
    failedRequests.push({
      url: request.url(),
      failure: request.failure()?.errorText || 'Unknown',
      resourceType: request.resourceType()
    });
  });
  page.on('response', response => {
    if (response.status() >= 400) {
      failedRequests.push({
        url: response.url(),
        status: response.status(),
        statusText: response.statusText()
      });
    }
  });
  
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    } else if (msg.type() === 'warning') {
      consoleWarnings.push(text);
    } else {
      consoleLogs.push(text);
    }
  });

  // Collect page errors
  const pageErrors = [];
  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });

  // Navigate to the app
  await page.goto('/');
  
  // Wait a bit for React to render
  await page.waitForTimeout(3000);

  // Check what's actually on the page
  const bodyText = await page.textContent('body');
  const rootContent = await page.textContent('#root');
  const rootHTML = await page.innerHTML('#root');
  
  // Check for any visible elements
  const visibleElements = await page.evaluate(() => {
    const elements = document.querySelectorAll('*');
    const visible = [];
    for (const el of elements) {
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
        if (el.textContent && el.textContent.trim().length > 0) {
          visible.push({
            tag: el.tagName,
            text: el.textContent.trim().substring(0, 100),
            id: el.id,
            className: el.className
          });
        }
      }
    }
    return visible.slice(0, 20); // Return first 20 visible elements
  });

  // Take a screenshot
  await page.screenshot({ path: 'test-results/diagnostic-blank-screen.png', fullPage: true });

  // Log all findings
  console.log('\n=== DIAGNOSTIC RESULTS ===');
  console.log('\nFailed Requests:', JSON.stringify(failedRequests, null, 2));
  console.log('\nConsole Errors:', consoleErrors);
  console.log('\nConsole Warnings:', consoleWarnings);
  console.log('\nPage Errors:', pageErrors);
  console.log('\nBody Text (first 500 chars):', bodyText?.substring(0, 500));
  console.log('\nRoot Content:', rootContent);
  console.log('\nRoot HTML (first 1000 chars):', rootHTML?.substring(0, 1000));
  console.log('\nVisible Elements:', JSON.stringify(visibleElements, null, 2));
  
  // Check if root is empty
  const rootEmpty = !rootContent || rootContent.trim().length === 0;
  console.log('\nRoot is empty:', rootEmpty);
  
  // Check if we can find React root
  const reactRoot = await page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return null;
    return {
      hasChildren: root.children.length > 0,
      childCount: root.children.length,
      innerHTML: root.innerHTML.substring(0, 500)
    };
  });
  console.log('\nReact Root Info:', reactRoot);

  // Check for PhotoGroup text
  const hasPhotoGroupText = bodyText?.includes('PhotoGroup') || rootContent?.includes('PhotoGroup');
  console.log('\nContains "PhotoGroup" text:', hasPhotoGroupText);

  // Filter out expected/non-critical errors
  // These are errors that can occur during normal operation or are expected in test scenarios
  const criticalErrors = consoleErrors.filter(error => {
    const errorLower = error.toLowerCase();
    // Ignore network errors that are expected during P2P testing
    if (errorLower.includes('failed to load resource') || 
        errorLower.includes('500 (internal server error)') ||
        errorLower.includes('networkerror') ||
        errorLower.includes('fetch')) {
      return false;
    }
    // Ignore JSON parsing errors from server error responses
    if (errorLower.includes('unexpected token') && errorLower.includes('json')) {
      return false;
    }
    // Ignore service worker errors (common in development)
    if (errorLower.includes('service worker') || errorLower.includes('serviceworker')) {
      return false;
    }
    // All other errors are considered critical
    return true;
  });

  const criticalPageErrors = pageErrors.filter(error => {
    const errorLower = error.toLowerCase();
    // Ignore JSON parsing errors from server error responses
    if (errorLower.includes('unexpected token') && errorLower.includes('json')) {
      return false;
    }
    // All other page errors are considered critical
    return true;
  });

  // Only fail on critical errors
  if (criticalErrors.length > 0 || criticalPageErrors.length > 0) {
    throw new Error(
      `Found critical errors:\n` +
      `Critical Console Errors: ${criticalErrors.join('\n')}\n` +
      `Critical Page Errors: ${criticalPageErrors.join('\n')}\n` +
      `(Filtered out ${consoleErrors.length - criticalErrors.length} expected console errors and ${pageErrors.length - criticalPageErrors.length} expected page errors)`
    );
  }

  // If root is completely empty, that's a problem
  if (rootEmpty && !hasPhotoGroupText) {
    throw new Error(
      'Root element is empty and no PhotoGroup text found. Blank screen detected.\n' +
      `Root HTML: ${rootHTML}\n` +
      `Visible Elements: ${JSON.stringify(visibleElements, null, 2)}`
    );
  }
});

