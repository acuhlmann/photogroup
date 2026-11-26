import express from 'express';
import crypto from 'crypto';
import fsp from 'fs/promises';
import path from 'path';
import { defaultStoreDir } from './RoomStore.js';

// "Send a problem report" in the app posts the session as JSON (the app log,
// the transfers, the room's devices and photos, see ui/src/share/report/).
// It lands as one file in data/reports/, next to rooms.json on the volume,
// so a redeploy keeps it. ./get-reports.sh copies the files from the VM.

export const MAX_REPORT_BYTES = 2 * 1024 * 1024;
export const REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_REPORTS = 500;
// Per address: enough for a person who tries a few times, not for a flood.
export const REPORTS_PER_HOUR = 6;
const HOUR_MS = 60 * 60 * 1000;
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A short id a person can read out: "K7QX-M2PA". */
export function newReportId(bytes = crypto.randomBytes(8)) {
    const chars = [...bytes].map(byte => ID_ALPHABET[byte % ID_ALPHABET.length]).join('');
    return chars.slice(0, 4) + '-' + chars.slice(4, 8);
}

export function defaultReportsDir() {
    if (process.env.REPORTS_DIR) return process.env.REPORTS_DIR;
    const name = process.env.NODE_ENV === 'test' ? 'reports-test-' + process.pid : 'reports';
    return path.join(defaultStoreDir(), name);
}

/** Only what the app makes: one JSON object that says it is a PhotoGroup report. */
export function readReport(raw) {
    let data = raw;
    if (Buffer.isBuffer(raw) || typeof raw === 'string') {
        try {
            data = JSON.parse(String(raw));
        } catch {
            return null;
        }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.app !== 'PhotoGroup' || data.kind !== 'problem-report') return null;
    return data;
}

export default class ProblemReports {
    constructor({ app, remoteLog = () => {}, dir = defaultReportsDir(), now = () => Date.now() }) {
        this.app = app;
        this.remoteLog = remoteLog;
        this.dir = dir;
        this.now = now;
        this.sent = new Map(); // address → times of its recent reports
    }

    start() {
        // Not JSON: the app-wide parser stops at 100 kB, and a report can be more.
        const body = express.raw({ type: () => true, limit: MAX_REPORT_BYTES });
        this.app.post('/api/reports', body, (request, response) => this.receive(request, response));
        this.app.use('/api/reports', (err, request, response, next) => {
            if (err?.type === 'entity.too.large') return response.status(413).send('The report is too big');
            next(err);
        });
    }

    allowed(address) {
        const since = this.now() - HOUR_MS;
        const times = (this.sent.get(address) || []).filter(at => at > since);
        if (times.length >= REPORTS_PER_HOUR) {
            this.sent.set(address, times);
            return false;
        }
        times.push(this.now());
        this.sent.set(address, times);
        if (this.sent.size > 10000) this.sent.clear();
        return true;
    }

    async receive(request, response) {
        const data = readReport(request.body);
        if (!data) return response.status(400).send('Not a problem report');
        if (!this.allowed(request.ip || 'unknown')) return response.status(429).send('Too many reports. Try again later.');

        const id = newReportId();
        const receivedAt = new Date(this.now()).toISOString();
        const file = path.join(this.dir, `${receivedAt.replace(/[:.]/g, '-')}_${id}.json`);
        try {
            await fsp.mkdir(this.dir, { recursive: true });
            await fsp.writeFile(file, JSON.stringify({ id, receivedAt, ...data }, null, 1));
            await this.prune();
        } catch (err) {
            this.remoteLog('problem report not saved: ' + err.message);
            return response.status(500).send('The server could not keep the report');
        }
        this.remoteLog(`problem report ${id} from ${data.mode || '?'} mode, ${request.body?.length ?? '?'} bytes`);
        response.json({ id });
    }

    /** Old reports go after 30 days, and the oldest when there are too many. */
    async prune() {
        const names = (await fsp.readdir(this.dir)).filter(name => name.endsWith('.json')).sort();
        const oldest = new Date(this.now() - REPORT_TTL_MS).toISOString().replace(/[:.]/g, '-');
        const extra = Math.max(0, names.length - MAX_REPORTS);
        const drop = names.filter((name, index) => index < extra || name.split('_')[0] < oldest);
        await Promise.all(drop.map(name => fsp.rm(path.join(this.dir, name), { force: true })));
    }
}
