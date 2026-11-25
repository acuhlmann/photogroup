import '../test-setup.js';

import assert from 'assert';
import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import express from 'express';
import request from 'supertest';
import ProblemReports, { newReportId, readReport, REPORTS_PER_HOUR, MAX_REPORTS, MAX_REPORT_BYTES } from '../../ProblemReports.js';

const report = (extra = {}) => JSON.stringify({ app: 'PhotoGroup', kind: 'problem-report', mode: 'simple', note: 'No photos', ...extra });

describe('Problem reports API', () => {
    let dir;
    let app;
    let clock;
    let reports;

    beforeEach(async () => {
        dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pg-reports-'));
        clock = Date.parse('2026-11-25T10:00:00Z');
        app = express();
        app.use(express.json());
        reports = new ProblemReports({ app, dir, now: () => clock });
        reports.start();
    });

    afterEach(() => fsp.rm(dir, { recursive: true, force: true }));

    it('keeps a report as a file and answers its id', async () => {
        const res = await request(app).post('/api/reports').set('Content-Type', 'text/plain').send(report()).expect(200);
        assert.match(res.body.id, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
        const files = await fsp.readdir(dir);
        assert.strictEqual(files.length, 1);
        assert.ok(files[0].endsWith(`_${res.body.id}.json`));
        const kept = JSON.parse(await fsp.readFile(path.join(dir, files[0]), 'utf8'));
        assert.strictEqual(kept.id, res.body.id);
        assert.strictEqual(kept.note, 'No photos');
        assert.strictEqual(kept.receivedAt, '2026-11-25T10:00:00.000Z');
    });

    it('takes a report sent as JSON too', async () => {
        await request(app).post('/api/reports').send({ app: 'PhotoGroup', kind: 'problem-report' }).expect(200);
    });

    it('takes a report over the 100 kB JSON limit', async () => {
        const log = Array.from({ length: 3000 }, (_, i) => ({ at: i, text: 'x'.repeat(100) }));
        await request(app).post('/api/reports').set('Content-Type', 'application/octet-stream').send(report({ log })).expect(200);
    });

    it('refuses anything that is not a report', async () => {
        await request(app).post('/api/reports').set('Content-Type', 'text/plain').send('hello').expect(400);
        await request(app).post('/api/reports').set('Content-Type', 'text/plain').send('{"app":"Other"}').expect(400);
        assert.deepStrictEqual(await fsp.readdir(dir).catch(() => []), []);
    });

    it('refuses a report that is too big', async () => {
        const big = report({ log: 'x'.repeat(MAX_REPORT_BYTES) });
        await request(app).post('/api/reports').set('Content-Type', 'text/plain').send(big).expect(413);
    });

    it('takes a few reports an hour from one address, then says to wait', async () => {
        for (let i = 0; i < REPORTS_PER_HOUR; i++) {
            await request(app).post('/api/reports').set('Content-Type', 'text/plain').send(report()).expect(200);
        }
        await request(app).post('/api/reports').set('Content-Type', 'text/plain').send(report()).expect(429);
        clock += 61 * 60 * 1000;
        await request(app).post('/api/reports').set('Content-Type', 'text/plain').send(report()).expect(200);
    });

    it('drops reports older than 30 days and keeps at most the newest ones', async () => {
        await fsp.writeFile(path.join(dir, '2026-10-01T00-00-00-000Z_OLDX-OLDX.json'), '{}');
        await fsp.writeFile(path.join(dir, '2026-11-20T00-00-00-000Z_NEWX-NEWX.json'), '{}');
        await request(app).post('/api/reports').set('Content-Type', 'text/plain').send(report()).expect(200);
        const files = await fsp.readdir(dir);
        assert.strictEqual(files.length, 2);
        assert.ok(!files.some(name => name.includes('OLDX')));

        for (let i = 0; i < MAX_REPORTS + 3; i++) {
            await fsp.writeFile(path.join(dir, `2026-11-21T00-00-00-${String(i).padStart(3, '0')}Z_FILL-${i}.json`), '{}');
        }
        await reports.prune();
        assert.strictEqual((await fsp.readdir(dir)).length, MAX_REPORTS);
    });

    it('makes ids from a small alphabet with no look-alike letters', () => {
        assert.strictEqual(newReportId(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])), 'ABCD-EFGH');
        assert.ok(!/[01IO]/.test(newReportId()));
        assert.strictEqual(readReport('[1]'), null);
    });
});
