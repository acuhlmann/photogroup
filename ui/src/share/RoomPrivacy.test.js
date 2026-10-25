import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { EventEmitter } from 'events';
import RoomPrivacy, { privacyLines } from './RoomPrivacy';

const button = text => Array.from(document.body.querySelectorAll('button')).find(item => item.textContent === text);

describe('RoomPrivacy', () => {
    it('says what the server keeps, and for how long', () => {
        const lines = privacyLines({ copies: 2 });
        expect(lines[0]).toBe('Photos usually go directly from phone to phone.');
        expect(lines.join(' ')).toContain('when nobody uses it for 30 days');
        expect(lines.join(' ')).toContain('for clips');
        expect(lines.join(' ')).toContain('when all people have the photo, or after 24 hours');
        expect(lines.at(-1)).toBe('The server has 2 server copies for this room now.');
        expect(privacyLines({ keepCopies: true }).join(' ')).toContain('keeps a server copy of each photo for 24 hours');
    });

    it('says what a private room hides from the server', () => {
        const text = privacyLines({ isPrivate: true }).join(' ');
        expect(text).toContain('This room is private.');
        expect(text).toContain('cannot read them');
        expect(text).not.toContain('fingerprint');
    });

    it('deletes the room for everyone after asking once', async () => {
        const master = {
            client: { peerId: 'me' },
            service: { deleteRoom: vi.fn().mockResolvedValue({ deleted: 'r1' }) },
            roomPhotos: { all: () => [{ infoHash: 'h', hasServerCopy: true }] },
            roomDeleted: vi.fn(),
        };
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        const onClose = vi.fn();
        await act(async () => root.render(<RoomPrivacy master={master} open onClose={onClose} />));
        expect(document.body.querySelector('[data-testid="privacy-lines"]').textContent).toContain('1 server copy');

        await act(async () => button('Delete this room now').click());
        expect(document.body.querySelector('[data-testid="delete-room-warning"]').textContent).toContain('The photos stay on the phones');
        expect(master.service.deleteRoom).not.toHaveBeenCalled();
        await act(async () => button('Delete room').click());
        expect(master.service.deleteRoom).toHaveBeenCalledTimes(1);
        expect(master.roomDeleted).toHaveBeenCalledWith({ peerId: 'me' });
        await act(async () => root.unmount());
        div.remove();
    });

    it('changes "Keep copies" for the whole room', async () => {
        const emitter = new EventEmitter();
        const updateRoomSettings = vi.fn().mockResolvedValue({ keepCopies: true });
        const master = { emitter, client: { peerId: 'me' }, service: { updateRoomSettings }, roomPhotos: { all: () => [] } };
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(<RoomPrivacy master={master} open onClose={vi.fn()} />));

        const toggle = () => [...document.body.querySelectorAll('label')]
            .find(label => label.textContent === 'Keep copies for people who join later')
            .querySelector('input');
        expect(toggle().checked).toBe(false);

        await act(async () => emitter.emit('roomSettings', { keepCopies: true }));
        expect(toggle().checked).toBe(true);
        expect(document.body.querySelector('[data-testid="privacy-lines"]').textContent).toContain('keeps a server copy of each photo');

        updateRoomSettings.mockResolvedValueOnce({ keepCopies: false });
        await act(async () => toggle().click());
        expect(updateRoomSettings).toHaveBeenCalledWith({ keepCopies: false });
        expect(toggle().checked).toBe(false);

        updateRoomSettings.mockRejectedValueOnce(new Error('offline'));
        await act(async () => toggle().click());
        expect(toggle().checked).toBe(false);
        expect(document.body.querySelector('[role="alert"]').textContent).toBe('Could not change the room. Try again.');

        await act(async () => root.unmount());
        div.remove();
    });
});
