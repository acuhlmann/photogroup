#!/usr/bin/env node

/**
 * Run all tests for PhotoGroup project
 * 
 * This script runs:
 * 1. Server unit tests
 * 2. Server API tests
 * 3. Server integration tests
 * 4. UI unit tests
 * 5. UI e2e tests
 * 
 * Usage:
 *   node test-all.js                    # Run all tests
 *   node test-all.js --headed           # Run E2E tests in headed mode
 *   node test-all.js --watch            # Run in watch mode (for development)
 *   node test-all.js --server-only      # Run only server tests
 *   node test-all.js --ui-only          # Run only UI tests
 *   node test-all.js --e2e-only         # Run only E2E tests
 */

const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runCommand(command, cwd, description) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`${description}`, 'bright');
  log(`${'='.repeat(60)}`, 'cyan');
  log(`Running: ${command}`, 'blue');
  log(`Directory: ${cwd}\n`, 'blue');

  try {
    const { stdout, stderr } = await execPromise(command, { 
      cwd,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      env: { ...process.env, NODE_ENV: 'test' }
    });
    
    if (stdout) {
      console.log(stdout);
    }
    if (stderr && !stderr.includes('Warning:')) {
      console.error(stderr);
    }
    
    log(`✅ ${description} - PASSED`, 'green');
    return { success: true, output: stdout };
  } catch (error) {
    log(`❌ ${description} - FAILED`, 'red');
    console.error(error.stdout || error.message);
    if (error.stderr) {
      console.error(error.stderr);
    }
    return { success: false, error: error.message, output: error.stdout };
  }
}

let serverProcess = null;

async function checkServerRunning() {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get('http://localhost:8081/api/rooms', (res) => {
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

async function startServer(serverDir) {
  if (serverProcess) {
    log('Server already started by test runner', 'yellow');
    return;
  }

  // Check if server is already running
  const alreadyRunning = await checkServerRunning();
  if (alreadyRunning) {
    log('✅ Backend server is already running on port 8081', 'green');
    log('   Using existing server instance', 'yellow');
    return;
  }

  log('Starting backend server...', 'yellow');
  // Note: For E2E tests, we want the server to run in normal mode (not test mode)
  // so that it behaves like production. Only the test processes should use NODE_ENV=test.
  serverProcess = spawn('npm', ['start'], {
    cwd: serverDir,
    stdio: 'pipe',
    env: { ...process.env, PORT: '8081', WS_PORT: '9000', NODE_ENV: process.env.NODE_ENV || 'development' }
  });

  let serverOutput = '';
  let serverErrors = '';

  serverProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    serverOutput += output + '\n';
    if (output && !output.includes('bind EINVAL') && !output.includes('listen EADDRINUSE')) {
      console.log(`[Server] ${output}`);
    }
  });

  serverProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    serverErrors += output + '\n';
    // Filter out expected port conflict messages
    if (output && 
        !output.includes('Warning:') && 
        !output.includes('bind EINVAL') && 
        !output.includes('listen EADDRINUSE')) {
      console.error(`[Server Error] ${output}`);
    }
  });

  serverProcess.on('error', (error) => {
    log(`❌ Failed to start server process: ${error.message}`, 'red');
    serverProcess = null;
  });

  // Wait for server to be ready
  let retries = 30;
  while (retries > 0) {
    const isRunning = await checkServerRunning();
    if (isRunning) {
      log('✅ Backend server started successfully', 'green');
      return;
    }
    
    // Check if process died
    if (serverProcess && serverProcess.killed) {
      throw new Error('Server process died unexpectedly');
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries--;
  }

  // If we get here, server didn't start
  const portInUse = serverErrors.includes('EADDRINUSE') || serverOutput.includes('EADDRINUSE');
  if (portInUse) {
    log('⚠️  Port 8081 or 9000 is already in use', 'yellow');
    log('   Attempting to use existing server...', 'yellow');
    // Give it one more check - maybe another process started it
    const isRunning = await checkServerRunning();
    if (isRunning) {
      log('✅ Found server running on port 8081', 'green');
      serverProcess = null; // Don't try to kill it
      return;
    }
    throw new Error('Port 8081 or 9000 is in use and server is not responding. Please stop the existing server or use a different port.');
  }

  throw new Error(`Server failed to start within 30 seconds. Errors: ${serverErrors.substring(0, 200)}`);
}

async function stopServer() {
  if (serverProcess) {
    log('Stopping backend server...', 'yellow');
    try {
      serverProcess.kill('SIGTERM');
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if it doesn't shut down gracefully
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
        
        serverProcess.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    } catch (error) {
      log(`Warning: Error stopping server: ${error.message}`, 'yellow');
    } finally {
      serverProcess = null;
    }
  }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
  await stopServer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await stopServer();
  process.exit(0);
});

async function main() {
  // Set NODE_ENV=test for all tests
  process.env.NODE_ENV = 'test';
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const isHeaded = args.includes('--headed');
  const isWatch = args.includes('--watch');
  const serverOnly = args.includes('--server-only');
  const uiOnly = args.includes('--ui-only');
  const e2eOnly = args.includes('--e2e-only');

  log('\n🧪 PhotoGroup - Running All Tests\n', 'bright');
  
  if (isHeaded) {
    log('Mode: Headed (browsers will be visible)', 'cyan');
  }
  if (isWatch) {
    log('Mode: Watch (tests will re-run on changes)', 'cyan');
  }
  if (serverOnly) {
    log('Mode: Server tests only', 'cyan');
  }
  if (uiOnly) {
    log('Mode: UI tests only', 'cyan');
  }
  if (e2eOnly) {
    log('Mode: E2E tests only', 'cyan');
  }
  log('');

  const results = {
    serverUnit: null,
    serverAPI: null,
    serverIntegration: null,
    uiUnit: null,
    uiE2E: null,
  };

  const rootDir = __dirname;
  const serverDir = path.join(rootDir, 'server');
  const uiDir = path.join(rootDir, 'ui');

  // Check if server is running (needed for e2e tests)
  let serverRunning = false;
  let serverStartedByUs = false;

  if (!serverOnly) {
    log('Checking if backend server is running...', 'yellow');
    serverRunning = await checkServerRunning();
    
    if (!serverRunning) {
      log('⚠️  Backend server is not running on port 8081', 'yellow');
      log('   Auto-starting server for E2E tests...', 'yellow');
      try {
        await startServer(serverDir);
        serverRunning = true;
        serverStartedByUs = true;
      } catch (error) {
        log(`❌ Failed to start server: ${error.message}`, 'red');
        if (!e2eOnly) {
          log('   Continuing with other tests...', 'yellow');
        } else {
          log('   Cannot run E2E tests without server', 'red');
          process.exit(1);
        }
      }
    } else {
      log('✅ Backend server is running\n', 'green');
    }
  }

  // Run tests based on flags
  if (!uiOnly && !e2eOnly) {
    // 1. Server Unit Tests
    results.serverUnit = await runCommand(
      'npm test',
      serverDir,
      'Server Unit Tests'
    );

    // 2. Server API Tests
    results.serverAPI = await runCommand(
      'npm run test:api',
      serverDir,
      'Server API Tests'
    );

    // 3. Server Integration Tests
    results.serverIntegration = await runCommand(
      'npm run test:integration',
      serverDir,
      'Server Integration Tests'
    );
  }

  if (!serverOnly && !e2eOnly) {
    // 4. UI Unit Tests
    // Note: vitest uses --run instead of --watchAll=false
    const watchFlag = isWatch ? '' : '--run';
    results.uiUnit = await runCommand(
      `npm test -- ${watchFlag}`,
      uiDir,
      'UI Unit Tests'
    );
  }

  // 5. UI E2E Tests
  if (!serverOnly && !uiOnly) {
    if (serverRunning) {
      const e2eCommand = isHeaded 
        ? 'npm run test:e2e:headed'
        : isWatch
        ? 'npm run test:e2e:side-by-side'
        : 'npm run test:e2e';
      
      results.uiE2E = await runCommand(
        e2eCommand,
        uiDir,
        'UI E2E Tests'
      );
    } else {
      log('\n⏭️  Skipping UI E2E Tests (server not running)', 'yellow');
      results.uiE2E = { success: false, skipped: true, reason: 'Server not running' };
    }
  }

  // Summary
  log('\n' + '='.repeat(60), 'cyan');
  log('📊 TEST SUMMARY', 'bright');
  log('='.repeat(60), 'cyan');

  const allTests = [
    { name: 'Server Unit Tests', result: results.serverUnit },
    { name: 'Server API Tests', result: results.serverAPI },
    { name: 'Server Integration Tests', result: results.serverIntegration },
    { name: 'UI Unit Tests', result: results.uiUnit },
    { name: 'UI E2E Tests', result: results.uiE2E },
  ];

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  allTests.forEach(({ name, result }) => {
    if (result?.skipped) {
      log(`⏭️  ${name}: SKIPPED (${result.reason})`, 'yellow');
      skipped++;
    } else if (result?.success) {
      log(`✅ ${name}: PASSED`, 'green');
      passed++;
    } else {
      log(`❌ ${name}: FAILED`, 'red');
      failed++;
    }
  });

  log('\n' + '='.repeat(60), 'cyan');
  log(`Total: ${passed + failed + skipped} | ✅ Passed: ${passed} | ❌ Failed: ${failed} | ⏭️  Skipped: ${skipped}`, 'bright');
  log('='.repeat(60) + '\n', 'cyan');

  // Cleanup: stop server if we started it
  if (serverStartedByUs) {
    await stopServer();
  }

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(async (error) => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  
  // Cleanup on error
  if (serverProcess) {
    await stopServer();
  }
  
  process.exit(1);
});

