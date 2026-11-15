import Logger from 'js-logger';
import shortid  from 'shortid';
import cryptoRandomString from "crypto-random-string";
import { backoffDelay } from './util/ConnectionRecovery';
import { CHUNK_BYTES, FIRST_CHUNK_BYTES } from './torrent/ServerCopyLimits';
import { readPreference } from './preferences';
import { serverNotReached } from './nearby/nearbyNotes';

const SESSION_KEY = 'pgSessionId';

// Reloads keep the sessionId (and the server-issued token proving we own it)
// so the server swaps out our old peer instead of listing it next to the new
// one. It is only written while the page unloads, so a duplicated tab (which
// copies sessionStorage) still gets its own id.
function restoreSession() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
        sessionStorage.removeItem(SESSION_KEY);
        if (saved && saved.sessionId) return saved;
    } catch { /* storage blocked or unreadable */ }
    return { sessionId: shortid.generate() };
}

/**
 * @emits RoomsService#urlChange
 * @type {array} latest server state of magnet urls
 */
export default class RoomsService {

    constructor(emitter) {

        this.hasRoom = false;
        this.emitter = emitter;

        this.url = '/api/rooms';

        ({ sessionId: this.sessionId, sessionToken: this.sessionToken } = restoreSession());
        window.addEventListener('pagehide', event => this.handlePageHide(event));
        window.addEventListener('pageshow', () => {
            try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
        });
        this.clientId = localStorage.getItem('clientId');
        if(!this.clientId) {
            this.clientId = shortid.generate();
            localStorage.setItem('clientId', this.clientId);
        }
        //this.id = cryptoRandomString({length: 20, type: 'url-safe'});
        this.id = cryptoRandomString({length: 20, characters: '1234567890abcdefghijklmnopqrstuvwxyzzyxwvutsrqponmlkjihgfedcbaabcdefghijklmnopqrstuvwxyz'});

        const urlParams = new URLSearchParams(window.location.search);
        if(urlParams.has('room')) {
            this.id = urlParams.get('room');
            //this.emitter.emit('openRoomStart');
            this.hasRoom = true;
        }

        emitter.on('addPeerDone', async () => {

            const urlParams = new URLSearchParams(window.location.search);
            if(urlParams.has('room')) {
                this.id = urlParams.get('room');
                // An event listener's rejection goes nowhere: say what failed.
                try {
                    await this.master.findExistingContent(this.joinRoom);
                } catch (err) {
                    Logger.error('open room failed: ' + (err?.message || err));
                }
                //this.emitter.emit('openRoomEnd');
                this.emitter.emit('readyToUpload');
            }
        });

        emitter.on('appEventRequest', event => {

            return fetch(this.url + '/' + this.id + '/photos/events', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(event)
            });
        });
    }

    handlePageHide(event) {
        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sessionId: this.sessionId, sessionToken: this.sessionToken }));
        } catch { /* storage blocked */ }
        // A page frozen in the back/forward cache may come back; keep its peer.
        if (event.persisted || !this.hasRoom) return;
        const peerId = this.master?.client?.peerId;
        if (!peerId || !this.sessionToken || !navigator.sendBeacon) return;
        navigator.sendBeacon(this.url + '/' + this.id + '/peers/' + encodeURIComponent(peerId)
            + '/leave?sessionId=' + encodeURIComponent(this.sessionId), this.tokenBody());
    }

    /**
     * The session token as a beacon body: in the URL it would land in the
     * proxies' access logs.
     */
    tokenBody() {
        return new Blob([this.sessionToken], { type: 'text/plain' });
    }

    /**
     * Going to the background: tell the room we're away, not gone, so it
     * keeps us (and the photos we hold) through a longer grace period.
     */
    markAway() {
        if (!this.hasRoom) return false;
        const peerId = this.master?.client?.peerId;
        if (!peerId || !this.sessionToken || !navigator.sendBeacon) return false;
        return navigator.sendBeacon(this.url + '/' + this.id + '/peers/' + encodeURIComponent(peerId)
            + '/away?sessionId=' + encodeURIComponent(this.sessionId), this.tokenBody());
    }

    changeUrl(name, value) {
        const location = window.location;
        const params = new URLSearchParams(location.search);
        params.set(name, value);
        // Keep "#k=…": a private room's key.
        window.history.replaceState({}, '', decodeURIComponent(`${location.pathname}?${params}`) + location.hash);
    }

    closeUpdates() {
        this._sseIntentionallyClosed = true;
        if (this._sseReconnectTimer) { clearTimeout(this._sseReconnectTimer); this._sseReconnectTimer = null; }
        try { this._eventSource?.close(); } catch { /* noop */ }
        this._eventSource = null;
    }

    /** Force an immediate SSE reconnect (e.g. page became visible again). */
    reconnectUpdates() {
        if (!this.hasRoom) return;
        if (this._sseReconnectTimer) { clearTimeout(this._sseReconnectTimer); this._sseReconnectTimer = null; }
        try { this._eventSource?.close(); } catch { /* noop */ }
        this._eventSource = null;
        this._sseReconnectAttempt = 0;
        this.listenToUrlChanges();
    }

    scheduleSseReconnect() {
        if (this._sseIntentionallyClosed || this._sseReconnectTimer) return;
        const delay = backoffDelay(this._sseReconnectAttempt || 0);
        this._sseReconnectAttempt = (this._sseReconnectAttempt || 0) + 1;
        Logger.warn('SSE dropped, reconnecting in ' + delay + 'ms');
        this._sseReconnectTimer = setTimeout(() => {
            this._sseReconnectTimer = null;
            this.listenToUrlChanges();
            // Anything broadcast while we were asleep is missed: ask the
            // app to re-sync room state and re-announce to trackers.
            this.emitter.emit('sseReconnected');
        }, delay);
    }

    listenToUrlChanges() {
        const scope = this;
        // Never stack EventSources: backgrounded phones used to accumulate
        // one per reconnect, duplicating every photo/peer event.
        try { this._eventSource?.close(); } catch { /* noop */ }
        this._sseIntentionallyClosed = false;

        const source = this._eventSource = new window.EventSource('/api/rooms/' + this.id + '/updates/?sessionId=' + this.sessionId);
        // Whoever opened this stream re-syncs on their own; only a reconnect
        // the browser does by itself needs to ask for one (below).
        this._sseDropped = false;
        source.addEventListener('open', () => {
            scope._sseReconnectAttempt = 0;
            // Back after the browser's own retry: anything broadcast in the
            // gap was missed, and after a long gap the room dropped us.
            if (scope._sseDropped) {
                scope._sseDropped = false;
                scope.emitter.emit('sseReconnected');
            }
        }, false);

        // Each message as it came off the stream, for geek mode's map: which
        // channel, and how many bytes the server sent.
        const heard = (channel, event, data) => scope.emitter.emit('sse', {
            channel, type: data && !Array.isArray(data) ? data.type : undefined, bytes: event.data ? event.data.length : 0,
        });

        source.addEventListener('photos', event => {

            const data = JSON.parse(event.data);
            heard('photos', event, data);

            if(data.item) {
                if(data.type === 'add' || data.type === 'update') {
                    Logger.info(`photos: ${data.type} ${data.item.fileName || ''} infoHash ${data.item.infoHash} peerId ${data.item.peerId}`);
                } else if(data.type.includes('Owner')) {
                    //Logger.info(`photos: ${data.type} ${JSON.stringify(data.item, null, ' ')}`);
                } else {
                    Logger.info(`photos: ${data.type} ${JSON.stringify(data.item, null, ' ')}`);
                }
            } else {
                Logger.info(`photos: ${JSON.stringify(data, null, ' ')}`);
            }

            scope.master?.offlineRoom?.apply(data);
            scope.emitter.emit('photos', data);

        }, false);

        source.addEventListener('peers', event => {

            const data = JSON.parse(event.data);
            heard('peers', event, data);

            //Logger.info(`peers: ${data.type} ${JSON.stringify(data.item, null, ' ')}`);
            Logger.info(`peers: ${data.type} ${data.item.name} ${data.item.sessionId}`);

            const peer = data.item;
            
            // Debug: Check if network data is present
            if (peer.networkChain && peer.networkChain.length > 0) {
                const enrichedItems = peer.networkChain.filter(item => item.network && (item.network.city || item.network.connection?.isp));
                if (enrichedItems.length > 0) {
                    Logger.info(`[UI] Received peer ${peer.peerId} with ${enrichedItems.length} enriched network items`);
                    enrichedItems.forEach(item => {
                        Logger.info(`  - ${item.ip}: city=${item.network.city}, isp=${item.network.connection?.isp}`);
                    });
                } else {
                    Logger.warn(`[UI] Received peer ${peer.peerId} - NO enriched network data in chain`);
                    peer.networkChain.forEach(item => {
                        Logger.warn(`  - ${item.ip}: hasNetwork=${!!item.network}, networkKeys=${item.network ? Object.keys(item.network).join(',') : 'none'}`);
                    });
                }
            }
            
            const nat = peer.networkChain
                ? peer.networkChain.find(item => (item.type.includes('srflx') || item.type.includes('prflx'))
                    && item.label) : null;
            if(nat) {
                //Logger.info(`peers nat: ${nat.label}`);
            }

            scope.emitter.emit('peers', data);
        }, false);

        source.addEventListener('room', event => {
            const data = JSON.parse(event.data);
            heard('room', event, data);
            if (data?.settings) scope.emitter.emit('roomSettings', data.settings);
            if (data?.deleted) scope.emitter.emit('roomDeleted', data.deleted);
        }, false);

        source.addEventListener('peerConnections', event => {

            const data = JSON.parse(event.data);
            heard('peerConnections', event, data);

            //Logger.info(`peerConnections: ${data.length} ${JSON.stringify(data, null, ' ')}`);

            scope.emitter.emit('peerConnections', data);
        }, false);

        source.addEventListener('error', e => {
            Logger.error('sse error: ' + JSON.stringify(e))
            scope.master?.offlineRoom?.check().catch(() => {});
            if (source.readyState === EventSource.CLOSED) {
                Logger.error('Connection was closed');
                scope.scheduleSseReconnect();
            } else {
                scope._sseDropped = true;
            }
        }, false);
    }

    /**
     * Proof that a request comes from this tab's session in the room. Owner
     * records need it too: they decide who may leave a server copy.
     */
    sessionHeaders() {
        return { 'X-Session-Id': this.sessionId, 'X-Session-Token': this.sessionToken || '' };
    }

    blobUrl(infoHash, path = '') {
        return this.url + '/' + this.id + '/photos/blob' + path + '?infoHash=' + encodeURIComponent(infoHash);
    }

    /**
     * Leave a temporary server copy of a photo, in chunks the server lets us
     * resume: it answers a wrong offset with where it got to, so a page
     * frozen midway carries on from there. Resolves to a `status`:
     * stored, exists, busy (someone else is uploading it), interrupted
     * (network gone or session lost; try again on resume) or refused.
     */
    async uploadServerCopy(infoHash, blob, { onProgress, retries = 3, wait = backoffDelay } = {}) {
        if (!infoHash || !blob) throw new Error('uploadServerCopy needs infoHash and blob');
        const size = blob.size;
        let offset = 0;
        let failures = 0;
        const pause = async () => {
            if (++failures > retries) return false;
            await new Promise(resolve => setTimeout(resolve, typeof wait === 'function' ? wait(failures - 1) : wait));
            return true;
        };
        while (offset < size) {
            const end = Math.min(size, offset + (offset === 0 ? FIRST_CHUNK_BYTES : CHUNK_BYTES));
            let response;
            try {
                response = await fetch(this.blobUrl(infoHash) + '&offset=' + offset + '&size=' + size, {
                    method: 'PUT',
                    headers: { ...this.sessionHeaders(), 'Content-Type': blob.type || 'application/octet-stream' },
                    body: blob.slice(offset, end)
                });
            } catch (err) {
                Logger.warn('server copy chunk failed: ' + (err?.message || err));
                if (await pause()) continue;
                return { status: 'interrupted', received: offset };
            }
            const body = await response.json().catch(() => ({}));
            if (response.ok) {
                failures = 0;
                offset = body.received;
                onProgress?.(offset, size);
                if (body.complete) return { status: 'stored', size };
            } else if (response.status === 409 && body.code === 'OFFSET' && Number.isFinite(body.received)) {
                offset = body.received;
            } else if (response.status === 409 && body.exists) {
                return { status: 'exists' };
            } else if (response.status === 409 && body.uploading) {
                return { status: 'busy' };
            } else if (response.status === 403) {
                // Dropped from the room while away; rejoining on resume fixes it.
                return { status: 'interrupted', received: offset };
            } else if (response.status >= 500) {
                // The server is struggling, not saying no: worth another go later.
                if (await pause()) continue;
                return { status: 'interrupted', received: offset };
            } else {
                return { status: 'refused', code: response.status, message: body.error };
            }
        }
        return { status: 'stored', size };
    }

    /**
     * Download the server copy of a photo when P2P has stalled, reporting
     * `onProgress(loaded, total)` as the bytes arrive where the browser
     * can stream the body.
     */
    async fetchServerCopy(infoHash, { onProgress } = {}) {
        const response = await fetch(this.blobUrl(infoHash), { headers: this.sessionHeaders() });
        if (!response.ok) return null;
        const reader = onProgress && response.body?.getReader?.();
        if (!reader) return response.blob();
        const total = Number(response.headers.get('Content-Length')) || undefined;
        const type = response.headers.get('Content-Type') || '';
        const parts = [];
        let loaded = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            loaded += value.byteLength;
            onProgress(loaded, total);
        }
        return new Blob(parts, { type });
    }

    /** Ask whoever has the photo to leave a server copy. */
    async requestServerCopy(infoHash) {
        const response = await fetch(this.blobUrl(infoHash, '/request'), { method: 'POST', headers: this.sessionHeaders() });
        if (!response.ok) throw new Error('Asking for a server copy failed (' + response.status + ')');
        return response.json();
    }

    /** Room-wide settings, e.g. keepCopies for people who join later. */
    async updateRoomSettings(settings) {
        const response = await fetch(this.url + '/' + this.id + '/settings', {
            method: 'PUT',
            headers: { ...this.sessionHeaders(), 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        if (!response.ok) throw new Error('Could not change the room (' + response.status + ')');
        return response.json();
    }

    /** Delete this room for everyone: its photo list and server copies go now. */
    async deleteRoom() {
        const response = await fetch(this.url + '/' + this.id, { method: 'DELETE', headers: this.sessionHeaders() });
        if (!response.ok) throw new Error('Could not delete the room (' + response.status + ')');
        return response.json();
    }

    /**
     * The VAPID key this server sends push with, or null when it sends none:
     * that is the answer from a server that could not read its key file.
     */
    async pushConfig() {
        const response = await fetch('/api/__pushConfig__');
        if (!response.ok) throw new Error('Could not read the push setup (' + response.status + ')');
        return response.json();
    }

    /** Leave this browser's push endpoint with the room, so it can be told. */
    async subscribePush(subscription) {
        const response = await fetch(this.url + '/' + this.id + '/push', {
            method: 'PUT',
            headers: { ...this.sessionHeaders(), 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...subscription, sessionId: this.sessionId, sessionToken: this.sessionToken }),
        });
        return response.ok;
    }

    /**
     * Take this browser's endpoint off the room. Keepalive: this is sent while
     * a page is on its way out, when leaving a room or forgetting the device.
     */
    async unsubscribePush(endpoint) {
        const response = await fetch(this.url + '/' + this.id + '/push', {
            method: 'DELETE',
            keepalive: true,
            headers: { ...this.sessionHeaders(), 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint }),
        });
        return response.ok;
    }

    getRtcConfig() {

        return fetch('/api/__rtcConfig__')
            .then(response => {
                return response.json();
            })
            .then(json => {
                delete json.comment;
                //Logger.debug('read ' + JSON.stringify(json));
                return json;
            })
            .catch(err => {
                Logger.debug('__rtcConfig__ err ' + err);
            });
    }
    
    /**
     * Get the tracker WebSocket configuration from the server
     * @returns {Promise<{wsUrl: string, port: number}>} The tracker configuration
     */
    getTrackerConfig() {
        return fetch('/api/__trackerConfig__')
            .then(response => {
                return response.json();
            })
            .then(json => {
                delete json.comment;
                Logger.debug('trackerConfig: ' + JSON.stringify(json));
                return json;
            })
            .catch(err => {
                Logger.warn('__trackerConfig__ err ' + err);
                // Fallback to default local WebSocket URL
                return { wsUrl: 'ws://127.0.0.1:9000', port: 9000 };
            });
    }

    get peerData() {
        return {
            sessionId: this.sessionId,
            peerId: this.master.client.peerId,
            originPlatform: this.master.originPlatform,
            device: this.master.device,
            name: localStorage.getItem('nickname'),
            networkChain: this.networkChain,
            // Rejoining while another app is in front (the stream came back
            // in the background) doesn't make us present again.
            away: typeof document !== 'undefined' && document.visibilityState === 'hidden',
            // "Data saver": this phone takes only the photos it asks for.
            dataSaver: readPreference('dataSaver'),
        };
    }

    async createRoom() {

        this.hasRoom = true;
        const data = {
            id: this.id,
            peer: this.peerData,
            sessionToken: this.sessionToken
        };

        try {
            let response = await fetch(this.url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)});

            if (!response.ok) {
                const failure = new Error(response.status); // 404
                failure.status = response.status;
                throw failure;
            }

            const room = await response.json();
            if (room.sessionToken) this.sessionToken = room.sessionToken;
            this.listenToUrlChanges();
            return await this.withHeld(room);

        } catch(err) {
            Logger.debug('create room ' + err);
            // No server: the room starts on this phone alone.
            const offline = await this.openOffline(err, { create: true });
            if (offline) return offline;
            throw err;
        }
    }

    /** The room from this phone's copy when the server was not reached, or null. */
    async openOffline(err, options) {
        const offlineRoom = this.master?.offlineRoom;
        if (!offlineRoom || !serverNotReached(err)) return null;
        Logger.warn('The server was not reached: the room opens from this phone');
        return offlineRoom.openOffline(options);
    }

    /** The server's room, with the photos that waited for the server on this phone. */
    async withHeld(room) {
        const offlineRoom = this.master?.offlineRoom;
        return offlineRoom ? offlineRoom.reconcile(room) : room;
    }

    async joinRoom() {

        this.hasRoom = true;
        const data = {
            peer: this.peerData,
            sessionToken: this.sessionToken
        };

        //await this.master.torrentsDb.clear();

        try {
            let response = await fetch(this.url + '/' + this.id, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)});

            if (!response.ok) {
                if (response.status === 404) {
                    Logger.warn('join room: room missing on server (e.g. after restart); recreating with same id');
                    return this.createRoom();
                }
                const errText = await response.text().catch(() => '');
                Logger.error('join room failed: ' + response.status + ' ' + errText);
                const failure = new Error(`Join failed (${response.status})`);
                failure.status = response.status;
                throw failure;
            }
            Logger.info('joined room');
            const room = await response.json();
            if (room.sessionToken) this.sessionToken = room.sessionToken;
            this.listenToUrlChanges();
            return await this.withHeld(room);

        } catch(err) {
            Logger.error('join room ' + err);
            // No server: the room opens from the copy on this phone.
            const offline = await this.openOffline(err);
            if (offline) return offline;
            throw err;
        }
    }

    async getRoom() {

        try {
            let response = await fetch(this.url + '/' + this.id);

            if (!response.ok) {
                console.error(response.status);
            } else {
                Logger.info('get room');
                const room = await response.json();
                return room;
            }

        } catch(err) {
            Logger.error('get room ' + err);
            throw err;
        }
    }

    //---------------------

    async updatePeer(update) {

        if(!this.hasRoom) return;

        const peerId = this.master.client.peerId;
        if(update.name) {
            localStorage.setItem('nickname', update.name);
        }

        const nat = update.networkChain
            ? update.networkChain.find(item => (item.type.includes('srflx') || item.type.includes('prflx'))
                && item.label) : null;
        if(nat) {
            Logger.info(`peers share nat: ${nat.label}`);
        }

        update.peerId = peerId;
        try {
            let response = await fetch('/api/rooms/' + this.id + '/peers/' + peerId, {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(update)});

            if (!response.ok) {
                Logger.error(response.url + ' ' + response.status);
            } else {
                return await response.json();
            }

        } catch(err) {
            Logger.error('update peer ' + err);
            throw err;
        }
    }

    async share(photos) {

        photos.forEach(item => {
            if(item.infoHash) {
                item.infoHash = encodeURIComponent(item.infoHash);
            }
        });
        const offlineRoom = this.master?.offlineRoom;
        try {
            const result = await this.sendShare(photos);
            if (result) offlineRoom?.apply({ type: 'add', item: result });
            return result;
        } catch(err) {
            // No server: the photos are in the room on this phone, and go to
            // the server when it answers again.
            if (offlineRoom && serverNotReached(err)) {
                await offlineRoom.hold(photos);
                return photos;
            }
            Logger.error('share pic ' + err);
            throw err;
        }
    }

    /** Tell the server about photos. Rejects when the server was not reached. */
    async sendShare(photos) {
        const response = await fetch(this.url + '/' + this.id + '/photos/', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sessionId: this.sessionId, photos })});

        if (!response.ok) {
            Logger.error(response.url + ' ' + response.status);
            if ([502, 503, 504].includes(response.status)) {
                const failure = new Error('The server did not take the photos (' + response.status + ')');
                failure.status = response.status;
                throw failure;
            }
            return undefined;
        }
        return response.json();
    }

    /*async addServerPeer(url) {

        const data = {
            url: url,
            serverPeer: true,
        };

        try {
            let response = await fetch(this.url + '/' + this.id + '/photos', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)});

            if (!response.ok) {
                Logger.error(response.url + ' ' + response.status);
            } else {
                return await response.json();
            }
        } catch(err) {
            Logger.error('addServerPeer ' + err);
            throw err;
        }
    }*/

    async update(updates) {

        //if(update.fileName) {
        //    localStorage.setItem('fileName-' + infoHash, update.fileName);
        //}
        updates.forEach(item => {
            if(item.infoHash) {
                item.infoHash = encodeURIComponent(item.infoHash);
            }
        });
        try {
            let response = await fetch(this.url + '/' + this.id + '/photos/', {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updates)});

            if (!response.ok) {
                Logger.error(response.url + ' ' + response.status);
            }

            return await response.json();
        } catch(err) {
            Logger.error('update ' + err);
            throw err;
        }
    }

    /**
     * Set a photo's shared title, description or rating for everyone in the
     * room. Only the fields passed change; '' or rating 0 clears one.
     */
    async updateDetails(infoHash, fields) {
        const response = await fetch(this.url + '/' + this.id + '/photos/details', {
            method: 'PUT',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                infoHash,
                sessionId: this.sessionId,
                sessionToken: this.sessionToken,
                ...fields,
            }),
        });
        if (!response.ok) {
            const message = await response.text().catch(() => '');
            const error = new Error(message || ('Could not save details (' + response.status + ')'));
            error.status = response.status;
            throw error;
        }
        return response.json();
    }

    /**
     * Give a clip that came without a poster frame the one this device made,
     * so devices that can't decode the clip still see what it is.
     */
    async sharePoster(infoHash, poster) {
        let response;
        try {
            response = await fetch(this.url + '/' + this.id + '/photos/poster', {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ infoHash, poster, sessionId: this.sessionId, sessionToken: this.sessionToken }),
            });
        } catch (err) {
            // No server: phones nearby get the small picture from this phone.
            if (this.master?.offlineRoom && serverNotReached(err)) {
                this.master.offlineRoom.holdPoster(infoHash, poster);
                return { infoHash, poster };
            }
            throw err;
        }
        if (!response.ok) throw new Error('Could not share the poster (' + response.status + ')');
        return response.json();
    }

    delete(infoHash) {

        return fetch(this.url + '/' + this.id + '/photos/', {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({infoHash: encodeURIComponent(infoHash)})
        }).then(response => {
            return response.json();
        });
    }

    connect(connection) {

        if(connection.infoHash) {
            connection.infoHash = encodeURIComponent(connection.infoHash);
        }
        connection.fileName = encodeURIComponent(connection.fileName);
        return fetch(this.url + '/' + this.id + '/connections', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(connection)
        }).then(response => {
            return response.json();
        });
    }

    disconnect(infoHash) {

        const data = {
            infoHash: encodeURIComponent(infoHash),
        };

        return fetch(this.url + '/' + this.id + '/connections', {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
    }

    addOwner(updates) {

        updates.forEach(item => {
            if(item.infoHash) {
                item.infoHash = encodeURIComponent(item.infoHash);
            }
        });
        try {
            return fetch(this.url + '/' + this.id + '/photos/owners/', {
                method: 'POST',
                headers: {
                    ...this.sessionHeaders(),
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updates)
            });
        } catch(e) {
            Logger.error(updates.length + ' addOwner ' + e);
        }
    }

    removeOwner(peerId) {

        return fetch(this.url + '/' + this.id + '/photos/owners/' + peerId, {
            method: 'DELETE',
            headers: {
                ...this.sessionHeaders(),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
    }

    updateOwner(updates) {

        updates.forEach(item => {
            if(item.infoHash) {
                item.infoHash = encodeURIComponent(item.infoHash);
            }
        });
        try {
            return fetch(this.url + '/' + this.id + '/photos/owners/', {
                method: 'PUT',
                headers: {
                    ...this.sessionHeaders(),
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updates)
            });
        } catch(e) {
            Logger.error(updates.length + ' updateOwner ' + e);
        }
    }

    saveNetwork(chain) {
        this.networkChain = chain
    }

    static deleteAll() {

        return fetch('/api/rooms', {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
        }).then(response => {
            return response.json();
        });
    }
}
