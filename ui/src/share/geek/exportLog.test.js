import { describe, it, expect } from 'vitest';
import { buildExport, exportFileName } from './exportLog';

describe('buildExport', () => {
    it('writes the session as data, without TURN passwords', () => {
        const master = {
            client: { peerId: 'me', torrents: [] },
            creator: { iceServers: { iceServers: [{ urls: 'turn:t.example', username: 'u', credential: 'secret' }] } },
            peers: { items: [{ peerId: 'me', name: 'Mine', networkChain: [{ type: 'host', ip: '10.0.0.2', port: 1 }] }], connections: [] },
            roomPhotos: { all: () => [{ infoHash: 'abc', fileName: 'a.jpg', peerId: 'me', owners: [{ peerId: 'me' }] }] },
            ledger: { all: () => [{ infoHash: 'abc', startedAt: 1, stages: [{ at: 1, lane: 'p2p', stage: 'signal' }], peers: new Map(), server: { rx: 0, tx: 0 } }] },
            deviceTimes: { read: () => [], summary: () => ({}) },
        };
        const timeline = { entries: [{ at: 0, kind: 'peer', text: '+ Ana joined' }, { at: 1, kind: 'rx', text: '' }] };
        const data = buildExport({ master, timeline, now: Date.UTC(2026, 10, 14, 9, 30), href: 'https://x/?room=r1#k=key' });
        expect(JSON.stringify(data)).not.toMatch(/secret|k=key|username/);
        expect(data.iceServers).toEqual([{ urls: 'turn:t.example' }]);
        expect(data.room).toBe('r1');
        expect(data.photos[0]).toMatchObject({ fileName: 'a.jpg', sharedBy: 'me' });
        expect(data.log).toEqual([{ at: '1970-01-01T00:00:00.000Z', kind: 'peer', text: '+ Ana joined' }]);
        expect(data.ledger[0].stages).toHaveLength(1);
        expect(exportFileName(data)).toBe('photogroup-log-r1-2026-11-14T09-30-00.json');
    });
});
