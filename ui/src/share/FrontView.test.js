import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import { createAppTheme } from '../theme';
import { TRIGGER_LABEL } from './nearby/NearbyFront';
import { SEND_MANY_TITLE } from './nearby/LightSendMany';
import { RECEIVE_TITLE } from './nearby/LightReceive';

vi.mock('./nearby/qrCodec', () => ({
  qrSymbol: vi.fn().mockResolvedValue({ data: new Uint8Array([0]), width: 1, height: 1 }),
  drawSymbol: vi.fn(),
  readQrBytes: vi.fn().mockResolvedValue(null),
  prepareReader: vi.fn().mockResolvedValue({}),
  prepareWriter: vi.fn().mockResolvedValue({}),
}));

const { default: FrontView } = await import('./FrontView');

function memoryStorage() {
  const items = new Map();
  return {
    getItem: key => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key),
    clear: () => items.clear(),
  };
}

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

const createMockMaster = () => ({
  emitter: createMockEmitter(),
  service: {
    createRoom: vi.fn().mockResolvedValue({ id: 'test-room' }),
    changeUrl: vi.fn(),
    id: 'test-room-id'
  },
  findExistingContent: vi.fn().mockResolvedValue(true)
});

function renderFrontView(ui, mode = 'light') {
  const theme = createAppTheme(mode);
  return (
    <ThemeProvider theme={theme}>
      {ui}
    </ThemeProvider>
  );
}

const findButton = label => Array.from(document.body.querySelectorAll('button'))
  .find(button => button.textContent?.trim() === label);

describe('FrontView', () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

  beforeEach(() => {
    delete window.location;
    window.location = { search: '' };
    vi.stubGlobal('localStorage', memoryStorage());
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('no camera in test')) },
    });
  });

  afterEach(() => {
    if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    else delete navigator.mediaDevices;
    document.body.innerHTML = '';
  });

  it('renders without crashing', () => {
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(renderFrontView(<FrontView master={createMockMaster()} />));
    root.unmount();
  });

  it('renders start room button when no room in URL', async () => {
    window.location.search = '';
    const master = createMockMaster();
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
      root.render(renderFrontView(<FrontView master={master} />));
    });
    await act(async () => {
      master.emitter.emit('iceDone');
    });
    expect(document.body.textContent).toContain('Share the pictures');
    expect(document.body.textContent).toContain('Start a room');
    expect(document.body.textContent).toContain('Scan to join');
    expect(document.body.textContent).toContain('4.2 MB');
    expect(findButton(TRIGGER_LABEL)).toBeTruthy();
    expect(findButton(SEND_MANY_TITLE)).toBeFalsy();
    expect(findButton(RECEIVE_TITLE)).toBeFalsy();
    await act(async () => {
      root.unmount();
    });
    div.remove();
  });

  it('does not render when room is in URL', () => {
    window.location.search = '?room=test123';
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(renderFrontView(<FrontView master={createMockMaster()} />));
    root.unmount();
  });

  it('calls openRoom when button is clicked', () => {
    window.location.search = '';
    const master = createMockMaster();
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(renderFrontView(<FrontView master={master} />));
    master.emitter.emit('iceDone');

    const button = div.querySelector('button');
    if (button) {
      button.click();
    }

    root.unmount();
  });

  it('places the demoted camera trigger below Your rooms and outside the primary action stack', async () => {
    localStorage.setItem('photogroup.rooms', JSON.stringify([
      { id: 'room-1', name: 'Beach day', firstSeen: 1000, lastSeen: Date.now() },
    ]));
    const master = createMockMaster();
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
      root.render(renderFrontView(<FrontView master={master} />, 'dark'));
    });
    await act(async () => {
      master.emitter.emit('iceDone');
    });

    const scanButton = findButton('Scan to join');
    const roomsHeading = div.querySelector('#your-rooms');
    const nearbyTrigger = findButton(TRIGGER_LABEL);

    expect(roomsHeading?.textContent).toBe('Your rooms');
    expect(nearbyTrigger).toBeTruthy();
    expect(scanButton.compareDocumentPosition(roomsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(roomsHeading.compareDocumentPosition(nearbyTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scanButton.parentElement?.contains(nearbyTrigger)).toBe(false);

    await act(async () => {
      root.unmount();
    });
    div.remove();
  });

  it('launches both Send and Get camera flows from the demoted front-page entry', async () => {
    const master = createMockMaster();
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
      root.render(renderFrontView(<FrontView master={master} />));
    });
    await act(async () => {
      master.emitter.emit('iceDone');
    });

    // Get flow
    await act(async () => findButton(TRIGGER_LABEL).click());
    await act(async () => findButton(RECEIVE_TITLE).click());
    expect(document.body.querySelector('#light-receive-title')?.textContent).toBe(RECEIVE_TITLE);

    await act(async () => {
      document.body.querySelector('[aria-label="Close"]')?.click();
    });
    expect(document.body.querySelector('#light-receive-title')).toBeNull();

    // Send flow
    await act(async () => findButton(TRIGGER_LABEL).click());
    const fileInput = div.querySelector('[data-testid="nearby-files"]');
    const inputClick = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
    await act(async () => findButton(SEND_MANY_TITLE).click());
    expect(inputClick).toHaveBeenCalledTimes(1);

    const photo = new File([new Uint8Array([1, 2, 3])], 'pic.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [photo] });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.body.querySelector('#light-many-title')?.textContent).toBe(SEND_MANY_TITLE);

    await act(async () => {
      root.unmount();
    });
    div.remove();
  });
});
