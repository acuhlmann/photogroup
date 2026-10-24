import StringUtil from '../util/StringUtil';

// Turns the app's events into one-line log entries for geek mode: what came
// over the wire, from the server and the swarm, as it happens.

const short = (value, length = 8) => (value ? String(value).slice(0, length) : '?');

function peerName(peer) {
    if (!peer) return 'peer';
    return peer.name || StringUtil.slimPlatform(peer.originPlatform || '') || short(peer.peerId);
}

function torrentName(torrent) {
    if (!torrent) return '?';
    return torrent.name || short(torrent.infoHash);
}

/**
 * One log entry for an event, or null for events not worth a line.
 * `kind` is the channel it came on: wire, rx, tx, peer, link, photo, ice, sse.
 */
export function describeEvent(name, args) {
    const [first, second, third] = args;
    switch (name) {
    case 'wire': {
        // WebRTC wires have no address; name the peer instead.
        const addr = second || first?.remoteAddress || 'peer ' + short(first?.peerId);
        return { kind: 'wire', text: `handshake ${addr} · ${torrentName(third)} · ${first?.type || 'webrtc'}` };
    }
    case 'downloadProgress': {
        if (!first) return null;
        const percent = Number.isFinite(first.progress) ? ` ${Math.round(first.progress)}%` : '';
        return { kind: 'rx', key: 'rx' + (first.torrent?.infoHash || ''), text: `${first.speed || '0 B/s'} ← ${torrentName(first.torrent)}${percent}` };
    }
    case 'uploadProgress': {
        if (!first) return null;
        return { kind: 'tx', key: 'tx' + (first.torrent?.infoHash || ''), text: `${first.speed || '0 B/s'} → ${torrentName(first.torrent)}` };
    }
    case 'pieceReceived':
    case 'pieceSent': {
        if (!first) return null;
        const arrow = name === 'pieceReceived' ? '←' : '→';
        return {
            kind: name === 'pieceReceived' ? 'rx' : 'tx',
            key: name + (first.torrent?.infoHash || '') + first.peerId,
            text: `piece ${first.index + 1}/${first.total} ${arrow} peer ${short(first.peerId)} · ${torrentName(first.torrent)}`,
        };
    }
    case 'peers': {
        if (!first) return null;
        if (first.type === 'add') return { kind: 'peer', text: `+ ${peerName(first.item)} joined (${short(first.item?.peerId)})` };
        if (first.type === 'delete') return { kind: 'peer', text: `− ${short(first.item)} left` };
        return null;
    }
    case 'peerConnections': {
        if (!Array.isArray(first)) return null;
        const types = first.reduce((counts, conn) => {
            const type = conn.connectionType || 'link';
            counts[type] = (counts[type] || 0) + 1;
            return counts;
        }, {});
        const summary = Object.entries(types).map(([type, count]) => `${count} ${type}`).join(', ');
        return { kind: 'link', text: first.length ? `topology ${summary}` : 'topology no links' };
    }
    case 'photos': {
        if (!first) return null;
        if (first.type === 'add') {
            // Adds come as a list of photos.
            const added = [].concat(first.item || []);
            const photo = added[0] || {};
            const more = added.length > 1 ? ` +${added.length - 1}` : '';
            return { kind: 'photo', text: `+ ${photo.fileName || 'photo'} magnet ${short(photo.infoHash, 10)}${more}` };
        }
        if (first.type === 'delete') return { kind: 'photo', text: `− ${short(first.item?.infoHash || first.item, 10)} removed` };
        if (first.type === 'all' && Array.isArray(first.item)) return { kind: 'sse', text: `room snapshot · ${first.item.length} photos` };
        return null;
    }
    case 'pcEvent': {
        if (!second) return null;
        return { kind: 'ice', text: `${String(first).replace('statechange', '')} → ${second}` };
    }
    case 'localNetwork': {
        if (!Array.isArray(first) || !first.length) return null;
        const types = [...new Set(first.map(item => item.typeDetail || item.type).filter(Boolean))];
        return { kind: 'ice', text: `${first.length} candidates · ${types.join(' ')}` };
    }
    case 'sseReconnected':
        return { kind: 'sse', text: 'event stream reconnected' };
    default:
        return null;
    }
}

export const LOGGED_EVENTS = [
    'wire', 'downloadProgress', 'uploadProgress', 'pieceReceived', 'pieceSent', 'peers', 'peerConnections',
    'photos', 'pcEvent', 'localNetwork', 'sseReconnected',
];
