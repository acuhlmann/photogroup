import React from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme } from '@mui/material/styles';
import { vi } from 'vitest';
import Uploader from './Uploader';
import WebCrypto from '../security/WebCrypto';

// Mock dependencies
const mockModel = {
  emitter: {
    on: vi.fn(),
    emit: vi.fn(),
    removeListener: vi.fn()
  },
  seed: vi.fn()
};

describe('Uploader', () => {
  const theme = createTheme();

  beforeEach(() => {
    delete window.location;
    window.location = { search: '' };
  });

  it('renders without crashing', () => {
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />
    );
    root.unmount();
  });

  it('renders upload button when room is in URL', () => {
    window.location.search = '?room=test123';
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />
    );
    // Uploader should render when room is present
    root.unmount();
  });

  it('does not render when no room and not ready', () => {
    window.location.search = '';
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />
    );
    // Uploader should not render when no room and not ready
    root.unmount();
  });

  it('handles file upload', () => {
    window.location.search = '?room=test123';
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />
    );
    
    // Simulate file input change
    const input = div.querySelector('input[type="file"]');
    if (input) {
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const event = { target: { files: [file] } };
      // Trigger handleUpload
    }
    
    root.unmount();
  });
});


describe('Uploader on Android', () => {
  const { readFileSync } = require('node:fs');
  const path = require('node:path');
  const { act } = require('react');
  const EventEmitter = require('events');

  const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
  const fixture = name => readFileSync(path.join(__dirname, '../gallery/metadata/embed/__fixtures__', name));
  const original = () => new File([fixture('photo.jpg')], 'PXL_original.jpg', { type: 'image/jpeg' });
  const stripped = () => new File([fixture('blank-gps.jpg')], 'PXL_stripped.jpg', { type: 'image/jpeg' });
  const picked = files => files.map(file => ({ getFile: () => Promise.resolve(file) }));

  let userAgent;
  let model;
  let div;
  let root;

  beforeEach(async () => {
    delete window.location;
    window.location = { search: '?room=test123' };
    userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ANDROID);
    window.showOpenFilePicker = vi.fn();
    model = { emitter: new EventEmitter(), seed: vi.fn() };
    div = document.createElement('div');
    document.body.appendChild(div);
    root = createRoot(div);
    await act(async () => root.render(<Uploader model={model} emitter={model.emitter} classes={{}} />));
    await act(async () => model.emitter.emit('readyToUpload'));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    div.remove();
    userAgent.mockRestore();
    delete window.showOpenFilePicker;
    watchers.forEach(listener => document.removeEventListener('click', listener));
    watchers = [];
  });

  const input = () => div.querySelector('input[type="file"]');
  // React handles clicks at its root, so whether the native picker was
  // cancelled is only settled once the click reaches the document.
  let watchers = [];
  const watchInputClicks = () => {
    const native = vi.fn();
    const listener = event => { if (event.target === input()) native(event.defaultPrevented); };
    document.addEventListener('click', listener);
    watchers.push(listener);
    return native;
  };
  const clickShare = () => act(async () => div.querySelector('label[for="contained-button-file"]').click());
  const dialogButton = label => Array.from(document.body.querySelectorAll('button')).find(item => item.textContent === label);

  it('opens the Files picker instead of the file input, and shares what was picked', async () => {
    const photo = original();
    window.showOpenFilePicker.mockResolvedValue(picked([photo]));
    const native = watchInputClicks();

    await clickShare();

    expect(window.showOpenFilePicker).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect(model.seed).toHaveBeenCalled());
    expect(model.seed.mock.calls[0][0]).toEqual([photo]);
  });

  it('holds back files whose location Android removed, and shares the rest', async () => {
    const good = original();
    const bad = stripped();
    window.showOpenFilePicker.mockResolvedValue(picked([good, bad]));

    await clickShare();

    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="location-held"]')).not.toBeNull());
    expect(model.seed).toHaveBeenCalledTimes(1);
    expect(model.seed.mock.calls[0][0]).toEqual([good]);
    expect(document.body.querySelector('[data-testid="location-held"]').textContent).toContain('PXL_stripped.jpg');
    expect(document.body.textContent).toContain('Pick it again in Files');
  });

  it('opens the Files picker again from the dialog', async () => {
    window.showOpenFilePicker.mockResolvedValueOnce(picked([stripped()]));
    await clickShare();
    await vi.waitFor(() => expect(dialogButton('Pick again')).toBeTruthy());
    expect(model.seed).not.toHaveBeenCalled();

    const photo = original();
    window.showOpenFilePicker.mockResolvedValueOnce(picked([photo]));
    await act(async () => dialogButton('Pick again').click());

    expect(window.showOpenFilePicker).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(model.seed).toHaveBeenCalled());
    expect(model.seed.mock.calls[0][0]).toEqual([photo]);
  });

  it('shares held files without location when asked to', async () => {
    const bad = stripped();
    window.showOpenFilePicker.mockResolvedValue(picked([bad]));
    await clickShare();
    await vi.waitFor(() => expect(dialogButton('Share without location')).toBeTruthy());

    await act(async () => dialogButton('Share without location').click());

    expect(model.seed).toHaveBeenCalledTimes(1);
    expect(model.seed.mock.calls[0][0]).toEqual([bad]);
  });

  it('shares nothing when the picker is closed', async () => {
    window.showOpenFilePicker.mockRejectedValue(Object.assign(new Error('closed'), { name: 'AbortError' }));
    await clickShare();
    await act(async () => {});
    expect(model.seed).not.toHaveBeenCalled();
  });

  it('offers the file input on a fresh tap when the Files picker fails', async () => {
    window.showOpenFilePicker.mockRejectedValue(Object.assign(new Error('blocked'), { name: 'SecurityError' }));
    const native = watchInputClicks();

    await clickShare();
    await vi.waitFor(() => expect(dialogButton('Choose files')).toBeTruthy());
    // The failed picker used up the tap, so nothing opens the input behind the person's back.
    expect(native.mock.calls.map(([prevented]) => prevented)).toEqual([true]);

    await act(async () => dialogButton('Choose files').click());
    expect(native.mock.calls.map(([prevented]) => prevented)).toEqual([true, false]);

    await clickShare();
    expect(window.showOpenFilePicker).toHaveBeenCalledTimes(1);
    expect(native.mock.calls.at(-1)[0]).toBe(false);
  });

  describe('with encryption on', () => {
    let encryptFile;

    beforeEach(async () => {
      encryptFile = vi.spyOn(WebCrypto.prototype, 'encryptFile').mockResolvedValue({ blob: new Blob(['ciphertext']) });
      await act(async () => model.emitter.emit('encrypt', true));
    });

    afterEach(() => encryptFile.mockRestore());

    it('asks for the password once, for the files that were fine and the ones shared without location', async () => {
      const good = original();
      const bad = stripped();
      window.showOpenFilePicker.mockResolvedValue(picked([good, bad]));
      await clickShare();
      await vi.waitFor(() => expect(dialogButton('Share without location')).toBeTruthy());

      await act(async () => dialogButton('Share without location').click());
      await act(async () => dialogButton('Encrypt').click());

      await vi.waitFor(() => expect(model.seed).toHaveBeenCalled());
      expect(encryptFile.mock.calls[0][0]).toEqual([good, bad]);
      expect(model.seed.mock.calls[0][1]).toBe(true);
      expect(model.seed.mock.calls[0][2]).toEqual([good, bad]);
    });

    it('lets the files that were fine go ahead when the dialog is closed', async () => {
      const good = original();
      window.showOpenFilePicker.mockResolvedValue(picked([good, stripped()]));
      await clickShare();
      await vi.waitFor(() => expect(dialogButton('Pick again')).toBeTruthy());

      const held = document.body.querySelector('[aria-labelledby="location-held-title"]');
      await act(async () => held.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await act(async () => dialogButton('Encrypt').click());

      await vi.waitFor(() => expect(model.seed).toHaveBeenCalled());
      expect(encryptFile.mock.calls[0][0]).toEqual([good]);
    });
  });

  it('checks files from the file input too, where there is no Files picker', async () => {
    delete window.showOpenFilePicker;
    const bad = stripped();
    await act(async () => {
      Object.defineProperty(input(), 'files', { value: [bad], configurable: true });
      input().dispatchEvent(new Event('change', { bubbles: true }));
    });

    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="location-held"]')).not.toBeNull());
    expect(model.seed).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('choose Files, not Photos or Gallery');
  });

  it('leaves other platforms on the file input, unchecked', async () => {
    userAgent.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    const bad = stripped();
    await clickShare();
    expect(window.showOpenFilePicker).not.toHaveBeenCalled();

    await act(async () => {
      Object.defineProperty(input(), 'files', { value: [bad], configurable: true });
      input().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(model.seed).toHaveBeenCalledTimes(1);
    expect(model.seed.mock.calls[0][0]).toEqual([bad]);
  });
});
