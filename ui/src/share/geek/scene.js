import StringUtil from '../util/StringUtil';
import { describeIceServers, summarizeChain, forecastPath, verdictFor, NAT_LABELS } from '../topology/NetworkInsight';

// The geek stage draws the room as layers, top to bottom, so where a node
// sits says what it is:
//   photogroup.network (edge, API + SSE, tracker, server copies)
//   the internet between: STUN, NATs (public addresses), TURN relays
//   devices, each with the photos it holds underneath
// Routes go through those layers the way traffic actually does.

export const TIER = { infra: 0.12, net: 0.4, device: 0.66 };
export const THUMB = 34;
const MAX_THUMBS = 5;

const isReflexive = item => item && (item.type === 'srflx' || item.type === 'prflx'
    || (item.typeDetail || '').includes('srflx') || (item.typeDetail || '').includes('prflx'));
const isRelayCandidate = item => item && (item.type === 'relay' || (item.typeDetail || '').startsWith('relay'));

export function hostOf(url) {
    try {
        const parsed = new URL(url);
        return parsed.host;
    } catch {
        return String(url || '');
    }
}

function deviceName(peer) {
    return peer.name || StringUtil.peerDevice(peer) || String(peer.peerId || '').slice(0, 8);
}

function candidateLine(item) {
    const transport = (item.transport || '').toLowerCase();
    return `${item.type || item.typeDetail || '?'} ${item.ip}${item.port ? ':' + item.port : ''}${transport ? ' ' + transport : ''}`;
}

function placeLine(network) {
    if (!network) return null;
    const isp = network.connection && (network.connection.isp || network.connection.org);
    const where = [network.city, network.country].filter(Boolean).join(', ');
    return [where, isp].filter(Boolean).join(' · ') || null;
}

/** What the page can learn about photogroup.network from where it was loaded. */
function infraNodes({ origin, trackerUrl, photos }) {
    const host = hostOf(origin) || 'photogroup.network';
    const local = /localhost|127\.0\.0\.1/.test(host);
    const copies = photos.filter(photo => photo.hasServerCopy);
    const uploading = photos.filter(photo => photo.serverCopyUploader && !photo.hasServerCopy);
    const bytes = copies.reduce((sum, photo) => sum + (photo.serverCopySize || 0), 0);
    return [
        {
            id: 'edge', kind: 'edge', label: local ? 'dev server' : 'edge',
            sub: local ? host : 'Cloud Run wake → nginx',
            info: local
                ? [`origin ${host}`, 'vite dev server proxies /api to :8081']
                : [`origin ${host} (TLS)`, 'Cloud Run photogroup-wake starts the VM when needed', 'nginx :443 → app :8081, tracker :9000', 'the VM stops when nobody uses it'],
        },
        {
            id: 'api', kind: 'api', label: 'API · SSE', sub: ':8081 rooms, peers, magnets',
            info: ['REST: rooms, peers, magnet links, photo details', 'Server-Sent Events send room changes to all devices',
                'keeps · the people here: peer ID, name, device, network addresses',
                'keeps · per photo: magnet link (infohash), name, type, size, date taken, fingerprint, titles',
                'keeps rooms and photo data on disk until nobody uses the room for 30 days; people in memory only',
                'never sees · the photos (only a server copy, if someone asks for one)'],
        },
        {
            id: 'tracker', kind: 'tracker', label: 'tracker', sub: hostOf(trackerUrl) || 'ws :9000',
            info: ['BitTorrent WebSocket tracker', 'devices send infohashes here, and exchange WebRTC offers and answers',
                'sees · which device wants which infohash, and the ICE candidates',
                'never sees · the photos', trackerUrl ? `url ${trackerUrl}` : null].filter(Boolean),
        },
        {
            id: 'copies', kind: 'copies', label: 'server copies',
            sub: copies.length ? `${copies.length} held` + (bytes ? ` · ${(bytes / 1048576).toFixed(1)} MB` : '') : (uploading.length ? `${uploading.length} uploading` : 'none held'),
            info: ['last resort when P2P and TURN fail', 'keeps · the photo, only while a device needs it',
                '8 MB parts, upload continues after a stop, 60 s upload lease', 'deleted when all devices have the photo, or 24 h after upload',
                `${copies.length} held, ${uploading.length} uploading`],
        },
    ];
}

/**
 * Build the scene for the current room: nodes with positions, routes as
 * lists of node ids, and photo thumbnails placed under the devices holding them.
 * `tiles` are the gallery's tiles (they carry owners, the image URL and progress).
 */
export function buildScene({ myPeerId, peers = [], connections = [], localNetwork = null, me = {}, rtcConfig = null,
    trackerUrl = '', origin = '', tiles = [], photos = [], width = 800, height = 600 }) {
    const nodes = [];
    const routes = [];
    const thumbs = [];
    const byId = new Map();
    const add = node => {
        if (byId.has(node.id)) return byId.get(node.id);
        byId.set(node.id, node);
        nodes.push(node);
        return node;
    };

    // Devices: everyone in the room, with us in the middle.
    const list = peers.map(peer => ({ ...peer }));
    if (myPeerId && !list.find(peer => peer.peerId === myPeerId)) {
        list.push({ ...me, peerId: myPeerId, networkChain: localNetwork || [] });
    }
    const mine = list.find(peer => peer.peerId === myPeerId);
    if (mine && !(mine.networkChain && mine.networkChain.length) && localNetwork) mine.networkChain = localNetwork;
    const others = list.filter(peer => peer.peerId !== myPeerId);
    const ordered = [...others.slice(0, Math.ceil(others.length / 2)), ...(mine ? [mine] : []), ...others.slice(Math.ceil(others.length / 2))];

    // Phones are too narrow for one row of servers or wide device boxes.
    const compact = width < 640;
    const deviceY = height * TIER.device;
    const netY = height * TIER.net;
    const infraY = height * TIER.infra;

    // What used to be the "This device" panel lives on the nodes: our link's
    // verdict on ours, the path a transfer is likely to take on everyone else's.
    const ice = describeIceServers(rtcConfig);
    const hasTurn = ice.turn.length > 0;
    const mySummary = summarizeChain(mine?.networkChain || localNetwork);
    const linkLines = (summary, isMe) => {
        if (isMe) {
            return [
                `link · ${verdictFor(summary, { hasTurn }).text}`,
                summary.mdnsCount ? `${summary.mdnsCount} host candidate${summary.mdnsCount > 1 ? 's' : ''} masked as mDNS .local` : null,
                summary.cgnat ? 'CGNAT 100.64/10: your ISP adds a second NAT' : null,
                summary.transports?.length ? `stack ${summary.transports.join('+').toUpperCase()}${summary.ipv6 ? ' · IPv6' : ' · IPv4 only'}` : null,
                `stun ${ice.stun.slice(0, 2).join(', ') || 'none'}`,
                `turn ${ice.turn.slice(0, 2).join(', ') || 'none · the HTTPS server copy is the fallback'}`,
            ];
        }
        const forecast = forecastPath(mySummary, summary, { hasTurn });
        return [`path from you · ${forecast.label}`, forecast.why];
    };

    ordered.forEach((peer, index) => {
        const chain = peer.networkChain || [];
        const summary = summarizeChain(chain);
        const isMe = peer.peerId === myPeerId;
        add({
            id: peer.peerId, kind: 'device', isMe, example: !!peer.example,
            x: width * (index + 1) / (ordered.length + 1), y: deviceY,
            maxW: Math.min(260, Math.max(72, width / (ordered.length + 1) - 12)),
            label: (isMe ? 'you · ' : '') + deviceName(peer),
            sub: summary.lanIps[0] || (summary.mdnsCount ? 'mDNS host' : ''),
            peer, summary,
            info: [
                `peer ${String(peer.peerId).slice(0, 16)}`,
                peer.device || null,
                StringUtil.slimPlatform(peer.originPlatform || '') || null,
                peer.connectionSpeedType ? `link ${peer.connectionSpeedType}` : null,
                `NAT ${NAT_LABELS[summary.nat] || summary.nat}${summary.cgnat ? ' · carrier-grade NAT' : ''}`,
                ...linkLines(summary, isMe),
                ...chain.slice(0, 8).map(candidateLine),
            ].filter(Boolean),
        });
    });

    // NATs: one per public address, above the devices behind it.
    const natOf = new Map();
    ordered.forEach(peer => {
        const reflexive = (peer.networkChain || []).find(isReflexive);
        if (!reflexive) return;
        const id = 'nat:' + reflexive.ip;
        const nat = add({
            id, kind: 'nat', x: 0, y: netY, members: [],
            label: reflexive.ip, sub: reflexive.example ? 'example address' : placeLine(reflexive.network) || 'public address',
            example: !!reflexive.example,
            info: [
                `public ${reflexive.ip}${reflexive.port ? ':' + reflexive.port : ''}`,
                reflexive.network?.hostname ? `rdns ${reflexive.network.hostname}` : null,
                placeLine(reflexive.network),
                reflexive.typeDetail ? `seen as ${reflexive.typeDetail}` : null,
                'from the STUN reply',
            ].filter(Boolean),
        });
        nat.members.push(peer.peerId);
        natOf.set(peer.peerId, id);
    });
    nodes.filter(node => node.kind === 'nat').forEach(nat => {
        const xs = nat.members.map(id => byId.get(id).x);
        nat.x = xs.reduce((a, b) => a + b, 0) / xs.length;
    });

    // photogroup.network across the top middle, third parties at the sides.
    const rack = infraNodes({ origin, trackerUrl, photos });
    if (compact) {
        // Two rows of two, right of STUN.
        rack.forEach((node, index) => add({
            ...node,
            x: width * (index % 2 ? 0.81 : 0.5),
            y: infraY + (index < 2 ? -22 : 22),
            maxW: width * 0.29,
        }));
    } else {
        const rackLeft = width * 0.2;
        const rackWidth = width * 0.6;
        rack.forEach((node, index) => add({ ...node, x: rackLeft + rackWidth * (index + 0.5) / rack.length, y: infraY, maxW: rackWidth / rack.length - 12 }));
    }
    // STUN and TURN sit between the servers and the NATs, clear of the tier labels.
    const sideY = compact ? (infraY + netY) / 2 - 10 : infraY + (netY - infraY) * 0.4;

    const stun = add({
        id: 'stun', kind: 'stun', x: Math.max(width * 0.07, 48), y: sideY,
        label: 'STUN', sub: ice.stun[0] || 'none configured',
        info: ['tells each device its public address and port', 'a public server, not photogroup.network',
            'sees · your public IP address and port only', ...ice.stun.map(host => `stun ${host}`)],
    });
    const relayIps = new Set();
    ordered.forEach(peer => (peer.networkChain || []).filter(isRelayCandidate).forEach(item => relayIps.add(item.ip)));
    // Always on the map: when there is none, that is worth seeing too, since
    // the server copy then catches what TURN would have.
    const turnHere = ice.turn.length > 0 || relayIps.size > 0;
    const provider = ice.turn.some(host => /twilio/i.test(host)) ? 'Twilio' : null;
    const turn = add({
        id: 'turn', kind: 'turn', x: Math.min(width * 0.93, width - 48), y: sideY,
        label: 'TURN', sub: turnHere ? (provider || ice.turn[0] || [...relayIps][0]) : 'none configured',
        idle: !turnHere,
        info: turnHere
            ? ['forwards WebRTC data when no direct path works', `a ${provider ? provider + ' ' : ''}relay, not photogroup.network`,
                'sees · both IP addresses and encrypted data; it cannot read the photo',
                ...ice.turn.map(host => `turn ${host}`), ...[...relayIps].map(ip => `relay candidate ${ip}`)]
            : ['forwards WebRTC data when no direct path works', 'not configured on this server',
                'if P2P cannot connect, the HTTPS server copy takes over'],
    });

    // Routes. Signalling: every device keeps an event stream to the API and
    // a socket to the tracker, out through its NAT.
    const via = id => (natOf.has(id) ? [id, natOf.get(id)] : [id]);
    ordered.forEach(peer => {
        routes.push({ id: 'sse:' + peer.peerId, kind: 'sse', path: [...via(peer.peerId), 'edge', 'api'], peerId: peer.peerId });
        routes.push({ id: 'tracker:' + peer.peerId, kind: 'tracker', path: [...via(peer.peerId), 'edge', 'tracker'], peerId: peer.peerId });
        routes.push({ id: 'copies:' + peer.peerId, kind: 'copies', path: [...via(peer.peerId), 'edge', 'copies'], peerId: peer.peerId });
    });
    nodes.filter(node => node.kind === 'nat').forEach(nat => {
        routes.push({ id: 'stun:' + nat.id, kind: 'stun', path: [nat.id, stun.id] });
    });
    // This device asks STUN even when no NAT is known yet (STUN may not have
    // answered), and asks TURN for a relay address when one is configured.
    if (byId.has(myPeerId)) {
        if (!natOf.has(myPeerId)) routes.push({ id: 'stun:' + myPeerId, kind: 'stun', path: [myPeerId, stun.id], peerId: myPeerId });
        if (turnHere) routes.push({ id: 'turnctl:' + myPeerId, kind: 'turnctl', path: [...via(myPeerId), turn.id], peerId: myPeerId });
    }

    // Transfers, by the path ICE settled on.
    const seen = new Set();
    connections.forEach(conn => {
        const a = conn.fromPeerId;
        const b = conn.toPeerId;
        if (!byId.has(a) || !byId.has(b) || a === b) return;
        const key = [a, b].sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);
        const type = String(conn.connectionType || '').trim();
        let path;
        let kind;
        if (type.startsWith('relay')) {
            kind = 'relay';
            path = [...via(a), turn.id, ...via(b).reverse()];
        } else if (type === 'p2p') {
            kind = 'lan';
            path = [a, b];
        } else {
            kind = 'punch';
            const left = via(a);
            const right = via(b).reverse();
            // Same NAT: hairpin through it.
            path = left[1] && left[1] === right[0] ? [a, left[1], b] : [...left, ...right];
        }
        routes.push({ id: 'p2p:' + key, kind, path, peers: [a, b], label: type || 'p2p', conn });
    });

    // Photos: under each device that holds a full copy; ours also while arriving.
    const devices = nodes.filter(node => node.kind === 'device');
    // One row of thumbnails, centred under a node, with a +N when they overflow.
    const shelf = (node, held, offset) => {
        const shown = held.slice(0, MAX_THUMBS);
        const gap = 6;
        const total = shown.length * THUMB + (shown.length - 1) * gap;
        shown.forEach((tile, index) => {
            thumbs.push({
                key: node.id + ':' + (tile.tileKey || tile.infoHash),
                tileKey: tile.tileKey || tile.infoHash,
                deviceId: node.id,
                x: Math.min(width - THUMB / 2 - 4, Math.max(THUMB / 2 + 4, node.x - total / 2 + index * (THUMB + gap) + THUMB / 2)),
                y: node.y + offset + THUMB / 2,
                size: THUMB,
                tile,
                more: index === MAX_THUMBS - 1 && held.length > MAX_THUMBS ? held.length - MAX_THUMBS + 1 : 0,
            });
        });
        node.mediaCount = held.length;
    };
    devices.forEach(device => {
        const held = tiles.filter(tile => {
            const owners = tile.owners || [];
            if (device.isMe) return true;
            return tile.peerId === device.id || owners.some(owner => owner.peerId === device.id && !owner.loading);
        });
        shelf(device, held, 44);
        device.photoCount = held.length;
    });
    // The server holds bytes too, and used to be the one node that showed no
    // media for them: the copies it keeps sit under it like a device's photos.
    const copies = byId.get('copies');
    if (copies) shelf(copies, tiles.filter(tile => tile.hasServerCopy), 30);

    return { nodes, routes, thumbs, byId };
}

/**
 * The transfer routes a torrent's progress belongs on: ours to the peers
 * we hold a wire with for it. With no wires to go by, all of ours.
 */
export function transferRoutesFor(routes, myPeerId, torrent) {
    const mine = routes.filter(route => route.peers && route.peers.includes(myPeerId));
    const wired = new Set((torrent?.wires || []).map(wire => String(wire.peerId)));
    if (!wired.size) return mine;
    return mine.filter(route => route.peers.some(id => id !== myPeerId && wired.has(String(id))));
}

/** The points of a route, in order. */
export function routePoints(scene, route) {
    return route.path.map(id => scene.byId.get(id)).filter(Boolean).map(node => ({ x: node.x, y: node.y }));
}

/** A point `t` (0..1) of the way along a polyline, by length. */
export function pointAlong(points, t) {
    if (points.length < 2) return points[0] || { x: 0, y: 0 };
    const lengths = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        lengths.push(length);
        total += length;
    }
    let left = Math.max(0, Math.min(1, t)) * total;
    for (let i = 0; i < lengths.length; i++) {
        if (left <= lengths[i] || i === lengths.length - 1) {
            const k = lengths[i] ? left / lengths[i] : 0;
            return {
                x: points[i].x + (points[i + 1].x - points[i].x) * k,
                y: points[i].y + (points[i + 1].y - points[i].y) * k,
            };
        }
        left -= lengths[i];
    }
    return points[points.length - 1];
}
