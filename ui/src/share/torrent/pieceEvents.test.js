import { describe, it, expect, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import { watchPieces } from './pieceEvents';

function setup() {
    const torrent = new EventEmitter();
    Object.assign(torrent, { pieces: [1, 2, 3], pieceLength: 32768, lastPieceLength: 1000 });
    const emitter = new EventEmitter();
    const received = vi.fn();
    const sent = vi.fn();
    emitter.on('pieceReceived', received);
    emitter.on('pieceSent', sent);
    watchPieces(torrent, emitter);
    const wire = new EventEmitter();
    wire.peerId = 'ana';
    torrent.emit('wire', wire);
    return { torrent, wire, received, sent };
}

describe('watchPieces', () => {
    it('names the peer a verified piece came from', () => {
        const { torrent, wire, received } = setup();
        wire.emit('piece', 0, 0, new Uint8Array(16384));
        wire.emit('piece', 0, 16384, new Uint8Array(16384));
        torrent.emit('verified', 0);
        expect(received).toHaveBeenCalledWith(expect.objectContaining({ index: 0, size: 32768, total: 3, peerId: 'ana' }));
        // Our own pieces, verified when seeding, came over no wire.
        torrent.emit('verified', 1);
        expect(received).toHaveBeenCalledTimes(1);
    });

    it('counts a piece as sent once a peer has asked for all of it', () => {
        const { wire, sent } = setup();
        wire.emit('request', 1, 0, 16384);
        expect(sent).not.toHaveBeenCalled();
        wire.emit('request', 1, 16384, 16384);
        expect(sent).toHaveBeenCalledWith(expect.objectContaining({ index: 1, size: 32768, peerId: 'ana' }));
        // The short last piece fits in one block.
        wire.emit('request', 2, 0, 1000);
        expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ index: 2, size: 1000 }));
    });
});
