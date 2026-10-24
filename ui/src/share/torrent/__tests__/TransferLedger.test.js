import { describe, it, expect } from 'vitest';
import EventEmitter from 'eventemitter3';
import TransferLedger from '../TransferLedger';

const setup = () => {
    const emitter = new EventEmitter();
    const clock = { value: 1000 };
    const ledger = new TransferLedger({ emitter, now: () => clock.value });
    return { emitter, clock, ledger };
};

const fakeTorrent = () => {
    const torrent = new EventEmitter();
    Object.assign(torrent, { infoHash: 'abc', name: 'beach.jpg', pieces: new Array(4).fill(0), pieceLength: 16384 });
    return torrent;
};

describe('TransferLedger', () => {
    it('records the P2P stages a torrent goes through, in order and timed', () => {
        const { emitter, clock, ledger } = setup();
        const torrent = fakeTorrent();
        emitter.emit('newTorrent', torrent);
        clock.value += 800;
        torrent.emit('wire', { peerId: 'peer-one-id', type: 'webrtc' });
        torrent.emit('wire', { peerId: 'peer-one-id', type: 'webrtc' });
        torrent.emit('metadata');
        clock.value += 200;
        emitter.emit('pieceReceived', { torrent, peerId: 'peer-one-id', index: 0, total: 4, size: 16384 });
        emitter.emit('pieceReceived', { torrent, peerId: 'peer-one-id', index: 1, total: 4, size: 16384 });
        torrent.emit('done');

        const item = ledger.get('abc');
        expect(item.stages.map(stage => stage.stage)).toEqual(['signal', 'handshake', 'metadata', 'pieces', 'verify']);
        expect(item.stages[1]).toMatchObject({ at: 1800, text: 'wire up with peer peer-one · webrtc' });
        expect(item.stages[3].text).toBe('first piece from peer peer-one (#1/4)');
        expect(item.peers.get('peer-one-id').rx).toBe(32768);
    });

    it('keeps server stages, folding progress into one timed stage, and counts the bytes', () => {
        const { emitter, clock, ledger } = setup();
        emitter.emit('serverCopy', { infoHash: 'abc-photo.jpg', direction: 'down', stage: 'requested', why: 'no P2P progress for 10 s' });
        emitter.emit('serverCopy', { infoHash: 'abc-photo.jpg', direction: 'down', stage: 'downloading', loaded: 0, total: 10 });
        clock.value += 1500;
        emitter.emit('serverCopy', { infoHash: 'abc-photo.jpg', direction: 'down', stage: 'downloading', loaded: 10, total: 10 });
        emitter.emit('serverCopy', { infoHash: 'abc-photo.jpg', direction: 'down', stage: 'done', loaded: 10, total: 10 });

        // A compound photo id belongs to its torrent.
        const item = ledger.get('abc');
        expect(item.stages.map(stage => stage.stage)).toEqual(['requested', 'downloading', 'done']);
        expect(item.stages[1]).toMatchObject({ at: 1000, until: 2500, loaded: 10 });
        expect(item.server.rx).toBe(10);
        expect(item.serverStage.stage).toBe('done');
    });

    it('tells subscribers when anything changed', () => {
        const { emitter, ledger } = setup();
        let calls = 0;
        const stop = ledger.subscribe(() => calls++);
        emitter.emit('serverCopy', { infoHash: 'abc', direction: 'up', stage: 'queued' });
        stop();
        emitter.emit('serverCopy', { infoHash: 'abc', direction: 'up', stage: 'uploading' });
        expect(calls).toBe(1);
    });
});
