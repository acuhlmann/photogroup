/**
 * TransferTelemetry - turns a live WebTorrent torrent into something a person
 * can watch while they wait: which stage of the P2P pipeline we are in, what
 * the swarm looks like, which network path WebRTC picked, and a timestamped
 * log of the protocol events as they happen.
 *
 * Pure helpers live here so they can be unit tested; the React view is
 * TransferConsole.js.
 */

export const PHASES = [
    { id: 'signal', label: 'Announce', long: 'Telling the tracker which photo you want' },
    { id: 'discover', label: 'Discover', long: 'Waiting for a peer with the photo' },
    { id: 'handshake', label: 'Handshake', long: 'Connecting to the peer' },
    { id: 'metadata', label: 'Metadata', long: 'Getting the file list and piece hashes' },
    { id: 'pieces', label: 'Pieces', long: 'Receiving the pieces' },
    { id: 'verify', label: 'Verify', long: 'All pieces checked, showing the photo' },
];

/** Short explainers, keyed by phase, rotated while the user waits. */
export const PHASE_NOTES = {
    signal: [
        'The tracker only connects browsers. It never sees the photo.',
        'Your browser tells the tracker the infohash of the photo. The tracker finds peers with the same infohash.',
    ],
    discover: [
        'No peer yet. The sender may have locked their phone. Phones stop WebRTC when the screen is locked.',
        'Each peer sends its addresses: local (LAN), public (from STUN) and relay (TURN).',
    ],
    handshake: [
        'ICE tests the addresses in order: local first, then public, then the TURN relay.',
        'When the connection is encrypted, both browsers send a BitTorrent handshake.',
    ],
    metadata: [
        'A magnet link contains only the infohash. Peers send the file list and the piece hashes.',
        'Your browser checks the file list against the infohash. A peer cannot send a different file.',
    ],
    pieces: [
        'Your browser checks each piece against its SHA-1 hash before it keeps it.',
        'With many peers, your browser asks for the rarest pieces first.',
        'You can send each piece that you have to other people immediately.',
    ],
    verify: [
        'All pieces are correct. Your browser puts the file together and shows it.',
    ],
};

/** "a1b2c3d4…9f0e" style hash for narrow screens. */
export function shortHash(hash, head = 8, tail = 4) {
    if (!hash || typeof hash !== 'string') return '';
    if (hash.length <= head + tail + 1) return hash;
    return hash.slice(0, head) + '…' + hash.slice(-tail);
}

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const v = bytes / Math.pow(1024, i);
    return (i === 0 ? v.toFixed(0) : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + units[i];
}

/** "+12.3s" relative timestamps for the log. */
export function formatElapsed(ms) {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    if (ms < 60000) return '+' + (ms / 1000).toFixed(1) + 's';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return '+' + m + 'm' + String(s).padStart(2, '0') + 's';
}

function countVerified(torrent) {
    const bf = torrent.bitfield;
    const n = torrent.pieces ? torrent.pieces.length : 0;
    if (!bf || typeof bf.get !== 'function' || !n) return 0;
    let c = 0;
    for (let i = 0; i < n; i++) if (bf.get(i)) c++;
    return c;
}

function describeWire(wire) {
    const ext = wire.peerExtendedHandshake || {};
    const client = ext.v ? String(ext.v) : null;
    const extensions = ext.m ? Object.keys(ext.m) : [];
    return {
        peerId: wire.peerId || null,
        type: wire.type || 'unknown',
        remoteAddress: wire.remoteAddress || null,
        downloaded: wire.downloaded || 0,
        uploaded: wire.uploaded || 0,
        choked: !!wire.peerChoking,
        client,
        extensions,
    };
}

/** A safe, plain-data view of a torrent. Every field tolerates a half-built torrent. */
export function snapshotTorrent(torrent) {
    if (!torrent || !torrent.infoHash) return null;
    const pieces = torrent.pieces ? torrent.pieces.length : 0;
    let announce = [];
    if (Array.isArray(torrent.announce)) announce = torrent.announce.slice(0, 3);
    return {
        infoHash: torrent.infoHash,
        name: torrent.name || null,
        numPeers: torrent.numPeers || 0,
        wires: Array.isArray(torrent.wires) ? torrent.wires.map(describeWire) : [],
        hasMetadata: !!(torrent.metadata || pieces > 0),
        pieces,
        pieceLength: torrent.pieceLength || 0,
        verified: countVerified(torrent),
        length: torrent.length || 0,
        downloaded: torrent.downloaded || 0,
        uploaded: torrent.uploaded || 0,
        downloadSpeed: torrent.downloadSpeed || 0,
        uploadSpeed: torrent.uploadSpeed || 0,
        progress: torrent.progress || 0,
        done: !!torrent.done,
        announce,
    };
}

/**
 * Which phase the transfer is in. `seen` carries events that leave no trace on
 * the torrent itself (an announce went out, a peer was offered).
 */
export function computePhase(snap, seen = {}) {
    if (!snap) return 'signal';
    if (snap.done || snap.progress >= 1) return 'verify';
    if (snap.hasMetadata && (snap.downloaded > 0 || snap.verified > 0)) return 'pieces';
    if (snap.wires.length > 0) return snap.hasMetadata ? 'pieces' : 'metadata';
    if (seen.peerOffered || snap.numPeers > 0) return 'handshake';
    if (seen.announced) return 'discover';
    return 'signal';
}

export function phaseIndex(phaseId) {
    return Math.max(0, PHASES.findIndex(p => p.id === phaseId));
}

const PATH_LABELS = {
    host: 'direct LAN',
    srflx: 'NAT-punched via STUN',
    prflx: 'peer-reflexive',
    relay: 'TURN relay',
};

/**
 * Reads the selected ICE candidate pair out of an RTCStatsReport (or any
 * iterable of stats objects) and says how the bytes are actually flowing.
 */
export function classifyCandidatePair(stats) {
    if (!stats) return null;
    const all = [];
    if (typeof stats.forEach === 'function') stats.forEach(s => all.push(s));
    else if (Array.isArray(stats)) all.push(...stats);
    const byId = new Map(all.map(s => [s.id, s]));

    let pair = null;
    const transport = all.find(s => s.type === 'transport' && s.selectedCandidatePairId);
    if (transport) pair = byId.get(transport.selectedCandidatePairId);
    if (!pair) pair = all.find(s => s.type === 'candidate-pair' && (s.selected || s.nominated) && s.state === 'succeeded');
    if (!pair) return null;

    const local = byId.get(pair.localCandidateId) || {};
    const remote = byId.get(pair.remoteCandidateId) || {};
    const localType = local.candidateType || 'unknown';
    const remoteType = remote.candidateType || 'unknown';
    const relayed = localType === 'relay' || remoteType === 'relay';
    const worst = relayed ? 'relay'
        : (localType === 'srflx' || remoteType === 'srflx') ? 'srflx'
        : (localType === 'prflx' || remoteType === 'prflx') ? 'prflx'
        : localType === 'host' && remoteType === 'host' ? 'host' : localType;

    return {
        localType,
        remoteType,
        protocol: local.protocol || remote.protocol || pair.protocol || null,
        remoteAddress: remote.address || remote.ip || null,
        remotePort: remote.port || null,
        rttMs: Number.isFinite(pair.currentRoundTripTime) ? Math.round(pair.currentRoundTripTime * 1000) : null,
        outgoingBitrate: Number.isFinite(pair.availableOutgoingBitrate) ? pair.availableOutgoingBitrate : null,
        relayed,
        path: worst,
        label: PATH_LABELS[worst] || worst,
    };
}

/** WebRTC peers' RTCPeerConnections, by peer id. */
function peerConnections(torrent) {
    const out = [];
    const peers = torrent && torrent._peers;
    if (!peers || typeof peers.forEach !== 'function') return out;
    peers.forEach((peer, id) => {
        const pc = peer && peer.conn && peer.conn._pc;
        if (pc && typeof pc.getStats === 'function') out.push({ id, pc, peer });
    });
    return out;
}

/** Asks every live WebRTC connection which ICE pair won. */
export async function probeIcePaths(torrent) {
    const results = [];
    for (const { id, pc } of peerConnections(torrent)) {
        try {
            const info = classifyCandidatePair(await pc.getStats());
            if (info) results.push({ id, ...info });
        } catch {
            // Closed connections throw; skip them.
        }
    }
    return results;
}

/**
 * Subscribes to protocol events and reports them as log lines.
 * `push({kind, text})` is called for each; returns a detach function.
 */
export function attachTelemetryLog(torrent, push, seen = {}) {
    if (!torrent || typeof torrent.on !== 'function') return () => {};
    const handlers = [];
    const on = (ev, fn) => { torrent.on(ev, fn); handlers.push([ev, fn]); };
    let verifiedLogged = 0;

    on('trackerAnnounce', () => {
        if (!seen.announced) push({ kind: 'net', text: 'tracker ack: announce for ' + shortHash(torrent.infoHash) + ' accepted' });
        seen.announced = true;
    });
    on('peer', id => {
        seen.peerOffered = true;
        const label = typeof id === 'string' && id.length > 20 ? shortHash(id, 6, 4) : String(id || '');
        push({ kind: 'net', text: 'peer offered ' + label + ' · starting ICE' });
    });
    on('wire', (wire, addr) => {
        const d = describeWire(wire);
        push({
            kind: 'ok',
            text: 'wire up [' + d.type + '] ' + (addr || d.remoteAddress || '') +
                (d.peerId ? ' peer_id ' + shortHash(d.peerId, 6, 2) : ''),
        });
        if (typeof wire.once === 'function') {
            wire.once('extended', (ext, info) => {
                if (ext !== 'handshake' || !info) return;
                const m = info.m ? Object.keys(info.m).join(', ') : 'none';
                const v = info.v ? String(info.v) : 'unknown client';
                push({ kind: 'info', text: 'BEP 10 handshake: ' + v + ' · ext ' + m });
            });
            wire.once('close', () => push({ kind: 'warn', text: 'wire closed ' + (addr || '') }));
        }
    });
    on('metadata', () => {
        const n = torrent.pieces ? torrent.pieces.length : 0;
        push({
            kind: 'ok',
            text: 'metadata ok: ' + (torrent.files ? torrent.files.length : 0) + ' file(s), ' +
                formatBytes(torrent.length) + ', ' + n + ' × ' + formatBytes(torrent.pieceLength) + ' pieces',
        });
    });
    on('verified', index => {
        verifiedLogged++;
        // Small files have few pieces: log them all. Big ones: every 8th.
        const n = torrent.pieces ? torrent.pieces.length : 0;
        if (n <= 16 || verifiedLogged % 8 === 1 || verifiedLogged === n) {
            push({ kind: 'data', text: 'piece #' + index + ' SHA-1 ✓ (' + verifiedLogged + '/' + (n || '?') + ')' });
        }
    });
    on('noPeers', source => push({ kind: 'warn', text: 'no peers via ' + source + ' yet' }));
    on('warning', err => push({ kind: 'warn', text: String(err && err.message ? err.message : err).slice(0, 120) }));
    on('done', () => push({ kind: 'ok', text: 'all pieces verified · ' + formatBytes(torrent.downloaded) + ' received' }));

    return () => {
        handlers.forEach(([ev, fn]) => {
            if (typeof torrent.removeListener === 'function') torrent.removeListener(ev, fn);
        });
    };
}
