// Test setup file to suppress console output during tests
// This should be required before app.js to prevent Twilio logs and server startup messages

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

// Mock twilio before app.js requires it
const mockTwilioClient = {
  tokens: {
    create: function(options, callback) {
      // Simulate async response without making real API call
      setImmediate(() => {
        callback(null, {
          iceServers: [
            { urls: 'stun:test.stun.server:3478' },
            { urls: 'turn:test.turn.server:3478', username: 'test', credential: 'test' }
          ]
        });
      });
    }
  }
};

// Mock the twilio module in require cache before it's used
const Module = require('module');
try {
  const twilioPath = require.resolve('twilio');
  delete require.cache[twilioPath];
  require.cache[twilioPath] = {
    id: twilioPath,
    exports: function(accountSid, authToken) {
      return mockTwilioClient;
    }
  };
} catch (e) {
  // Twilio might not be installed, that's okay
}

module.exports = {
  restoreConsole: function() {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.info = originalConsoleInfo;
  }
};

