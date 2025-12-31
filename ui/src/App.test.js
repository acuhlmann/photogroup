import React from 'react';
import ReactDOM from 'react-dom';
import { createMuiTheme } from '@material-ui/core/styles';
import App from './App';

// Mock dependencies
jest.mock('./share/torrent/TorrentMaster', () => {
  class MockTorrentMaster {
    constructor(roomsService, emitter) {
      // Ensure service is always a proper object
      // Use the passed roomsService if it exists, otherwise create a mock
      const service = roomsService || {
        master: null,
        createRoom: jest.fn(),
        changeUrl: jest.fn(),
        id: 'test-room-id'
      };
      
      // Ensure master property exists and is writable
      if (!service.hasOwnProperty('master')) {
        service.master = null;
      }
      
      this.service = service;
      this.emitter = emitter || {
        on: jest.fn(),
        emit: jest.fn()
      };
      this.torrentAddition = {
        emitter: {
          on: jest.fn()
        }
      };
      this.findExistingContent = jest.fn();
      this.reload = jest.fn();
      this.restartTrackers = jest.fn();
      this.client = {
        peerId: 'test-peer-id'
      };
    }
  }
  
  return MockTorrentMaster;
});

jest.mock('visibilityjs', () => ({
  isSupported: jest.fn(() => true),
  change: jest.fn()
}));

// Mock audiomotion-analyzer - it's an ES module that Jest can't parse
// Mock is now in setupTests.js

jest.mock('online-js', () => ({
  __esModule: true,
  default: jest.fn()
}));

jest.mock('webtorrent', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    remove: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn(),
    off: jest.fn()
  }))
}));

describe('App', () => {
  const theme = createMuiTheme();

  it('renders without crashing', () => {
    const div = document.createElement('div');
    ReactDOM.render(<App prefersDarkMode={false} theme={theme} />, div);
    ReactDOM.unmountComponentAtNode(div);
  });

  it('renders PhotoGroup header', () => {
    const div = document.createElement('div');
    ReactDOM.render(<App prefersDarkMode={false} theme={theme} />, div);
    expect(div.textContent).toContain('PhotoGroup');
    ReactDOM.unmountComponentAtNode(div);
  });

  it('handles dark mode preference', () => {
    const darkTheme = createMuiTheme({ palette: { type: 'dark' } });
    const div = document.createElement('div');
    ReactDOM.render(<App prefersDarkMode={true} theme={darkTheme} />, div);
    ReactDOM.unmountComponentAtNode(div);
  });
});
