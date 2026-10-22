/**
 * What to tell someone waiting for a photo about its server copy, the
 * fallback when no phone that has it can be reached directly.
 */
import { holdersOf, isAway, peerLabel } from '../topology/presence';

function names(peers) {
    const labels = peers.map(peerLabel);
    return labels.length <= 2 ? labels.join(' and ') : labels.slice(0, 2).join(', ') + ' and others';
}

/**
 * @param {(infoHash: string) => boolean} [uploadStalled] whether an upload
 *   started but went quiet (RoomPhotos.uploadStalled)
 * @returns {{text: string, canFetch: boolean, canAsk: boolean, holdersAway: boolean}|null}
 *   canFetch: a copy is there to download; canAsk: worth asking for one.
 */
export function serverCopyStatus(tile, peers, myPeerId, uploadStalled = () => false) {
    // Our own photo: nothing to wait for.
    if (!tile || tile.fromServerCopy || tile.seed || tile.peerId === myPeerId) return null;
    const items = Array.isArray(peers) ? peers : [];
    const holders = holdersOf(tile, items, myPeerId);
    const holdersAway = holders.length > 0 && holders.every(isAway);

    if (tile.hasServerCopy) {
        return { text: 'Server copy ready if needed', canFetch: true, canAsk: false, holdersAway };
    }
    if (tile.serverCopyUploader) {
        const uploader = items.find(peer => peer.peerId === tile.serverCopyUploader);
        const percent = tile.serverCopySize ? Math.floor(100 * (tile.serverCopyReceived || 0) / tile.serverCopySize) : 0;
        if (uploadStalled(tile.infoHash)) {
            // Their phone likely froze: asking again lets someone else carry on.
            return { text: `${peerLabel(uploader)}'s server copy stopped at ${percent}%`, canFetch: false, canAsk: true, holdersAway };
        }
        return { text: `${peerLabel(uploader)} is leaving a server copy · ${percent}%`, canFetch: false, canAsk: false, holdersAway };
    }
    if (tile.serverCopyRequestedAt) {
        return {
            text: holdersAway ? `Asked for a server copy · ${names(holders)} ${holders.length > 1 ? 'are' : 'is'} away` : 'Asked for a server copy',
            canFetch: false, canAsk: true, holdersAway
        };
    }
    if (holdersAway) {
        return { text: `Waiting for ${names(holders)} to come back`, canFetch: false, canAsk: true, holdersAway };
    }
    return null;
}
