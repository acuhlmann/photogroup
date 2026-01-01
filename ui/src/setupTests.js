import { vi } from 'vitest';

// Mock localStorage for jsdom
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.localStorage = localStorageMock;
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock audiomotion-analyzer - it's an ES module that Vitest can't parse
vi.mock('audiomotion-analyzer', () => {
  return {
    __esModule: true,
    default: class MockAudioMotionAnalyzer {
      constructor() {}
      connect() {}
      disconnect() {}
      setOptions() {}
    }
  };
});

// Mock window.matchMedia for jsdom
window.matchMedia = window.matchMedia || function(query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
};

