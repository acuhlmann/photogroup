# Test Coverage Documentation

This document describes the comprehensive test suite implemented for the PhotoGroup application.

## Test Structure

### UI Unit Tests (`ui/src/`)

#### App.test.js
- Tests App component rendering
- Tests dark mode preference handling
- Tests header rendering

#### Component Tests
- **FrontView.test.js**: Tests room creation UI, button rendering, and room URL handling
- **Uploader.test.js**: Tests file upload component, room-based rendering, and file handling
- **SettingsView.test.js**: Tests settings dialog, icon rendering, and dialog interactions

### Server Unit Tests (`server/tests/unit/`)

#### IpTranslator.test.js
- IP extraction from requests
- IPv4-mapped IPv6 address handling
- IP lookup caching
- Country flag emoji conversion
- Network chain and candidate IP enrichment

#### Topology.test.js
- Connection type determination (p2p, relay, p2p nat)
- Peer connection handling
- Network chain matching

#### IceServers.test.js
- ICE server configuration
- Twilio integration (when available)
- RTC config endpoint registration

#### Tracker.test.js
- Tracker server initialization
- Event handling
- Endpoint registration

#### MyDht.test.js
- DHT initialization
- Peer lookup functionality

### Server API Tests (`server/tests/api/`)

#### rooms.test.js
- `POST /api/rooms/` - Room creation
- `GET /api/rooms/:id` - Room retrieval
- `POST /api/rooms/:id` - Room joining
- `POST /api/rooms/:id/photos/` - Photo addition
- `PUT /api/rooms/:id/photos/` - Photo updates
- `DELETE /api/rooms/:id/photos/` - Photo deletion
- `DELETE /api/rooms` - Room reset

#### peers.test.js
- `PUT /api/rooms/:id/peers/:peerId` - Peer updates
- Peer creation with required fields
- Error handling for missing peers/rooms

#### updates.test.js
- `GET /api/rooms/:id/updates/` - SSE connection establishment
- Error handling for non-existent rooms

#### owners.test.js
- `POST /api/rooms/:id/photos/owners/` - Add photo owners
- `PUT /api/rooms/:id/photos/owners/` - Update photo owners
- `DELETE /api/rooms/:id/photos/owners/:peerId` - Remove photo owners

#### connections.test.js
- `POST /api/rooms/:id/connections` - Create connections
- `DELETE /api/rooms/:id/connections` - Delete connections

### Server Integration Tests (`server/tests/integration/`)

#### p2p-flow.test.js
- Complete P2P photo sharing flow:
  - Room creation
  - Multiple peer joining
  - Photo addition and sharing
  - Owner management
  - Connection lifecycle
- Multiple photos handling
- Peer update scenarios

### E2E Tests (`ui/e2e/tests/`)

#### two-browser-p2p-flow.spec.js (Existing)
- Two-browser P2P photo sharing flow
- Room creation and URL sharing
- Image upload and gallery display

#### single-peer-flow.spec.js
- Single peer room creation
- Photo upload in single peer scenario
- Room URL sharing via clipboard

#### multi-peer-flow.spec.js
- Three-browser P2P flow
- Multiple peers joining room
- Photo sharing across multiple peers

#### error-scenarios.spec.js
- Invalid room URL handling
- Network disconnection handling
- Room creation failure scenarios
- Large file upload handling

#### image-upload-flow.spec.js
- Core E2E test: Upload image in one browser, receive in another
- Verifies essential P2P photo sharing functionality
- Can run in headless (CI) or headed (local) mode
- Supports side-by-side browser viewing for local development

### Test Helpers (`ui/e2e/helpers/`)

#### test-helpers.js
- `checkServerRunning()` - Verify backend server availability
- `checkServerHealth()` - Check server health with retries
- `startBackendServer()` - Start backend server programmatically
- `stopBackendServer()` - Stop backend server
- `waitForImage()` - Wait for content images to appear (not UI icons)
- `waitForLoadingIndicator()` - Wait for loading indicators
- `createRoom()` - Helper to create a room
- `uploadFile()` - Helper to upload files
- `positionWindow()` - Position browser window (for side-by-side viewing)
- `setupSideBySideWindows()` - Setup side-by-side browser windows

## Running Tests

### Running All Tests

From the project root:
```bash
npm test                    # Run all tests (auto-starts servers)
npm run test:headed          # Run E2E tests in headed mode (visible browsers)
npm run test:watch         # Run in watch mode for development
npm run test:server-only     # Run only server tests
npm run test:ui-only        # Run only UI tests
npm run test:e2e-only       # Run only E2E tests
```

### UI Unit Tests
```bash
cd ui
npm test                     # Run with watch mode
npm test -- --watchAll=false # Run once
```

### Server Tests
```bash
cd server
npm test                     # All tests (unit + API + integration)
npm run test:unit            # Unit tests only
npm run test:api             # API tests only
npm run test:integration     # Integration tests only
```

### E2E Tests

#### Local Development (Side-by-Side Browsers)
```bash
cd ui
npm run test:e2e:side-by-side  # Opens two browser windows side-by-side
```

#### Local Development (Headed Mode)
```bash
cd ui
npm run test:e2e:headed        # Browsers visible, single window
npm run test:e2e:ui            # Interactive UI mode
npm run test:e2e:debug         # Debug mode with inspector
```

#### CI Mode (Headless)
```bash
cd ui
npm run test:e2e:ci            # Headless, optimized for CI
npm run test:e2e               # Standard headless mode
```

### All Tests (CI/CD)

#### GitHub Actions
The GitHub Actions workflow (`.github/workflows/test.yml`) runs automatically on:
- Push to main/master branches
- Pull requests to main/master branches
- Manual workflow dispatch

The workflow:
1. Installs all dependencies
2. Runs UI unit tests
3. Runs server unit tests
4. Runs server API tests
5. Runs server integration tests
6. Installs Playwright browsers (Chromium only for speed)
7. Starts backend server automatically
8. Runs E2E tests (headless, Chromium only)
9. Uploads Playwright test reports and videos (on failure)

#### Local CI Simulation
```bash
npm run test:ci                # Run all tests in CI mode
```

## Test Coverage Summary

### UI Components
- ✅ App component
- ✅ FrontView (room creation)
- ✅ Uploader component
- ✅ SettingsView component

### Server Components
- ✅ IpTranslator (IP extraction, lookup, enrichment)
- ✅ Topology (connection type determination)
- ✅ IceServers (ICE server configuration)
- ✅ Tracker (tracker server initialization)
- ✅ MyDht (DHT functionality)

### Server API Endpoints
- ✅ Room management (CRUD)
- ✅ Peer management
- ✅ Photo management
- ✅ Owner management
- ✅ Connection management
- ✅ SSE updates

### Integration Scenarios
- ✅ Complete P2P flow
- ✅ Multiple peers
- ✅ Multiple photos
- ✅ Peer updates

### E2E Scenarios
- ✅ Single peer flow
- ✅ Two peer flow (core image upload/receive)
- ✅ Three peer flow
- ✅ Error handling
- ✅ Network disconnection
- ✅ Invalid room URLs

## Test Execution Modes

### Local Development

#### Side-by-Side Browser Testing
For visual inspection of P2P image sharing:
```bash
npm run test:e2e:watch
# or
cd ui && npm run test:e2e:side-by-side
```

This opens two browser windows side-by-side so you can watch:
- Browser 1 (left): Uploads an image
- Browser 2 (right): Receives the image via P2P

#### Standard Local Testing
```bash
npm test                    # Auto-starts servers, runs all tests
npm run test:headed          # E2E tests with visible browsers
```

### CI/CD (GitHub Actions)

The dedicated test workflow (`.github/workflows/test.yml`) runs:
- All test suites automatically
- Headless E2E tests
- Automatic server startup
- Test report and artifact uploads

The deploy workflow (`.github/workflows/deploy.yml`) only runs if tests pass.

## Troubleshooting

### Server Not Starting
If E2E tests fail with "server not running":
- The test runner should auto-start the server
- Check that port 8081 is not in use: `lsof -i :8081`
- Manually start: `npm run start-server`

### E2E Tests Timing Out
- P2P transfers can take 60-90 seconds
- Increase timeout in test if needed
- Check network connectivity
- Verify both browsers can connect to the server

### Playwright Browsers Not Installed
```bash
cd ui
npx playwright install chromium
```

### Side-by-Side Windows Not Positioning
- Window positioning is best-effort and may not work on all platforms
- Manually position windows if needed
- The viewport size will still be set correctly

### Tests Failing in CI but Passing Locally
- Check CI logs for specific errors
- Verify all dependencies are installed
- Check that secrets (Twilio) are configured in GitHub
- Review Playwright test artifacts uploaded to GitHub

## Future Test Extensions

Potential areas for additional testing:
- Performance tests (load testing)
- Security tests (authentication, encryption)
- Accessibility tests
- Cross-browser compatibility (Firefox, Safari)
- Mobile device testing
- Large file handling tests
- Concurrent room operations
- Stress testing with many peers

