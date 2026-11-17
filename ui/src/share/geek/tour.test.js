import { describe, it, expect } from 'vitest';
import { buildScene } from './scene';
import { demoInputs, withDemoRoutes, tourSteps, tourFriend, GHOST_ID, EXAMPLE_PHOTO, fingerprintPhoto, pieceLengthFor } from './tour';
import { PHASES } from './FingerprintDiagram';
import { phaseAt } from './diagramParts';
import { PICTURES } from './stepPictures';
import { createTimeline } from './timeline';
import { createTourPlayer } from './tourPlayer';
import { explainEntry, EXPLAINED_KINDS } from './explain';
import { describeEvent } from './packetLog';

const host = ip => ({ ip, port: 50000, type: 'host', typeDetail: 'host', transport: 'udp' });
const srflx = ip => ({ ip, port: 61000, type: 'srflx', typeDetail: 'srflx', transport: 'udp' });

const base = (extra = {}) => ({
    myPeerId: 'me',
    me: { name: 'Mine' },
    localNetwork: [host('192.168.1.2')],
    peers: [{ peerId: 'me', name: 'Mine', networkChain: [host('192.168.1.2')] }],
    connections: [],
    origin: 'https://photogroup.network',
    rtcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
    width: 1000,
    height: 800,
    ...extra,
});

const tourScene = inputs => withDemoRoutes(buildScene(demoInputs(inputs)), inputs.myPeerId);

describe('tour scene', () => {
    it('brings an example friend and example public addresses when you are alone without STUN', () => {
        const scene = tourScene(base());
        const ghost = scene.byId.get(GHOST_ID);
        expect(ghost).toMatchObject({ kind: 'device', example: true, label: 'a friend (example)' });
        expect(tourFriend(scene, 'me')).toBe(GHOST_ID);
        // Both of you behind a NAT, each marked an example where it is one.
        const nats = scene.nodes.filter(node => node.kind === 'nat');
        expect(nats).toHaveLength(2);
        expect(nats.every(nat => nat.example && nat.sub === 'example address')).toBe(true);
        // The three paths ICE tries, through the right boxes.
        const route = id => scene.routes.find(item => item.id === id);
        expect(route('demo:lan').path).toEqual(['me', GHOST_ID]);
        expect(route('demo:punch').path).toEqual(['me', 'nat:198.51.100.23', 'nat:203.0.113.99', GHOST_ID]);
        expect(route('demo:relay').path).toEqual(['me', 'nat:198.51.100.23', 'turn', 'nat:203.0.113.99', GHOST_ID]);
    });

    it('uses the real friend and your real public address when there are some', () => {
        const scene = tourScene(base({
            localNetwork: [host('192.168.1.2'), srflx('1.1.1.1')],
            peers: [
                { peerId: 'me', name: 'Mine', networkChain: [host('192.168.1.2'), srflx('1.1.1.1')] },
                { peerId: 'ana', name: 'Ana', networkChain: [host('10.0.0.3'), srflx('2.2.2.2')] },
            ],
            connections: [{ fromPeerId: 'me', toPeerId: 'ana', connectionType: 'stun' }],
        }));
        expect(scene.byId.get(GHOST_ID)).toBeUndefined();
        expect(tourFriend(scene, 'me')).toBe('ana');
        expect(scene.byId.get('nat:1.1.1.1').example).toBe(false);

        const steps = tourSteps(scene, { myPeerId: 'me' });
        // The pieces step follows the path ICE really settled on.
        const pieces = steps.find(step => step.id === 'pieces');
        expect(pieces.routes).toEqual(['p2p:ana|me']);
        expect(steps.find(step => step.id === 'ice').body).toContain('ICE chose the path straight through both NATs');
    });
});

describe('tourSteps', () => {
    const scene = tourScene(base());
    const steps = tourSteps(scene, { myPeerId: 'me', rtcConfig: base().rtcConfig });

    it('walks a share from opening the room to who saw what', () => {
        expect(steps.map(step => step.id)).toEqual(['join', 'stun', 'hash', 'publish', 'tracker', 'ice', 'turn', 'pieces', 'copy', 'summary']);
        steps.forEach(step => {
            expect(step.title).toBeTruthy();
            expect(step.body.length).toBeGreaterThan(80);
        });
    });

    it('only lights and flies on what is really on the map', () => {
        const nodes = new Set(scene.nodes.map(node => node.id));
        const routes = new Set(scene.routes.map(route => route.id));
        steps.forEach(step => {
            step.nodes.forEach(id => expect(nodes.has(id), `${step.id} node ${id}`).toBe(true));
            step.routes.forEach(id => expect(routes.has(id), `${step.id} route ${id}`).toBe(true));
            step.packets.forEach(packet => expect(routes.has(packet.route), `${step.id} packet ${packet.route}`).toBe(true));
        });
    });

    it('tells the fingerprint step in phases, with an example photo when there is none', () => {
        const hash = steps.find(step => step.id === 'hash');
        expect(hash.visual).toBe('fingerprint');
        expect(hash.photo).toBe(EXAMPLE_PHOTO);
        expect(hash.phases).toHaveLength(PHASES);
        expect(hash.phases[0]).toBe('Your browser cuts the photo into pieces of 16 KiB.');
        expect(hash.body).toBe(hash.phases.join(' '));
        expect(hash.sees).toEqual([{ who: 'on your device only', what: 'the photo, its pieces and their hashes', tone: 'good' }]);
        // The example adds up the way WebTorrent cuts a 3.4 MB photo.
        expect(EXAMPLE_PHOTO.pieceLength).toBe(16384);
        expect(EXAMPLE_PHOTO.pieceCount).toBe(205);
        expect(pieceLengthFor(100 * 1024 * 1024)).toBe(131072);
        expect([0, 0.19, 0.2, 0.5, 0.99, 1].map(progress => phaseAt(progress, PHASES))).toEqual([0, 0, 1, 2, 4, 4]);
    });

    it('tells every step in phases, each with its picture', () => {
        steps.forEach(step => {
            expect(PICTURES[step.visual], step.id).toBeTruthy();
            expect(step.phases.length, step.id).toBeGreaterThan(1);
            expect(step.body).toBe(step.phases.join(' '));
            // About two seconds or more per phase, so the picture can be read.
            expect(step.duration / step.phases.length, step.id).toBeGreaterThanOrEqual(1800);
        });
        expect(steps.filter(step => step.seesInPicture).map(step => step.id)).toEqual(['hash', 'summary']);
        expect(steps.find(step => step.id === 'stun').data).toMatchObject({ privateIp: '192.168.1.2', publicIp: '198.51.100.23' });
    });

    it('shows a real photo in the fingerprint step, the one you shared first', () => {
        const hashes = n => Array.from({ length: n }, (_, i) => String(i).padStart(40, String(i % 10)));
        const theirs = { infoHash: 'AAA', name: 'theirs.jpg', length: 50000, pieceLength: 16384, _hashes: hashes(4) };
        const mine = { infoHash: 'BBB', name: 'IMG_2041.jpg', length: 3100000, pieceLength: 16384, _hashes: hashes(190) };
        const loading = { infoHash: 'CCC', length: 0, pieceLength: 0 };
        const photo = fingerprintPhoto([loading, theirs, mine], [{ infoHash: 'bbb', peerId: 'me' }], 'me');
        expect(photo).toMatchObject({ example: false, name: 'IMG_2041.jpg', pieceCount: 190, infoHash: 'bbb' });
        // The first three pieces and the last.
        expect(photo.pieceHashes).toEqual([hashes(190)[0], hashes(190)[1], hashes(190)[2], hashes(190)[189]].map(h => h.slice(0, 8)));
        expect(fingerprintPhoto([theirs], [], 'me').pieceHashes).toHaveLength(4);
        expect(fingerprintPhoto([loading], [], 'me')).toBeNull();
        expect(fingerprintPhoto(undefined, undefined, 'me')).toBeNull();
        const real = tourSteps(scene, { myPeerId: 'me', photo }).find(step => step.id === 'hash');
        expect(real.photo).toBe(photo);
    });

    it('says plainly what the server keeps and what it never sees', () => {
        const publish = steps.find(step => step.id === 'publish');
        expect(publish.sees.map(item => item.who)).toEqual(['photogroup.network keeps', 'never sees']);
        expect(publish.sees[0].what).toMatch(/magnet.*30 days/);
        // No TURN configured here: the tour says so, and what catches it instead.
        const turn = steps.find(step => step.id === 'turn');
        expect(turn.body).toContain('no TURN configured');
        expect(turn.packets).toEqual([]);
    });

    it('describes a configured TURN relay as seeing only encrypted bytes', () => {
        const relayed = tourScene(base({ rtcConfig: { iceServers: [{ urls: 'turn:global.turn.twilio.com:3478', username: 'u', credential: 'c' }] } }));
        expect(relayed.byId.get('turn')).toMatchObject({
            label: 'Twilio',
            sub: 'global.turn.twilio.com',
        });
        const turn = tourSteps(relayed, { myPeerId: 'me' }).find(step => step.id === 'turn');
        expect(turn.sees[0]).toEqual({ who: 'TURN sees', what: 'both IP addresses and encrypted bytes' });
        expect(turn.routes).toContain('turnctl:me');
        expect(turn.packets.length).toBeGreaterThan(0);
    });

    it('includes public fallback trackers in the tracker step when present', () => {
        const tracker = steps.find(step => step.id === 'tracker');
        expect(tracker.nodes).toContain('pubtrackers');
        expect(tracker.routes).toContain('pubtracker:me');
    });
});

describe('createTourPlayer', () => {
    const steps = [
        { id: 'a', duration: 1000, packets: [{ route: 'r', label: 'one', at: 0 }, { route: 'r', label: 'two', at: 500 }] },
        { id: 'b', duration: 1000, packets: [{ route: 'r', label: 'three', at: 0 }] },
    ];
    const setup = () => {
        const clock = { value: 0 };
        const now = () => clock.value;
        const timeline = createTimeline({ now });
        const player = createTourPlayer({ timeline, now });
        player.load(steps);
        player.start(0);
        return { clock, timeline, player };
    };
    const labels = timeline => timeline.entries.map(entry => entry.flights[0].label);

    it("sends each step's packets on time and loops the step until you move on", () => {
        const { clock, timeline, player } = setup();
        player.tick();
        expect(labels(timeline)).toEqual(['one']);
        clock.value = 600;
        player.tick();
        expect(labels(timeline)).toEqual(['one', 'two']);
        clock.value = 2000;
        player.tick();
        clock.value = 2050;
        player.tick();
        expect(player.index).toBe(0);
        expect(labels(timeline)).toEqual(['one', 'two', 'one']);
        player.next();
        expect(player.step.id).toBe('b');
        // Moving on clears the map of the last step's packets.
        expect(timeline.entries).toHaveLength(0);
    });

    it('holds, slows down and plays through on its own', () => {
        const { clock, timeline, player } = setup();
        player.setHeld(true);
        clock.value = 5000;
        player.tick();
        expect(labels(timeline)).toEqual([]);
        expect(timeline.playing).toBe(false);
        player.setHeld(false);
        player.setSpeed(0.5);
        clock.value = 5800;
        player.tick();
        // Half speed: 800 ms in is 400 ms of the step, before "two" leaves.
        expect(labels(timeline)).toEqual(['one']);
        player.setSpeed(1);
        player.setAuto(true);
        clock.value = 8000;
        player.tick();
        expect(player.step.id).toBe('b');
    });

    it('stays on the step you were reading when the map is rebuilt', () => {
        const { player } = setup();
        player.next();
        player.load([{ id: 'z', packets: [] }, ...steps]);
        expect(player.step.id).toBe('b');
    });
});

describe('explainEntry', () => {
    it('has an explanation for every kind of line the log writes', () => {
        const samples = [
            ['wire', [{ peerId: 'x', type: 'webrtc' }, 'addr', { name: 'a' }]],
            ['downloadProgress', [{ torrent: { name: 'a' }, speed: '1 MB/s' }]],
            ['uploadProgress', [{ torrent: { name: 'a' }, speed: '1 MB/s' }]],
            ['peers', [{ type: 'add', item: { peerId: 'p' } }]],
            ['peerConnections', [[]]],
            ['photos', [{ type: 'add', item: [{ fileName: 'a.jpg' }] }]],
            ['pcEvent', ['icegatheringstatechange', 'gathering']],
            ['pcEvent', ['icecandidate', 'srflx 203.0.113.5:5000']],
            ['pcEvent', ['icecandidate', 'relay 192.0.2.9:49152']],
            ['trackerAnnounce', [{ torrent: { name: 'a' }, isPublic: true, host: 'tracker.openwebtorrent.com' }]],
            ['trackerStatus', [{ isPublic: true, host: 'tracker.btorrent.xyz', status: 'connected' }]],
            ['linkStats', [{ changed: true, peerId: 'ana', local: 'relay', remote: 'srflx', relayProtocol: 'udp' }]],
            ['sseReconnected', []],
            ['serverCopy', [{ stage: 'queued', infoHash: 'h' }]],
        ];
        samples.forEach(([name, args]) => {
            const line = describeEvent(name, args);
            expect(EXPLAINED_KINDS, name).toContain(line.kind);
            expect(explainEntry({ kind: line.kind }).sees).toBeTruthy();
        });
        expect(explainEntry({ kind: 'stun' }).title).toContain('STUN');
        expect(explainEntry({ kind: 'turn' }).title).toContain('TURN');
        expect(explainEntry({ kind: 'pub' }).title).toContain('Public backup');
        // A change the log writes no line for still gets explained.
        expect(explainEntry({ kind: 'peers' }).title).toBe('Someone joined, left or changed');
        expect(explainEntry(null)).toBeNull();
        expect(explainEntry({ kind: 'tour' })).toBeNull();
    });
});
