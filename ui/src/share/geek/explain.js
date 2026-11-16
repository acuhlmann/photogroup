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
        sees: 'A tracker (PhotoGroup or a public backup) sent the offer and the answer. The connection itself goes browser to browser.',
    },
    trk: {
        title: 'PhotoGroup primary tracker',
        body: 'Your browser sent the infohash to PhotoGroup’s own WebSocket tracker (photogroup.network). It introduces peers in the room via WebRTC offers and answers and feeds the server-side ICE topology view.',
        sees: 'photogroup.network’s tracker: your IP address, infohashes, and ICE candidates. It never sees the photo.',
    },
    pub: {
        title: 'Public backup WebSocket trackers',
        body: 'Alongside PhotoGroup’s tracker, your browser announces to public WebSocket trackers (like openwebtorrent.com) so peer discovery survives if the main tracker socket drops on mobile. BitTorrent DHT is off.',
        sees: 'Public trackers see infohashes and WebRTC offers/answers, never the photos.',
    },
    stun: {
        title: 'STUN lookup: finding your public address',
        body: 'Your browser sent a STUN Binding Request to learn the public IP address and port (srflx) your router assigns. STUN helps browsers punch holes through NATs, and carries no photo or media bytes.',
        sees: 'STUN sees your public IP address and port only — never photos, rooms, or peers.',
    },
    turn: {
        title: 'TURN relay: allocation & encrypted fallback',
        body: 'Your browser either reserved a TURN relay address (Allocate) during ICE gathering or is forwarding encrypted WebRTC bytes through TURN because direct NAT hole punching failed.',
        sees: 'TURN sees both IP addresses and encrypted DTLS bytes. It cannot read the photos.',
    },
    path: {
        title: 'The direct path to a peer',
        body: 'WebRTC reports the selected direct candidate pair: host (same LAN) or srflx (STUN-assisted NAT hole punch). Periodic STUN connectivity checks keep the path open and measure round-trip time.',
        sees: 'Only the two browsers. Data is DTLS-encrypted and bypasses photogroup.network and TURN.',
    },
    peer: {
        title: 'Someone joined, left or changed',
        body: 'The server keeps the list of people in the room. It sends each change to all devices over Server-Sent Events.',
        sees: 'photogroup.network: the names, devices and network addresses of the people in the room.',
    },
    link: {
        title: 'The paths changed',
        body: 'Each browser tells the server which path ICE chose to each peer: same LAN (host↔host), STUN-assisted NAT hole punch (srflx↔srflx), or TURN relay. The colored lines between devices show these paths.',
        sees: 'photogroup.network: which path each pair of devices uses.',
    },
    photo: {
        title: 'A photo was shared',
        body: 'The sharer sent the magnet link and data about the file (name, type, size, date taken). The photo stays on their device until someone asks for its pieces.',
        sees: 'photogroup.network keeps the magnet link and the file data with the room. It never sees the photo.',
    },
    ice: {
        title: 'ICE: gathering connection candidates',
        body: 'Your browser collects network candidates: local addresses (host), public addresses from STUN (srflx), and relay addresses from TURN if configured. Peers try direct paths before falling back to TURN.',
        sees: 'STUN sees your public IP:port; TURN (if configured) allocates a relay port; the room receives your candidates.',
    },
    sse: {
        title: 'The server sent an update',
        body: 'photogroup.network keeps one event stream (SSE) open to each device. It sends room changes on this stream immediately.',
        sees: 'photogroup.network: room changes only, never photos.',
    },
    copy: {
        title: 'Server copy: the last resort',
        body: 'Direct P2P and TURN did not connect, or all holders left. A device with the photo uploads a copy over HTTPS in 8 MB parts; the receiver downloads it and verifies its fingerprint.',
        sees: 'photogroup.network keeps the copy only until all devices have the photo, for 24 h at most.',
    },
    pair: {
        title: 'Data went from phone to phone, not over the network',
        body: 'A new person needs only the room link. It goes as a QR code from screen to camera, as sound from speaker to microphone, or on an NFC tag. Sound moves about 10 bytes each second. That is enough for a room code. A photo can also go from screen to camera as a stream of codes, at some kilobytes each second, with no network.',
        sees: 'Each person who sees the code or hears the sound can join the room. photogroup.network is not on this path.',
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
    trackerStatus: 'trk',
    pubtracker: 'pub',
    turnctl: 'turn',
    relay: 'turn',
    linkStats: 'path',
    serverCopy: 'copy',
    pairing: 'pair',
};

/** `{ title, body, sees }` for a recorded event, or null when there is nothing to say. */
export function explainEntry(entry) {
    if (!entry) return null;
    return EXPLAIN[entry.kind] || EXPLAIN[ALIAS[entry.kind]] || null;
}

export const EXPLAINED_KINDS = Object.keys(EXPLAIN);
