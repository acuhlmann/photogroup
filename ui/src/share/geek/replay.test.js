import { describe, it, expect } from 'vitest';
import { buildScene } from './scene';
import { replaySteps } from './replay';

const host = ip => ({ ip, port: 50000, type: 'host', typeDetail: 'host', transport: 'udp' });
const srflx = ip => ({ ip, port: 61000, type: 'srflx', typeDetail: 'srflx', transport: 'udp' });

const scene = buildScene({
    myPeerId: 'me',
    me: { name: 'Mine' },
    localNetwork: [host('192.168.1.2'), srflx('1.1.1.1')],
    peers: [
        { peerId: 'me', name: 'Mine', networkChain: [host('192.168.1.2'), srflx('1.1.1.1')] },
        { peerId: 'ana', name: 'Ana', networkChain: [host('10.0.0.3'), srflx('2.2.2.2')] },
    ],
    connections: [{ fromPeerId: 'ana', toPeerId: 'me', connectionType: 'stun' }],
    origin: 'https://photogroup.network',
    rtcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
    width: 1000,
    height: 800,
});

const item = {
    infoHash: 'h1', name: 'beach.jpg',
    stages: [
        { at: 1000, lane: 'p2p', stage: 'signal', text: 'announce infohash to tracker' },
        { at: 1400, lane: 'p2p', stage: 'handshake', text: 'wire up', peerId: 'ana' },
        { at: 1700, lane: 'p2p', stage: 'metadata', text: 'metadata · 4 pieces of 16 KiB' },
        { at: 2000, lane: 'p2p', stage: 'pieces', text: 'first piece', peerId: 'ana', kind: 'rx' },
        { at: 9000, lane: 'p2p', stage: 'verify', text: 'all pieces here' },
    ],
    peers: new Map([['ana', { rx: 65536, tx: 0, pieces: 4 }]]),
    server: { rx: 0, tx: 0 },
};

describe('replaySteps', () => {
    const steps = replaySteps(scene, item, { myPeerId: 'me', peers: [{ peerId: 'ana', name: 'Ana' }] });

    it('turns each recorded stage into a step, with its real time, and ends with a summary', () => {
        expect(steps.map(step => step.title)).toEqual([
            'Your browser asked the tracker for peers',
            'Connected to Ana',
            'Got the file list and piece hashes',
            'First piece from Ana',
            'All pieces checked',
            'Summary',
        ]);
        expect(steps[0].body).toMatch(/^At \+0 ms, next stage 400 ms later\./);
        expect(steps[3].body).toContain('65.5 kB went from Ana');
        // A long real gap plays in a few seconds, a short one is still readable.
        expect(steps[3].duration).toBe(5000);
        expect(steps[0].duration).toBe(2200);
        expect(steps.at(-1).body).toBe('This share took 8.0 s on this device. 100% went peer to peer and 0% through the server.');
    });

    it('flies the pieces toward you along the path the two devices really use', () => {
        const pieces = steps[3];
        expect(pieces.routes).toEqual(['p2p:ana|me']);
        const route = scene.routes.find(r => r.id === 'p2p:ana|me');
        // The route starts at Ana, so pieces to you run along it, not against it.
        expect(route.path[0]).toBe('ana');
        expect(pieces.packets.every(packet => packet.reverse === false)).toBe(true);
        const known = new Set(scene.routes.map(r => r.id));
        steps.forEach(step => step.packets.forEach(packet => expect(known.has(packet.route)).toBe(true)));
    });

    it('has nothing to replay without recorded stages', () => {
        expect(replaySteps(scene, null)).toEqual([]);
        expect(replaySteps(scene, { stages: [] })).toEqual([]);
    });
});
