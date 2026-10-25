import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
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
});
