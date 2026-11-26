import { buildExport } from '../geek/exportLog';
import { readLog } from './appLog';
import { appVersion } from './appVersion';

// A problem report: what the person wrote, this device, the app log, and in
// a room the same session data as geek mode's log export (transfers, devices,
// photos, and the packet log when the map ran). No photos, no TURN passwords,
// no session tokens, and never the private room key (it is after "#").

export const REPORT_KIND = 'problem-report';
export const MAX_NOTE = 2000;
// The server takes 2 MB. Stay under it with room for the JSON around it.
export const MAX_REPORT_BYTES = 1800 * 1024;
export const NOT_INCLUDED = '(not included)';

/** The address without its "#…": a private room's key lives there. */
export function addressOf(href = '') {
    return String(href).split('#')[0];
}

function deviceOf(win) {
    const nav = win?.navigator || {};
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    const screen = win?.screen;
    let installed = false;
    try {
        installed = !!(win?.matchMedia?.('(display-mode: standalone)')?.matches || nav.standalone);
    } catch {
        installed = false;
    }
    return {
        userAgent: nav.userAgent || '',
        language: nav.language || null,
        online: nav.onLine !== false,
        connection: connection?.effectiveType || null,
        screen: screen ? { width: screen.width, height: screen.height, pixelRatio: win.devicePixelRatio || 1 } : null,
        touch: !!win?.matchMedia?.('(pointer: coarse)')?.matches,
        installed,
        memoryGb: nav.deviceMemory ?? null,
        cores: nav.hardwareConcurrency ?? null,
    };
}

/** The names a private room keeps from the server: photos and people. */
function privateNames(master, roomName) {
    const names = new Set();
    const add = value => {
        const text = typeof value === 'string' ? value.trim() : '';
        if (text.length >= 3) names.add(text);
    };
    (master?.roomPhotos?.all?.() || []).forEach(photo => {
        add(photo.fileName);
        add(photo.title);
        add(photo.details?.title);
    });
    (master?.client?.torrents || []).forEach(torrent => {
        add(torrent.name);
        (torrent.files || []).forEach(file => add(file.name));
    });
    (master?.peers?.items || []).forEach(peer => add(peer.name));
    add(roomName);
    return [...names].sort((a, b) => b.length - a.length);
}

/** Every string in the data, with each of those names taken out. */
export function withoutNames(data, names) {
    if (!names.length) return data;
    const clean = text => names.reduce((out, name) => out.split(name).join(NOT_INCLUDED), text);
    const walk = value => {
        if (typeof value === 'string') return clean(value);
        if (Array.isArray(value)) return value.map(walk);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
        }
        return value;
    };
    return walk(data);
}

const sizeOf = data => new Blob([JSON.stringify(data)]).size;

/** Make it fit the server's limit: the oldest lines go first. */
export function fitReport(data, max = MAX_REPORT_BYTES) {
    let out = data;
    if (sizeOf(out) <= max) return out;
    out = { ...out, ledger: undefined, trimmed: true };
    for (let round = 0; round < 12 && sizeOf(out) > max; round++) {
        out = {
            ...out,
            appLog: (out.appLog || []).slice(Math.floor((out.appLog || []).length / 2)),
            log: (out.log || []).slice(Math.floor((out.log || []).length / 2)),
            transfers: round > 3 ? (out.transfers || []).slice(-20) : out.transfers,
        };
    }
    return out;
}

/**
 * @param {object} input
 * @param {object} [input.master] the TorrentMaster, for the room's data
 * @param {string} input.note what the person wrote
 * @param {string} input.mode the UI mode
 * @param {boolean} [input.inRoom]
 * @param {boolean} [input.isPrivate]
 * @param {string} [input.roomName] a private room's name, kept out like the others
 */
export function buildReport({
    master, note = '', mode = '', inRoom = false, isPrivate = false, roomName = '',
    now = Date.now(), win = typeof window !== 'undefined' ? window : undefined,
}) {
    const href = addressOf(win?.location?.href);
    let session = {};
    if (inRoom && master) {
        try {
            session = buildExport({ master, timeline: master.geekTimeline, now, href, userAgent: win?.navigator?.userAgent || '' });
        } catch (err) {
            session = { sessionError: String(err?.message || err) };
        }
    }
    const report = {
        ...session,
        app: 'PhotoGroup',
        kind: REPORT_KIND,
        version: 1,
        appVersion: appVersion(),
        sentAt: new Date(now).toISOString(),
        mode,
        inRoom,
        private: !!isPrivate,
        address: href,
        note: String(note || '').trim().slice(0, MAX_NOTE),
        device: { name: master?.device || null, ...deviceOf(win) },
        serverAway: !!master?.offlineRoom?.away,
        appLog: readLog().map(line => ({ at: new Date(line.at).toISOString(), level: line.level, text: line.text })),
    };
    delete report.exportedAt;
    const safe = isPrivate ? withoutNames(report, privateNames(master, roomName)) : report;
    // What the person wrote stays as it is: they chose to send it.
    return fitReport({ ...safe, note: report.note });
}

/** "photogroup-report-2026-11-25T10-00-00.json" */
export function reportFileName(report) {
    const stamp = String(report.sentAt || '').replace(/[:.]/g, '-').replace(/-\d+Z$/, '');
    return `photogroup-report-${stamp}.json`;
}
