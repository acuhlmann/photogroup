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

        this.hasRoom = false;
        this.emitter = emitter;

        this.url = '/api/rooms';

        this.sessionId = shortid.generate();
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

        source.addEventListener("photos", event => {

            const data = JSON.parse(event.data);

            Logger.info(`photos: ${data.type} ${data.item.fileName || ''} infoHash ${data.item.infoHash} peerId ${data.item.peerId}`);

            scope.emitter.emit('photos', data);

        }, false);

        source.addEventListener("peers", event => {

            const data = JSON.parse(event.data);

            Logger.info(`peers: ${data.type} ${data.item.name} ${data.item.sessionId}`);

            scope.emitter.emit('peers', data);
        }, false);

        /*source.addEventListener("iceEvent", event => {

            const data = JSON.parse(event.data);
            const sdp = data.sdp ? data.sdp.length : '';
            Logger.info('iceEvent: '+ data.type + ' ' + data.event + ' sdp ' + sdp);

            scope.emitter.emit('iceEvent', data);
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
        }, false);*/

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

    get peerData() {
        return {
            sessionId: this.sessionId,
            peerId: this.master.client.peerId,
            originPlatform: this.master.originPlatform,
            name: localStorage.getItem('nickname')
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
                const room = await response.json();
                this.listenToUrlChanges();
                return room;
            }

        } catch(err) {
            Logger.error('join room ' + err);
            throw err;
        }
    }

    async updatePeer(update) {

        if(!this.hasRoom) return;

        const peerId = this.master.client.peerId;
        if(update.name) {
            localStorage.setItem('nickname', update.name);
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

    /*find() {

        if(!this.hasRoom) {

            return Promise.resolve();

        } else {

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
    }*/

    async share(data) {

        data.origin = this.master.client.peerId;

        try {
            let response = await fetch(this.url + '/' + this.id + '/photos/' + data.infoHash, {
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

    async update(infoHash, update) {

        //if(update.fileName) {
        //    localStorage.setItem('fileName-' + infoHash, update.fileName);
        //}

        update.infoHash = infoHash;
        try {
            let response = await fetch(this.url + '/' + this.id + '/photos/' + infoHash, {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(update)});

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

        return fetch(this.url + '/' + this.id + '/photos/' + infoHash, {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        }).then(response => {
            return response.json();
        });
    }

    connect(connection) {

        return fetch(this.url + '/' + this.id + '/photos/connections', {
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
            infoHash: infoHash,
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

        try {
            return fetch(this.url + '/' + this.id + '/photos/owners/' + peerId, {
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
        } catch(e) {
            Logger.error(infoHash + ' addOwner ' + e);
        }
    }

    removeOwner(infoHash, peerId) {

        return fetch(this.url + '/' + this.id + '/photos/owners/' + peerId, {
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