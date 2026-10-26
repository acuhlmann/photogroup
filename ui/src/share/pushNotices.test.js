import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushAvailable, urlBase64ToUint8Array, enablePush, syncPush, disablePush, dropRoomSubscription } from './pushNotices';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/token';
// A real VAPID public key: an uncompressed P-256 point, 65 bytes, 87 base64url
// characters with the padding dropped. An invented string here would only prove
// the test agrees with itself about its own length.
const PUBLIC_KEY = 'BONtv9NwFh-dHDzx9k2vlOUENPBUWIRsk63J9Vpqtuj7QJ_LizYZfIxn7P01BCc5DYPUl6TRctTQlBz9VywBBjo';

function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
        clear: () => items.clear(),
    };
}

function fakeSubscription() {
    return { endpoint: ENDPOINT, keys: { p256dh: 'k', auth: 'a' }, unsubscribe: vi.fn(async () => true) };
}

/**
 * A browser that can do push. `existing` is what the worker already holds and
 * `made` is what a fresh subscribe hands back - kept apart because "this
 * browser has subscribed before" and "this browser is subscribing now" are two
 * different ways through enablePush, and one object for both would test only
 * the first.
 */
function pushWindow({ existing = fakeSubscription(), made = fakeSubscription(), subscribe = vi.fn(async () => made) } = {}) {
    const win = {
        isSecureContext: true,
        Notification: { permission: 'granted' },
        PushManager: {},
        navigator: {
            serviceWorker: {
                ready: Promise.resolve({ pushManager: { getSubscription: async () => existing, subscribe } }),
            },
        },
    };
    return { win, existing, made, subscribe };
}

function service({ publicKey = PUBLIC_KEY, subscribePush = vi.fn(async () => true), unsubscribePush = vi.fn(async () => true) } = {}) {
    return { pushConfig: vi.fn(async () => ({ publicKey })), subscribePush, unsubscribePush };
}

describe('pushNotices', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', memoryStorage());
    });

    describe('what this browser can do', () => {
        it('needs the push API, a service worker, notifications and a secure page', () => {
            expect(pushAvailable(pushWindow({}).win)).toBe(true);
            const noPushManager = pushWindow({}).win;
            delete noPushManager.PushManager;
            expect(pushAvailable(noPushManager)).toBe(false);
            const insecure = pushWindow({}).win;
            insecure.isSecureContext = false;
            expect(pushAvailable(insecure)).toBe(false);
            const noWorker = pushWindow({}).win;
            noWorker.navigator = {};
            expect(pushAvailable(noWorker)).toBe(false);
            expect(pushAvailable({})).toBe(false);
        });

        it('turns the VAPID key into the bytes the subscription wants', () => {
            // '-_8/' is the last four of the base64url alphabet: 62, 63, 60, 63.
            expect([...urlBase64ToUint8Array('-_8/')]).toEqual([0xFB, 0xFF, 0x3F]);
            expect(urlBase64ToUint8Array('-_8/')).toBeInstanceOf(Uint8Array);
            // Three characters carry 18 bits, which is two whole bytes: the
            // leftover 6 are not a byte and are dropped, not zero-extended.
            expect([...urlBase64ToUint8Array('-_8')]).toEqual([0xFB, 0xFF]);
        });

        it('pads a key to a whole group of four before decoding', () => {
            for (const key of ['AA', 'AAA', 'AAAA', 'AAAB', PUBLIC_KEY]) {
                expect(urlBase64ToUint8Array(key).length).toBe(Math.floor(key.length * 3 / 4));
            }
        });
    });

    describe('subscribing', () => {
        it('leaves the endpoint with the server, and makes no new subscription', async () => {
            const { win, existing, subscribe } = pushWindow({});
            const api = service();
            expect(await enablePush({ service: api, win })).toBe(true);
            expect(subscribe).not.toHaveBeenCalled();
            expect(api.subscribePush.mock.calls[0][0]).toEqual({ endpoint: existing.endpoint, keys: existing.keys });
        });

        it('makes a subscription when the browser does not have one yet', async () => {
            const { win, made, subscribe } = pushWindow({ existing: null });
            const api = service();
            expect(await enablePush({ service: api, win })).toBe(true);
            expect(subscribe).toHaveBeenCalledTimes(1);
            expect(subscribe.mock.calls[0][0].userVisibleOnly).toBe(true);
            expect(subscribe.mock.calls[0][0].applicationServerKey).toBeInstanceOf(Uint8Array);
            expect(subscribe.mock.calls[0][0].applicationServerKey.length).toBe(65);
            expect(api.subscribePush.mock.calls[0][0].endpoint).toBe(made.endpoint);
        });

        it('asks the server what key to use before it asks the browser', async () => {
            const { win, subscribe } = pushWindow({ existing: null });
            const api = service();
            await enablePush({ service: api, win });
            expect(api.pushConfig).toHaveBeenCalledTimes(1);
            expect(subscribe.mock.calls[0][0].applicationServerKey[0]).toBe(0x04);
        });

        it('says no when this server sends no push, without touching the browser', async () => {
            const { win, subscribe } = pushWindow({ existing: null });
            expect(await enablePush({ service: service({ publicKey: null }), win })).toBe(false);
            expect(subscribe).not.toHaveBeenCalled();
        });

        it('says no when the person refused the subscription, and keeps the in-page notice', async () => {
            const { win } = pushWindow({ existing: null, subscribe: vi.fn(async () => { throw new Error('NotAllowedError'); }) });
            expect(await enablePush({ service: service(), win })).toBe(false);
        });

        it('says no without a server to tell, or a browser that cannot push', async () => {
            expect(await enablePush({ win: pushWindow({}).win })).toBe(false);
            expect(await enablePush({ service: service(), win: {} })).toBe(false);
        });
    });

    describe('on every room open', () => {
        it('refreshes only once this browser both chose it and allowed it', async () => {
            const api = service();
            const { win } = pushWindow({});
            expect(await syncPush({ service: api, win })).toBe(false);

            localStorage.setItem('photogroup.notify', 'true');
            expect(await syncPush({ service: api, win })).toBe(true);
            expect(api.subscribePush).toHaveBeenCalledTimes(1);
        });

        it('stays quiet when the browser has not been allowed', async () => {
            localStorage.setItem('photogroup.notify', 'true');
            const { win } = pushWindow({});
            win.Notification.permission = 'default';
            const api = service();
            expect(await syncPush({ service: api, win })).toBe(false);
            expect(api.subscribePush).not.toHaveBeenCalled();
        });

        it('stays quiet where there is no push to be had', async () => {
            localStorage.setItem('photogroup.notify', 'true');
            const api = service();
            expect(await syncPush({ service: api, win: {} })).toBe(false);
        });
    });

    describe('stopping', () => {
        it('takes it off the room and unsubscribes the browser', async () => {
            const { win, existing } = pushWindow({});
            const api = service();
            expect(await disablePush({ service: api, win })).toBe(true);
            expect(api.unsubscribePush).toHaveBeenCalledWith(ENDPOINT);
            expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
        });

        it('has nothing to do when the browser never subscribed', async () => {
            const { win } = pushWindow({ existing: null });
            const api = service();
            expect(await disablePush({ service: api, win })).toBe(true);
            expect(api.unsubscribePush).not.toHaveBeenCalled();
        });

        it('leaving one room takes it off that room and leaves the browser alone', async () => {
            const { win, existing } = pushWindow({});
            const api = service();
            expect(await dropRoomSubscription({ service: api, win })).toBe(true);
            expect(api.unsubscribePush).toHaveBeenCalledWith(ENDPOINT);
            expect(existing.unsubscribe).not.toHaveBeenCalled();
        });

        it('a leave that the browser will not answer is a no, not a thrown error', async () => {
            const { win } = pushWindow({});
            win.navigator.serviceWorker.ready = Promise.reject(new Error('no worker'));
            expect(await dropRoomSubscription({ service: service(), win })).toBe(false);
        });

        it('leaving is a no where push was never available', async () => {
            expect(await dropRoomSubscription({ service: service(), win: {} })).toBe(false);
            expect(await dropRoomSubscription({ win: pushWindow({}).win })).toBe(false);
        });
    });
});
