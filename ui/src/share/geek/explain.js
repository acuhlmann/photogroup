// What a recorded event means, for someone stepping through the real traffic
// one event at a time: what just happened, and who gets to see it. Keyed by
// the log line's kind, so every line the footer writes has an answer.

const EXPLAIN = {
    rx: {
        title: 'A piece arrived',
        body: 'Your browser asked a peer for this piece in 16 KiB blocks over the WebRTC data channel, then checked it against its SHA-1 hash before keeping it. From now on you can pass it on to others.',
        sees: 'Only the two browsers: the data channel is encrypted, and photogroup.network is not on the path.',
    },
    tx: {
        title: 'You sent a piece',
        body: 'A peer asked for this piece and your browser served it from the photo it holds. Every device that has pieces helps the others, so the person who shared it is not the only source.',
        sees: 'Only the two browsers (and a TURN relay, as encrypted bytes, if the route goes through one).',
    },
    wire: {
        title: 'A peer connection opened',
        body: 'ICE found a working path, DTLS set up encryption, and the two browsers exchanged the BitTorrent handshake: the infohash and their peer ids. Pieces can flow now.',
        sees: 'The tracker brokered the offer and answer that led here; the connection itself is browser to browser.',
    },
    peer: {
        title: 'Someone joined, left or changed',
        body: 'The server keeps the list of who is in the room and pushes changes to everyone over Server-Sent Events.',
        sees: 'photogroup.network: names, devices and network addresses of the people in the room.',
    },
    link: {
        title: 'The paths changed',
        body: 'Each browser reports which candidate pair ICE settled on for each peer: same network, through the NATs, or relayed by TURN. That is what the coloured lines between devices show.',
        sees: 'photogroup.network: which path each pair of devices uses.',
    },
    photo: {
        title: 'A photo was published',
        body: 'The sharer sent the magnet link and facts about the file (name, type, size, date taken). The photo itself stays on their device until someone asks for its pieces.',
        sees: 'photogroup.network keeps the magnet and file facts with the room; never the pixels.',
    },
    ice: {
        title: 'ICE: finding ways in',
        body: 'Your browser gathers candidates: private LAN addresses, the public address a STUN server reflects back, and a relay address if TURN is configured. These are the ways a peer might reach you.',
        sees: 'STUN sees your public IP and port. The candidates are shared with the room so peers can try them.',
    },
    sse: {
        title: 'The server pushed an update',
        body: 'photogroup.network keeps one Server-Sent Events stream open to every device, and pushes room changes down it the moment they happen.',
        sees: 'photogroup.network: room changes only, never photo bytes.',
    },
    copy: {
        title: 'Server copy: the last resort',
        body: 'A download stalled (or everyone who had the photo left), so a copy goes through the server over HTTPS: uploaded in 8 MB chunks by someone who has it, downloaded and fingerprint-checked by whoever needs it.',
        sees: 'photogroup.network holds these bytes until everyone has the photo, or for 24 h at most.',
    },
};

// An event the log has no line for (a peer's details changing, say) keeps
// its raw name as its kind: it still means the same thing.
const ALIAS = {
    peers: 'peer',
    peerConnections: 'link',
    photos: 'photo',
    pcEvent: 'ice',
    localNetwork: 'ice',
    sseReconnected: 'sse',
    serverCopy: 'copy',
};

/** `{ title, body, sees }` for a recorded event, or null when there is nothing to say. */
export function explainEntry(entry) {
    if (!entry) return null;
    return EXPLAIN[entry.kind] || EXPLAIN[ALIAS[entry.kind]] || null;
}

export const EXPLAINED_KINDS = Object.keys(EXPLAIN);
