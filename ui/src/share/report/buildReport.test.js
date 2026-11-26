import { describe, it, expect, beforeEach } from 'vitest';
import { buildReport, fitReport, withoutNames, addressOf, reportFileName, NOT_INCLUDED } from './buildReport';
import { recordLog, clearLog, readLog, MAX_LINES } from './appLog';

const win = {
    location: { href: 'https://photogroup.network/?room=r1#k=secretkey' },
    navigator: { userAgent: 'UA/1', language: 'de-CH', onLine: true, connection: { effectiveType: '4g' } },
    screen: { width: 390, height: 844 },
    devicePixelRatio: 3,
    matchMedia: query => ({ matches: query.includes('coarse') }),
};

const master = () => ({
    device: 'Safari on iPhone',
    client: { peerId: 'me', torrents: [{ name: 'Holiday-beach.jpg', files: [{ name: 'Holiday-beach.jpg' }] }] },
    creator: { iceServers: { iceServers: [{ urls: 'turn:t.example', username: 'u', credential: 'turnpass' }] } },
    peers: { items: [{ peerId: 'me', name: 'Annika' }, { peerId: 'p2', name: 'Bruno' }], connections: [] },
    roomPhotos: { all: () => [{ infoHash: 'abc', fileName: 'Holiday-beach.jpg', peerId: 'p2', owners: [] }] },
    ledger: { all: () => [] },
    deviceTimes: { read: () => [], summary: () => ({}) },
    geekTimeline: { entries: [{ at: 0, kind: 'peer', text: '+ Bruno joined' }] },
});

describe('buildReport', () => {
    beforeEach(() => clearLog());

    it('holds the note, this device, the app log and the room data', () => {
        recordLog('WARN', 'Connection error with Bruno', 5);
        const report = buildReport({ master: master(), note: '  No photos arrive ', mode: 'simple', inRoom: true, now: Date.UTC(2026, 10, 25, 10), win });
        expect(report).toMatchObject({
            app: 'PhotoGroup', kind: 'problem-report', mode: 'simple', inRoom: true, private: false,
            note: 'No photos arrive', room: 'r1', address: 'https://photogroup.network/?room=r1',
            device: { name: 'Safari on iPhone', userAgent: 'UA/1', connection: '4g', touch: true, screen: { width: 390, height: 844, pixelRatio: 3 } },
        });
        expect(report.appLog).toEqual([{ at: '1970-01-01T00:00:00.005Z', level: 'WARN', text: 'Connection error with Bruno' }]);
        expect(report.log).toEqual([{ at: '1970-01-01T00:00:00.000Z', kind: 'peer', text: '+ Bruno joined' }]);
        expect(report.peers.map(peer => peer.name)).toEqual(['Annika', 'Bruno']);
        expect(JSON.stringify(report)).not.toMatch(/secretkey|turnpass|username/);
        expect(reportFileName(report)).toBe('photogroup-report-2026-11-25T10-00-00.json');
    });

    it('holds no room data before a room', () => {
        const report = buildReport({ master: master(), mode: 'default', inRoom: false, win });
        expect(report.peers).toBeUndefined();
        expect(report.photos).toBeUndefined();
        expect(report.device.name).toBe('Safari on iPhone');
    });

    it('takes the names of photos, people and the room out of a private room report', () => {
        recordLog('INFO', 'added Holiday-beach.jpg for Bruno in Anna birthday');
        const report = buildReport({
            master: master(), note: 'Bruno sees nothing', mode: 'geek', inRoom: true, isPrivate: true, roomName: 'Anna birthday', win,
        });
        const text = JSON.stringify({ ...report, note: '' });
        expect(text).not.toMatch(/Holiday-beach|Bruno|Annika|Anna birthday/);
        expect(report.appLog[0].text).toBe(`added ${NOT_INCLUDED} for ${NOT_INCLUDED} in ${NOT_INCLUDED}`);
        expect(report.private).toBe(true);
        // The note is what the person chose to write.
        expect(report.note).toBe('Bruno sees nothing');
    });

    it('leaves short names, numbers and keys alone', () => {
        expect(withoutNames({ a: 'Al went', n: 3, list: ['Al'] }, [])).toEqual({ a: 'Al went', n: 3, list: ['Al'] });
        expect(withoutNames({ name: 'Bruno', nested: [{ t: 'to Bruno' }] }, ['Bruno'])).toEqual({ name: NOT_INCLUDED, nested: [{ t: `to ${NOT_INCLUDED}` }] });
    });

    it('cuts the oldest lines until the report fits', () => {
        const appLog = Array.from({ length: 4000 }, (_, i) => ({ at: i, level: 'INFO', text: 'line ' + i + ' ' + 'x'.repeat(200) }));
        const fitted = fitReport({ app: 'PhotoGroup', appLog, log: [], ledger: [{ big: 'y'.repeat(1000) }] }, 100 * 1024);
        expect(new Blob([JSON.stringify(fitted)]).size).toBeLessThanOrEqual(100 * 1024);
        expect(fitted.trimmed).toBe(true);
        expect(fitted.ledger).toBeUndefined();
        expect(fitted.appLog.at(-1).text).toMatch(/^line 3999 /);
    });

    it('drops the address part after #', () => {
        expect(addressOf('https://x/?room=a#k=b')).toBe('https://x/?room=a');
    });
});

describe('appLog', () => {
    beforeEach(() => clearLog());

    it('keeps only the newest lines', () => {
        for (let i = 0; i < MAX_LINES + 5; i++) recordLog('INFO', 'n' + i, i);
        const lines = readLog();
        expect(lines).toHaveLength(MAX_LINES);
        expect(lines[0].text).toBe('n5');
    });
});
