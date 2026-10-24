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

/**
 * The tour's steps for this scene. Each step:
 *   { id, title, body, nodes: [ids], routes: [ids], packets: [{ route, label, reverse, rgb, at }],
 *     sees: [{ who, what, tone }], duration }
 * `at` is when in the step a packet leaves (ms); `duration` is how long the
 * step runs before it loops or moves on.
 */
export function tourSteps(scene, { myPeerId, rtcConfig } = {}) {
    const friend = tourFriend(scene, myPeerId);
    const friendNode = scene.byId.get(friend);
    const friendName = friendNode?.example ? 'your friend' : (friendNode?.peer?.name || 'your friend');
    const mineNat = natOf(scene, myPeerId);
    const theirNat = natOf(scene, friend);
    const ice = describeIceServers(rtcConfig);
    const turnNode = scene.byId.get('turn');
    const hasTurn = !turnNode?.idle;
    const via = transferRoute(scene, myPeerId, friend);
    const settled = via && !via.demo ? via : null;
    const pathWords = { lan: 'directly on your network', punch: 'straight through both NATs', relay: 'through the TURN relay' };
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
            body: 'Your browser loads PhotoGroup from photogroup.network. If the server was asleep, a small Cloud Run service wakes it, then nginx passes the request to the app. Joining registers your device with a random peer id, and opens an event stream (SSE) the server uses to push room changes to you.',
            nodes: ids([myPeerId, mineNat, 'edge', 'api']),
            routes: ['sse:' + myPeerId],
            packets: [
                { route: 'sse:' + myPeerId, label: 'GET / (the app)', at: 0 },
                { route: 'sse:' + myPeerId, label: 'HTML · JS', reverse: true, at: 900 },
                { route: 'sse:' + myPeerId, label: 'POST join room', at: 2000 },
                { route: 'sse:' + myPeerId, label: 'SSE open', reverse: true, at: 3000 },
            ],
            sees: [
                { who: HOLDS, what: 'room id, your peer id, name and device type' },
                { who: NEVER, what: 'anything from your photos', tone: 'good' },
            ],
            duration: 4600,
        },
        {
            id: 'stun',
            title: 'Find your public address (STUN)',
            body: `Behind a router your device only knows its private address. It asks a public STUN server${ice.stun[0] ? ` (${ice.stun[0]})` : ''} "where do you see me from?", and the reply is the public IP and port your NAT used. That address, plus your private ones, are your ICE candidates: the ways someone could reach you. They are shared with the room so a friend's browser can try them.`,
            nodes: ids([myPeerId, mineNat, 'stun', 'api']),
            routes: ids([mineNat && 'stun:' + mineNat, 'sse:' + myPeerId]),
            packets: ids([
                mineNat && { route: 'stun:' + mineNat, label: 'binding request', at: 0 },
                mineNat && { route: 'stun:' + mineNat, label: 'you are ' + (scene.byId.get(mineNat)?.label || 'IP:port'), reverse: true, at: 1100 },
                { route: 'sse:' + myPeerId, label: 'PUT my candidates', at: 2400 },
            ]),
            sees: [
                { who: 'STUN sees', what: 'your public IP and port, nothing else' },
                { who: HOLDS, what: 'your candidates: private and public addresses, with ISP and city looked up from the public one' },
            ],
            duration: 4000,
        },
        {
            id: 'hash',
            title: 'Share a photo: fingerprint it on your device',
            body: 'When you share, your browser cuts the file into pieces and takes a SHA-1 hash of every piece. The hash of that list is the infohash, the photo\'s fingerprint and name on the network. Nothing has left your device yet: the photo stays on your phone, ready to be served from there.',
            nodes: [myPeerId],
            routes: [],
            packets: [],
            sees: [{ who: 'on your device only', what: 'the photo, its pieces and their hashes', tone: 'good' }],
            duration: 3500,
        },
        {
            id: 'publish',
            title: 'Publish the magnet link',
            body: 'Your browser sends the server a magnet link (the infohash) and a few facts about the file. The server pushes them to everyone in the room over their event streams, so the photo shows up for your friend as a placeholder. Only then does the photo itself start to move.',
            nodes: ids([myPeerId, friend, 'edge', 'api']),
            routes: ids(['sse:' + myPeerId, friend && 'sse:' + friend]),
            packets: ids([
                { route: 'sse:' + myPeerId, label: 'POST magnet', at: 0 },
                friend && { route: 'sse:' + friend, label: 'SSE photos:add', reverse: true, at: 1300 },
                { route: 'sse:' + myPeerId, label: 'SSE photos:add', reverse: true, at: 1300 },
            ]),
            sees: [
                { who: HOLDS, what: 'the magnet, file name, type, size, date taken and a size+hash fingerprint. Kept on disk with the room until it is 30 days untouched' },
                { who: NEVER, what: 'the photo\'s pixels', tone: 'good' },
            ],
            duration: 3600,
        },
        {
            id: 'tracker',
            title: 'Meet through the tracker',
            body: `Both browsers announce the infohash to the tracker, a WebSocket server on photogroup.network. It pairs up browsers that want the same photo and passes their WebRTC offer and answer between them. Those carry each side's ICE candidates, so ${friendName}'s browser now knows how it might reach yours.`,
            nodes: ids([myPeerId, friend, 'edge', 'tracker']),
            routes: ids(['tracker:' + myPeerId, friend && 'tracker:' + friend]),
            packets: ids([
                { route: 'tracker:' + myPeerId, label: 'announce infohash', at: 0 },
                friend && { route: 'tracker:' + friend, label: 'announce infohash', at: 300 },
                { route: 'tracker:' + myPeerId, label: 'offer (SDP)', at: 1500 },
                friend && { route: 'tracker:' + friend, label: 'offer (SDP)', reverse: true, at: 2300 },
                friend && { route: 'tracker:' + friend, label: 'answer (SDP)', at: 3300 },
                { route: 'tracker:' + myPeerId, label: 'answer (SDP)', reverse: true, at: 4100 },
            ]),
            sees: [
                { who: 'tracker sees', what: 'who wants which infohash, and their ICE candidates' },
                { who: NEVER, what: 'photo bytes: it only makes introductions', tone: 'good' },
            ],
            duration: 5600,
        },
        {
            id: 'ice',
            title: 'Try every path (ICE)',
            body: 'ICE tests candidate pairs from best to worst. First direct on the same network. Then through both routers, each side sending to the other\'s STUN-learned address at once so both NATs let the replies in: hole punching. Last, via a TURN relay. The first pair that answers carries the photo.'
                + (settled ? ` Between you and ${friendName} it settled ${pathWords[settled.kind] || 'on a path'}.` : ''),
            nodes: ids([myPeerId, friend, mineNat, theirNat, 'turn']),
            routes: ['demo:lan', 'demo:punch', 'demo:relay', settled?.id].filter(id => id && has(id)),
            packets: [
                { route: 'demo:lan', label: 'check host↔host', at: 0, speed: 0.016 },
                { route: 'demo:punch', label: 'check srflx↔srflx', at: 1400, speed: 0.014 },
                { route: 'demo:punch', label: 'check srflx↔srflx', reverse: true, at: 1400, speed: 0.014 },
                { route: 'demo:relay', label: 'check relay', at: 3000, speed: 0.012 },
            ],
            sees: [
                { who: 'routers see', what: 'packets between two addresses, as for any video call' },
            ],
            duration: 5200,
        },
        {
            id: 'turn',
            title: 'When direct fails: TURN',
            body: hasTurn
                ? 'Some networks cannot be punched through: carrier-grade NAT on mobile data, strict office firewalls, or routers that change ports for every destination on both sides. Then both browsers send to a TURN relay, which forwards the packets. The data channel stays DTLS-encrypted end to end, so the relay moves bytes it cannot read.'
                : 'Some networks cannot be punched through: carrier-grade NAT on mobile data, strict office firewalls, or routers that change ports for every destination on both sides. A TURN relay would forward the packets then. This server has no TURN configured, so when P2P cannot connect, the server copy (two steps on) takes over.',
            nodes: ids([myPeerId, friend, mineNat, theirNat, 'turn']),
            routes: has('demo:relay') ? ['demo:relay'] : [],
            packets: hasTurn ? [
                { route: 'demo:relay', label: 'encrypted', at: 0, rgb: TX },
                { route: 'demo:relay', label: 'encrypted', at: 1200, rgb: TX },
                { route: 'demo:relay', label: 'encrypted', reverse: true, at: 600, rgb: RX },
            ] : [],
            sees: hasTurn ? [
                { who: 'TURN sees', what: 'both IP addresses and encrypted bytes' },
                { who: NEVER, what: 'the photo itself: the encryption keys stay in the two browsers', tone: 'good' },
            ] : [{ who: 'TURN', what: 'none configured: the server copy is the fallback' }],
            duration: 4200,
        },
        {
            id: 'pieces',
            title: 'Swap pieces, browser to browser',
            body: 'Over the encrypted WebRTC data channel the browsers speak BitTorrent. A handshake, then the file list and piece hashes (metadata), then the pieces themselves. Each piece is checked against its hash before it is kept, so a corrupted or forged piece is thrown away. Every verified piece can be passed straight on to the next person.',
            nodes: ids([myPeerId, friend, ...(via?.path || [])]),
            routes: ids([via?.id]),
            packets: via ? [
                { route: via.id, label: 'handshake', at: 0, reverse: outbound(via) },
                { route: via.id, label: 'metadata', at: 900, reverse: outbound(via), rgb: TX },
                ...pieces(via, 8, 1900, 280),
            ] : [],
            sees: [
                { who: NEVER, what: 'any of it: photogroup.network is not on this path', tone: 'good' },
            ],
            duration: 5200,
        },
        {
            id: 'copy',
            title: 'Last resort: a server copy',
            body: `If a download makes no progress for ${Math.round(P2P_STALL_MS / 1000)} seconds, or everyone who has the photo has switched to another app (phones freeze the page), the receiver asks for a copy. Someone who has the photo uploads it over HTTPS in 8 MB chunks, and the receiver downloads it and checks its fingerprint. Files over ${MAX_PHOTO_MB} MB never go there.`,
            nodes: ids([myPeerId, friend, 'edge', 'copies']),
            routes: ids(['copies:' + myPeerId, friend && 'copies:' + friend]),
            packets: ids([
                friend && { route: 'copies:' + friend, label: 'POST /request', at: 0 },
                { route: 'copies:' + myPeerId, label: 'PUT chunk 1', at: 1000, rgb: TX },
                { route: 'copies:' + myPeerId, label: 'PUT chunk 2', at: 1800, rgb: TX },
                friend && { route: 'copies:' + friend, label: 'GET copy', reverse: true, at: 3000, rgb: RX },
            ]),
            sees: [
                { who: HOLDS, what: 'the photo\'s bytes, only until everyone has it or 24 h pass, whichever is first' },
            ],
            duration: 4800,
        },
        {
            id: 'summary',
            title: 'Who saw what',
            body: 'When the direct path works, the photo only ever exists on the devices in the room. photogroup.network introduces people and keeps the list of what was shared; STUN and the tracker help browsers find each other; TURN, if used, carries encrypted bytes it cannot open. The server holds a photo only as a short-lived copy when P2P has failed.',
            nodes: scene.nodes.map(node => node.id),
            routes: ids(['sse:' + myPeerId, 'tracker:' + myPeerId, via?.id]),
            packets: via ? pieces(via, 4, 0, 400) : [],
            sees: [
                { who: HOLDS, what: 'room, people (names, devices, addresses), magnet links and file facts' },
                { who: 'STUN · tracker', what: 'addresses and which photo you want, never its bytes' },
                { who: 'TURN', what: hasTurn ? 'encrypted bytes, if direct fails' : 'not configured here' },
                { who: 'server copy', what: 'the bytes, only after P2P failed, for up to 24 h' },
            ],
            duration: 4000,
        },
    ];
}
