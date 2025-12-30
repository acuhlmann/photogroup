# E2E Tests

This directory contains end-to-end tests for the PhotoGroup application using Playwright.

## Prerequisites

1. **Backend Server**: The backend server must be running on port 8081 before running tests.
   - Start it with: `npm run start-server` (from project root)
   - Or start both UI and server: `npm run start` (from project root)

2. **UI Server**: The Playwright config will automatically start the React dev server on port 3000.

## Running Tests

From the `ui` directory:

```bash
# Run all E2E tests
npm run test:e2e

# Run tests with UI mode (interactive)
npm run test:e2e:ui

# Run tests in debug mode
npm run test:e2e:debug
```

## Test Files

- `tests/two-browser-p2p-flow.spec.js` - Tests the complete P2P photo sharing flow with two browser instances

## Test Flow

The main test validates:
1. Room creation and URL sharing
2. Second browser joining via shared URL
3. Image upload from first browser
4. Image appearing in second browser's gallery

## Troubleshooting

- **"Backend server is not running"**: Make sure the server is started on port 8081
- **Test timeouts**: P2P operations can take time; tests have generous timeouts (60s for image loading)
- **Dialog not opening**: The test includes fallback logic to manually open the dialog if needed

