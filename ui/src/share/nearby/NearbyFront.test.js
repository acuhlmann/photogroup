import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../theme';

vi.mock('./qrCodec', () => ({
    qrSymbol: vi.fn().mockResolvedValue({ data: new Uint8Array([0]), width: 1, height: 1 }),
    drawSymbol: vi.fn(),
    readQrBytes: vi.fn().mockResolvedValue(null),
    prepareReader: vi.fn().mockResolvedValue({}),
    prepareWriter: vi.fn().mockResolvedValue({}),
}));

const {
    default: NearbyFront,
    TRIGGER_LABEL,
    SEND_ONLY_LABEL,
    CHOOSER_TITLE,
    NO_NETWORK_TEXT,
    FILES_TOO_LARGE,
} = await import('./NearbyFront');
const { SEND_MANY_TITLE } = await import('./LightSendMany');
const { RECEIVE_TITLE } = await import('./LightReceive');
const { MAX_LIGHT_BYTES } = await import('./lightFrames');

function createMockMaster() {
    const listeners = {};
    return {
        emitter: {
            on: vi.fn((event, fn) => {
                (listeners[event] ||= []).push(fn);
            }),
            emit: vi.fn((event, ...args) => {
                (listeners[event] || []).forEach(fn => fn(...args));
            }),
            removeListener: vi.fn((event, fn) => {
                if (listeners[event]) listeners[event] = listeners[event].filter(item => item !== fn);
            }),
        },
    };
}

function setMediaDevices(value) {
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        writable: true,
        value,
    });
}

async function renderNearby(master, mode = 'light') {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
        root.render(
            <ThemeProvider theme={createAppTheme(mode)}>
                <NearbyFront master={master} />
            </ThemeProvider>
        );
    });
    return { div, root };
}

const findButton = label => Array.from(document.body.querySelectorAll('button'))
    .find(button => button.textContent?.trim() === label);

describe('NearbyFront', () => {
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

    beforeEach(() => {
        setMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(new Error('no camera in test')) });
    });

    afterEach(() => {
        if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
        else delete navigator.mediaDevices;
        document.body.innerHTML = '';
    });

    it('shows one quiet trigger line initially and hides the Send/Get buttons until opened', async () => {
        const { div, root } = await renderNearby(createMockMaster());
        expect(findButton(TRIGGER_LABEL)).toBeTruthy();
        expect(findButton(SEND_MANY_TITLE)).toBeFalsy();
        expect(findButton(RECEIVE_TITLE)).toBeFalsy();
        expect(div.textContent).not.toContain(NO_NETWORK_TEXT);
        await act(async () => root.unmount());
    });

    it('opens a chooser with Send and Get options and launches Send on file pick', async () => {
        const master = createMockMaster();
        const { div, root } = await renderNearby(master);

        await act(async () => findButton(TRIGGER_LABEL).click());
        const dialog = document.body.querySelector('[role="dialog"]');
        expect(dialog).toBeTruthy();
        expect(dialog.textContent).toContain(CHOOSER_TITLE);
        expect(dialog.textContent).toContain(NO_NETWORK_TEXT);
        expect(findButton(SEND_MANY_TITLE)).toBeTruthy();
        expect(findButton(RECEIVE_TITLE)).toBeTruthy();

        const fileInput = div.querySelector('[data-testid="nearby-files"]');
        const inputClick = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
        await act(async () => findButton(SEND_MANY_TITLE).click());
        expect(inputClick).toHaveBeenCalledTimes(1);
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();

        const photo = new File([new Uint8Array([1, 2, 3])], 'pic.jpg', { type: 'image/jpeg' });
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [photo] });
        await act(async () => {
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(document.body.querySelector('#light-many-title')?.textContent).toBe(SEND_MANY_TITLE);

        await act(async () => root.unmount());
    });

    it('launches Get photos by camera from the chooser', async () => {
        const master = createMockMaster();
        const { root } = await renderNearby(master);

        await act(async () => findButton(TRIGGER_LABEL).click());
        await act(async () => findButton(RECEIVE_TITLE).click());

        expect(document.body.querySelector('#light-receive-title')?.textContent).toBe(RECEIVE_TITLE);
        expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();

        await act(async () => root.unmount());
    });

    it('emits an error if selected files exceed the camera size limit', async () => {
        const master = createMockMaster();
        const { div, root } = await renderNearby(master);

        const fileInput = div.querySelector('[data-testid="nearby-files"]');
        const big = { name: 'huge.mp4', type: 'video/mp4', size: MAX_LIGHT_BYTES + 1 };
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [big] });
        await act(async () => {
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(master.emitter.emit).toHaveBeenCalledWith('showError', FILES_TOO_LARGE);
        expect(document.body.querySelector('#light-many-title')).toBeNull();

        await act(async () => root.unmount());
    });

    it('offers send-only directly when camera capture is unavailable', async () => {
        setMediaDevices(undefined);
        const { div, root } = await renderNearby(createMockMaster(), 'dark');

        const trigger = findButton(SEND_ONLY_LABEL);
        expect(trigger).toBeTruthy();
        expect(findButton(TRIGGER_LABEL)).toBeFalsy();

        const fileInput = div.querySelector('[data-testid="nearby-files"]');
        const inputClick = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
        await act(async () => trigger.click());
        expect(inputClick).toHaveBeenCalledTimes(1);
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();

        await act(async () => root.unmount());
    });
});
