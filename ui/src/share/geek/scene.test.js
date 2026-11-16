import { describe, it, expect } from 'vitest';
import { buildScene, buildRouteGeometry, routePoints, pointAlong, transferRoutesFor, TIER, hostOf, natTitle } from './scene';

const chain = (lan, pub, network) => [
    { ip: lan, port: 50000, type: 'host', transport: 'udp' },
    ...(pub ? [{
        ip: pub, port: 61000, type: 'srflx', transport: 'udp',
        network: network === undefined
            ? { city: 'Vienna', country: 'AT', connection: { isp: 'A1' } }
            : network,
    }] : []),
];

function room(connections = [], extra = {}) {
    return buildScene({
        myPeerId: 'me',
        me: { name: 'Mine' },
        localNetwork: chain('192.168.1.2', '1.1.1.1'),
        peers: [
            { peerId: 'ana', name: 'Ana', networkChain: chain('192.168.1.3', '1.1.1.1') },
            { peerId: 'ben', name: 'Ben', networkChain: chain('10.0.0.7', '2.2.2.2') },
        ],
        connections,
        origin: 'https://photogroup.network',
        trackerUrl: 'wss://photogroup.network/tracker',
        rtcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
        width: 1000,
        height: 800,
        ...extra,
    });
}

describe('buildScene', () => {
    it('puts infra on top, NATs between and devices at the bottom, with us in the middle', () => {
        const scene = room();
        const devices = scene.nodes.filter(node => node.kind === 'device');
        expect(devices.map(node => node.id)).toEqual(['ana', 'me', 'ben']);
        expect(devices.every(node => node.y === 800 * TIER.device)).toBe(true);
        expect(scene.byId.get('me').label).toBe('you · Mine');

        const [edge, api, tracker, copies] = ['edge', 'api', 'tracker', 'copies'].map(id => scene.byId.get(id));
        expect(edge.y).toBeLessThan(api.y);
        expect([api.y, tracker.y, copies.y]).toEqual([api.y, api.y, api.y]);
        expect(api.y).toBeLessThan(800 * TIER.net);
        expect([edge.badge, api.badge, tracker.badge, copies.badge]).toEqual([
            'INGRESS', 'STATE · SSE', 'PRIMARY WS', 'TEMP RELAY',
        ]);
        expect(scene.byId.get('edge').sub).toBe('Cloud Run wake → nginx');
        expect(scene.byId.get('tracker').sub).toBe('photogroup.network');
        expect(scene.byId.get('stun')).toMatchObject({ badge: 'ICE DISCOVERY', caption: 'finds IP:port · no media' });
        expect(scene.byId.get('stun').sub).toContain('stun.l.google.com');
        // Public fallback WebSocket trackers appear outside photogroup.network.
        expect(scene.byId.get('pubtrackers')).toMatchObject({ kind: 'pubtracker', badge: 'BACKUP WS' });
        expect(scene.byId.get('pubtrackers').info.join('\n')).toContain('tracker.openwebtorrent.com');
        // No TURN server and no relay candidates: TURN is still shown, as missing.
        expect(scene.byId.get('turn')).toMatchObject({ sub: 'none configured', idle: true, badge: 'NO TURN' });
        expect(scene.byId.get('turn').info.join(' ')).toContain('server copy takes over');
        // What each server holds and never sees is spelled out on it.
        expect(scene.byId.get('api').info.join('\n')).toMatch(/never sees · the photos/);
        expect(scene.byId.get('stun').info).toContain('sees · your public IP address and port only');

        // Ana and I share a public address, so one NAT sits between us.
        const shared = scene.byId.get('nat:1.1.1.1');
        expect(shared.members.sort()).toEqual(['ana', 'me']);
        expect(shared.x).toBe((scene.byId.get('ana').x + scene.byId.get('me').x) / 2);
        expect(shared).toMatchObject({ label: 'Vienna, AT · A1', sub: '1.1.1.1' });
        expect(shared.id).toBe('nat:1.1.1.1');
    });

    it('titles NAT nodes with place, then rDNS, then ISP; IP stays secondary', () => {
        expect(natTitle({ city: 'Vienna', country: 'AT', connection: { isp: 'A1' } })).toBe('Vienna, AT · A1');
        expect(natTitle({ hostname: 'dsl-1-2-3.example.net' })).toBe('dsl-1-2-3.example.net');
        expect(natTitle({ connection: { org: 'Example ISP' } })).toBe('Example ISP');
        expect(natTitle(null)).toBe('public address');
        expect(natTitle({})).toBe('public address');

        const place = room([], {
            localNetwork: chain('192.168.1.2', '1.1.1.1'),
            peers: [
                { peerId: 'ana', name: 'Ana', networkChain: chain('192.168.1.3', '1.1.1.1') },
                { peerId: 'ben', name: 'Ben', networkChain: chain('10.0.0.7', '2.2.2.2') },
            ],
        });
        expect(place.byId.get('nat:1.1.1.1')).toMatchObject({ label: 'Vienna, AT · A1', sub: '1.1.1.1' });
        expect(place.byId.get('nat:2.2.2.2')).toMatchObject({ label: 'Vienna, AT · A1', sub: '2.2.2.2' });

        const hostOnly = room([], {
            localNetwork: chain('192.168.1.2', '9.9.9.9', { hostname: 'nat.isp.example' }),
            peers: [{ peerId: 'ana', name: 'Ana', networkChain: chain('10.0.0.3', '8.8.8.8', { hostname: 'peer.isp.example' }) }],
        });
        expect(hostOnly.byId.get('nat:9.9.9.9')).toMatchObject({ label: 'nat.isp.example', sub: '9.9.9.9' });
        expect(hostOnly.byId.get('nat:8.8.8.8')).toMatchObject({ label: 'peer.isp.example', sub: '8.8.8.8' });

        const bare = room([], {
            localNetwork: chain('192.168.1.2', '5.5.5.5', null),
            peers: [{ peerId: 'ana', name: 'Ana', networkChain: chain('10.0.0.3', '6.6.6.6', null) }],
        });
        expect(bare.byId.get('nat:5.5.5.5')).toMatchObject({ label: 'public address', sub: '5.5.5.5' });
        expect(bare.byId.get('nat:5.5.5.5').label).not.toBe('5.5.5.5');
        expect(bare.byId.get('nat:6.6.6.6')).toMatchObject({ id: 'nat:6.6.6.6', label: 'public address', sub: '6.6.6.6' });

        const example = buildScene({
            myPeerId: 'me',
            me: { name: 'Mine' },
            localNetwork: [
                { ip: '192.168.1.2', port: 50000, type: 'host', transport: 'udp' },
                { ip: '198.51.100.23', port: 61000, type: 'srflx', transport: 'udp', example: true },
            ],
            peers: [],
            connections: [],
            origin: 'https://photogroup.network',
            trackerUrl: 'wss://photogroup.network/tracker',
            rtcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
            width: 1000,
            height: 800,
        });
        expect(example.byId.get('nat:198.51.100.23')).toMatchObject({
            id: 'nat:198.51.100.23',
            label: 'public address',
            sub: 'example address',
            example: true,
        });
    });

    it('puts what the old "This device" panel said on the nodes', () => {
        const scene = room();
        const me = scene.byId.get('me').info.join('\n');
        expect(me).toMatch(/^link · /m);
        expect(me).toContain('stun stun.l.google.com');
        expect(me).toContain('turn none · the HTTPS server copy is the fallback');
        // Same public address: a LAN path; another network: a hole punch.
        expect(scene.byId.get('ana').info).toContain('path from you · same network, host↔host');
        expect(scene.byId.get('ben').info.find(line => line.startsWith('path from you'))).toBe('path from you · direct via STUN hole punch');
    });

    it('routes signalling out through each NAT to photogroup.network', () => {
        const scene = room();
        const sse = scene.routes.find(route => route.id === 'sse:ben');
        expect(sse.path).toEqual(['ben', 'nat:2.2.2.2', 'edge', 'api']);
        expect(scene.routes.find(route => route.id === 'tracker:me').path).toEqual(['me', 'nat:1.1.1.1', 'edge', 'tracker']);
        expect(scene.routes.filter(route => route.kind === 'stun')).toHaveLength(2);
    });

    it('draws transfers by the path ICE picked', () => {
        const scene = room([
            { fromPeerId: 'me', toPeerId: 'ana', connectionType: 'p2p' },
            { fromPeerId: 'ana', toPeerId: 'me', connectionType: 'p2p' },
            { fromPeerId: 'me', toPeerId: 'ben', connectionType: 'p2p nat' },
        ]);
        const transfers = scene.routes.filter(route => route.peers);
        expect(transfers).toHaveLength(2);
        expect(transfers[0].kind).toBe('lan');
        expect(transfers[0].path).toEqual(['me', 'ana']);
        expect(transfers[1]).toMatchObject({ kind: 'punch', path: ['me', 'nat:1.1.1.1', 'nat:2.2.2.2', 'ben'] });
    });

    it('hairpins through a shared NAT and relays through TURN', () => {
        const hairpin = room([{ fromPeerId: 'me', toPeerId: 'ana', connectionType: 'p2p nat' }]);
        expect(hairpin.routes.find(route => route.peers).path).toEqual(['me', 'nat:1.1.1.1', 'ana']);

        const relayed = room([{ fromPeerId: 'me', toPeerId: 'ben', connectionType: 'relay udp' }], {
            rtcConfig: { iceServers: [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }] },
        });
        expect(relayed.byId.get('turn').sub).toContain('turn.example.com');
        expect(relayed.routes.find(route => route.peers)).toMatchObject({
            kind: 'relay', path: ['me', 'nat:1.1.1.1', 'turn', 'nat:2.2.2.2', 'ben'], label: 'relay udp',
        });
    });

    it('puts photos under the devices holding them, ours included while arriving', () => {
        const tiles = [
            { infoHash: 'h1', peerId: 'me', owners: [{ peerId: 'me' }, { peerId: 'ana' }] },
            { infoHash: 'h2', peerId: 'ben', owners: [{ peerId: 'ben' }, { peerId: 'me', loading: true }] },
            ...Array.from({ length: 6 }, (_, i) => ({ infoHash: 'x' + i, peerId: 'me', owners: [] })),
        ];
        const scene = room([], { tiles, photos: [{ hasServerCopy: true, serverCopySize: 2 * 1048576 }] });
        const at = id => scene.thumbs.filter(thumb => thumb.deviceId === id);
        expect(at('ana').map(thumb => thumb.tileKey)).toEqual(['h1']);
        expect(at('ben').map(thumb => thumb.tileKey)).toEqual(['h2']);
        // Eight photos on my device: five thumbs, the last one says how many more.
        expect(at('me')).toHaveLength(5);
        expect(at('me')[4].more).toBe(4);
        expect(scene.byId.get('me').photoCount).toBe(8);
        expect(at('ana')[0].y).toBeGreaterThan(scene.byId.get('ana').y);
        expect(scene.byId.get('copies').sub).toBe('1 held · 2.0 MB');
    });

    it('gives the server a shelf of the copies it holds, like a device photos', () => {
        const tiles = [
            { infoHash: 'h1', peerId: 'me', owners: [{ peerId: 'me' }], hasServerCopy: true },
            { infoHash: 'h2', peerId: 'me', owners: [{ peerId: 'me' }] },
            { infoHash: 'h3', peerId: 'me', owners: [{ peerId: 'me' }], hasServerCopy: true },
        ];
        const scene = room([], { tiles });
        const onServer = scene.thumbs.filter(thumb => thumb.deviceId === 'copies');
        // Only the two the server actually keeps, not everything in the room.
        expect(onServer.map(thumb => thumb.tileKey)).toEqual(['h1', 'h3']);
        const copies = scene.byId.get('copies');
        expect(copies.mediaCount).toBe(2);
        // Under the node, the way a device's photos sit under its box.
        expect(onServer[0].y).toBeGreaterThan(copies.y);
    });

    it("shows a photo under another device while it arrives there, and first", () => {
        const tiles = [
            { infoHash: 'h1', peerId: 'me', owners: [{ peerId: 'me' }, { peerId: 'ana' }] },
            { infoHash: 'h2', peerId: 'me', owners: [{ peerId: 'me' }, { peerId: 'ana', loading: true }] },
        ];
        const ana = room([], { tiles }).thumbs.filter(thumb => thumb.deviceId === 'ana');
        expect(ana.map(thumb => [thumb.tileKey, thumb.arriving])).toEqual([['h2', true], ['h1', false]]);
    });

    it('puts copies on their way up and asked-for copies on the server shelf too', () => {
        const tiles = ['h1', 'h2', 'h3', 'h4'].map(infoHash => ({ infoHash, peerId: 'me', owners: [{ peerId: 'me' }] }));
        const photos = [
            { infoHash: 'h1', hasServerCopy: true, serverCopySize: 1048576 },
            { infoHash: 'h2', serverCopyReceived: 10, serverCopySize: 100, serverCopyUploader: 'me' },
            { infoHash: 'h3', serverCopyRequestedAt: 5 },
        ];
        const scene = room([], { tiles, photos });
        const onServer = scene.thumbs.filter(thumb => thumb.deviceId === 'copies');
        expect(onServer.map(thumb => [thumb.tileKey, thumb.copy])).toEqual([['h2', 'uploading'], ['h3', 'requested'], ['h1', 'stored']]);
        expect(scene.byId.get('copies').sub).toBe('1 held · 1.0 MB · 1 uploading');
    });

    it('reads each photo of a shared torrent by its own id, not the torrent\'s', () => {
        const tiles = ['base-a.jpg', 'base-b.jpg'].map(infoHash => ({ infoHash, peerId: 'me', owners: [{ peerId: 'me' }] }));
        const photos = [
            { infoHash: 'base-a.jpg', hasServerCopy: true, serverCopySize: 100 },
            { infoHash: 'base-b.jpg', serverCopyRequestedAt: 5 },
        ];
        const scene = room([], { tiles, photos });
        const onServer = scene.thumbs.filter(thumb => thumb.deviceId === 'copies');
        expect(onServer.map(thumb => [thumb.tileKey, thumb.copy])).toEqual([['base-b.jpg', 'requested'], ['base-a.jpg', 'stored']]);
    });

    it('fits each device its share of a phone width, so rows do not run together', () => {
        const tiles = Array.from({ length: 4 }, (_, i) => ({ infoHash: 'x' + i, peerId: 'me', owners: [{ peerId: 'me' }, { peerId: 'ana' }] }));
        const scene = room([], { tiles, width: 400, height: 800 });
        const ana = scene.thumbs.filter(thumb => thumb.deviceId === 'ana');
        expect(ana).toHaveLength(2);
        expect(ana[1].more).toBe(3);
        expect(ana.at(-1).x + ana.at(-1).size / 2).toBeLessThan(scene.byId.get('me').x - 28 / 2);
    });

    it('names a local dev server instead of the production edge', () => {
        const scene = room([], { origin: 'http://localhost:3000' });
        expect(scene.byId.get('edge')).toMatchObject({ label: 'dev server', sub: 'localhost:3000' });
        expect(hostOf('not a url')).toBe('not a url');
    });

    it('separates PhotoGroup tracker from configurable announceUrls and shows TURN allocate when TURN exists', () => {
        const states = new Map([
            ['wss://photogroup.network/tracker', { connected: true, waiting: false }],
            ['wss://custom.tracker.example/ws', { connected: true, waiting: false }],
        ]);
        const scene = room([], {
            announceUrls: ['wss://photogroup.network/tracker', 'wss://custom.tracker.example/ws'],
            trackerStates: states,
            rtcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }] },
        });
        expect(scene.byId.get('tracker').status).toBe('connected');
        expect(scene.byId.get('pubtrackers')).toMatchObject({
            sub: 'custom.tracker.example',
            status: 'connected',
        });
        expect(scene.routes.find(r => r.id === 'pubtracker:me').path).toEqual(['me', 'nat:1.1.1.1', 'pubtrackers']);
        expect(scene.routes.find(r => r.id === 'turnctl:me').path).toEqual(['me', 'nat:1.1.1.1', 'turn']);

        const noPublic = room([], { announceUrls: ['wss://photogroup.network/tracker'] });
        expect(noPublic.byId.get('pubtrackers')).toBeUndefined();
        expect(noPublic.routes.find(r => r.id === 'turnctl:me')).toBeUndefined();
    });

    it('keeps all tiers strictly ordered without overlap on narrow phones and short unfolded foldables', () => {
        const tiles = [{ infoHash: 'h1', peerId: 'me', owners: [{ peerId: 'me' }], hasServerCopy: true }];
        for (const [w, h] of [[360, 640], [412, 480], [880, 420], [880, 720]]) {
            const scene = room([], { width: w, height: h, tiles, photos: tiles });
            const edge = scene.byId.get('edge');
            const api = scene.byId.get('api');
            const stun = scene.byId.get('stun');
            const pub = scene.byId.get('pubtrackers');
            const turn = scene.byId.get('turn');
            const nat = scene.byId.get('nat:1.1.1.1');
            const me = scene.byId.get('me');
            expect(edge.y).toBeLessThan(api.y);
            expect(api.y).toBeLessThan(stun.y);
            expect(stun.y).toBeLessThan(nat.y);
            expect(pub.y).toBeLessThan(nat.y);
            expect(turn.y).toBeLessThan(nat.y);
            expect(nat.y).toBeLessThan(me.y);
            scene.nodes.forEach(node => {
                expect(node.x).toBeGreaterThanOrEqual(20);
                expect(node.x).toBeLessThanOrEqual(w - 20);
            });
            scene.thumbs.forEach(thumb => {
                expect(thumb.y + thumb.size / 2).toBeLessThan(h);
            });
        }
    });

    it('keeps devices and thumbnails inside short (<220px) map containers when log drawer is tall', () => {
        const tiles = [{ infoHash: 'h1', peerId: 'me', owners: [{ peerId: 'me' }] }];
        for (const [w, h, withTiles] of [[800, 180, false], [800, 180, true], [360, 180, true], [600, 150, false]]) {
            const scene = room([], { width: w, height: h, tiles: withTiles ? tiles : [] });
            const edge = scene.byId.get('edge');
            const api = scene.byId.get('api');
            const nat = scene.byId.get('nat:1.1.1.1');
            const me = scene.byId.get('me');
            expect(edge.y).toBeLessThan(api.y);
            expect(api.y).toBeLessThan(nat.y);
            expect(nat.y).toBeLessThan(me.y);
            expect(me.y).toBeLessThan(h - 15);
            scene.thumbs.forEach(thumb => {
                expect(thumb.y + thumb.size / 2).toBeLessThan(h);
            });
        }
    });
});

describe('buildRouteGeometry', () => {
    it('fans shared segments into distinct curves and arcs LAN links clear of intermediate devices', () => {
        const scene = room([
            { fromPeerId: 'ana', toPeerId: 'ben', connectionType: 'p2p' },
        ]);
        const geo = buildRouteGeometry(scene);
        const ssePts = geo.get('sse:me');
        const trkPts = geo.get('tracker:me');
        const pubPts = geo.get('pubtracker:me');
        expect(ssePts.length).toBeGreaterThan(4);
        expect(trkPts.length).toBeGreaterThan(4);
        expect(pubPts.length).toBeGreaterThan(2);
        // Midpoints on shared segments diverge into separate lanes rather than overlapping.
        const sseMid = pointAlong(ssePts, 0.35);
        const trkMid = pointAlong(trkPts, 0.35);
        expect(Math.hypot(sseMid.x - trkMid.x, sseMid.y - trkMid.y)).toBeGreaterThan(2);

        // Direct LAN route between Ana (left) and Ben (right) bows upward above Me (center).
        const lanPts = geo.get('p2p:ana|ben');
        const lanMid = pointAlong(lanPts, 0.5);
        expect(lanMid.y).toBeLessThan(scene.byId.get('me').y - 15);
    });

    it('separates multiple routes sharing a NAT-to-NAT segment into distinct lanes', () => {
        const scene = room([
            { fromPeerId: 'me', toPeerId: 'ben', connectionType: 'p2p nat' },
        ]);
        scene.routes.push({
            id: 'demo:punch',
            kind: 'punch',
            path: ['me', 'nat:1.1.1.1', 'nat:2.2.2.2', 'ben'],
            label: 'srflx ↔ srflx',
            demo: true,
        });
        const geo = buildRouteGeometry(scene);
        const realPts = geo.get('p2p:ben|me');
        const demoPts = geo.get('demo:punch');
        const realMid = pointAlong(realPts, 0.5);
        const demoMid = pointAlong(demoPts, 0.5);
        expect(Math.abs(realMid.y - demoMid.y)).toBeGreaterThan(2);
    });
});

describe('pointAlong', () => {
    it('walks a polyline by length', () => {
        const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }];
        expect(pointAlong(points, 0)).toEqual({ x: 0, y: 0 });
        expect(pointAlong(points, 0.25)).toEqual({ x: 10, y: 0 });
        expect(pointAlong(points, 0.5)).toEqual({ x: 10, y: 10 });
        expect(pointAlong(points, 1)).toEqual({ x: 10, y: 30 });
        expect(pointAlong([{ x: 3, y: 4 }], 0.5)).toEqual({ x: 3, y: 4 });
    });

    it('turns a route into points', () => {
        const scene = room();
        const points = routePoints(scene, scene.routes.find(route => route.id === 'sse:me'));
        expect(points).toHaveLength(4);
        expect(points[3]).toEqual({ x: scene.byId.get('api').x, y: scene.byId.get('api').y });
    });
});

describe('transferRoutesFor', () => {
    it('puts a torrent on the routes to the peers wired for it', () => {
        const scene = room([
            { fromPeerId: 'me', toPeerId: 'ana', connectionType: 'p2p' },
            { fromPeerId: 'me', toPeerId: 'ben', connectionType: 'p2p nat' },
            { fromPeerId: 'ana', toPeerId: 'ben', connectionType: 'p2p nat' },
        ]);
        const ids = list => list.map(route => route.id).sort();
        expect(ids(transferRoutesFor(scene.routes, 'me', { wires: [{ peerId: 'ben' }] }))).toEqual(['p2p:ben|me']);
        // No wires known yet: every route of ours, never the others'.
        expect(ids(transferRoutesFor(scene.routes, 'me', { wires: [] }))).toEqual(['p2p:ana|me', 'p2p:ben|me']);
    });
});
