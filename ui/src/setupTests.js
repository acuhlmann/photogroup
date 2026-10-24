import { vi } from 'vitest';

// Mock localStorage for jsdom. jsdom 30 exposes it as a getter-only Window property.
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
vi.stubGlobal('localStorage', localStorageMock);

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

// jsdom can't decode video, so a poster frame grab would only wait out its
// timeout. Give up at once instead.
vi.mock('./share/util/videoFrame', () => {
  const captureFrame = vi.fn(async () => null);
  const posterFromFile = vi.fn(async () => null);
  return { captureFrame, posterFromFile, default: { captureFrame, posterFromFile } };
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

