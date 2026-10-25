import '../test-setup.js';
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import webpush from 'web-push';
import PushService, {
    endpointAllowed, notificationText, photosTag, PUSH_HOSTS, MAX_ROOM_SUBSCRIPTIONS,
} from '../../PushService.js';

const FCM = 'https://fcm.googleapis.com/fcm/send/abcdef123456';
const AUTOPUSH = 'https://updates.push.services.mozilla.com/wpush/v2/abcdef';
const APPLE = 'https://web.push.apple.com/abcdef';
const KEYS = { p256dh: 'browserPublicKey', auth: 'browserAuthToken' };

// The push library checks the shape of a VAPID pair, so a test pair has to be
// a real one. Generated once for the file: it costs a millisecond, and every
// service below just reuses it instead of paying a key generation each time.
const VAPID = webpush.generateVAPIDKeys();

const room = (id, settings = {}, sessions = []) => ({
    id,
    settings,
    peers: { clientsBySessionId: new Map(sessions.map(s => [s, {}])) },
});

/**
 * A service that writes into `dir`, records what it would send, and holds its
 * batch timers until the test fires them, so nothing is delivered before the
 * burst is complete. Clearing a timer really removes it: a batch that keeps
 * growing must still end up as one message.
 */
function service(options = {}) {
    const { dir, ...rest } = options;
    const timers = new Map();
    let sequence = 0;
    const sent = [];
    const made = new PushService({
        file: dir ? path.join(dir, 'push.json') : undefined,
        keyFile: dir ? path.join(dir, 'vapid.json') : undefined,
        batchMs: 1000,
        generateKeys: () => VAPID,
        send: (subscription, payload) => {
            sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
            return Promise.resolve({ statusCode: 201 });
        },
        setTimer: fn => { const id = ++sequence; timers.set(id, fn); return id; },
        clearTimer: id => timers.delete(id),
        ...rest,
    });
    made.start();
    return {
        made,
        sent,
        fire: () => {
            const waiting = [...timers.values()];
            timers.clear();
            waiting.forEach(fn => fn());
        },
    };
}

describe('PushService', () => {
    let dir;

    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    describe('which endpoints may be posted to', () => {
        it('takes the push services browsers actually hand out', () => {
            [FCM, AUTOPUSH, APPLE].forEach(endpoint => assert.ok(endpointAllowed(endpoint)));
        });

        it('refuses anything that is not https', () => {
            assert.ok(!endpointAllowed('http://fcm.googleapis.com/fcm/send/x'));
            assert.ok(!endpointAllowed('not-a-url'));
            assert.ok(!endpointAllowed(''));
            assert.ok(!endpointAllowed(undefined));
        });

        it('refuses a host that only ends up looking like a push service', () => {
            assert.ok(!endpointAllowed('https://fcm.googleapis.com.attacker.net/x'));
            assert.ok(!endpointAllowed('https://notpush.apple.com/x'));
            assert.ok(!endpointAllowed('https://fcm.googleapis.com:8443/fcm/send/x'));
        });

        it('refuses the addresses no browser is ever handed an endpoint for, including this VM metadata service', () => {
            assert.ok(!endpointAllowed('https://169.254.169.254/latest/meta-data/'));
            assert.ok(!endpointAllowed('https://[::1]/x'));
            assert.ok(!endpointAllowed('https://localhost/x'));
            assert.ok(!endpointAllowed('https://metadata.google.internal/x'));
            // Credentials hide the host the request would really go to.
            assert.ok(!endpointAllowed('https://fcm.googleapis.com@169.254.169.254/x'));
        });

        it('keeps a room from filling up with them', () => {
            const { made } = service({ dir });
            for (let i = 0; i < MAX_ROOM_SUBSCRIPTIONS; i++) {
                assert.ok(made.add('abc', { endpoint: `${FCM}-${i}`, keys: KEYS }));
            }
            assert.ok(!made.add('abc', { endpoint: `${FCM}-overflow`, keys: KEYS }));
            assert.strictEqual(made.count('abc'), MAX_ROOM_SUBSCRIPTIONS);
        });

        it('wants an endpoint and the browser keys that encrypt for it', () => {
            const { made } = service({ dir });
            assert.ok(!made.add('abc', { endpoint: FCM, keys: { p256dh: 'k' } }));
            assert.ok(!made.add('abc', { endpoint: FCM }));
            assert.ok(!made.add('abc', { endpoint: 'https://x.test/y', keys: KEYS }));
            assert.ok(made.add('abc', { endpoint: FCM, keys: KEYS }));
        });

        it('keeps one entry per endpoint, so two tabs of one browser get one message', () => {
            const { made } = service({ dir });
            made.add('abc', { endpoint: FCM, keys: KEYS, sessionId: 'one' });
            made.add('abc', { endpoint: FCM, keys: KEYS, sessionId: 'two' });
            assert.strictEqual(made.count('abc'), 1);
            assert.strictEqual(made.all(), 1);
        });

        it('lists only hosts, never a URL or a wildcard', () => {
            assert.ok(PUSH_HOSTS.includes('fcm.googleapis.com'));
            assert.ok(PUSH_HOSTS.every(host => !host.includes('://') && !host.includes('*')));
        });
    });

    describe('what the message says', () => {
        it('names a room people can read', () => {
            assert.deepStrictEqual(notificationText(room('abc', { name: 'Beach day' }), 3), {
                title: 'Beach day',
                body: 'Someone added 3 photos.',
                roomId: 'abc',
                tag: photosTag('abc'),
            });
            assert.strictEqual(notificationText(room('abc'), 1).body, 'Someone added a photo.');
            assert.strictEqual(notificationText(room('abc'), 1).title, 'PhotoGroup');
        });

        it('says nothing readable about a private room, whose name the server only has sealed', () => {
            const text = notificationText(room('abc', { private: true, name: 'sealed:B3vTwO' }), 2);
            assert.strictEqual(text.title, 'PhotoGroup');
            assert.ok(!text.title.includes('sealed'));
        });

        it('gathers one room into one message', () => {
            assert.strictEqual(photosTag('abc'), 'photogroup-new-photos-abc');
        });
    });

    describe('who is told', () => {
        function subscribed(options = {}) {
            const setup = service({ dir, ...options });
            setup.made.add('abc', { endpoint: FCM, keys: KEYS, sessionId: 'away' });
            setup.made.add('abc', { endpoint: AUTOPUSH, keys: KEYS, sessionId: 'here' });
            return setup;
        }

        it('stays quiet when nobody in the room asked to be told', async () => {
            const { made, sent } = service({ dir });
            assert.deepStrictEqual(await made.photosAdded(room('abc'), { count: 2 }), []);
            assert.strictEqual(sent.length, 0);
        });

        it('tells the room once about a burst of photos', async () => {
            const { made, sent, fire } = subscribed();
            const told = made.photosAdded(room('abc'), { count: 2, sessionId: 'sharer' });
            made.photosAdded(room('abc'), { count: 3, sessionId: 'sharer' });
            assert.strictEqual(sent.length, 0, 'still collecting: a phone is still uploading');
            fire();
            await told;
            // One message each, not one per photo: five photos are one piece of
            // news, and both browsers in the room hear the same count.
            assert.strictEqual(sent.length, 2);
            sent.forEach(item => assert.strictEqual(item.payload.body, 'Someone added 5 photos.'));
        });

        it('leaves a phone with an open update stream to its own notice', async () => {
            const { made, sent, fire } = subscribed();
            const told = made.photosAdded(room('abc', {}, ['here']), { count: 1 });
            fire();
            assert.deepStrictEqual(await told, [FCM]);
            assert.strictEqual(sent.length, 1);
            assert.strictEqual(sent[0].endpoint, FCM);
        });

        it('does not tell the phone that shared the photos', async () => {
            const { made, sent, fire } = service({ dir });
            made.add('abc', { endpoint: FCM, keys: KEYS, sessionId: 'sharer' });
            const told = made.photosAdded(room('abc'), { count: 1, sessionId: 'sharer' });
            fire();
            assert.deepStrictEqual(await told, []);
            assert.strictEqual(sent.length, 0);
        });

        it('tells a browser whose session the server never saw', async () => {
            const { made, sent, fire } = service({ dir });
            made.add('abc', { endpoint: FCM, keys: KEYS });
            const told = made.photosAdded(room('abc'), { count: 1 });
            fire();
            assert.deepStrictEqual(await told, [FCM]);
            assert.strictEqual(sent.length, 1);
        });

        it('forgets an endpoint the push service says is gone, and keeps the rest', async () => {
            const { made, fire } = service({
                dir,
                send: subscription => (subscription.endpoint === FCM
                    ? Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 }))
                    : Promise.resolve({ statusCode: 201 })),
            });
            made.add('abc', { endpoint: FCM, keys: KEYS });
            made.add('abc', { endpoint: AUTOPUSH, keys: KEYS });
            const told = made.photosAdded(room('abc'), { count: 1 });
            fire();
            assert.deepStrictEqual(await told, [AUTOPUSH]);
            assert.strictEqual(made.count('abc'), 1);
        });

        it('keeps a subscription whose service was only busy', async () => {
            const { made, fire } = service({
                dir,
                send: () => Promise.reject(Object.assign(new Error('too many'), { statusCode: 429 })),
            });
            made.add('abc', { endpoint: FCM, keys: KEYS });
            const told = made.photosAdded(room('abc'), { count: 1 });
            fire();
            assert.deepStrictEqual(await told, []);
            assert.strictEqual(made.count('abc'), 1);
        });

        it('drops what a room leaves behind, message and all', async () => {
            const { made, sent, fire } = subscribed();
            const waiting = made.photosAdded(room('abc'), { count: 1 });
            made.forgetRoom('abc');
            fire();
            assert.deepStrictEqual(await waiting, []);
            assert.strictEqual(sent.length, 0);
            assert.strictEqual(made.all(), 0);
        });

        it('drops everything when the rooms are dropped', () => {
            const { made } = subscribed();
            made.reset();
            assert.strictEqual(made.all(), 0);
            assert.strictEqual(made.count('abc'), 0);
        });
    });

    describe('across a restart', () => {
        it('keeps the subscriptions and the key they were made against', async () => {
            const first = service({ dir });
            first.made.add('abc', { endpoint: FCM, keys: KEYS, sessionId: 'away' });
            await first.made.settled();
            const publicKey = first.made.publicKey;

            const again = service({ dir });
            assert.strictEqual(again.made.publicKey, publicKey);
            assert.strictEqual(again.made.count('abc'), 1);
            assert.strictEqual(again.made.all(), 1);
        });

        it('does not keep a subscription nobody has opened the room for in over a month', async () => {
            const first = service({ dir });
            first.made.add('abc', { endpoint: FCM, keys: KEYS });
            await first.made.settled();

            const later = service({ dir, now: () => Date.now() + 31 * 24 * 60 * 60 * 1000 });
            assert.strictEqual(later.made.count('abc'), 0);
        });

        it('starts with none when the file is not readable, and still comes up', () => {
            fs.writeFileSync(path.join(dir, 'push.json'), '{ not json');
            const { made } = service({ dir });
            assert.strictEqual(made.all(), 0);
        });

        it('saves the private key where a stranger cannot read it', async () => {
            const { made } = service({ dir });
            await made.settled();
            const mode = fs.statSync(path.join(dir, 'vapid.json')).mode & 0o777;
            assert.strictEqual(mode & 0o077, 0, 'group and other may not touch it: ' + mode.toString(8));
        });

        it('saves the endpoints where a stranger cannot read them either', async () => {
            const { made } = service({ dir });
            made.add('abc', { endpoint: FCM, keys: KEYS });
            await made.settled();
            const mode = fs.statSync(path.join(dir, 'push.json')).mode & 0o777;
            assert.strictEqual(mode & 0o077, 0,
                'an endpoint is a bearer token: ' + mode.toString(8));
        });

        it('replaces a half-written key file with a working pair rather than staying deaf', () => {
            fs.writeFileSync(path.join(dir, 'vapid.json'), JSON.stringify({ publicKey: 'Btrunc', privateKey: 'x' }));
            const { made } = service({ dir });
            assert.strictEqual(made.publicKey, VAPID.publicKey);
        });

        it('takes its keys from the environment, so a moved machine keeps them', () => {
            const saved = { ...process.env };
            process.env.VAPID_PUBLIC_KEY = VAPID.publicKey;
            process.env.VAPID_PRIVATE_KEY = VAPID.privateKey;
            try {
                const { made } = service({ dir });
                assert.strictEqual(made.publicKey, VAPID.publicKey);
            } finally {
                process.env = saved;
            }
        });

        it('sends no push on a VAPID pair that does not check out, instead of taking the server down', async () => {
            const saved = { ...process.env };
            process.env.VAPID_PUBLIC_KEY = 'Btruncated';
            process.env.VAPID_PRIVATE_KEY = 'truncated';
            try {
                const { made, sent, fire } = service({ dir });
                assert.strictEqual(made.publicKey, null);
                made.add('abc', { endpoint: FCM, keys: KEYS });
                // With no key there is nothing to subscribe with either, so the
                // room is told by the page alone and no endpoint is posted to.
                const told = made.photosAdded(room('abc'), { count: 1 });
                fire();
                assert.deepStrictEqual(await told, []);
                assert.strictEqual(sent.length, 0);
            } finally {
                process.env = saved;
            }
        });
    });

    describe('telling the page what key to subscribe with', () => {
        it('answers with the key it has', () => {
            let handler = null;
            const app = { get: (route, fn) => { if (route === '/api/__pushConfig__') handler = fn; } };
            const { made } = service({ dir, app });
            const answered = {};
            handler({}, { send: body => Object.assign(answered, body) });
            assert.strictEqual(answered.publicKey, made.publicKey);
        });

        it('answers with none when there is no key, so the page does not ask', () => {
            const made = new PushService({
                file: path.join(dir, 'push.json'),
                keyFile: path.join(dir, 'vapid.json'),
            });
            let handler = null;
            made.app = { get: (route, fn) => { handler = fn; } };
            made.registerPublicKeyRoute();
            const answered = {};
            handler({}, { send: body => Object.assign(answered, body) });
            assert.strictEqual(answered.publicKey, null);
        });
    });
});
