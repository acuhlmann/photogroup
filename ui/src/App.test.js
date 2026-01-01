import React from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import App from './App';

// Mock dependencies
vi.mock('./share/torrent/TorrentMaster', () => {
  class MockTorrentMaster {
    constructor(roomsService, emitter) {
      // Ensure service is always a proper object
      // Use the passed roomsService if it exists, otherwise create a mock
      const service = roomsService || {
        master: null,
        createRoom: vi.fn(),
        changeUrl: vi.fn(),
        id: 'test-room-id'
      };
      
      // Ensure master property exists and is writable
      if (!service.hasOwnProperty('master')) {
        service.master = null;
      }
      
      this.service = service;
      this.emitter = emitter || {
        on: vi.fn(),
        emit: vi.fn()
      };
      this.torrentAddition = {
        emitter: {
          on: vi.fn()
        }
      };
      this.findExistingContent = vi.fn();
      this.reload = vi.fn();
      this.restartTrackers = vi.fn();
      this.client = {
        peerId: 'test-peer-id'
      };
    }
  }
  
  return {
    default: MockTorrentMaster
  };
});

vi.mock('visibilityjs', () => ({
  isSupported: vi.fn(() => true),
  change: vi.fn()
}));

// Mock audiomotion-analyzer - it's an ES module that Vitest can't parse
// Mock is now in setupTests.js

vi.mock('online-js', () => ({
  __esModule: true,
  default: vi.fn()
}));

vi.mock('webtorrent', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    remove: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
    off: vi.fn()
  })),
  WEBRTC_SUPPORT: true
}));

vi.mock('notistack', async () => {
  const actual = await vi.importActual('notistack');
  return {
    ...actual,
    withSnackbar: (Component) => Component,
  };
});

vi.mock('./share/ShareCanvas', () => ({
  __esModule: true,
  default: () => React.createElement('div', null, 'ShareCanvas')
}));

describe('App', () => {
  const theme = createTheme();

  it('renders without crashing', () => {
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(<App prefersDarkMode={false} theme={theme} />);
    root.unmount();
  });

  it('renders PhotoGroup header', async () => {
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(<App prefersDarkMode={false} theme={theme} />);
    // Wait for next tick to allow rendering
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(div.textContent).toContain('PhotoGroup');
    root.unmount();
  });

  it('handles dark mode preference', () => {
    const darkTheme = createTheme({ palette: { mode: 'dark' } });
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(<App prefersDarkMode={true} theme={darkTheme} />);
    root.unmount();
  });
});
