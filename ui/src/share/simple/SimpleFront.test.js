import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../theme';
import { TRIGGER_LABEL } from '../nearby/NearbyFront';
import { SEND_MANY_TITLE } from '../nearby/LightSendMany';
import { RECEIVE_TITLE } from '../nearby/LightReceive';

vi.mock('../nearby/qrCodec', () => ({
    qrSymbol: vi.fn().mockResolvedValue({ data: new Uint8Array([0]), width: 1, height: 1 }),
    drawSymbol: vi.fn(),
    readQrBytes: vi.fn().mockResolvedValue(null),
    prepareReader: vi.fn().mockResolvedValue({}),
    prepareWriter: vi.fn().mockResolvedValue({}),
}));

const { default: SimpleFront } = await import('./SimpleFront');

function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
        clear: () => items.clear(),
    };
}

function createMockMaster() {
    const listeners = {};
    return {
        me: 'peer-1',
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
        service: {
            createRoom: vi.fn().mockResolvedValue({ id: 'simple-room' }),
            changeUrl: vi.fn(),
        },
        findExistingContent: vi.fn().mockResolvedValue(true),
    };
}

async function renderSimpleFront(master, mode = 'light') {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
        root.render(
            <ThemeProvider theme={createAppTheme(mode)}>
                <SimpleFront master={master} />
            </ThemeProvider>
        );
    });
    return { div, root };
}

const findButton = label => Array.from(document.body.querySelectorAll('button'))
    .find(button => button.textContent?.trim() === label);

describe('SimpleFront', () => {
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

    beforeEach(() => {
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

    it('renders primary actions and keeps camera options tucked behind one quiet button', async () => {
        const { div, root } = await renderSimpleFront(createMockMaster());
        expect(findButton('Start a room')).toBeTruthy();
        expect(findButton('Scan to join')).toBeTruthy();
        expect(findButton(TRIGGER_LABEL)).toBeTruthy();
        expect(findButton(SEND_MANY_TITLE)).toBeFalsy();
        expect(findButton(RECEIVE_TITLE)).toBeFalsy();
        expect(div.textContent).toContain('One person starts a room.');
        await act(async () => root.unmount());
    });

    it('places the demoted camera trigger below Your rooms and above the steps', async () => {
        localStorage.setItem('photogroup.rooms', JSON.stringify([
            { id: 'room-1', name: 'Dinner', firstSeen: 1000, lastSeen: Date.now() },
        ]));
        const { div, root } = await renderSimpleFront(createMockMaster(), 'dark');

        const scanButton = findButton('Scan to join');
        const roomsHeading = div.querySelector('#your-rooms');
        const nearbyTrigger = findButton(TRIGGER_LABEL);
        const stepsList = div.querySelector('ol');

        expect(roomsHeading?.textContent).toBe('Your rooms');
        expect(nearbyTrigger).toBeTruthy();
        expect(scanButton.compareDocumentPosition(roomsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(roomsHeading.compareDocumentPosition(nearbyTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(nearbyTrigger.compareDocumentPosition(stepsList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(scanButton.parentElement?.contains(nearbyTrigger)).toBe(false);

        await act(async () => root.unmount());
    });

    it('launches both Send and Get camera flows from the demoted SimpleFront entry', async () => {
        const { div, root } = await renderSimpleFront(createMockMaster());

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

        await act(async () => root.unmount());
    });
});
