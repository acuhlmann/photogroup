import { readPreference } from './preferences';

// "Tell me about new photos": while this page is in the background, show a
// notification when someone else adds photos. Only while the browser still
// runs the page; there are no push messages from the server.

export const BATCH_MS = 2000;

function notificationApi(win) {
    return win && 'Notification' in win ? win.Notification : null;
}

/** Ask the browser for permission. True when notifications may be shown. */
export async function askToNotify(win = window) {
    const api = notificationApi(win);
    if (!api) return false;
    if (api.permission === 'granted') return true;
    if (api.permission === 'denied') return false;
    return (await api.requestPermission()) === 'granted';
}

export function noticeText(count) {
    return count === 1 ? 'Someone added a photo.' : `Someone added ${count} photos.`;
}

/**
 * Listen for photos from other people and show one notification for each
 * burst of them. Returns a function that stops listening.
 */
export function watchNewPhotos({ emitter, getMyPeerId, win = window, doc = document, setTimer = setTimeout } = {}) {
    let pending = 0;
    let timer = null;

    const show = () => {
        timer = null;
        const count = pending;
        pending = 0;
        const api = notificationApi(win);
        if (!count || !api || api.permission !== 'granted' || !doc.hidden || !readPreference('notify')) return;
        const notice = new api(doc.title || 'PhotoGroup', { body: noticeText(count), tag: 'photogroup-new-photos' });
        notice.onclick = () => {
            win.focus?.();
            notice.close();
        };
    };

    const handle = event => {
        if (event?.type !== 'add' || !doc.hidden || !readPreference('notify')) return;
        const me = getMyPeerId?.();
        const items = [].concat(event.item || []).filter(item => item && !item.isFake && item.peerId !== me);
        if (!items.length) return;
        pending += items.length;
        if (!timer) timer = setTimer(show, BATCH_MS);
    };

    emitter.on('photos', handle);
    return () => emitter.removeListener('photos', handle);
}
