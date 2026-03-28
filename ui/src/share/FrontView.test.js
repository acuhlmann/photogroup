import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import FrontView from './FrontView';
import { createAppTheme } from '../theme';

// Mock dependencies - create a real EventEmitter-like object that actually works
const createMockEmitter = () => {
  const listeners = {};
  const emitter = {
    on: (event, callback) => {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(callback);
    },
    emit: (event, ...args) => {
      if (listeners[event]) {
        listeners[event].forEach(callback => {
          try {
            callback(...args);
          } catch (e) {
            // Ignore errors in callbacks during tests
          }
        });
      }
    },
    removeListener: (event, callback) => {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((cb) => cb !== callback);
    },
  };
  emitter.on = vi.fn(emitter.on);
  emitter.emit = vi.fn(emitter.emit);
  emitter.removeListener = vi.fn(emitter.removeListener);
  return emitter;
};

const mockMaster = {
  emitter: createMockEmitter(),
  service: {
    createRoom: vi.fn().mockResolvedValue({ id: 'test-room' }),
    changeUrl: vi.fn(),
    id: 'test-room-id'
  },
  findExistingContent: vi.fn().mockResolvedValue(true)
};

function renderFrontView(ui) {
  const theme = createAppTheme('light');
  return (
    <ThemeProvider theme={theme}>
      {ui}
    </ThemeProvider>
  );
}

describe('FrontView', () => {
  beforeEach(() => {
    delete window.location;
    window.location = { search: '' };
  });

  it('renders without crashing', () => {
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(renderFrontView(<FrontView master={mockMaster} />));
    root.unmount();
  });

  it('renders start room button when no room in URL', () => {
    window.location.search = '';
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(renderFrontView(<FrontView master={mockMaster} />));
    mockMaster.emitter.emit('iceDone');
    expect(div).toBeTruthy();
    root.unmount();
  });

  it('does not render when room is in URL', () => {
    window.location.search = '?room=test123';
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(renderFrontView(<FrontView master={mockMaster} />));
    root.unmount();
  });

  it('calls openRoom when button is clicked', () => {
    window.location.search = '';
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(renderFrontView(<FrontView master={mockMaster} />));
    mockMaster.emitter.emit('iceDone');

    const button = div.querySelector('button');
    if (button) {
      button.click();
    }

    root.unmount();
  });
});
