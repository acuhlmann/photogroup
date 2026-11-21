import { useEffect, useState } from 'react';
import { getBaseInfoHash, getTorrent } from '../torrent/WebTorrentUtils';
import { activeHolders, holdersOf } from '../topology/presence';

/** What a photo says that came by camera only in small size, and has no more bytes on the way. */
export const SMALL_ONLY_TEXT = 'Small size only';

/** Whether the tile shows the photo in small size that came by camera, with no more of it on the way. */
export function isSmallOnly(tile) {
    return !!(tile && tile.smallFromLight && tile.loading && !(tile.torrentFile?.progress > 0));
}

/**
 * What a photo that is still arriving waits for, in a few words for its
 * tile. It says who it connects to before the first byte comes, so a tile
 * does not say "Arriving…" for a long time with nothing that moves.
 *
 * @param {object} tile
 * @param {{torrent?: object, peers?: object[], myPeerId?: string, device?: string}} context
 *   device: "phone" in simple mode, "device" in geek mode
 */
export function arrivingText(tile, { torrent, peers = [], myPeerId, device = 'phone' } = {}) {
    const progress = tile?.torrentFile?.progress || 0;
    const percent = Math.round(progress * 100);
    if (percent > 0) return `Arriving · ${percent}%`;
    const wires = Array.isArray(torrent?.wires) ? torrent.wires.length : 0;
    if (wires > 0) return 'Arriving…';
    const active = activeHolders(tile, peers, myPeerId);
    if (active.length === 1 && active[0].name) return `Connecting to ${active[0].name}…`;
    if (active.length > 1) return `Connecting to ${active.length} ${device}s…`;
    if (active.length === 1) return `Connecting to a ${device}…`;
    if (holdersOf(tile, peers, myPeerId).length > 0) return `Waiting for the ${device} with this photo`;
    if (tile?.smallFromLight) return SMALL_ONLY_TEXT;
    return 'Arriving…';
}

/** The torrent that carries a tile's photo, before or after its metadata is here. */
function torrentOf(tile, master) {
    if (tile?.torrent) return tile.torrent;
    if (!master?.client || !tile?.infoHash) return null;
    try {
        return getTorrent(master.client, getBaseInfoHash(tile.infoHash)) || null;
    } catch {
        return null;
    }
}

/** arrivingText for a tile, checked again each second while it arrives. */
export function useArrivingText(tile, master, device = 'phone') {
    const read = () => arrivingText(tile, {
        torrent: torrentOf(tile, master),
        peers: master?.peers?.items || [],
        myPeerId: master?.client?.peerId,
        device,
    });
    const [text, setText] = useState(read);
    const loading = !!(tile && tile.loading);
    useEffect(() => {
        setText(read());
        if (!loading) return undefined;
        const id = setInterval(() => setText(read()), 1000);
        return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, tile, master, device]);
    return text;
}
