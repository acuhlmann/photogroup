import Logger from 'js-logger';
import { readPreference } from './preferences';

// Web push: the browser's own push service wakes a closed page, so a photo
// someone shares after this phone hung up still gets a message through. The
// in-page notice (newPhotoNotices.js) needs the page to still be running; this
// does not.
//
// What it takes: the service worker (the share-target one, already registered
// at scope '/'), a VAPID key this server is willing to send with, and the same
// notification permission the in-page notice needs.
//
// Where it does not work: an iPhone only pushes to a PhotoGroup added to the
// Home Screen, and a plain browser tab on any iOS does not get push at all.
// Then this says false and the page keeps its in-view notice, which is the
// whole feature minus the closed-browser part.

/** Whether this browser can be given a push subscription at all. */
export function pushAvailable(win = window) {
    return !!win?.Notification && !!win?.navigator?.serviceWorker
        && 'PushManager' in win && !!win.isSecureContext;
}

/** The subscription's applicationServerKey is the VAPID key as raw bytes. */
export function urlBase64ToUint8Array(key) {
    const padded = String(key).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - String(key).length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function asObject(subscription) {
    if (!subscription) return null;
    const json = subscription.toJSON ? subscription.toJSON() : subscription;
    return { endpoint: json.endpoint, keys: json.keys };
}

async function readyWorker(win) {
    return win.navigator.serviceWorker.ready;
}

/**
 * Subscribe this browser to push for the room the service is in, and leave the
 * subscription with the server. False when this browser, or this server, has
 * no push to give: the caller then keeps the in-page notice alone.
 *
 * Called again whenever the room opens, because a room this person returns to
 * weeks later must not be pointing at an endpoint that expired with the last
 * one, and the session it is matched against is new every time.
 */
export async function enablePush({ service, win = window } = {}) {
    if (!service || !pushAvailable(win)) return false;
    try {
        const config = await service.pushConfig();
        if (!config?.publicKey) return false;
        const registration = await readyWorker(win);
        const subscription = (await registration.pushManager.getSubscription())
            || await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(config.publicKey),
            });
        return await service.subscribePush(asObject(subscription));
    } catch (err) {
        // iOS without a Home Screen install, a denied subscription, a server
        // that sends no push: none of it is worth a message to the person
        // standing over a room full of photos.
        Logger.warn('push: ' + (err?.message || err));
        return false;
    }
}

/**
 * Re-leave the subscription with the server for the room just opened, if this
 * browser was told to do push before. A session id is made fresh every start
 * and the server matches a message against it to decide who is still present,
 * so a room opened again without this says "not here" to a phone that is here,
 * and notifies a person who is looking at the photos arriving.
 *
 * Says false when there is nothing to refresh: the choice was never made, or
 * the browser has not been given permission for it.
 */
export async function syncPush({ service, win = window } = {}) {
    if (!readPreference('notify')) return false;
    const api = 'Notification' in win ? win.Notification : null;
    if (!api || api.permission !== 'granted') return false;
    return enablePush({ service, win });
}

/**
 * Take this browser off one room and keep the browser subscription: another
 * room opened in another tab is still being told about. Leaving a room is the
 * case for this; turning the choice off entirely is disablePush.
 */
export async function dropRoomSubscription({ service, win = window } = {}) {
    if (!service || !pushAvailable(win)) return false;
    try {
        const registration = await readyWorker(win);
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return true;
        return await service.unsubscribePush(subscription.endpoint);
    } catch (err) {
        Logger.warn('push leave: ' + (err?.message || err));
        return false;
    }
}

/**
 * Stop being told about this room, and drop the browser subscription with it:
 * the choice is one per browser, so a switch off means no push anywhere. Other
 * rooms this browser left subscribed then point at a dead endpoint, and the
 * push service says so the next time, which is how they are cleaned up.
 */
export async function disablePush({ service, win = window } = {}) {
    if (!pushAvailable(win)) return false;
    try {
        const registration = await readyWorker(win);
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return true;
        if (service) await service.unsubscribePush(subscription.endpoint);
        await subscription.unsubscribe();
        return true;
    } catch (err) {
        Logger.warn('push off: ' + (err?.message || err));
        return false;
    }
}
