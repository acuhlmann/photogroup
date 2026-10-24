import { describe, it, expect } from 'vitest';
import { buildScene, routePoints, pointAlong, transferRoutesFor, TIER, hostOf } from './scene';

const chain = (lan, pub) => [
    { ip: lan, port: 50000, type: 'host', transport: 'udp' },
    ...(pub ? [{ ip: pub, port: 61000, type: 'srflx', transport: 'udp', network: { city: 'Vienna', country: 'AT', connection: { isp: 'A1' } } }] : []),
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

        expect(['edge', 'api', 'tracker', 'copies'].map(id => scene.byId.get(id).y)).toEqual(Array(4).fill(800 * TIER.infra));
        expect(scene.byId.get('edge').sub).toBe('Cloud Run wake → nginx');
        expect(scene.byId.get('tracker').sub).toBe('photogroup.network');
        expect(scene.byId.get('stun').sub).toContain('stun.l.google.com');
        // No TURN server and no relay candidates: no TURN node.
        expect(scene.byId.get('turn')).toBeUndefined();

        // Ana and I share a public address, so one NAT sits between us.
        const shared = scene.byId.get('nat:1.1.1.1');
        expect(shared.members.sort()).toEqual(['ana', 'me']);
        expect(shared.x).toBe((scene.byId.get('ana').x + scene.byId.get('me').x) / 2);
        expect(shared.sub).toBe('Vienna, AT · A1');
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

    it('names a local dev server instead of the production edge', () => {
        const scene = room([], { origin: 'http://localhost:3000' });
        expect(scene.byId.get('edge')).toMatchObject({ label: 'dev server', sub: 'localhost:3000' });
        expect(hostOf('not a url')).toBe('not a url');
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
