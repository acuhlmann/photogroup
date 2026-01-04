import Logger from 'js-logger';
import shortid  from 'shortid';
import cryptoRandomString from "crypto-random-string";

/**
 * @emits RoomsService#urlChange
 * @type {array} latest server state of magnet urls
 */
export default class RoomsService {

    constructor(emitter) {

        this.hasRoom = false;
        this.emitter = emitter;

        this.url = '/api/rooms';

        this.sessionId = shortid.generate();
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
                await this.master.findExistingContent(this.joinRoom);
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

    changeUrl(name, value) {
        const location = window.location;
        const params = new URLSearchParams(location.search);
        params.set(name, value);
        window.history.replaceState({}, '', decodeURIComponent(`${location.pathname}?${params}`));
    }

    listenToUrlChanges() {
        const scope = this;

        const source = new window.EventSource('/api/rooms/' + this.id + '/updates/?sessionId=' + this.sessionId);

        source.addEventListener('photos', event => {

            const data = JSON.parse(event.data);

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

            scope.emitter.emit('photos', data);

        }, false);

        source.addEventListener('peers', event => {

            const data = JSON.parse(event.data);

            //Logger.info(`peers: ${data.type} ${JSON.stringify(data.item, null, ' ')}`);
            Logger.info(`peers: ${data.type} ${data.item.name} ${data.item.sessionId}`);

            const peer = data.item;
            const nat = peer.networkChain
                ? peer.networkChain.find(item => (item.type.includes('srflx') || item.type.includes('prflx'))
                    && item.label) : null;
            if(nat) {
                //Logger.info(`peers nat: ${nat.label}`);
            }

            scope.emitter.emit('peers', data);
        }, false);

        source.addEventListener('peerConnections', event => {

            const data = JSON.parse(event.data);

            //Logger.info(`peerConnections: ${data.length} ${JSON.stringify(data, null, ' ')}`);

            scope.emitter.emit('peerConnections', data);
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
            name: localStorage.getItem('nickname'),
            networkChain: this.networkChain
        };
    }

    async createRoom() {

        this.hasRoom = true;
        const data = {
            id: this.id,
            peer: this.peerData
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

            } else {

                /*this.addNetwork(this.networkChain).then(() => {

                    Logger.info('addNetwork no 2');

                    this.emitter.emit('pcEvent', 'icegatheringstatechange', '');
                    this.emitter.emit('pcEvent', 'iceconnectionstatechange', '');
                    this.emitter.emit('pcEvent', 'signalingstatechange', '');
                    //this is now in Uploader
                    this.emitter.emit('topStateMessage', '');
                });*/
            }

            const room = await response.json();
            this.listenToUrlChanges();
            return room;

        } catch(err) {
            Logger.debug('create room ' + err);
            throw err;
        }
    }

    async joinRoom() {

        this.hasRoom = true;
        const data = {
            peer: this.peerData
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
                console.error(response.status);
            } else {
                Logger.info('joined room');
                const room = await response.json();
                this.listenToUrlChanges();
                return room;
            }

        } catch(err) {
            Logger.error('join room ' + err);
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
        const data = {
            sessionId: this.sessionId,
            photos: photos
        };
        try {

            let response = await fetch(this.url + '/' + this.id + '/photos/', {
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
            Logger.error('share pic ' + err);
            throw err;
        }
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