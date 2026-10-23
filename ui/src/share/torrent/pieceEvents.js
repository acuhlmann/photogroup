// WebTorrent says when a piece is verified, but not which peer sent it, and
// nothing when we finish sending one. The wires know: watch their blocks and
// emit one event per whole piece, naming the peer it moved to or from.
//   pieceReceived / pieceSent: { torrent, index, size, total, peerId }

/** Bytes in piece `index`; the last piece is usually shorter. */
function pieceSize(torrent, index) {
    const total = torrent.pieces ? torrent.pieces.length : 0;
    if (index === total - 1 && torrent.lastPieceLength) return torrent.lastPieceLength;
    return torrent.pieceLength || 0;
}

export function watchPieces(torrent, emitter) {
    // Piece index → the peer whose wire delivered its last block.
    const from = new Map();
    // `${peerId}:${index}` → bytes they have asked us for so far.
    const asked = new Map();
    const details = (index, peerId) => ({
        torrent, index, peerId,
        size: pieceSize(torrent, index),
        total: torrent.pieces ? torrent.pieces.length : 0,
    });

    torrent.on('wire', wire => {
        const peerId = String(wire.peerId);
        wire.on('piece', index => from.set(index, peerId));
        wire.on('request', (index, offset, length) => {
            const key = peerId + ':' + index;
            const bytes = (asked.get(key) || 0) + length;
            if (bytes < pieceSize(torrent, index)) {
                asked.set(key, bytes);
                return;
            }
            asked.delete(key);
            emitter.emit('pieceSent', details(index, peerId));
        });
    });

    // Seeding verifies our own pieces too; only those a wire brought count.
    torrent.on('verified', index => {
        if (!from.has(index)) return;
        const peerId = from.get(index);
        from.delete(index);
        emitter.emit('pieceReceived', details(index, peerId));
    });
}
