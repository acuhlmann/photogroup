import { readTransfers, readServerCopies } from './transfers';
import { readSummary } from './sessionSummary';

// The whole session as one JSON file, to attach to a bug report: the log
// lines, every transfer with its stages and times, the room's devices and
// photos, and how long each device took. It holds IP addresses and device
// names, but no TURN passwords, session tokens or private room keys.

export const EXPORT_VERSION = 1;

/** ICE servers without their usernames and passwords. */
function iceServersOf(rtcConfig) {
    return (rtcConfig?.iceServers || []).map(server => ({ urls: server.urls }));
}

const peerOf = peer => ({
    peerId: peer.peerId,
    name: peer.name || null,
    device: peer.device || null,
    platform: peer.originPlatform || null,
    away: !!peer.away,
    dataSaver: !!peer.dataSaver,
    networkChain: (peer.networkChain || []).map(candidate => ({
        type: candidate.type, typeDetail: candidate.typeDetail, ip: candidate.ip, port: candidate.port, transport: candidate.transport,
    })),
});

const photoOf = photo => ({
    infoHash: photo.infoHash,
    fileName: photo.fileName || null,
    fileType: photo.fileType || null,
    sharedBy: photo.peerId || null,
    owners: (photo.owners || []).map(owner => ({ peerId: owner.peerId, loading: !!owner.loading })),
    hasServerCopy: !!photo.hasServerCopy,
    serverCopySize: photo.serverCopySize ?? null,
    serverCopyReceived: photo.serverCopyReceived ?? null,
    serverCopyRequestedAt: photo.serverCopyRequestedAt ?? null,
    serverCopyStartedAt: photo.serverCopyStartedAt ?? null,
    serverCopyStoredAt: photo.serverCopyStoredAt ?? null,
    serverCopyExpiresAt: photo.serverCopyExpiresAt ?? null,
});

const ledgerOf = item => ({
    infoHash: item.infoHash,
    name: item.name || null,
    startedAt: item.startedAt,
    stages: item.stages,
    failures: item.failures || [],
    server: item.server,
    peers: [...(item.peers?.entries?.() || [])].map(([peerId, tally]) => ({ peerId, rx: tally.rx, tx: tally.tx, pieces: tally.pieces })),
    pieces: (item.pieceLog || []).length,
});

/** The export as plain data. */
export function buildExport({ master, timeline, now = Date.now(), href = '', userAgent = '' }) {
    const creator = master.creator || {};
    const input = {
        items: master.ledger?.all?.() || [],
        torrents: master.client?.torrents || [],
        photos: master.roomPhotos?.all?.() || [],
        peers: master.peers?.items || [],
        connections: master.peers?.connections || [],
        myPeerId: master.client?.peerId,
        localNetwork: master.localNetwork,
        keepCopies: !!master.serverPinning?.keepCopies,
    };
    const rows = readTransfers(input);
    let room = null;
    try {
        room = new URL(href).searchParams.get('room');
    } catch {
        room = null;
    }
    return {
        app: 'PhotoGroup',
        version: EXPORT_VERSION,
        exportedAt: new Date(now).toISOString(),
        room,
        userAgent,
        me: input.myPeerId || null,
        iceServers: iceServersOf(creator.iceServers),
        iceTransportPolicy: creator.iceServers?.iceTransportPolicy || 'all',
        localNetwork: (input.localNetwork || []).map(candidate => ({ type: candidate.type, ip: candidate.ip, port: candidate.port })),
        peers: input.peers.map(peerOf),
        connections: input.connections.map(conn => ({ from: conn.fromPeerId, to: conn.toPeerId, type: conn.connectionType || null })),
        photos: input.photos.map(photoOf),
        summary: readSummary({
            rows, share: master.deviceTimes?.summary?.() || {}, devices: master.deviceTimes?.read?.() || [],
            peers: input.peers, myPeerId: input.myPeerId,
        }),
        deviceTimes: master.deviceTimes?.read?.() || [],
        transfers: rows.map(row => ({
            infoHash: row.infoHash, name: row.name, direction: row.direction, done: row.done, size: row.size,
            elapsedMs: row.elapsedMs, runningMs: row.runningMs, times: row.times, split: row.split, why: row.why,
            sources: row.sources.map(source => ({ peerId: source.peerId, kind: source.kind, bytes: source.bytes, tookMs: source.tookMs ?? null })),
        })),
        serverCopies: readServerCopies({ ...input, now }),
        ledger: input.items.map(ledgerOf),
        // The packet log: the last two minutes this map recorded.
        log: (timeline?.entries || []).filter(entry => entry.text).map(entry => ({
            at: new Date(entry.at).toISOString(), kind: entry.kind, text: entry.text,
        })),
    };
}

/** "photogroup-log-abc123-2026-11-14T09-30-00.json" */
export function exportFileName(data) {
    const stamp = String(data.exportedAt || '').replace(/[:.]/g, '-').replace(/-\d+Z$/, '');
    return `photogroup-log-${data.room || 'room'}-${stamp}.json`;
}

/** Save the export as a file; returns the file name. */
export function downloadExport(data, doc = document) {
    const name = exportFileName(data);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = url;
    link.download = name;
    doc.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return name;
}
