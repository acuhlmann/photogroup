import StringUtil from '../util/StringUtil';
import { PHASES, snapshotTorrent, computePhase, phaseIndex } from '../torrent/TransferTelemetry';
import { getBaseInfoHash } from '../torrent/WebTorrentUtils';
import { summarizeChain, forecastPath } from '../topology/NetworkInsight';
import { isAway } from '../topology/presence';

// Geek mode's transfer view, as plain data: for each photo this device has
// sent or received, the stages it went through, where its bytes came from
// (each peer by the path ICE settled on, or the server), how much of it went
// browser to browser, and why the rest did not.

/** The path a WebRTC connection type stands for, as the map draws it. */
export function linkKind(type) {
    const value = String(type || '').trim();
    if (value.startsWith('relay')) return 'relay';
    if (value === 'p2p') return 'lan';
    return value ? 'punch' : 'unknown';
}

const KIND_WORDS = {
    lan: 'same network',
    punch: 'NAT hole punch',
    relay: 'TURN relay',
    server: 'HTTPS server copy',
    unknown: 'P2P',
};

export const SERVER_STEPS = {
    down: [
        { id: 'requested', label: 'ask' },
        { id: 'uploaded', label: 'copy up' },
        { id: 'downloading', label: 'GET' },
        { id: 'verifying', label: 'verify' },
    ],
    up: [
        { id: 'queued', label: 'queue' },
        { id: 'uploading', label: 'PUT' },
        { id: 'stored', label: 'stored' },
    ],
};

const peerName = peer => (peer && (peer.name || StringUtil.slimPlatform(peer.originPlatform || ''))) || null;
const short = value => String(value || '').slice(0, 8);
const percent = (part, total) => (total ? Math.round(part / total * 100) : 0);

/** Where each server step stands: 'done', 'active', 'failed' or 'todo'. */
export function serverSteps(direction, stage, photo = {}) {
    const steps = SERVER_STEPS[direction];
    if (!steps || !stage) return null;
    const failed = ['failed', 'rejected', 'interrupted', 'busy', 'too-large'].includes(stage.stage);
    let reached;
    if (direction === 'up') {
        reached = { queued: 0, uploading: 1, stored: 3, exists: 3 }[stage.stage];
        if (reached === undefined) reached = failed ? 1 : 0;
    } else {
        const copyThere = photo.hasServerCopy || ['downloading', 'verifying', 'done'].includes(stage.stage);
        if (stage.stage === 'done') reached = 4;
        else if (stage.stage === 'verifying' || stage.stage === 'rejected') reached = 3;
        else if (stage.stage === 'downloading') reached = 2;
        else reached = copyThere ? 2 : 1;
    }
    return steps.map((step, index) => ({
        ...step,
        state: index < reached ? 'done' : index === reached ? (failed ? 'failed' : 'active') : 'todo',
    }));
}

/** Each P2P phase as done, active or still to come. */
export function p2pSteps(phase, done) {
    const at = phaseIndex(phase);
    return PHASES.map((step, index) => ({
        id: step.id,
        label: step.label,
        state: done || index < at ? 'done' : index === at ? 'active' : 'todo',
    }));
}

/**
 * Why this transfer went (or is going) the way it does, in a few lines,
 * newest concern first.
 */
function explain({ row, photo, peersById, myPeerId, mine, hasTurn }) {
    const lines = [];
    const stage = row.server;
    const forecastWith = peerId => {
        const peer = peersById.get(peerId);
        return peer ? forecastPath(mine, summarizeChain(peer.networkChain), { hasTurn }) : null;
    };

    if (stage?.direction === 'up') {
        if (stage.stage === 'too-large') lines.push(`No server copy: ${stage.why}.`);
        else if (stage.stage === 'stored' || stage.stage === 'exists') lines.push(`Left a server copy because ${stage.why}. It is deleted once everyone has the photo.`);
        else if (stage.why) lines.push(`Uploading a server copy because ${stage.why}.`);
    }
    if (stage?.direction === 'down') {
        if (stage.stage === 'done') lines.push(`Came from the server over HTTPS because ${stage.why}.`);
        else if (stage.stage === 'requested') lines.push(`Asked the room for a server copy: ${stage.why}.`);
        else if (stage.stage === 'rejected') lines.push(`Ignored a server copy: ${stage.why}.`);
        else if (stage.why) lines.push(`Fetching the server copy: ${stage.why}.`);
    }

    row.sources.filter(source => source.peerId).forEach(source => {
        const name = source.label;
        if (source.kind === 'lan') {
            lines.push(`${name} is on your network, so pieces go host to host without leaving it.`);
        } else if (source.kind === 'punch') {
            lines.push(`${name} via a NAT hole punch: STUN found both public addresses and the bytes go straight between you.`);
        } else if (source.kind === 'relay') {
            const forecast = forecastWith(source.peerId);
            lines.push(`${name} is relayed by TURN: still encrypted end to end, but through a relay. ${forecast?.why || ''}`.trim());
        }
    });

    if (row.direction === 'down' && !row.done && !row.sources.some(source => source.peerId)) {
        const holders = (photo?.owners || []).filter(owner => owner.peerId !== myPeerId && !owner.loading).map(owner => owner.peerId);
        if (photo?.peerId && photo.peerId !== myPeerId && !holders.includes(photo.peerId)) holders.push(photo.peerId);
        const present = holders.map(id => peersById.get(id)).filter(Boolean);
        if (holders.length && !present.length) lines.push('Nobody who has it is in the room right now, so only a server copy can bring it.');
        else if (present.length && present.every(isAway)) lines.push('Everyone who has it is in another app; phones freeze P2P in the background.');
        else if (row.phase === 'signal' || row.phase === 'discover') {
            const forecast = present.length ? forecastWith(present[0].peerId) : null;
            lines.push('Waiting for the tracker to introduce a peer that has it.' + (forecast ? ` Expected path: ${forecast.label}.` : ''));
        }
    }
    if (row.direction === 'up' && !row.sources.length && !stage) {
        lines.push('Nobody has asked for pieces yet. Everyone else in the room may already have it.');
    }
    if (!lines.length && row.done && row.split.server === 0 && row.split.total > 0) {
        lines.push('Fully peer-to-peer: the server never carried a byte of it.');
    }
    return lines;
}

/**
 * The rows of the transfer view.
 * @param {object} input
 * @param {object[]} input.items TransferLedger.all()
 * @param {object[]} input.torrents the WebTorrent client's torrents
 * @param {object[]} input.photos the room's photos
 * @param {object[]} input.peers the room's peers
 * @param {object[]} input.connections peerConnections
 * @param {string} input.myPeerId
 * @param {object[]} input.localNetwork this device's ICE candidates
 * @param {boolean} input.hasTurn
 */
export function readTransfers({ items = [], torrents = [], photos = [], peers = [], connections = [], myPeerId,
    localNetwork = null, hasTurn = false, now = Date.now() }) {
    const peersById = new Map(peers.map(peer => [peer.peerId, peer]));
    const mePeer = peersById.get(myPeerId);
    const mine = summarizeChain(mePeer?.networkChain?.length ? mePeer.networkChain : localNetwork);
    const torrentOf = new Map(torrents.filter(Boolean).map(torrent => [torrent.infoHash, torrent]));
    // One torrent can carry several photos; its first is the one that decides.
    const photoOf = new Map();
    const namesOf = new Map();
    photos.forEach(photo => {
        const key = getBaseInfoHash(photo.infoHash);
        if (!key) return;
        if (!photoOf.has(key)) photoOf.set(key, photo);
        if (photo.fileName) namesOf.set(key, [...(namesOf.get(key) || []), photo.fileName]);
    });
    const nameOf = (key, fallback) => {
        const names = namesOf.get(key) || [];
        if (!names.length) return fallback;
        return names.length > 2 ? `${names[0]} + ${names.length - 1} more` : names.join(' + ');
    };
    const kindWith = peerId => {
        const conn = connections.find(item => (item.fromPeerId === myPeerId && item.toPeerId === peerId)
            || (item.toPeerId === myPeerId && item.fromPeerId === peerId));
        return linkKind(conn?.connectionType);
    };

    const rows = items.map(item => {
        const torrent = torrentOf.get(item.infoHash);
        const photo = photoOf.get(item.infoHash);
        const snap = snapshotTorrent(torrent);
        const sharer = photo ? photo.peerId === myPeerId : item.server.tx > 0 || item.serverStage?.direction === 'up';
        const direction = sharer ? 'up' : 'down';
        const viaServer = item.server.rx > 0 || photos.some(each => each.fromServerCopy && getBaseInfoHash(each.infoHash) === item.infoHash);
        const done = sharer || !!snap?.done || viaServer;
        const seen = { announced: item.stages.length > 0, peerOffered: item.stages.some(stage => stage.stage === 'handshake') };
        const phase = computePhase(snap, seen);
        const key = direction === 'down' ? 'rx' : 'tx';

        const sources = [...item.peers.entries()]
            .filter(([, tally]) => tally[key] > 0)
            .map(([peerId, tally]) => ({
                peerId,
                label: peerName(peersById.get(peerId)) || 'peer ' + short(peerId),
                kind: kindWith(peerId),
                bytes: tally[key],
            }));
        // Bytes a wire carries before a piece verifies are not in the tally yet.
        (snap?.wires || []).forEach(wire => {
            const peerId = String(wire.peerId || '');
            if (sources.find(source => source.peerId === peerId)) return;
            const bytes = direction === 'down' ? wire.downloaded : wire.uploaded;
            if (bytes > 0) sources.push({ peerId, label: peerName(peersById.get(peerId)) || 'peer ' + short(peerId), kind: kindWith(peerId), bytes });
        });
        const serverBytes = direction === 'down' ? item.server.rx : item.server.tx;
        if (serverBytes > 0) sources.push({ peerId: null, label: 'server', kind: 'server', bytes: serverBytes });
        sources.forEach(source => { source.how = KIND_WORDS[source.kind]; });

        const total = sources.reduce((sum, source) => sum + source.bytes, 0);
        const relay = sources.filter(source => source.kind === 'relay').reduce((sum, source) => sum + source.bytes, 0);
        const split = { total, server: serverBytes, relay, p2p: total - serverBytes - relay };

        // How long each stage ran: until the next one began, or, for a stage
        // that kept rewriting itself (a chunked upload), until its last update.
        const withDurations = item.stages.map((stage, index) => {
            const next = item.stages[index + 1];
            const end = stage.until || (next ? next.at : null);
            return { ...stage, tookMs: end > stage.at ? end - stage.at : null };
        });
        const lastStage = withDurations[withDurations.length - 1];
        // Over when its last stage was written; still going, there is no end,
        // only how long this device has been at it.
        const endedAt = done ? (lastStage ? lastStage.until || lastStage.at : null) : null;

        const row = {
            infoHash: item.infoHash,
            name: nameOf(item.infoHash, item.name || torrent?.name || short(item.infoHash)),
            size: snap?.length || photo?.fileSize || null,
            direction,
            done,
            viaServer,
            progress: done ? 1 : snap?.progress || 0,
            phase,
            p2p: p2pSteps(phase, !!snap?.done || (sharer && !!snap)),
            server: item.serverStage,
            serverSteps: serverSteps(item.serverStage?.direction, item.serverStage, photo),
            sources,
            split,
            stages: withDurations,
            startedAt: item.startedAt,
            lastAt: lastStage ? lastStage.until || lastStage.at : item.startedAt,
            // Wall-clock time the whole transfer took, or, while it is still
            // going, how long this device has been at it.
            elapsedMs: done && endedAt !== null ? Math.max(0, endedAt - item.startedAt) : null,
            runningMs: done ? null : Math.max(0, now - item.startedAt),
        };
        row.decentral = describeSplit(split);
        row.why = explain({ row, photo, peersById, myPeerId, mine, hasTurn });
        return row;
    });
    return rows.sort((a, b) => b.lastAt - a.lastAt);
}

/** How long something took: "0.4 s", "12.4 s", "2 m 05 s". */
export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes} m ${String(seconds).padStart(2, '0')} s`;
}

/** "fully peer-to-peer", "70% P2P · 30% server", and so on. */
export function describeSplit({ total, server, relay, p2p }) {
    if (!total) return { level: 'none', text: 'no bytes moved yet' };
    if (!server && !relay) return { level: 'p2p', text: 'fully peer-to-peer' };
    if (!server) return { level: 'relay', text: `peer-to-peer · ${percent(relay, total)}% through TURN` };
    if (!p2p && !relay) return { level: 'server', text: 'all through the server' };
    return { level: 'mixed', text: `${percent(p2p + relay, total)}% P2P · ${percent(server, total)}% server` };
}

/** All of this session's transfers added up, for the tab's headline. */
export function totals(rows) {
    return rows.reduce((sum, row) => ({
        total: sum.total + row.split.total,
        p2p: sum.p2p + row.split.p2p,
        relay: sum.relay + row.split.relay,
        server: sum.server + row.split.server,
    }), { total: 0, p2p: 0, relay: 0, server: 0 });
}
