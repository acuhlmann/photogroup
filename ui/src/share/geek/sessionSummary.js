import { describeIceServers, describeTrackers } from '../topology/NetworkInsight';
import { buildAnnounceList } from '../torrent/DiscoveryConfig';
import { formatDuration, totals, describeSplit, peerName } from './transfers';

// The share as a whole: how long each device took, how the bytes went, and
// the total time, for the map's card when a share is done and for Transfers.

/** "first photo 2.1 s · all 3 in 14 s", or how far a device has come. */
export function deviceTimesLine(row) {
    if (!row || !row.wanted) return null;
    const parts = [];
    if (row.firstMs !== null) parts.push(`first photo ${formatDuration(row.firstMs)}`);
    if (row.allMs !== null) parts.push(`all ${row.wanted} in ${formatDuration(row.allMs)}`);
    else if (row.got < row.wanted) {
        parts.push(`${row.got} of ${row.wanted}`);
        if (row.waitingMs !== null) parts.push(`${formatDuration(row.waitingMs)} so far`);
    } else if (row.before) parts.push(`had all ${row.wanted} before you came`);
    return parts.join(' · ') || null;
}

/**
 * The summary of this session's share.
 * @param {object} input
 * @param {object[]} input.rows readTransfers()
 * @param {object} input.share DeviceTimes.summary()
 * @param {object[]} input.devices DeviceTimes.read()
 * @param {object[]} input.peers the room's peers
 * @param {string} input.myPeerId
 * @param {object|null} [input.rtcConfig]
 * @param {string} [input.trackerUrl]
 * @param {string[]} [input.announceUrls]
 */
export function readSummary({ rows = [], share = {}, devices = [], peers = [], myPeerId,
    rtcConfig = null, trackerUrl = '', announceUrls } = {}) {
    const sum = totals(rows);
    const split = describeSplit(sum);
    const byId = new Map(peers.map(peer => [peer.peerId, peer]));
    const percent = part => (sum.total ? Math.round(part / sum.total * 100) : 0);

    const ice = rtcConfig ? describeIceServers(rtcConfig) : null;
    const hasTurn = ice ? ice.turn.length > 0 : undefined;
    const hasStun = ice ? ice.stun.length > 0 : undefined;
    const effectiveAnnounce = announceUrls !== undefined
        ? announceUrls
        : (trackerUrl ? buildAnnounceList(trackerUrl) : null);
    const trackers = effectiveAnnounce || trackerUrl
        ? describeTrackers(effectiveAnnounce || [], trackerUrl)
        : null;

    return {
        done: !!share.done,
        key: share.endedAt || null,
        headline: [
            `${share.photos || 0} ${share.photos === 1 ? 'photo' : 'photos'} to ${Math.max(0, (share.devices || 1) - 1)} ${share.devices === 2 ? 'device' : 'devices'}`,
            share.totalMs !== null && share.totalMs !== undefined ? `in ${formatDuration(share.totalMs)}` : null,
        ].filter(Boolean).join(' '),
        split,
        bytes: sum,
        parts: [
            { kind: 'p2p', label: 'P2P direct', note: 'LAN / STUN-assisted', percent: percent(sum.p2p) },
            { kind: 'relay', label: 'TURN relay', note: 'encrypted media relay', percent: percent(sum.relay) },
            { kind: 'server', label: 'server copy', note: hasTurn === false ? 'no-TURN HTTPS fallback' : 'HTTPS fallback', percent: percent(sum.server) },
        ],
        network: (ice || trackers) ? {
            hasStun,
            hasTurn,
            stunLabel: hasStun ? 'STUN discovery' : 'no STUN',
            turnLabel: hasTurn ? 'TURN media relay ready' : (hasTurn === false ? 'no TURN · HTTPS server copy fallback' : null),
            primaryTracker: trackers?.primaryHost || null,
            publicTrackers: trackers?.external?.length || 0,
        } : null,
        devices: devices.filter(row => row.wanted > 0).map(row => ({
            peerId: row.peerId,
            name: row.peerId === myPeerId ? 'you' : peerName(byId.get(row.peerId)) || String(row.peerId).slice(0, 8),
            line: deviceTimesLine(row),
            done: row.got === row.wanted,
        })),
    };
}
