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

  // jsdom's Blob has no stream(), which browsers have and the unzip reads entries with.
  if (!('stream' in Blob.prototype)) {
    Object.defineProperty(Blob.prototype, 'stream', {
      value() {
        const blob = this;
        return new ReadableStream({
          async start(controller) {
            controller.enqueue(new Uint8Array(await blob.arrayBuffer()));
            controller.close();
          },
        });
      },
    });
  }

  const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
  const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const fixture = name => readFileSync(path.join(__dirname, '../gallery/metadata/embed/__fixtures__', name));
  const original = () => new File([fixture('photo.jpg')], 'PXL_original.jpg', { type: 'image/jpeg' });
  const stripped = () => new File([fixture('blank-gps.jpg')], 'PXL_stripped.jpg', { type: 'image/jpeg' });
  const photosZip = () => new File([readFileSync(path.join(__dirname, '__fixtures__/photos.zip'))], 'photos.zip', { type: 'application/zip' });

  let userAgent;
  let model;
  let div;
  let root;

  async function mount(agent) {
    userAgent.mockReturnValue(agent);
    div = document.createElement('div');
    document.body.appendChild(div);
    root = createRoot(div);
    await act(async () => root.render(<Uploader model={model} emitter={model.emitter} classes={{}} />));
    await act(async () => model.emitter.emit('readyToUpload'));
  }

  beforeEach(async () => {
    delete window.location;
    window.location = { search: '?room=test123' };
    userAgent = vi.spyOn(window.navigator, 'userAgent', 'get');
    model = { emitter: new EventEmitter(), seed: vi.fn() };
    await mount(ANDROID);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    div.remove();
    userAgent.mockRestore();
  });

  const input = () => div.querySelector('input[type="file"]');
  const choose = files => act(async () => {
    Object.defineProperty(input(), 'files', { value: files, configurable: true });
    input().dispatchEvent(new Event('change', { bubbles: true }));
  });
  const dialogButton = label => Array.from(document.body.querySelectorAll('button')).find(item => item.textContent === label);
  const heldList = () => document.body.querySelector('[data-testid="location-held"]');

  it('uses the regular file input, where Material Files is offered, and accepts zips', async () => {
    expect(input().getAttribute('accept')).toBe('image/*,video/*,audio/*,.zip,application/zip');
    const photo = original();
    await choose([photo]);
    await vi.waitFor(() => expect(model.seed).toHaveBeenCalled());
    expect(model.seed.mock.calls[0][0]).toEqual([photo]);
  });

  it('holds back files whose location Android removed, shares the rest, and says how to keep it', async () => {
    const good = original();
    await choose([good, stripped()]);

    await vi.waitFor(() => expect(heldList()).not.toBeNull());
    expect(model.seed).toHaveBeenCalledTimes(1);
    expect(model.seed.mock.calls[0][0]).toEqual([good]);
    expect(heldList().textContent).toContain('PXL_stripped.jpg');
    expect(document.body.textContent).toContain('choose Material Files');
    expect(document.body.textContent).toContain('share the zip');
  });

  it('opens the file input again from the dialog', async () => {
    await choose([stripped()]);
    await vi.waitFor(() => expect(dialogButton('Pick again')).toBeTruthy());
    const click = vi.fn();
    input().addEventListener('click', click);

    await act(async () => dialogButton('Pick again').click());

    expect(click).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(heldList()).toBeNull());
    expect(model.seed).not.toHaveBeenCalled();
  });

  it('shares held files without location when asked to', async () => {
    const bad = stripped();
    await choose([bad]);
    await vi.waitFor(() => expect(dialogButton('Share without location')).toBeTruthy());

    await act(async () => dialogButton('Share without location').click());

    expect(model.seed).toHaveBeenCalledTimes(1);
    expect(model.seed.mock.calls[0][0]).toEqual([bad]);
  });

  it('shares the photos inside a zip, holding back any that were blanked before zipping', async () => {
    await choose([photosZip()]);

    await vi.waitFor(() => expect(model.seed).toHaveBeenCalled());
    const shared = model.seed.mock.calls[0][0];
    expect(shared.map(file => file.name)).toEqual(['PXL_photo.jpg', 'PXL_gps.heic', 'PXL_clip.mp4']);
    expect(new Uint8Array(await shared[0].arrayBuffer())).toEqual(new Uint8Array(fixture('photo.jpg')));
    await vi.waitFor(() => expect(heldList()).not.toBeNull());
    expect(heldList().textContent).toBe('Strand ü.jpg');
  });

  it('says when a zip has nothing to share', async () => {
    const errors = vi.fn();
    model.emitter.on('showError', errors);
    const broken = new File([new Uint8Array([1, 2, 3])], 'broken.zip', { type: 'application/zip' });
    await choose([broken, original()]);

    await vi.waitFor(() => expect(model.seed).toHaveBeenCalled());
    expect(errors).toHaveBeenCalledWith('Couldn’t open broken.zip: it isn’t a zip file.');
    expect(model.seed.mock.calls[0][0].map(file => file.name)).toEqual(['PXL_original.jpg']);
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
      await choose([good, bad]);
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
      await choose([good, stripped()]);
      await vi.waitFor(() => expect(dialogButton('Pick again')).toBeTruthy());

      const held = document.body.querySelector('[aria-labelledby="location-held-title"]');
      await act(async () => held.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await act(async () => dialogButton('Encrypt').click());

      await vi.waitFor(() => expect(model.seed).toHaveBeenCalled());
      expect(encryptFile.mock.calls[0][0]).toEqual([good]);
    });

    it('lets them go ahead when the picker is closed after Pick again', async () => {
      const good = original();
      await choose([good, stripped()]);
      await vi.waitFor(() => expect(dialogButton('Pick again')).toBeTruthy());
      await act(async () => dialogButton('Pick again').click());

      await act(async () => input().dispatchEvent(new Event('cancel')));
      await act(async () => dialogButton('Encrypt').click());

      await vi.waitFor(() => expect(model.seed).toHaveBeenCalled());
      expect(encryptFile.mock.calls[0][0]).toEqual([good]);
    });
  });

  it('leaves other platforms alone: no zips, no checks', async () => {
    await act(async () => root.unmount());
    div.remove();
    await mount(DESKTOP);
    expect(input().getAttribute('accept')).toBe('image/*,video/*,audio/*');

    const bad = stripped();
    const zip = photosZip();
    await choose([bad, zip]);
    expect(model.seed).toHaveBeenCalledTimes(1);
    expect(model.seed.mock.calls[0][0]).toEqual([bad, zip]);
  });
});
