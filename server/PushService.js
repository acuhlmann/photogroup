/**
 * PushService - web push, so a photo shared after a phone's browser closed
 * still reaches the person who was waiting for it.
 *
 * The page already says "someone added photos" while a tab is merely in the
 * background (ui/src/share/newPhotoNotices.js), but that needs the page to
 * still be running. A push message goes through the browser's own push
 * service, so it arrives with the tab closed and the phone asleep.
 *
 * Who gets one: a subscription is left alone when its session still has an
 * open update stream (that tab notices by itself) and when it is the session
 * that shared the photos. So the two cases that are told are a phone that
 * dropped its stream by going to the background and one whose browser is shut.
 *
 * What this costs, and how it is bounded:
 *  - VAPID keys say who this server is to the push services. They are made
 *    once and kept next to the rooms file: a subscription stops working if
 *    the key it was made against changes.
 *  - An endpoint is both a bearer token and a URL this server POSTs to, so a
 *    hostile one is a way to make the VM talk to its own metadata service.
 *    Endpoints are matched against the push services browsers actually hand
 *    out (PUSH_HOSTS) before anything is sent.
 *  - The body travels encrypted to the browser's own key, but its size does
 *    not: only a count and the room's public name go in.
 *  - Subscriptions end with the room, with the push service's "gone", or after
 *    SUBSCRIPTION_TTL_MS of nobody re-opening that room.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import webpush from 'web-push';
import { defaultStoreDir } from './RoomStore.js';

// Photos arrive one POST at a time on a slow upload; one message per window
// says "new photos" once instead of ten times.
export const BATCH_MS = 2000;
export const SUBSCRIPTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ROOM_SUBSCRIPTIONS = 50;
export const MAX_TOTAL_SUBSCRIPTIONS = 500;
// A message nobody could take for a day is not worth taking late.
export const MESSAGE_TTL_SECONDS = 60 * 60 * 24;

/**
 * The push services browsers actually give out, as hosts or subdomain roots.
 * Matched exactly or as a subdomain, never as a suffix of something else, so
 * `fcm.googleapis.com.attacker.net` cannot register here.
 */
export const PUSH_HOSTS = [
    'fcm.googleapis.com',                 // Chrome, Edge, Opera, Brave, Samsung Internet, Firefox on Android
    'android.googleapis.com',             // the same, older Google Cloud Messaging form
    'updates.push.services.mozilla.com',  // Firefox on a computer
    'push.services.mozilla.com',
    'updates-autopush.stage.mozaws.net',
    'updates-autopush.dev.mozaws.net',
    'notify.windows.com',                 // Edge on Windows (Windows Push Notification Services)
    'push.apple.com',                     // Safari
    'web.push.apple.com',
    'web.push-sandbox.apple.com',
    'canary.push.apple.com',
];

/** https, no port, no credentials, a hostname rather than an address, a real push service. */
export function endpointAllowed(endpoint, allowedHosts = PUSH_HOSTS) {
    if (typeof endpoint !== 'string' || !endpoint) return false;
    let url;
    try {
        url = new URL(endpoint);
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (!host || host.startsWith('[') || host.endsWith('.localhost') || /^\d+(\.\d+){3}$/.test(host)) return false;
    return allowedHosts.some(allowed => host === allowed || host.endsWith('.' + allowed));
}

function validKeys(keys) {
    return !!keys && typeof keys.p256dh === 'string' && keys.p256dh.length > 0
        && typeof keys.auth === 'string' && keys.auth.length > 0;
}

/** Sessions with an open update stream: they notice new photos on their own. */
function liveSessions(room) {
    return new Set(room?.peers?.clientsBySessionId?.keys?.() || []);
}

/** A private room's name is sealed, so there is nothing public to say. */
export function notificationText(room, count) {
    const settings = room?.settings || {};
    const name = settings.private ? '' : String(settings.name || '').replace(/^sealed:/, '');
    return {
        title: name || 'PhotoGroup',
        body: count === 1 ? 'Someone added a photo.' : `Someone added ${count} photos.`,
        roomId: room.id,
        // The same tag the page uses for its own notice, so a phone whose tab
        // is still alive shows one message about these photos, not two.
        tag: photosTag(room.id),
    };
}

/** One message per room: two rooms are two pieces of news, one room is one. */
export function photosTag(roomId) {
    return 'photogroup-new-photos-' + roomId;
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve: value => resolve(value) };
}

export default class PushService {

    constructor({
        app,
        file = defaultPushPath(),
        keyFile = defaultKeyPath(),
        vapidSubject = process.env.VAPID_SUBJECT || 'https://photogroup.network',
        send = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options),
        generateKeys = () => webpush.generateVAPIDKeys(),
        batchMs = BATCH_MS,
        ttlMs = SUBSCRIPTION_TTL_MS,
        maxPerRoom = MAX_ROOM_SUBSCRIPTIONS,
        maxTotal = MAX_TOTAL_SUBSCRIPTIONS,
        now = () => Date.now(),
        setTimer = (fn, ms) => setTimeout(fn, ms),
        clearTimer = handle => clearTimeout(handle),
        allowedHosts = PUSH_HOSTS,
        remoteLog = () => {},
    } = {}) {
        Object.assign(this, {
            app, file, keyFile, vapidSubject, send, generateKeys, batchMs, ttlMs,
            maxPerRoom, maxTotal, now, setTimer, clearTimer, allowedHosts, remoteLog,
        });
        /** roomId -> endpoint -> { endpoint, keys, sessionId, at } */
        this.subscriptions = new Map();
        /** roomId -> the photos that arrived since the last message went out */
        this.batches = new Map();
        this.total = 0;
        this.publicKey = null;
        this.writing = Promise.resolve();
        this.seq = 0;
    }

    /** The key browsers subscribe with. app.js runs this once, before any route answers. */
    start() {
        this.loadKeys();
        this.load();
        this.registerPublicKeyRoute();
        return this;
    }

    /**
     * Environment first, then the saved pair, then a new pair. A deployment
     * that moves machines can set the pair and keep every subscription it made.
     *
     * A saved pair that does not validate is replaced rather than kept: it is
     * a half-written or hand-edited file, and nothing can be sent with it
     * anyway. Subscriptions made against the old key go with it, since a push
     * service expects the key a browser subscribed with.
     */
    loadKeys() {
        if (this.useEnvKeys()) return;
        let saved = null;
        try {
            saved = JSON.parse(fs.readFileSync(this.keyFile, 'utf8'));
        } catch { /* first start, or unreadable: make new keys either way */ }
        if (saved?.publicKey && saved?.privateKey) {
            this.setKeys(saved.publicKey, saved.privateKey);
            if (this.publicKey) return;
        }
        const made = this.generateKeys();
        this.setKeys(made.publicKey, made.privateKey);
        if (this.publicKey) this.scheduleKeys(made);
    }

    /** True when a complete pair is in the environment, whether or not it works. */
    useEnvKeys() {
        const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = process.env;
        if (!publicKey || !privateKey) return false;
        this.setKeys(publicKey, privateKey);
        return true;
    }

    /**
     * Hand the pair to the push library and keep the public half for the page.
     * A pair that does not validate (a truncated env var, a half-written key
     * file) leaves push off rather than throwing: the rooms are the point of
     * this process, and advertising a key the library would reject would have
     * browsers subscribe for nothing.
     */
    setKeys(publicKey, privateKey) {
        try {
            webpush.setVapidDetails(this.vapidSubject, publicKey, privateKey);
        } catch (err) {
            this.remoteLog('[Push] unusable VAPID keys, sending no push: ' + (err?.message || err));
            this.publicKey = null;
            this.privateKey = null;
            return;
        }
        this.publicKey = publicKey;
        this.privateKey = privateKey;
    }

    scheduleKeys(keys) {
        this.writing = this.writing.then(() => this.writeKeys(keys)).catch(err => {
            this.remoteLog('[Push] cannot save the VAPID keys: ' + (err?.message || err));
        });
        return this.writing;
    }

    async writeKeys(keys) {
        await fsp.mkdir(path.dirname(this.keyFile), { recursive: true });
        // 0600: this holds the private half of what authorizes our pushes.
        await fsp.writeFile(this.keyFile, JSON.stringify(keys), { encoding: 'utf8', mode: 0o600 });
    }

    /**
     * A missing or unreadable file is simply no subscriptions: push is a
     * nicety, and a broken one must never stop the server from starting.
     */
    load() {
        let raw;
        try {
            raw = fs.readFileSync(this.file, 'utf8');
        } catch (err) {
            if (err.code !== 'ENOENT') this.remoteLog('[Push] cannot read ' + this.file + ': ' + err.message);
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            this.remoteLog('[Push] ' + this.file + ' is not readable (' + err.message + '); starting with none');
            return;
        }
        const at = this.now();
        (Array.isArray(parsed?.subscriptions) ? parsed.subscriptions : []).forEach(item => {
            if (typeof item?.roomId !== 'string') return;
            if (at - (item.at || 0) > this.ttlMs) return;
            this.add(item.roomId, item, { persist: false });
        });
        if (this.total) this.remoteLog('[Push] restored ' + this.total + ' subscription(s)');
    }

    schedule() {
        this.writing = this.writing.then(() => this.write()).catch(err => {
            this.remoteLog('[Push] could not save subscriptions: ' + (err?.message || err));
        });
        return this.writing;
    }

    /** Queue a write and wait for everything queued, including this one. */
    settled() {
        this.schedule();
        return this.writing;
    }

    async write() {
        const all = [];
        this.subscriptions.forEach((byEndpoint, roomId) => {
            byEndpoint.forEach(item => all.push({ ...item, roomId }));
        });
        const body = JSON.stringify({ savedAt: this.now(), subscriptions: all });
        // Write-then-rename, with a name of its own: a crash mid-write leaves
        // the previous file intact, and two processes cannot collide on a path.
        const tmp = `${this.file}.tmp.${process.pid}.${++this.seq}`;
        try {
            await fsp.mkdir(path.dirname(this.file), { recursive: true });
            // 0600 for this one too: an endpoint URL is a bearer token, and
            // whoever holds one can post to that browser.
            await fsp.writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
            await fsp.rename(tmp, this.file);
        } catch (err) {
            await fsp.rm(tmp, { force: true }).catch(() => {});
            throw err;
        }
    }

    count(roomId) {
        return this.subscriptions.get(roomId)?.size || 0;
    }

    /** Every subscription held, whatever its room. */
    all() {
        return this.total;
    }

    /**
     * Keep one entry per endpoint per room. Two tabs of one browser share an
     * endpoint, and delivering to it twice would be the same message twice.
     * Returns false when the endpoint is not one we may post to, or the room
     * or the server is already full of subscriptions.
     */
    add(roomId, subscription, { persist = true } = {}) {
        const { endpoint, keys, sessionId } = subscription || {};
        if (typeof roomId !== 'string' || !roomId) return false;
        if (!endpointAllowed(endpoint, this.allowedHosts)) return false;
        if (!validKeys(keys)) return false;

        let byEndpoint = this.subscriptions.get(roomId);
        if (!byEndpoint) {
            if (this.total >= this.maxTotal) return false;
            byEndpoint = new Map();
            this.subscriptions.set(roomId, byEndpoint);
        }
        if (!byEndpoint.has(endpoint)) {
            if (byEndpoint.size >= this.maxPerRoom) return false;
            this.total++;
        }

        byEndpoint.set(endpoint, {
            endpoint,
            keys: { p256dh: keys.p256dh, auth: keys.auth },
            sessionId: typeof sessionId === 'string' ? sessionId : null,
            at: this.now(),
        });
        if (persist) this.schedule();
        return true;
    }

    remove(roomId, endpoint) {
        const byEndpoint = this.subscriptions.get(roomId);
        if (!byEndpoint || !byEndpoint.has(endpoint)) return false;
        byEndpoint.delete(endpoint);
        if (byEndpoint.size === 0) this.subscriptions.delete(roomId);
        this.total--;
        this.schedule();
        return true;
    }

    /** A room deleted for everyone has nobody left to tell. */
    forgetRoom(roomId) {
        this.total -= this.count(roomId);
        this.subscriptions.delete(roomId);
        this.dropBatch(roomId);
        this.schedule();
    }

    reset() {
        this.subscriptions.clear();
        this.batches.forEach(item => this.clearTimer(item.timer));
        this.batches.clear();
        this.total = 0;
        this.schedule();
    }

    /**
     * Photos arrived in `room`, shared by `sessionId`. Resolves with the
     * endpoints that were told, once the message for this burst goes out.
     */
    photosAdded(room, { count = 0, sessionId = null } = {}) {
        if (!room || count <= 0 || !this.publicKey || this.count(room.id) === 0) return Promise.resolve([]);

        // The timer is armed after the count lands, never inside the make: a
        // caller with an immediate timer (the tests) would otherwise deliver a
        // batch of zero before this line ever ran.
        const batch = this.batchFor(room);
        batch.count += count;
        if (sessionId) batch.sharedBy.add(sessionId);
        this.reschedule(batch);
        return batch.settled;
    }

    /** The burst being collected for `room`, started if none is running. */
    batchFor(room) {
        const waiting = this.batches.get(room.id);
        if (waiting) return waiting;
        const batch = { room, count: 0, sharedBy: new Set(), result: deferred(), settled: null, timer: null };
        batch.settled = batch.result.promise;
        this.batches.set(room.id, batch);
        return batch;
    }

    /** Restart the clock on this batch: a further photo is still the same news. */
    reschedule(batch) {
        if (batch.timer) this.clearTimer(batch.timer);
        batch.timer = this.setTimer(() => {
            this.batches.delete(batch.room.id);
            this.deliver(batch);
        }, this.batchMs);
    }

    /** Send what is waiting now: for a graceful stop, and for tests. */
    flush(roomId) {
        const batch = this.batches.get(roomId);
        if (!batch) return Promise.resolve([]);
        this.batches.delete(roomId);
        if (batch.timer) this.clearTimer(batch.timer);
        return this.deliver(batch);
    }

    /** Drop a queued message unsent: the room it was about is gone. */
    dropBatch(roomId) {
        const batch = this.batches.get(roomId);
        if (!batch) return;
        if (batch.timer) this.clearTimer(batch.timer);
        this.batches.delete(roomId);
        // Nobody is waiting on this room any more; answer an empty one rather
        // than leave the caller's promise hanging forever.
        batch.result.resolve([]);
    }

    /**
     * Tell everyone who cannot see it for themselves. A subscription whose
     * session still streams is left to the page's own notice, and one that
     * shared these photos is not told about its own delivery.
     */
    deliver(batch) {
        const { room, count } = batch;
        const byEndpoint = this.subscriptions.get(room.id);
        if (!byEndpoint || byEndpoint.size === 0) {
            batch.result.resolve([]);
            return batch.settled;
        }
        const live = liveSessions(room);
        const payload = JSON.stringify(notificationText(room, count));
        const sent = [];
        const drops = [];

        const targets = [...byEndpoint.values()].filter(item =>
            !item.sessionId || (!batch.sharedBy.has(item.sessionId) && !live.has(item.sessionId)));

        return Promise.all(targets.map(async item => {
            try {
                await this.send(item, payload, { TTL: MESSAGE_TTL_SECONDS });
                sent.push(item.endpoint);
            } catch (err) {
                // 404/410: the browser threw the subscription away. 400/413
                // from the push service: it no longer routes ours to it.
                if ([400, 404, 410, 413].includes(err?.statusCode)) drops.push(item.endpoint);
                else this.remoteLog('[Push] ' + (err?.statusCode ?? '?') + ' ' + (err?.message || err));
            }
        })).then(() => {
            drops.forEach(endpoint => this.remove(room.id, endpoint));
            batch.result.resolve(sent);
            return sent;
        });
    }

    registerPublicKeyRoute() {
        if (!this.app) return;
        // Named like __rtcConfig__ and __trackerConfig__: it belongs to this
        // service, not to a room, so it is not in Rooms.js.
        this.app.get('/api/__pushConfig__', (request, response) => {
            // null says "no push from here". The page then keeps the notice it
            // can already do and does not ask for a permission with no result.
            response.send({ publicKey: this.publicKey || null });
        });
    }
}

export function defaultPushPath() {
    if (process.env.PUSH_STORE_PATH) return process.env.PUSH_STORE_PATH;
    const name = process.env.NODE_ENV === 'test' ? 'photogroup-push-test-' + process.pid + '.json' : 'push.json';
    return path.join(defaultStoreDir(), name);
}

export function defaultKeyPath() {
    if (process.env.VAPID_KEY_PATH) return process.env.VAPID_KEY_PATH;
    const name = process.env.NODE_ENV === 'test' ? 'photogroup-vapid-test-' + process.pid + '.json' : 'vapid.json';
    return path.join(defaultStoreDir(), name);
}
