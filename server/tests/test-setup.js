// Test setup file to suppress console output during tests
// This should be imported before app.js to prevent Twilio logs and server startup messages

// Set NODE_ENV=test before any modules are loaded
process.env.NODE_ENV = 'test';

// Suppress console.log and console.error during tests
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleInfo = console.info;

// Store original functions for restoration if needed
global._originalConsole = {
  log: originalConsoleLog,
  error: originalConsoleError,
  info: originalConsoleInfo
};

// Suppress console output
console.log = () => {};
console.error = () => {};
console.info = () => {};

// Mock twilio - in ESM, we'll use a mock module
// The actual mocking will be done via import maps or by creating a mock module
export const restoreConsole = function() {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.info = originalConsoleInfo;
};

