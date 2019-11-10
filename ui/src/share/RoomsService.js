import Logger from 'js-logger';
import platform from 'platform';
import shortid  from 'shortid';

/**
 * @emits RoomsService#urlChange
 * @type {array} latest server state of magnet urls
 */
export default class RoomsService {

    constructor(emitter) {
        this.emitter = emitter;

        this.url = '/api/rooms/1';
        this.listenToUrlChanges();

        emitter.on('appEventRequest', event => {

            return fetch('/api/events/', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(event)
            });
        });
    }

    listenToUrlChanges() {
        const scope = this;

        this.sessionId = shortid.generate();
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

    async getPeer(peerId) {

        let response = await fetch('/api/peers?peerId=' + peerId);

        if (!response.ok) {
            throw new Error(response.status); // 404
        }

        return await response.json();
    }

    find() {

        return fetch(this.url)
            .then(response => {
                return response.json();
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

    async share(infoHash, magnetUri, secure, sharedBy, fileSize, picSummary, cameraSettings) {

        const data = {
            hash: infoHash,
            url: magnetUri,
            secure: secure,
            peerId: sharedBy.peerId,
            origin: this.master.client.peerId,
            fileSize: fileSize,
            picSummary: picSummary, cameraSettings: cameraSettings
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
            Logger.log('addServerPeer ' + err);
            throw err;
        }
    }

    async update(hash, update) {

        try {
            let response = await fetch(this.url + '/' + hash, {
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
        return fetch(this.url, {
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

        return fetch(this.url + '/connections', {
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

        return fetch(this.url + '/connections', {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
    }

    addOwner(infoHash, peerId) {

        return fetch(this.url + '/owners', {
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

        return fetch(this.url + '/owners', {
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

        let response = await fetch('/api/rooms/1/network');

        if (!response.ok) {
            throw new Error(response.status); // 404
        }

        return await response.json();
    }

    addNetwork(networkChain, shallTranslateIPs) {

        //TDODO if wtInitialized not received yet, batch request and resend after peerId is available.

        const data = {
            peerId: window.client.peerId,
            networkChain: networkChain ? networkChain.reverse() : [],
            shallTranslateIPs: shallTranslateIPs
        };
        return fetch('/api/rooms/1/network', {
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

    static getAll() {

        return fetch('/api/rooms', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
        }).then(response => {
            return response.json();
        });
    }
}