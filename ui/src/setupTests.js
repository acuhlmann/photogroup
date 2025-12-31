// Mock audiomotion-analyzer - it's an ES module that Jest can't parse
jest.mock('audiomotion-analyzer', () => {
  return {
    __esModule: true,
    default: class MockAudioMotionAnalyzer {
      constructor() {}
      connect() {}
      disconnect() {}
      setOptions() {}
    }
  };
}, { virtual: true });

// Mock window.matchMedia for jsdom
window.matchMedia = window.matchMedia || function(query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  };
};

