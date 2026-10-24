import { describe, it, expect, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import RoomPhotos from '../RoomPhotos';
import ServerPinning, { HELPER_DELAY_MS, RETRY_DELAYS_MS } from '../ServerPinning';
import { MAX_PHOTO_BYTES } from '../ServerCopyLimits';

function setup({ peers = [{ peerId: 'me' }, { peerId: 'friend' }], me = 'me', bytes = {}, now = () => 0 } = {}) {
    const emitter = new EventEmitter();
    const roomPhotos = new RoomPhotos(emitter, { now });
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
const clip = new Blob(['mp4'], { type: 'video/mp4' });

describe('ServerPinning', () => {
    it('leaves nothing on the server just for sharing a photo', async () => {
        const { pinning, service, emit } = setup();
        emit({ type: 'all', item: [photo('a', 'me')] });
        pinning.shared([{ infoHash: 'a', blob }]);
        expect(service.uploadServerCopy).not.toHaveBeenCalled();
    });

    it('leaves a copy of a clip even when the room keeps nothing', async () => {
        // The device that shared a video is often its only holder, and a
        // browser short on space frees video pieces first.
        const { pinning, service, emit, settle } = setup();
        emit({ type: 'all', item: [photo('v', 'me')] });
        pinning.shared([{ infoHash: 'v', blob: clip }]);
        await settle();
        expect(service.uploadServerCopy).toHaveBeenCalledWith('v', clip);
    });

    it('still declines a clip too large for the relay', async () => {
        const huge = { type: 'video/mp4', size: MAX_PHOTO_BYTES + 1 };
        const { pinning, service, emit, settle } = setup();
        emit({ type: 'all', item: [photo('v', 'me')] });
        pinning.shared([{ infoHash: 'v', blob: huge }]);
        await settle();
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

    it('takes over from an uploader whose phone froze mid-upload', async () => {
        let clock = 0;
        const { service, emit, timers, settle } = setup({
            bytes: { a: blob }, now: () => clock,
            peers: [{ peerId: 'me' }, { peerId: 'friend' }, { peerId: 'asker' }]
        });
        emit({ type: 'all', item: [photo('a', 'friend', [{ peerId: 'me', loading: false }])] });
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyUploader: 'friend', serverCopyReceived: 10 }] });
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyRequestedAt: 1 }] });
        timers[0].fn();
        await settle();
        expect(service.uploadServerCopy).not.toHaveBeenCalled(); // friend is still sending

        clock = 61000; // nothing from friend for longer than the lease
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyRequestedAt: 2 }] }); // asked again
        timers[1].fn();
        await settle();
        expect(service.uploadServerCopy).toHaveBeenCalledWith('a', blob);
    });

    it('on the way into the background, takes over a stalled upload too', async () => {
        let clock = 0;
        const { pinning, service, emit, settle } = setup({ bytes: { a: blob }, now: () => clock });
        emit({ type: 'all', item: [photo('a', 'me')] });
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyUploader: 'other', serverCopyReceived: 10 }] });
        expect(pinning.onHide()).toBe(0);
        clock = 61000;
        expect(pinning.onHide()).toBe(1);
        await settle();
        expect(service.uploadServerCopy).toHaveBeenCalledTimes(1);
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

    describe('until the copy lands', () => {
        const interrupted = { status: 'interrupted', received: 10 };

        it('keeps trying while in front, waiting longer each time', async () => {
            const { pinning, service, emit, emitter, timers, settle } = setup();
            emitter.emit('roomSettings', { keepCopies: true });
            emit({ type: 'all', item: [photo('a', 'me')] });
            service.uploadServerCopy
                .mockResolvedValueOnce(interrupted)
                .mockResolvedValueOnce(interrupted)
                .mockResolvedValueOnce({ status: 'stored' });
            pinning.shared([{ infoHash: 'a', blob }]);
            await settle();
            expect(timers.map(t => t.ms)).toEqual([RETRY_DELAYS_MS[0]]);
            timers[0].fn();
            await settle();
            expect(timers.map(t => t.ms)).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]]);
            timers[1].fn();
            await settle();
            expect(service.uploadServerCopy).toHaveBeenCalledTimes(3);
            expect(timers).toHaveLength(2);
        });

        it('stops retrying once someone else\'s copy landed', async () => {
            const { pinning, service, emit, emitter, timers, settle } = setup();
            emitter.emit('roomSettings', { keepCopies: true });
            emit({ type: 'all', item: [photo('a', 'me')] });
            service.uploadServerCopy.mockResolvedValueOnce(interrupted);
            pinning.shared([{ infoHash: 'a', blob }]);
            await settle();
            emit({ type: 'update', item: [{ infoHash: 'a', hasServerCopy: true }] });
            timers[0].fn();
            await settle();
            expect(service.uploadServerCopy).toHaveBeenCalledTimes(1);
        });

        it('waits for the page to come back when the retry falls due in the background', async () => {
            const { pinning, service, emit, emitter, timers, settle } = setup();
            emitter.emit('roomSettings', { keepCopies: true });
            emit({ type: 'all', item: [photo('a', 'me')] });
            service.uploadServerCopy.mockResolvedValueOnce(interrupted);
            pinning.shared([{ infoHash: 'a', blob }]);
            await settle();
            pinning.hidden = true; // as onHide leaves it
            timers[0].fn();
            await settle();
            expect(service.uploadServerCopy).toHaveBeenCalledTimes(1);
            await pinning.onResume();
            expect(service.uploadServerCopy).toHaveBeenCalledTimes(2);
        });

        it('tells this device while copies are on their way, and when it is safe to lock', async () => {
            const { pinning, service, emit, emitter, timers, settle } = setup();
            const reports = [];
            emitter.on('serverCopyBackup', report => reports.push(report));
            emitter.emit('roomSettings', { keepCopies: true });
            emit({ type: 'all', item: [photo('a', 'me'), photo('b', 'me')] });
            service.uploadServerCopy.mockResolvedValueOnce(interrupted);
            pinning.shared([{ infoHash: 'a', blob }, { infoHash: 'b', blob }]);
            await settle();
            expect(reports.at(-1)).toEqual({ pending: 1, landed: 1, safe: false });
            timers[0].fn();
            await settle();
            expect(reports.at(-1)).toEqual({ pending: 0, landed: 2, safe: true });

            // A copy refused for good is not a backup, even next to one that landed.
            emit({ type: 'all', item: [photo('c', 'me'), photo('d', 'me')] });
            service.uploadServerCopy.mockResolvedValueOnce({ status: 'refused', code: 413 });
            pinning.shared([{ infoHash: 'c', blob }, { infoHash: 'd', blob }]);
            await settle();
            await settle();
            expect(reports.at(-1)).toEqual({ pending: 0, landed: 1, safe: false });
        });

        it('stays on it while someone else is sending the copy, and counts their copy as landed', async () => {
            const { pinning, service, emit, emitter, timers, settle } = setup();
            const reports = [];
            emitter.on('serverCopyBackup', report => reports.push(report));
            emitter.emit('roomSettings', { keepCopies: true });
            emit({ type: 'all', item: [photo('a', 'me')] });
            service.uploadServerCopy.mockResolvedValueOnce({ status: 'busy' });
            pinning.shared([{ infoHash: 'a', blob }]);
            await settle();
            expect(reports.at(-1)).toMatchObject({ pending: 1 });
            expect(timers).toHaveLength(1);

            emit({ type: 'update', item: [{ infoHash: 'a', hasServerCopy: true }] });
            expect(reports.at(-1)).toEqual({ pending: 0, landed: 1, safe: true });
            timers[0].fn();
            await settle();
            expect(service.uploadServerCopy).toHaveBeenCalledTimes(1);
        });
    });
});
