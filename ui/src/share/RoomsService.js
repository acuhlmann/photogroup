import Logger from 'js-logger';
import platform from 'platform';
import shortid  from 'shortid';
import cryptoRandomString from "crypto-random-string";

/**
 * @emits RoomsService#urlChange
 * @type {array} latest server state of magnet urls
 */
export default class RoomsService {

    constructor(emitter) {
        this.emitter = emitter;

        this.url = '/api/rooms';

        this.sessionId = shortid.generate();
        //this.id = cryptoRandomString({length: 20, type: 'url-safe'});
        this.id = cryptoRandomString({length: 20, characters: '1234567890abcdefghijklmnopqrstuvwxyzzyxwvutsrqponmlkjihgfedcbaabcdefghijklmnopqrstuvwxyz'});

        this.listenToUrlChanges();

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

        this.readStartUpParams();
    }

    readStartUpParams() {
        const urlParams = new URLSearchParams(window.location.search);
        if(urlParams.has('room')) {
            this.id = urlParams.get('room');

            this.emitter.emit('openRoomStart');
            this.emitter.emit('openRoomEnd');
        }
    }

    listenToUrlChanges() {
        const scope = this;

        const source = new window.EventSource("/api/updates/?sessionId=" + this.sessionId);

        source.addEventListener("webPeers", event => {

            const data = JSON.parse(event.data);

            Logger.info('webPeers: '+Object.keys(data).length);

            scope.emitter.emit('webPeers', data);
        }, false);

        source.addEventListener("sseConnections", event => {

            const data = JSON.parse(event.data);
            Logger.info('sse sseConnections: '+JSON.stringify(data));

            scope.emitter.emit('sseConnections', data.sseConnections, data.ips);
        }, false);

        source.addEventListener("iceEvent", event => {

            const data = JSON.parse(event.data);
            const sdp = data.sdp ? data.sdp.length : '';
            Logger.info('iceEvent: '+ data.type + ' ' + data.event + ' sdp ' + sdp);

            scope.emitter.emit('iceEvent', data);
        }, false);

        source.addEventListener("urls", event => {

            const data = JSON.parse(event.data);

            data.urls.forEach(item => {
                const parsed = window.parsetorrent(item.url);
                const key = parsed.infoHash;
                Logger.info('sse urls: '+key + ' ' + item.secure, item.originPlatform, item.ips);
            });

            scope.emitter.emit('urls', data.urls);
        }, false);

        source.addEventListener("discoveryMessage", event => {

            const data = JSON.parse(event.data);

            Logger.warn('discoveryMessage: '+data);
        }, false);

        source.addEventListener("appEvent", event => {

            const data = JSON.parse(event.data);
            Logger.info('appEvent: '+ data.level + ' ' + data.type + ' ' + JSON.stringify(data.event));

            scope.emitter.emit('appEvent', data);
        }, false);

        source.addEventListener("networkTopology", event => {

            const data = JSON.parse(event.data);
            Logger.info('networkTopology: '+ data.nodes.length);
            scope.emitter.emit('networkTopology', data);
        }, false);


        source.addEventListener('open', e => {
            Logger.info('Connection was opened');
        }, false);

        source.addEventListener('error', e => {
            Logger.error('sse error: ' + JSON.stringify(e))
            if (e.readyState === EventSource.CLOSED) {
                Logger.error('Connection was closed');
            }
        }, false);

        source.onerror = e => {
            Logger.error('sse error: ' + JSON.stringify(e));
        };
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

    addPeer() {

        const data = {
            sessionId: this.sessionId,
            peerId: window.client.peerId,
            originPlatform: platform.description,
            //networkChain: networkChain ? networkChain.reverse() : []
        };
        return fetch('/api/peers', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
    }

    async updatePeer(id, update) {

        update.peerId = id;
        try {
            let response = await fetch('/api/peers/' + id, {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(update)});

            if (!response.ok) {
                throw new Error(response.status); // 404
            }

            return await response.json();
        } catch(err) {
            Logger.log('update peer ' + err);
            throw err;
        }
    }

    async getPeer(peerId) {

        let response = await fetch('/api/peers?peerId=' + peerId);

        if (!response.ok) {
            throw new Error(response.status); // 404
        }

        return await response.json();
    }

    async createRoom() {

        const data = {
            id: this.id
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
                throw new Error(response.status); // 404
            }

            return await response.json();
        } catch(err) {
            Logger.log('create room ' + err);
            throw err;
        }
    }

    find() {

        return fetch(this.url + '/' + this.id + '?sessionId=' + this.sessionId)
            .then(response => {
                if (!response.ok) {
                    console.error(response.status);
                } else {
                    return response.json();
                }
            })
            .then(json => {
                //Logger.debug('read ' + JSON.stringify(json));
                return json;
            })
            .then(data => {
                //scope.emitter.emit('urls', data);
                return data;
            });
    }

    async share(data) {

        data.origin = this.master.client.peerId;

        try {
            let response = await fetch(this.url + '/' + this.id + '/photos', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)});

            if (!response.ok) {
                //throw new Error(response.status); // 404
                console.error(response.status);
            } else {
                return await response.json();
            }

        } catch(err) {
            Logger.log('share pic ' + err);
            throw err;
        }
    }

    async addServerPeer(url) {

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
                console.error(response.status); // 404
            } else {
                return await response.json();
            }
        } catch(err) {
            Logger.log('addServerPeer ' + err);
            throw err;
        }
    }

    async update(hash, update) {

        update.hash = hash;
        try {
            let response = await fetch(this.url + '/' + this.id + '/photos/', {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(update)});

            if (!response.ok) {
                throw new Error(response.status); // 404
            }

            return await response.json();
        } catch(err) {
            Logger.log('update ' + err);
            throw err;
        }
    }

    delete(hash) {

        const data = {
            hash: hash,
            origin: this.master.client.peerId
        };
        return fetch(this.url + '/' + this.id, {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        }).then(response => {
            return response.json();
        });
    }

    connect(edge) {

        return fetch(this.url + '/' + this.id + '/photos/connections', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(edge)
        }).then(response => {
            return response.json();
        });
    }

    disconnect(hash) {

        const data = {
            hash: hash,
        };

        return fetch(this.url + '/' + this.id + '/photos/connections', {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
    }

    addOwner(infoHash, peerId) {

        return fetch(this.url + '/' + this.id + '/photos/owners', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                infoHash: infoHash,
                peerId: peerId
            })
        });
    }

    removeOwner(infoHash, peerId) {

        return fetch(this.url + '/' + this.id + '/photos/owners', {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                infoHash: infoHash,
                peerId: peerId
            })
        });
    }

    async getNetwork() {

        let response = await fetch(this.url + '/network');

        if (!response.ok) {
            console.error(response.status); // 404
        } else {
            return await response.json();
        }
    }

    addNetwork(networkChain, shallTranslateIPs) {

        //TDODO if wtInitialized not received yet, batch request and resend after peerId is available.

        const data = {
            peerId: window.client.peerId,
            networkChain: networkChain ? networkChain.reverse() : [],
            shallTranslateIPs: shallTranslateIPs
        };
        return fetch(this.url + '/network', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
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