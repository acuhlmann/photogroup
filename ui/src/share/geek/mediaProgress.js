import { getBaseInfoHash } from '../torrent/WebTorrentUtils';

// How far each photo on the map has come, from real state only:
// - this device: the torrent file's own progress, or the server copy's
//   download when the photo comes that way;
// - another device: the pieces it told us it has (its wire's bitfield), when
//   it is connected to us. Without a wire we do not know, so we say so;
// - the server: how much of the copy has been uploaded.

/** The torrent a tile belongs to, by its base infohash. */
export function torrentFor(tile, torrents = []) {
    const key = getBaseInfoHash(tile?.infoHash);
    return key ? torrents.find(torrent => torrent && getBaseInfoHash(torrent.infoHash) === key) || null : null;
}

/** The torrent's file for this tile: the photo, never its preview. */
function fileFor(tile, torrent) {
    const files = torrent?.files || [];
    return files.find(file => file === tile.torrentFile)
        || files.find(file => file.name === tile.fileName)
        || files.find(file => !String(file.name || '').startsWith('Thumbnail '))
        || null;
}

/** Share of a file's pieces a bitfield has, 0..1, or null when it can't tell. */
export function piecesShare(bitfield, torrent, file) {
    if (!bitfield || typeof bitfield.get !== 'function') return null;
    const count = torrent?.pieces?.length || 0;
    if (!count) return null;
    const first = Number.isInteger(file?._startPiece) ? file._startPiece : 0;
    const last = Number.isInteger(file?._endPiece) ? file._endPiece : count - 1;
    let have = 0;
    for (let index = first; index <= last; index++) if (bitfield.get(index)) have++;
    return have / (last - first + 1);
}

/**
 * Progress for one thumb on the map, or null when there is nothing to show
 * (the photo is all there).
 * @returns {{ value: number|null, via: 'p2p'|'server' } | null} value null: arriving, amount unknown
 */
export function thumbProgress(thumb, { myPeerId, torrents = [], ledger = null, photoOf = () => null } = {}) {
    const tile = thumb.tile || {};
    if (thumb.deviceId === 'copies') {
        if (thumb.copy === 'stored' || !thumb.copy) return null;
        const photo = { ...tile, ...(photoOf(tile.infoHash) || {}) };
        const size = photo.serverCopySize || 0;
        return { value: size ? Math.min(1, (photo.serverCopyReceived || 0) / size) : 0, via: 'server' };
    }
    // Preview-only is this device's own state: others can still be loading it.
    if (!thumb.arriving || (tile.previewOnly && thumb.deviceId === myPeerId)) return null;
    const torrent = torrentFor(tile, torrents);
    const file = fileFor(tile, torrent);
    if (thumb.deviceId === myPeerId) {
        const p2p = file && Number.isFinite(file.progress) ? file.progress : torrent?.progress || 0;
        const stage = ledger?.get?.(tile.infoHash)?.serverStage;
        const server = stage?.direction === 'down' && stage.total ? (stage.loaded || 0) / stage.total : 0;
        return server > p2p ? { value: Math.min(1, server), via: 'server' } : { value: Math.min(1, p2p), via: 'p2p' };
    }
    const wire = (torrent?.wires || []).find(item => String(item.peerId) === String(thumb.deviceId));
    const value = piecesShare(wire?.peerPieces, torrent, file);
    // All pieces there: the room hears "has it" a moment later.
    return value === 1 ? null : { value, via: 'p2p' };
}

/** "19h left": how long a stored server copy stays, for the caption under it. */
export function copyCaption(state, photo = {}, now = Date.now()) {
    if (state === 'requested') return 'asked';
    if (state !== 'stored') return null;
    if (!photo.serverCopyExpiresAt) return 'stored';
    const minutes = Math.max(0, Math.round((photo.serverCopyExpiresAt - now) / 60000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h left` : `${minutes}m left`;
}
