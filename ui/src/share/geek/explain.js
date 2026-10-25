// What a recorded event means, for someone stepping through the real traffic
// one event at a time: what just happened, and who gets to see it. Keyed by
// the log line's kind, so every line the footer writes has an answer.

const EXPLAIN = {
    rx: {
        title: 'A piece arrived',
        body: 'Your browser received this piece from a peer over the WebRTC data channel. It checked the piece against its SHA-1 hash. Now you can send this piece to other people too.',
        sees: 'Only the two browsers. The data is encrypted, and photogroup.network is not on the path.',
    },
    tx: {
        title: 'You sent a piece',
        body: 'A peer asked for this piece, and your browser sent it. All devices with pieces help each other, so the person who shared the photo is not the only source.',
        sees: 'Only the two browsers. A TURN relay, if used, sees only encrypted data.',
    },
    wire: {
        title: 'A peer connection opened',
        body: 'ICE found a path that works, and DTLS encrypted it. The two browsers sent the BitTorrent handshake. Now pieces can move.',
        sees: 'The tracker sent the offer and the answer. The connection itself goes from browser to browser.',
    },
    trk: {
        title: 'The tracker answered',
        body: 'Your browser told the tracker which photos it has. This is an announce. The tracker sent back peers that want the same photos, with their WebRTC offers.',
        sees: 'The tracker: your IP address and the infohash of each photo. It never sees the photo.',
    },
    path: {
        title: 'The path to a peer',
        body: 'WebRTC tells which candidate pair it uses: host (same network), srflx (through the NATs) or relay (through TURN). Every few seconds each browser sends a STUN check on this path. The answer proves the path works and gives the round-trip time.',
        sees: 'Only the two browsers, or the TURN relay when the path is relay. The data is encrypted.',
    },
    peer: {
        title: 'Someone joined, left or changed',
        body: 'The server keeps the list of people in the room. It sends each change to all devices over Server-Sent Events.',
        sees: 'photogroup.network: the names, devices and network addresses of the people in the room.',
    },
    link: {
        title: 'The paths changed',
        body: 'Each browser tells the server which path ICE chose to each peer: the same network, through the NATs, or through TURN. The colored lines between devices show these paths.',
        sees: 'photogroup.network: which path each pair of devices uses.',
    },
    photo: {
        title: 'A photo was shared',
        body: 'The sharer sent the magnet link and data about the file (name, type, size, date taken). The photo stays on their device until someone asks for its pieces.',
        sees: 'photogroup.network keeps the magnet link and the file data with the room. It never sees the photo.',
    },
    ice: {
        title: 'ICE: finding paths',
        body: 'Your browser collects candidates: private addresses, the public address from STUN, and a relay address if TURN is configured. Peers use these addresses to try to reach you.',
        sees: 'STUN sees your public IP address and port. The room receives your candidates.',
    },
    sse: {
        title: 'The server sent an update',
        body: 'photogroup.network keeps one event stream (SSE) open to each device. It sends room changes on this stream immediately.',
        sees: 'photogroup.network: room changes only, never photos.',
    },
    copy: {
        title: 'Server copy: the last resort',
        body: 'A download stopped, or all devices with the photo left. A device with the photo uploads a copy over HTTPS in 8 MB parts. The receiver downloads it and checks its fingerprint.',
        sees: 'photogroup.network keeps the copy until all devices have the photo, for 24 h at most.',
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
    trackerAnnounce: 'trk',
    linkStats: 'path',
    serverCopy: 'copy',
};

/** `{ title, body, sees }` for a recorded event, or null when there is nothing to say. */
export function explainEntry(entry) {
    if (!entry) return null;
    return EXPLAIN[entry.kind] || EXPLAIN[ALIAS[entry.kind]] || null;
}

export const EXPLAINED_KINDS = Object.keys(EXPLAIN);
