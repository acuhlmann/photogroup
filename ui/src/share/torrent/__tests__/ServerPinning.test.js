import { describe, it, expect, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import RoomPhotos from '../RoomPhotos';
import ServerPinning, { HELPER_DELAY_MS } from '../ServerPinning';
import { MAX_PHOTO_BYTES } from '../ServerCopyLimits';

function setup({ peers = [{ peerId: 'me' }, { peerId: 'friend' }], me = 'me', bytes = {} } = {}) {
    const emitter = new EventEmitter();
    const roomPhotos = new RoomPhotos(emitter);
    const service = { uploadServerCopy: vi.fn().mockResolvedValue({ status: 'stored' }) };
    const timers = [];
    const pinning = new ServerPinning({
        service, roomPhotos, emitter,
        getPeers: () => peers,
        getMyPeerId: () => me,
        findBytes: vi.fn(async infoHash => bytes[infoHash] || null),
        setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        random: () => 0,
    });
    const emit = event => emitter.emit('photos', event);
    const settle = () => pinning.running || Promise.resolve();
    return { emitter, roomPhotos, service, pinning, emit, timers, settle };
}

const photo = (infoHash, sharer, owners = []) => ({ infoHash, peerId: sharer, owners: [{ peerId: sharer, loading: false }, ...owners] });
const blob = new Blob(['jpg'], { type: 'image/jpeg' });

describe('ServerPinning', () => {
    it('leaves nothing on the server just for sharing', async () => {
        const { pinning, service, emit } = setup();
        emit({ type: 'all', item: [photo('a', 'me')] });
        pinning.shared([{ infoHash: 'a', blob }]);
        expect(service.uploadServerCopy).not.toHaveBeenCalled();
    });

    it('uploads right after sharing when the room keeps copies', async () => {
        const { pinning, service, emit, emitter, settle } = setup();
        emitter.emit('roomSettings', { keepCopies: true });
        emit({ type: 'all', item: [photo('a', 'me')] });
        pinning.shared([{ infoHash: 'a', blob }]);
        await settle();
        expect(service.uploadServerCopy).toHaveBeenCalledWith('a', blob);
    });

    it('answers a request for a photo it shared at once', async () => {
        const { pinning, service, emit, settle } = setup();
        emit({ type: 'all', item: [photo('a', 'me')] });
        pinning.shared([{ infoHash: 'a', blob }]);
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyRequestedAt: 1 }] });
        await settle();
        expect(service.uploadServerCopy).toHaveBeenCalledTimes(1);

        // Asked again later: it's there already, nothing more to send.
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyRequestedAt: 2 }] });
        await settle();
        expect(service.uploadServerCopy).toHaveBeenCalledTimes(1);
    });

    it('lets the sharer go first when it only downloaded the photo', async () => {
        const { service, emit, timers, settle } = setup({ bytes: { a: blob }, peers: [{ peerId: 'me' }, { peerId: 'friend' }, { peerId: 'asker' }] });
        emit({ type: 'all', item: [photo('a', 'friend', [{ peerId: 'me', loading: false }])] });
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyRequestedAt: 1 }] });
        expect(service.uploadServerCopy).not.toHaveBeenCalled();
        expect(timers[0].ms).toBe(HELPER_DELAY_MS);

        timers[0].fn();
        await settle();
        expect(service.uploadServerCopy).toHaveBeenCalledWith('a', blob);
    });

    it('stays out of it when someone else already started', async () => {
        const { service, emit, timers, settle } = setup({ bytes: { a: blob }, peers: [{ peerId: 'me' }, { peerId: 'friend' }, { peerId: 'asker' }] });
        emit({ type: 'all', item: [photo('a', 'friend', [{ peerId: 'me', loading: false }])] });
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyRequestedAt: 1 }] });
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyUploader: 'friend', serverCopyReceived: 10 }] });
        timers[0].fn();
        await settle();
        expect(service.uploadServerCopy).not.toHaveBeenCalled();
    });

    it('ignores an old request once everyone has the photo', async () => {
        const { service, emit, settle } = setup({ bytes: { a: blob } });
        emit({ type: 'all', item: [{ ...photo('a', 'me', [{ peerId: 'friend', loading: false }]), serverCopyRequestedAt: 1 }] });
        await settle();
        expect(service.uploadServerCopy).not.toHaveBeenCalled();
    });

    it('ignores requests for photos it does not have', async () => {
        const { service, emit, timers } = setup();
        emit({ type: 'all', item: [photo('a', 'friend', [{ peerId: 'me', loading: true }])] });
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyRequestedAt: 1 }] });
        expect(timers).toHaveLength(0);
        expect(service.uploadServerCopy).not.toHaveBeenCalled();
    });

    it('on the way into the background, copies only what someone in the room still lacks', async () => {
        const { pinning, service, emit, settle } = setup({
            peers: [{ peerId: 'me' }, { peerId: 'friend' }, { peerId: 'kim', away: 1 }],
            bytes: { a: blob, b: blob, c: blob }
        });
        emit({ type: 'all', item: [
            photo('a', 'me'), // nobody else has it
            photo('b', 'me', [{ peerId: 'friend', loading: false }, { peerId: 'kim', loading: false }]), // everyone has it
            photo('c', 'friend'), // not mine to give
            { ...photo('d', 'me'), hasServerCopy: true }, // copy exists
        ] });
        expect(pinning.onHide()).toBe(1);
        await settle();
        expect(service.uploadServerCopy).toHaveBeenCalledTimes(1);
        expect(service.uploadServerCopy).toHaveBeenCalledWith('a', blob);
    });

    it('does nothing in the background when alone in the room', () => {
        const { pinning, emit } = setup({ peers: [{ peerId: 'me' }] });
        emit({ type: 'all', item: [photo('a', 'me')] });
        expect(pinning.onHide()).toBe(0);
    });

    it('carries on with an upload a freeze cut off once back', async () => {
        const { pinning, service, emit, settle } = setup({ bytes: { a: blob } });
        service.uploadServerCopy.mockResolvedValueOnce({ status: 'interrupted', received: 10 });
        emit({ type: 'all', item: [photo('a', 'me')] });
        pinning.onHide();
        await settle();
        expect(service.uploadServerCopy).toHaveBeenCalledTimes(1);
        await pinning.onResume();
        expect(service.uploadServerCopy).toHaveBeenCalledTimes(2);
        await pinning.onResume();
        expect(service.uploadServerCopy).toHaveBeenCalledTimes(2);
    });

    it('skips files over the server limit', async () => {
        const big = { size: MAX_PHOTO_BYTES + 1, type: 'video/mp4' };
        const { pinning, service, emit, settle } = setup({ bytes: { a: big } });
        emit({ type: 'all', item: [photo('a', 'me')] });
        pinning.onHide();
        await settle();
        expect(service.uploadServerCopy).not.toHaveBeenCalled();
    });

    it('can pin again after a copy was dropped', async () => {
        const { pinning, service, emit, settle } = setup({ bytes: { a: blob } });
        emit({ type: 'all', item: [photo('a', 'me')] });
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyRequestedAt: 1 }] });
        await settle();
        emit({ type: 'update', item: [{ infoHash: 'a', hasServerCopy: false }] });
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyRequestedAt: 2 }] });
        await settle();
        expect(service.uploadServerCopy).toHaveBeenCalledTimes(2);
        expect(pinning.queued.size).toBe(0);
    });
});
