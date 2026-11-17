import { describeIceServers } from '../topology/NetworkInsight';
import { MAX_PHOTO_MB } from '../torrent/ServerCopyLimits';
import { P2P_STALL_MS } from '../torrent/ServerFallback';
import { RX, TX } from './traffic';

// Geek mode's guided tour: one photo's trip from your device to a friend's,
// told in steps on the real map. Each step lights the nodes and routes it is
// about, flies the packets that really cross there, and says who gets to see
// what. When you are alone in the room, an example friend (and, where STUN
// gave you no public address, an example one) stands in, marked as such.

export const GHOST_ID = 'example-friend';
const GHOST_PUBLIC = '203.0.113.99';
const EXAMPLE_PUBLIC = '198.51.100.23';

const isReflexive = item => item && (item.type === 'srflx' || item.type === 'prflx'
    || /srflx|prflx/.test(item.typeDetail || ''));

/** A chain with a public address in it, adding an example one when STUN gave none. */
function withPublic(chain = [], ip) {
    if (chain.some(isReflexive)) return chain;
    return [...chain, { ip, port: 52110, type: 'srflx', typeDetail: 'srflx', transport: 'udp', example: true }];
}

/**
 * buildScene's inputs for the tour: a friend to send to when there is none,
 * and public addresses for the NAT tier, so every step has something to light.
 */
export function demoInputs(inputs) {
    const { myPeerId } = inputs;
    // Everyone gets a public address to point at: their own, or an example.
    let spare = 7;
    const peers = (inputs.peers || []).map(peer => (peer.peerId === myPeerId
        ? { ...peer, networkChain: withPublic(peer.networkChain?.length ? peer.networkChain : inputs.localNetwork || [], EXAMPLE_PUBLIC) }
        : { ...peer, networkChain: withPublic(peer.networkChain || [], '203.0.113.' + spare++) }));
    const others = peers.filter(peer => peer.peerId !== myPeerId);
    if (!others.length) {
        peers.push({
            peerId: GHOST_ID, name: 'a friend (example)', example: true,
            networkChain: [
                { ip: '192.168.0.12', port: 50122, type: 'host', typeDetail: 'host', transport: 'udp' },
                { ip: GHOST_PUBLIC, port: 61022, type: 'srflx', typeDetail: 'srflx', transport: 'udp', example: true },
            ],
        });
    }
    return {
        ...inputs,
        peers,
        localNetwork: withPublic(inputs.localNetwork || [], EXAMPLE_PUBLIC),
    };
}

/** The friend the tour sends to: someone really here, else the example. */
export function tourFriend(scene, myPeerId) {
    const others = scene.nodes.filter(node => node.kind === 'device' && node.id !== myPeerId);
    return (others.find(node => !node.example) || others[0])?.id || null;
}

const natOf = (scene, id) => {
    const route = scene.routes.find(item => item.id === 'sse:' + id);
    return route && route.path[1] && route.path[1].startsWith('nat:') ? route.path[1] : null;
};

/**
 * The scene with the three paths ICE tries between us and the friend drawn
 * as their own routes (only shown while a step lights them).
 */
export function withDemoRoutes(scene, myPeerId) {
    const friend = tourFriend(scene, myPeerId);
    if (!friend || !myPeerId) return scene;
    const mine = natOf(scene, myPeerId);
    const theirs = natOf(scene, friend);
    const outward = [myPeerId, ...(mine ? [mine] : [])];
    const inward = [...(theirs ? [theirs] : []), friend];
    const punch = mine && mine === theirs ? [myPeerId, mine, friend] : [...outward, ...inward];
    const demo = [
        { id: 'demo:lan', kind: 'lan', path: [myPeerId, friend], label: 'host ↔ host', demo: true },
        { id: 'demo:punch', kind: 'punch', path: punch, label: 'srflx ↔ srflx', demo: true },
        { id: 'demo:relay', kind: 'relay', path: [...outward, 'turn', ...inward], label: 'relay', demo: true },
    ];
    return { ...scene, routes: [...scene.routes, ...demo] };
}

/** The transfer route between us and the friend: the real one if ICE settled, else the punch. */
function transferRoute(scene, myPeerId, friend) {
    const real = scene.routes.find(route => route.peers && route.peers.includes(myPeerId) && route.peers.includes(friend));
    return real || scene.routes.find(route => route.id === 'demo:punch');
}

const HOLDS = 'photogroup.network keeps';
const NEVER = 'never sees';

// WebTorrent's piece size for a file of this many bytes (the piece-length
// package that create-torrent uses): 16 KiB for a phone photo.
export const pieceLengthFor = bytes => Math.max(16384, 1 << ((Math.log2(bytes < 1024 ? 1 : bytes / 1024) + 0.5) | 0));

const EXAMPLE_SIZE = 3355443;
/** The photo the fingerprint step shows when this device has none. */
export const EXAMPLE_PHOTO = {
    example: true,
    name: 'photo.jpg',
    length: EXAMPLE_SIZE,
    pieceLength: pieceLengthFor(EXAMPLE_SIZE),
    pieceCount: Math.ceil(EXAMPLE_SIZE / pieceLengthFor(EXAMPLE_SIZE)),
    pieceHashes: ['a3f91c07', '5e0b2d94', 'c48a7f13', '19d6e2b8'],
    infoHash: '9c1e42d87fa03b5e61c9d2a48e7f0b3c5d6a07b3',
};

const kib = bytes => `${Math.round(bytes / 1024)} KiB`;

/** The fingerprint step in short sentences, one group per phase of the diagram. */
export function fingerprintPhases(photo = EXAMPLE_PHOTO) {
    return [
        `Your browser cuts the photo into pieces of ${kib(photo.pieceLength)}.`,
        'It calculates a SHA-1 hash for each piece.',
        'It puts the file name, the size and all piece hashes in one list. The SHA-1 hash of this list is the infohash.',
        'The infohash is the name of the photo on the network. Other devices use it to find the photo and to check each piece.',
        'It also makes a fingerprint: the size and a SHA-256 hash of three parts of the file. With it, other devices see that they already have the photo. Private rooms get no fingerprint.',
    ];
}

/**
 * A real photo for the fingerprint step: one this device shared if it can
 * tell, else any photo with its piece hashes known. Null when there is none.
 */
export function fingerprintPhoto(torrents = [], tiles = [], myPeerId) {
    const usable = torrents.filter(torrent => torrent && torrent.infoHash && torrent.length > 0
        && torrent.pieceLength > 0 && Array.isArray(torrent._hashes) && typeof torrent._hashes[0] === 'string');
    if (!usable.length) return null;
    const mine = new Set(tiles.filter(tile => tile && tile.peerId && tile.peerId === myPeerId)
        .map(tile => String(tile.infoHash || '').toLowerCase()));
    const torrent = usable.find(item => mine.has(String(item.infoHash).toLowerCase())) || usable[0];
    const hashes = torrent._hashes;
    return {
        example: false,
        name: torrent.name || torrent.files?.[0]?.name || 'photo',
        length: torrent.length,
        pieceLength: torrent.pieceLength,
        pieceCount: hashes.length,
        // All of them up to four, else the first three and the last: the diagram draws four rows.
        pieceHashes: (hashes.length <= 4 ? hashes : [...hashes.slice(0, 3), hashes[hashes.length - 1]]).map(hash => hash.slice(0, 8)),
        infoHash: String(torrent.infoHash).toLowerCase(),
    };
}

/**
 * The tour's steps for this scene. Each step:
 *   { id, title, body, nodes: [ids], routes: [ids], packets: [{ route, label, reverse, rgb, at }],
 *     sees: [{ who, what, tone }], duration }
 * `at` is when in the step a packet leaves (ms); `duration` is how long the
 * step runs before it loops or moves on.
 */
export function tourSteps(scene, { myPeerId, rtcConfig, photo } = {}) {
    const fingerprint = photo || EXAMPLE_PHOTO;
    const friend = tourFriend(scene, myPeerId);
    const friendNode = scene.byId.get(friend);
    const friendName = friendNode?.example ? 'your friend' : (friendNode?.peer?.name || 'your friend');
    const mineNat = natOf(scene, myPeerId);
    const theirNat = natOf(scene, friend);
    const ice = describeIceServers(rtcConfig);
    const turnNode = scene.byId.get('turn');
    const hasTurn = !turnNode?.idle;
    const hasPub = scene.byId.has('pubtrackers');
    const via = transferRoute(scene, myPeerId, friend);
    const settled = via && !via.demo ? via : null;
    const pathWords = { lan: 'on your network', punch: 'straight through both NATs', relay: 'through the TURN relay' };
    const ids = list => list.filter(Boolean);
    const has = id => scene.routes.some(route => route.id === id);

    // Pieces leave our end of the route, whichever end that is.
    const outbound = route => !!route && route.path[0] !== myPeerId;
    const pieces = (route, count, start, gap) => Array.from({ length: count }, (_, index) => ({
        route: route.id, rgb: TX, label: index % 2 ? '' : `piece #${index + 1}`,
        reverse: outbound(route), at: start + index * gap, speed: 0.02,
    }));

    return [
        {
            id: 'join',
            title: 'Open the room',
            body: 'Your browser loads PhotoGroup from photogroup.network. If the server is asleep, Cloud Run starts it. Then nginx sends the request to the app. When you join, the server gives your device a random peer ID. The server keeps an event stream (SSE) open to send room changes to you.',
            nodes: ids([myPeerId, mineNat, 'edge', 'api']),
            routes: ['sse:' + myPeerId],
            packets: [
                { route: 'sse:' + myPeerId, label: 'GET / (the app)', at: 0 },
                { route: 'sse:' + myPeerId, label: 'HTML · JS', reverse: true, at: 900 },
                { route: 'sse:' + myPeerId, label: 'POST join room', at: 2000 },
                { route: 'sse:' + myPeerId, label: 'SSE open', reverse: true, at: 3000 },
            ],
            sees: [
                { who: HOLDS, what: 'the room ID, your peer ID, your name and your device type' },
                { who: NEVER, what: 'your photos', tone: 'good' },
            ],
            duration: 4600,
        },
        {
            id: 'stun',
            title: 'Find your public address (STUN)',
            body: `Behind a router, your device knows only its private address. It asks a public STUN server${ice.stun[0] ? ` (${ice.stun[0]})` : ''} which address it sees. The STUN server sends back the public IP address and port of your router. Your private and public addresses are your ICE candidates. Your browser sends them to the room, so other browsers know how to reach you.`,
            nodes: ids([myPeerId, mineNat, 'stun', 'api']),
            routes: ids([mineNat && 'stun:' + mineNat, 'sse:' + myPeerId]),
            packets: ids([
                mineNat && { route: 'stun:' + mineNat, label: 'binding request', at: 0 },
                mineNat && { route: 'stun:' + mineNat, label: 'you are ' + (scene.byId.get(mineNat)?.label || 'IP:port'), reverse: true, at: 1100 },
                { route: 'sse:' + myPeerId, label: 'PUT my candidates', at: 2400 },
            ]),
            sees: [
                { who: 'STUN sees', what: 'your public IP address and port, and nothing more' },
                { who: HOLDS, what: 'your candidates (private and public addresses), and the ISP and city of your public address' },
            ],
            duration: 4000,
        },
        {
            id: 'hash',
            title: 'Share a photo: your device makes its fingerprint',
            // FingerprintDiagram draws these phases one after the other.
            visual: 'fingerprint',
            photo: fingerprint,
            phases: fingerprintPhases(fingerprint),
            body: fingerprintPhases(fingerprint).join(' '),
            nodes: [myPeerId],
            routes: [],
            packets: [],
            sees: [{ who: 'on your device only', what: 'the photo, its pieces and their hashes', tone: 'good' }],
            duration: 9000,
        },
        {
            id: 'publish',
            title: 'Send the magnet link',
            body: 'Your browser sends a magnet link (the infohash) and some data about the file to the server. The server sends this to all devices in the room. Your friend sees a placeholder for the photo. The photo itself has not moved yet.',
            nodes: ids([myPeerId, friend, 'edge', 'api']),
            routes: ids(['sse:' + myPeerId, friend && 'sse:' + friend]),
            packets: ids([
                { route: 'sse:' + myPeerId, label: 'POST magnet', at: 0 },
                friend && { route: 'sse:' + friend, label: 'SSE photos:add', reverse: true, at: 1300 },
                { route: 'sse:' + myPeerId, label: 'SSE photos:add', reverse: true, at: 1300 },
            ]),
            sees: [
                { who: HOLDS, what: 'the magnet link, file name, type, size, date taken and fingerprint. It keeps them on disk until nobody uses the room for 30 days' },
                { who: NEVER, what: 'the photo', tone: 'good' },
            ],
            duration: 3600,
        },
        {
            id: 'tracker',
            title: 'Meet through the trackers',
            body: `Both browsers send the infohash to PhotoGroup's primary WebSocket tracker on photogroup.network`
                + (hasPub ? ` (and public fallback WebSocket trackers so discovery survives mobile socket drops)` : '')
                + `. It connects browsers that want the same photo and swaps WebRTC offers and answers with each side's ICE candidates. Now the browser of ${friendName} knows how to reach your browser.`,
            nodes: ids([myPeerId, friend, 'edge', 'tracker', hasPub && 'pubtrackers']),
            routes: ids([
                'tracker:' + myPeerId,
                friend && 'tracker:' + friend,
                hasPub && has('pubtracker:' + myPeerId) && 'pubtracker:' + myPeerId,
                hasPub && friend && has('pubtracker:' + friend) && 'pubtracker:' + friend,
            ]),
            packets: ids([
                { route: 'tracker:' + myPeerId, label: 'announce infohash', at: 0 },
                friend && { route: 'tracker:' + friend, label: 'announce infohash', at: 300 },
                hasPub && has('pubtracker:' + myPeerId) && { route: 'pubtracker:' + myPeerId, label: 'backup announce', at: 600 },
                { route: 'tracker:' + myPeerId, label: 'offer (SDP)', at: 1500 },
                friend && { route: 'tracker:' + friend, label: 'offer (SDP)', reverse: true, at: 2300 },
                friend && { route: 'tracker:' + friend, label: 'answer (SDP)', at: 3300 },
                { route: 'tracker:' + myPeerId, label: 'answer (SDP)', reverse: true, at: 4100 },
            ]),
            sees: [
                { who: 'trackers see', what: 'which device wants which infohash, and the ICE candidates' },
                { who: NEVER, what: 'the photo: trackers only introduce devices', tone: 'good' },
            ],
            duration: 5600,
        },
        {
            id: 'ice',
            title: 'Try every path (ICE)',
            body: 'ICE tests pairs of candidates, from best to worst. First, it tries a direct path on the same network. Then it tries a path through both routers. Both sides send to the public address of the other side at the same time. This opens both NATs ("hole punching"). Last, it tries a TURN relay. The first pair that works carries the photo.'
                + (settled ? ` Between you and ${friendName}, ICE chose the path ${pathWords[settled.kind] || 'that works'}.` : ''),
            nodes: ids([myPeerId, friend, mineNat, theirNat, 'turn']),
            routes: ['demo:lan', 'demo:punch', 'demo:relay', settled?.id].filter(id => id && has(id)),
            packets: [
                { route: 'demo:lan', label: 'check host↔host', at: 0, speed: 0.016 },
                { route: 'demo:punch', label: 'check srflx↔srflx', at: 1400, speed: 0.014 },
                { route: 'demo:punch', label: 'check srflx↔srflx', reverse: true, at: 1400, speed: 0.014 },
                { route: 'demo:relay', label: 'check relay', at: 3000, speed: 0.012 },
            ],
            sees: [
                { who: 'routers see', what: 'data between two addresses, the same as for a video call' },
            ],
            duration: 5200,
        },
        {
            id: 'turn',
            title: 'When direct fails: TURN',
            body: hasTurn
                ? 'Some networks block hole punching (carrier-grade NAT, strict office firewalls, symmetric routers). During ICE gathering your browser asks TURN for an Allocate address, and if direct fails, both browsers send encrypted DTLS data through the TURN relay. Unlike STUN (which only finds your IP:port), TURN forwards every byte — still encrypted so it cannot read the photo.'
                : 'Some networks block hole punching. Examples are mobile networks with carrier-grade NAT, strict office firewalls, and routers that change the port for each destination. A TURN relay can forward the data then. This server has no TURN configured. If P2P cannot connect, PhotoGroup uses a server copy (step 9).',
            nodes: ids([myPeerId, friend, mineNat, theirNat, 'turn']),
            routes: ids([has('demo:relay') && 'demo:relay', hasTurn && has('turnctl:' + myPeerId) && 'turnctl:' + myPeerId]),
            packets: hasTurn ? ids([
                has('turnctl:' + myPeerId) && { route: 'turnctl:' + myPeerId, label: 'allocate', at: 0 },
                { route: 'demo:relay', label: 'encrypted', at: 400, rgb: TX },
                { route: 'demo:relay', label: 'encrypted', at: 1400, rgb: TX },
                { route: 'demo:relay', label: 'encrypted', reverse: true, at: 800, rgb: RX },
            ]) : [],
            sees: hasTurn ? [
                { who: 'TURN sees', what: 'both IP addresses and encrypted bytes' },
                { who: NEVER, what: 'the photo: the keys stay in the two browsers', tone: 'good' },
            ] : [{ who: 'TURN', what: 'not configured: the server copy is the fallback' }],
            duration: 4200,
        },
        {
            id: 'pieces',
            title: 'Swap pieces, browser to browser',
            body: 'The browsers use BitTorrent over the encrypted WebRTC data channel. First they send a handshake. Then they send the file list and the piece hashes (metadata). Then they send the pieces. The receiver checks each piece against its hash and discards a bad piece. It can send each good piece to the next person immediately.',
            nodes: ids([myPeerId, friend, ...(via?.path || [])]),
            routes: ids([via?.id]),
            packets: via ? [
                { route: via.id, label: 'handshake', at: 0, reverse: outbound(via) },
                { route: via.id, label: 'metadata', at: 900, reverse: outbound(via), rgb: TX },
                ...pieces(via, 8, 1900, 280),
            ] : [],
            sees: [
                { who: NEVER, what: 'this data: photogroup.network is not on this path', tone: 'good' },
            ],
            duration: 5200,
        },
        {
            id: 'copy',
            title: 'Last resort: a server copy',
            body: `The receiver asks for a server copy if the download stops for ${Math.round(P2P_STALL_MS / 1000)} seconds. It also asks if all devices with the photo are in another app, because phones stop the page in the background. A device with the photo uploads it over HTTPS in 8 MB parts. The receiver downloads it and checks its fingerprint. Clips also get a server copy when they are shared, because often only one phone has them. Files larger than ${MAX_PHOTO_MB} MB never go to the server.`,
            nodes: ids([myPeerId, friend, 'edge', 'copies']),
            routes: ids(['copies:' + myPeerId, friend && 'copies:' + friend]),
            packets: ids([
                friend && { route: 'copies:' + friend, label: 'POST /request', at: 0 },
                { route: 'copies:' + myPeerId, label: 'PUT chunk 1', at: 1000, rgb: TX },
                { route: 'copies:' + myPeerId, label: 'PUT chunk 2', at: 1800, rgb: TX },
                friend && { route: 'copies:' + friend, label: 'GET copy', reverse: true, at: 3000, rgb: RX },
            ]),
            sees: [
                { who: HOLDS, what: 'the photo, until all devices have it, for 24 h at most' },
            ],
            duration: 4800,
        },
        {
            id: 'summary',
            title: 'Who saw what',
            body: 'When the direct path works, the photo is only on the devices in the room. photogroup.network connects the people and keeps the list of shared photos. STUN and the tracker help browsers find each other. TURN, if used, carries encrypted data that it cannot read. The server keeps a photo only as a temporary server copy, for example when P2P fails.',
            nodes: scene.nodes.map(node => node.id),
            routes: ids(['sse:' + myPeerId, 'tracker:' + myPeerId, via?.id]),
            packets: via ? pieces(via, 4, 0, 400) : [],
            sees: [
                { who: HOLDS, what: 'the room, the people (names, devices, addresses), magnet links and file data' },
                { who: 'STUN · tracker', what: 'addresses and which photo you want, never the photo' },
                { who: 'TURN', what: hasTurn ? 'encrypted data, if the direct path fails' : 'not configured here' },
                { who: 'server copy', what: 'the photo, when needed, for 24 h at most' },
            ],
            duration: 4000,
        },
    ];
}
