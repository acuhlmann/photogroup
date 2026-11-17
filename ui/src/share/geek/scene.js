import StringUtil from '../util/StringUtil';
import { buildAnnounceList } from '../torrent/DiscoveryConfig';
import { describeIceServers, describeTrackers, summarizeChain, forecastPath, verdictFor, NAT_LABELS } from '../topology/NetworkInsight';

// The geek stage draws the room as layers, top to bottom, so where a node
// sits says what it is:
//   photogroup.network (edge gateway over API + SSE, primary WS tracker, server copies)
//   internet · discovery · relays (STUN, public backup WS trackers, TURN, NATs)
//   devices, each with the photos it holds underneath
// Routes curve and fan out across shared segments so overlapping flows stay readable.

export const TIER = { infra: 0.12, net: 0.44, device: 0.66 };
export const THUMB = 34;
export const THUMB_COMPACT = 28;
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
    const where = [network.city, network.country_code || network.country].filter(Boolean).join(', ');
    return [where, isp].filter(Boolean).join(' · ') || null;
}

/** True when enrichment has place, ISP, or reverse DNS worth showing on a NAT card. */
export function isUsefulNetwork(network) {
    if (!network || typeof network !== 'object') return false;
    const isp = network.connection && (network.connection.isp || network.connection.org);
    return !!(network.city || network.country || network.country_code || network.hostname || isp);
}

/** Last useful enrichment per public IP across scene rebuilds (SSE empty shells, new ports). */
const stickyNatNetworkByIp = new Map();

export function resetStickyNatNetwork() {
    stickyNatNetworkByIp.clear();
}

/**
 * Prefer the current enrichment; otherwise reuse a sticky / room-wide copy for the same IP
 * so NAT titles do not flash back to "public address" when a later chain update is bare.
 */
export function networkForNat(ip, current, roomNetworksByIp = null) {
    if (isUsefulNetwork(current)) {
        if (ip) stickyNatNetworkByIp.set(ip, current);
        return current;
    }
    if (ip && roomNetworksByIp?.has(ip) && isUsefulNetwork(roomNetworksByIp.get(ip))) {
        const fromRoom = roomNetworksByIp.get(ip);
        stickyNatNetworkByIp.set(ip, fromRoom);
        return fromRoom;
    }
    if (ip && stickyNatNetworkByIp.has(ip)) return stickyNatNetworkByIp.get(ip);
    return current || null;
}

function collectUsefulNetworksByIp(peers) {
    const byIp = new Map();
    (peers || []).forEach(peer => {
        (peer.networkChain || []).forEach(item => {
            if (item?.ip && isUsefulNetwork(item.network) && !byIp.has(item.ip)) {
                byIp.set(item.ip, item.network);
            }
        });
    });
    return byIp;
}

/** Human-readable NAT title: place → rDNS → ISP → stable fallback (never the raw IP). */
export function natTitle(network) {
    if (!network) return 'public address';
    const where = [network.city, network.country_code || network.country].filter(Boolean).join(', ');
    const isp = network.connection && (network.connection.isp || network.connection.org);
    if (where) return [where, isp].filter(Boolean).join(' · ');
    if (network.hostname) return network.hostname;
    if (isp) return isp;
    return 'public address';
}

function trackerStateLabel(states, url) {
    if (!states || !url) return null;
    const st = typeof states.get === 'function' ? states.get(url) : states[url];
    if (!st) return null;
    if (st.connected) return 'connected';
    if (st.waiting) return 'reconnecting';
    return 'idle';
}

/** What the page can learn about photogroup.network from where it was loaded. */
function infraNodes({ origin, trackerUrl, photos, trackerStates }) {
    const host = hostOf(origin) || 'photogroup.network';
    const local = /localhost|127\.0\.0\.1/.test(host);
    const copies = photos.filter(photo => photo.hasServerCopy);
    const uploading = photos.filter(photo => !photo.hasServerCopy && (photo.serverCopyUploader || photo.serverCopyReceived > 0));
    const asked = photos.filter(photo => !photo.hasServerCopy && !uploading.includes(photo) && photo.serverCopyRequestedAt);
    const bytes = copies.reduce((sum, photo) => sum + (photo.serverCopySize || 0), 0);
    const held = copies.length ? `${copies.length} held` + (bytes ? ` · ${(bytes / 1048576).toFixed(1)} MB` : '') : null;
    const coming = [uploading.length ? `${uploading.length} uploading` : null, asked.length ? `${asked.length} asked` : null];
    const copiesSub = [held, ...coming].filter(Boolean).slice(0, 2).join(' · ') || 'none held';
    const pgTrackerState = trackerStateLabel(trackerStates, trackerUrl);
    return [
        {
            id: 'edge', kind: 'edge', badge: local ? 'DEV PROXY' : 'INGRESS',
            label: local ? 'dev server' : 'edge',
            sub: local ? host : 'Cloud Run wake → nginx',
            info: local
                ? [`origin ${host}`, 'vite dev server proxies /api to :8081']
                : [`origin ${host} (TLS)`, 'Cloud Run photogroup-wake starts the VM when needed', 'nginx :443 → app :8081, tracker :9000', 'the VM stops when nobody uses it'],
        },
        {
            id: 'api', kind: 'api', badge: 'STATE · SSE',
            label: 'API · SSE', sub: ':8081 rooms, peers, magnets',
            info: ['REST: rooms, peers, magnet links, photo details', 'Server-Sent Events send room changes to all devices',
                'keeps · the people here: peer ID, name, device, network addresses',
                'keeps · per photo: magnet link (infohash), name, type, size, date taken, fingerprint, titles',
                'keeps rooms and photo data on disk until nobody uses the room for 30 days; people in memory only',
                'never sees · the photos (only a server copy, if someone asks for one)'],
        },
        {
            id: 'tracker', kind: 'tracker', badge: 'PRIMARY WS',
            label: 'tracker', sub: hostOf(trackerUrl) || 'ws :9000',
            status: pgTrackerState === 'connected' ? 'connected' : pgTrackerState === 'reconnecting' ? 'waiting' : null,
            info: [
                'PhotoGroup primary BitTorrent WebSocket tracker',
                pgTrackerState ? `socket · ${pgTrackerState}` : null,
                'devices announce infohashes here and exchange WebRTC offers and answers',
                'feeds server-side ICE topology view (the only tracker the server inspects)',
                'sees · which device wants which infohash, and the ICE candidates',
                'never sees · the photos',
                trackerUrl ? `url ${trackerUrl}` : null,
            ].filter(Boolean),
        },
        {
            id: 'copies', kind: 'copies', badge: 'TEMP RELAY',
            label: 'server copies',
            sub: copiesSub,
            info: ['last resort when P2P and TURN fail', 'keeps · the photo, only while a device needs it',
                '8 MB parts, upload continues after a stop, 60 s upload lease', 'deleted when all devices have the photo, or 24 h after upload',
                `${copies.length} held, ${uploading.length} uploading, ${asked.length} asked for`],
        },
    ];
}

/**
 * Build the scene for the current room: nodes with positions, routes as
 * lists of node ids, and photo thumbnails placed under the devices holding them.
 * `tiles` are the gallery's tiles (they carry owners, the image URL and progress).
 */
export function buildScene({ myPeerId, peers = [], connections = [], localNetwork = null, me = {}, rtcConfig = null,
    trackerUrl = '', announceUrls, trackerStates = null, origin = '', tiles = [], photos = [], width = 800, height = 600 }) {
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

    // Phones and narrow split-panes are too narrow for sidebars; tightY handles short
    // unfolded foldables or viewports with the bottom log drawer open.
    const compact = width < 640;
    const tightY = height < 520;
    const veryShort = height < 340;
    const hasCopiesOnShelf = photos.some(p => p.hasServerCopy || p.serverCopyUploader || p.serverCopyReceived > 0 || p.serverCopyRequestedAt)
        || tiles.some(t => t.hasServerCopy || t.serverCopyUploader || t.serverCopyReceived > 0 || t.serverCopyRequestedAt);

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

    // photogroup.network across the top middle: edge gateway above API, tracker and copies
    // so ingress lines fan downward cleanly instead of piercing through sibling boxes.
    const [edgeNode, apiNode, trackerNode, copiesNode] = infraNodes({ origin, trackerUrl, photos, trackerStates });
    const rackLeft = compact ? width * 0.03 : width * 0.22;
    const rackWidth = compact ? width * 0.94 : width * 0.56;
    const serviceNodes = [apiNode, trackerNode, copiesNode];

    const effectiveAnnounce = announceUrls === undefined ? buildAnnounceList(trackerUrl) : announceUrls;
    const trackerSummary = describeTrackers(effectiveAnnounce, trackerUrl);
    const extTrackers = trackerSummary.external;

    const side = (compact || height < 260) ? THUMB_COMPACT : THUMB;
    const thumbOffset = height < 260 ? 22 : (tightY ? 30 : 44);
    const thumbReserve = tiles.length
        ? (height < 260 ? thumbOffset + side + 6 : (tightY ? 72 : 96))
        : (height < 260 ? 22 : (tightY ? 46 : 64));

    let edgeY;
    let servicesY;
    let compactExtY;
    let stunY;
    let pubY;
    let turnY;
    let effectiveNetY;
    let deviceY;

    if (veryShort) {
        // When the log drawer leaves <340px (e.g. <220px), scale tiers proportionally
        // inside [0, height] so devices and thumbnails stay visible and selectable.
        deviceY = Math.round(Math.max(24, height - thumbReserve));
        edgeY = Math.round(Math.max(16, deviceY * 0.14));
        const span = Math.max(40, deviceY - edgeY);
        servicesY = Math.round(edgeY + span * 0.28);
        compactExtY = Math.round(edgeY + span * 0.56);
        stunY = compact ? compactExtY : Math.round(edgeY + span * 0.30);
        turnY = compact ? compactExtY : Math.round(edgeY + span * 0.36);
        pubY = compact ? compactExtY : Math.round(edgeY + span * 0.54);
        effectiveNetY = Math.round(edgeY + span * 0.78);
    } else {
        edgeY = Math.round(Math.max(compact ? 38 : (tightY ? 42 : 48), height * (compact ? 0.07 : 0.082)));
        servicesY = Math.round(Math.max(edgeY + (compact ? (tightY ? 46 : 52) : (tightY ? 48 : 58)), height * (compact ? 0.165 : 0.19)));

        // Monotonic tier Y positions so STUN, Public trackers, TURN, NATs, and devices never overlap
        // on short foldables (~880x420 with drawer open) or narrow phones (~360x640).
        compactExtY = Math.round(Math.max(servicesY + (hasCopiesOnShelf ? 94 : 68), height * 0.31));
        stunY = compact ? compactExtY : Math.round(Math.max(edgeY + (tightY ? 50 : 72), height * 0.22));
        pubY = compact ? compactExtY : Math.round(Math.max(stunY + (tightY ? 56 : 74), height * 0.34));
        turnY = compact ? compactExtY : Math.round(Math.max(edgeY + (tightY ? 56 : 80), height * 0.27));

        const minNetY = compact
            ? compactExtY + (tightY ? 56 : 70)
            : Math.max(
                servicesY + (hasCopiesOnShelf ? 96 : 56),
                extTrackers.length ? pubY + (tightY ? 48 : 64) : stunY + (tightY ? 48 : 64),
                turnY + (tightY ? 46 : 56),
            );
        const maxDeviceY = Math.max(220, height - thumbReserve);
        deviceY = Math.round(Math.min(maxDeviceY, Math.max(height * TIER.device, minNetY + (tightY ? 52 : 76))));
        effectiveNetY = Math.round(Math.min(deviceY - (tightY ? 48 : 64), Math.max(height * TIER.net, minNetY)));
        if (effectiveNetY < minNetY && deviceY < maxDeviceY) {
            effectiveNetY = Math.round(minNetY);
            deviceY = Math.round(Math.min(maxDeviceY, effectiveNetY + (tightY ? 48 : 64)));
        }
    }

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

    add({
        ...edgeNode,
        x: width * 0.5,
        y: edgeY,
        maxW: compact ? rackWidth * 0.58 : Math.min(230, rackWidth * 0.46),
    });
    serviceNodes.forEach((node, index) => add({
        ...node,
        x: rackLeft + rackWidth * (index + 0.5) / serviceNodes.length,
        y: servicesY,
        maxW: rackWidth / serviceNodes.length - (compact ? 6 : 14),
    }));

    // NATs: one per public address, above the devices behind it.
    const roomNetworksByIp = collectUsefulNetworksByIp(ordered);
    const natOf = new Map();
    ordered.forEach(peer => {
        const reflexive = (peer.networkChain || []).find(isReflexive);
        if (!reflexive) return;
        const id = 'nat:' + reflexive.ip;
        const memberSummary = summarizeChain(peer.networkChain || []);
        const network = networkForNat(reflexive.ip, reflexive.network, roomNetworksByIp);
        const title = natTitle(network);
        const info = [
            `public ${reflexive.ip}${reflexive.port ? ':' + reflexive.port : ''}`,
            network?.hostname ? `rdns ${network.hostname}` : null,
            placeLine(network),
            reflexive.typeDetail ? `seen as ${reflexive.typeDetail}` : null,
            'discovered via STUN binding reply',
        ].filter(Boolean);
        const nat = add({
            id, kind: 'nat', x: 0, y: effectiveNetY, members: [],
            natType: memberSummary.nat,
            label: title,
            sub: reflexive.example ? 'example address' : reflexive.ip,
            example: !!reflexive.example,
            info,
        });
        // Same NAT, later peer: upgrade a bare card when this peer still has place/ISP.
        if (title !== 'public address' && nat.label === 'public address') {
            nat.label = title;
            nat.info = info;
        }
        nat.members.push(peer.peerId);
        if (memberSummary.nat === 'symmetric') nat.natType = 'symmetric';
        else if (!nat.natType || nat.natType === 'unknown') nat.natType = memberSummary.nat;
        natOf.set(peer.peerId, id);
    });
    nodes.filter(node => node.kind === 'nat').forEach(nat => {
        const xs = nat.members.map(id => byId.get(id).x);
        nat.x = xs.reduce((a, b) => a + b, 0) / xs.length;
    });

    const leftSideX = compact ? Math.max(width * 0.15, 44) : Math.max(60, Math.min(width * 0.105, rackLeft * 0.48));
    const rightSideX = compact ? Math.min(width * 0.85, width - 44) : Math.min(width - 60, Math.max(width * 0.895, rackLeft + rackWidth + (width - (rackLeft + rackWidth)) * 0.52));

    const extClampY = Math.min(compactExtY, effectiveNetY - (veryShort ? 20 : 46));
    const stun = add({
        id: 'stun', kind: 'stun',
        x: leftSideX,
        y: compact ? extClampY : stunY,
        badge: 'ICE DISCOVERY',
        label: 'STUN',
        sub: ice.stun[0]
            ? (ice.stun.length > 1 ? `${ice.stun[0]} +${ice.stun.length - 1}` : ice.stun[0])
            : 'none configured',
        caption: 'finds IP:port · no media',
        info: [
            'tells each device its public IP address and port (srflx candidate)',
            'public server, not photogroup.network',
            'no photo or media bytes ever pass through STUN',
            'sees · your public IP address and port only',
            ...ice.stun.map(host => `stun ${host}`),
        ],
    });

    let pubtrackers = null;
    if (extTrackers.length > 0) {
        const connectedCount = extTrackers.filter(item => trackerStateLabel(trackerStates, item.url) === 'connected').length;
        const waitingCount = extTrackers.filter(item => trackerStateLabel(trackerStates, item.url) === 'reconnecting').length;
        pubtrackers = add({
            id: 'pubtrackers', kind: 'pubtracker',
            x: compact ? width * 0.5 : leftSideX,
            y: compact ? extClampY : pubY,
            maxW: compact ? Math.min(148, width * 0.34) : Math.min(156, Math.max(106, rackLeft - 24)),
            badge: 'BACKUP WS',
            label: 'Public trackers',
            sub: extTrackers.length === 1 ? extTrackers[0].host : `${extTrackers[0].host} +${extTrackers.length - 1}`,
            status: connectedCount > 0 ? 'connected' : waitingCount === extTrackers.length && waitingCount > 0 ? 'waiting' : null,
            info: [
                'public fallback WebSocket trackers alongside PhotoGroup tracker',
                'keeps peer discovery alive if photogroup.network WS drops on mobile',
                'BitTorrent DHT is disabled (WebSocket trackers only)',
                'sees · infohashes and WebRTC offers/answers',
                'never sees · the photos',
                ...extTrackers.map(item => {
                    const st = trackerStateLabel(trackerStates, item.url);
                    return `${item.url}${st ? ` (${st})` : ''}`;
                }),
            ],
        });
    }

    const relayIps = new Set();
    ordered.forEach(peer => (peer.networkChain || []).filter(isRelayCandidate).forEach(item => relayIps.add(item.ip)));
    const turnHere = ice.turn.length > 0 || relayIps.size > 0;
    const provider = ice.turn.some(host => /twilio/i.test(host)) ? 'Twilio' : null;
    const turn = add({
        id: 'turn', kind: 'turn',
        x: rightSideX,
        y: compact ? extClampY : turnY,
        badge: turnHere ? 'MEDIA RELAY' : 'NO TURN',
        label: 'TURN',
        sub: turnHere ? (provider || ice.turn[0] || [...relayIps][0]) : 'none configured',
        caption: turnHere ? 'encrypted relay fallback' : 'server copy fallback',
        idle: !turnHere,
        info: turnHere
            ? [
                'forwards encrypted WebRTC bytes when direct / hole-punch P2P fails',
                `a ${provider ? provider + ' ' : ''}relay, not photogroup.network`,
                'first receives Allocate Request during ICE gathering, then relays media if needed',
                'sees · both IP addresses and encrypted DTLS bytes; cannot read the photo',
                ...ice.turn.map(host => `turn ${host}`),
                ...[...relayIps].map(ip => `relay candidate ${ip}`),
            ]
            : [
                'forwards encrypted WebRTC data when no direct path works',
                'not configured on this server',
                'if P2P cannot connect, the HTTPS server copy takes over',
            ],
    });

    // Routes. Signalling: every device keeps an event stream to the API, a socket
    // to PhotoGroup's primary tracker, and backup sockets to public trackers.
    const via = id => (natOf.has(id) ? [id, natOf.get(id)] : [id]);
    ordered.forEach(peer => {
        routes.push({ id: 'sse:' + peer.peerId, kind: 'sse', path: [...via(peer.peerId), 'edge', 'api'], peerId: peer.peerId });
        routes.push({ id: 'tracker:' + peer.peerId, kind: 'tracker', path: [...via(peer.peerId), 'edge', 'tracker'], peerId: peer.peerId });
        routes.push({ id: 'copies:' + peer.peerId, kind: 'copies', path: [...via(peer.peerId), 'edge', 'copies'], peerId: peer.peerId });
        if (pubtrackers) {
            routes.push({ id: 'pubtracker:' + peer.peerId, kind: 'pubtracker', path: [...via(peer.peerId), pubtrackers.id], peerId: peer.peerId });
        }
    });
    nodes.filter(node => node.kind === 'nat').forEach(nat => {
        routes.push({ id: 'stun:' + nat.id, kind: 'stun', path: [nat.id, stun.id] });
    });
    // This device asks STUN even when no NAT is known yet (STUN may not have
    // answered), and allocates a TURN relay address when one is configured.
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

    // Photos: under each device that holds a full copy, and also under each
    // device that is getting one (ours, and others that told the room so).
    const devices = nodes.filter(node => node.kind === 'device');
    const share = devices.length ? width / (devices.length + 1) : width;
    const fits = Math.max(1, Math.min(MAX_THUMBS, Math.floor(share / (side + 6))));
    const shelf = (node, held, offset, extra = () => ({}), max = MAX_THUMBS, gap = 6) => {
        const shown = held.slice(0, max);
        const total = shown.length * side + (shown.length - 1) * gap;
        shown.forEach((tile, index) => {
            thumbs.push({
                key: node.id + ':' + (tile.tileKey || tile.infoHash),
                tileKey: tile.tileKey || tile.infoHash,
                deviceId: node.id,
                x: Math.min(width - side / 2 - 4, Math.max(side / 2 + 4, node.x - total / 2 + index * (side + gap) + side / 2)),
                y: node.y + offset + side / 2,
                size: side,
                tile,
                more: index === max - 1 && held.length > max ? held.length - max + 1 : 0,
                ...extra(tile),
            });
        });
        node.mediaCount = held.length;
    };
    const ownerOf = (tile, id) => (tile.owners || []).find(owner => owner.peerId === id);
    devices.forEach(device => {
        const has = tile => tile.peerId === device.id || (ownerOf(tile, device.id) && !ownerOf(tile, device.id).loading);
        const getting = tile => !has(tile) && !!ownerOf(tile, device.id)?.loading;
        const held = device.isMe ? tiles : tiles.filter(tile => has(tile) || getting(tile));
        const arriving = tile => (device.isMe ? !!tile.loading : getting(tile));
        const sorted = [...held.filter(arriving), ...held.filter(tile => !arriving(tile))];
        shelf(device, sorted, thumbOffset, tile => ({ arriving: arriving(tile) }), fits);
        device.photoCount = held.filter(tile => !arriving(tile)).length;
    });
    const copies = byId.get('copies');
    if (copies) {
        const photoOf = new Map(photos.map(photo => [photo.infoHash, photo]));
        const stateOf = tile => {
            const photo = { ...tile, ...(photoOf.get(tile.infoHash) || {}) };
            if (photo.hasServerCopy) return 'stored';
            if (photo.serverCopyUploader || photo.serverCopyReceived > 0) return 'uploading';
            if (photo.serverCopyRequestedAt) return 'requested';
            return null;
        };
        const order = { uploading: 0, requested: 1, stored: 2 };
        const onServer = tiles.filter(stateOf).sort((a, b) => order[stateOf(a)] - order[stateOf(b)]);
        // Wider gaps: each copy has a caption ("19h left") under it.
        shelf(copies, onServer, veryShort ? 22 : 30, tile => ({ copy: stateOf(tile) }), compact ? 3 : MAX_THUMBS, 14);
    }

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

const LANE_ORDER = ['lan', 'punch', 'relay', 'sse', 'tracker', 'copies', 'pubtracker', 'stun', 'turnctl'];

function sampleQuad(p0, cp, p1, steps = 12) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        pts.push({
            x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
            y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y,
        });
    }
    return pts;
}

/**
 * Compute smooth, lane-offset polylines for every route in `scene` so routes
 * sharing segments (device -> NAT, NAT -> edge, peer <-> peer) fan out into
 * distinct curves rather than painting directly over one another.
 * Returns Map<routeId, Array<{x, y}>>.
 */
export function buildRouteGeometry(scene) {
    const geometry = new Map();
    if (!scene?.routes?.length) return geometry;

    // Group routes traversing each undirected node pair so we can assign lanes.
    const segmentRoutes = new Map();
    const segKeyOf = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    scene.routes.forEach(route => {
        for (let i = 1; i < route.path.length; i++) {
            const a = route.path[i - 1];
            const b = route.path[i];
            if (!scene.byId.has(a) || !scene.byId.has(b) || a === b) continue;
            const key = segKeyOf(a, b);
            if (!segmentRoutes.has(key)) segmentRoutes.set(key, []);
            const list = segmentRoutes.get(key);
            if (!list.includes(route)) list.push(route);
        }
    });
    const rankOf = kind => {
        const idx = LANE_ORDER.indexOf(kind);
        return idx < 0 ? 99 : idx;
    };
    segmentRoutes.forEach(list => {
        list.sort((a, b) => rankOf(a.kind) - rankOf(b.kind) || String(a.id).localeCompare(String(b.id)));
    });

    const devices = scene.nodes.filter(n => n.kind === 'device');

    scene.routes.forEach(route => {
        const poly = [];
        for (let i = 1; i < route.path.length; i++) {
            const uId = route.path[i - 1];
            const vId = route.path[i];
            const u = scene.byId.get(uId);
            const v = scene.byId.get(vId);
            if (!u || !v) continue;

            const key = segKeyOf(uId, vId);
            const siblings = segmentRoutes.get(key) || [route];
            const count = siblings.length;
            const idx = Math.max(0, siblings.indexOf(route));
            const gap = count <= 1 ? 0 : Math.min(11, 46 / (count - 1));
            const laneOffset = (idx - (count - 1) / 2) * gap;

            // Canonical normal vector so opposite-direction routes keep consistent separation.
            const minNode = uId < vId ? u : v;
            const maxNode = uId < vId ? v : u;
            const dx = maxNode.x - minNode.x;
            const dy = maxNode.y - minNode.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;

            let segPts;
            if (route.kind === 'lan' && u.kind === 'device' && v.kind === 'device' && Math.abs(u.y - v.y) < 4) {
                const minX = Math.min(u.x, v.x);
                const maxX = Math.max(u.x, v.x);
                const between = devices.filter(d => d.x > minX + 4 && d.x < maxX - 4).length;
                const bow = -(between > 0 ? 32 + between * 12 : 16) - Math.abs(laneOffset) * 0.5;
                const cp = { x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 + bow };
                segPts = sampleQuad({ x: u.x, y: u.y }, cp, { x: v.x, y: v.y }, 14);
            } else if (u.kind === 'nat' && v.kind === 'nat') {
                // Keep punch path between NATs clear of the NAT IP/location labels below them,
                // while preserving signed lane separation across shared NAT-to-NAT segments.
                const cp = { x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 - 26 + laneOffset };
                segPts = sampleQuad({ x: u.x, y: u.y }, cp, { x: v.x, y: v.y }, 12);
            } else if (uId === 'edge' && (vId === 'api' || vId === 'tracker' || vId === 'copies')) {
                const p0 = { x: u.x + Math.sign(v.x - u.x) * 16, y: u.y + (u.h || 34) / 2 - 2 };
                const p1 = { x: v.x, y: v.y - (v.h || 38) / 2 + 2 };
                const cp = { x: (p0.x + p1.x) / 2 + (v.x - u.x) * 0.18, y: (p0.y + p1.y) / 2 };
                segPts = sampleQuad(p0, cp, p1, 10);
            } else if (route.kind === 'stun' && count === 1) {
                const cp = { x: (u.x + v.x) / 2 + nx * 12, y: (u.y + v.y) / 2 + ny * 12 - 8 };
                segPts = sampleQuad({ x: u.x, y: u.y }, cp, { x: v.x, y: v.y }, 10);
            } else if (Math.abs(laneOffset) > 0.25) {
                const p0 = { x: u.x + nx * laneOffset * 0.35, y: u.y + ny * laneOffset * 0.35 };
                const p1 = { x: v.x + nx * laneOffset * 0.35, y: v.y + ny * laneOffset * 0.35 };
                const cp = { x: (u.x + v.x) / 2 + nx * laneOffset * 1.45, y: (u.y + v.y) / 2 + ny * laneOffset * 1.45 };
                segPts = sampleQuad(p0, cp, p1, 12);
            } else {
                segPts = [{ x: u.x, y: u.y }, { x: v.x, y: v.y }];
            }

            if (poly.length && segPts.length) {
                const prev = poly[poly.length - 1];
                const first = segPts[0];
                if (Math.hypot(prev.x - first.x, prev.y - first.y) < 1.5) segPts = segPts.slice(1);
            }
            poly.push(...segPts);
        }
        geometry.set(route.id, poly);
    });

    return geometry;
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
