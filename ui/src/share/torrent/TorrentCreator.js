import NetworkTopologyFinder from "../topology/NetworkTopologyFinder";
import Logger from 'js-logger';
import createTorrent from 'create-torrent';
import WebTorrent from 'webtorrent';

export default class TorrentCreator {

    constructor(service, emitter, parent, torrentAddition) {

        this.service = service;
        this.emitter = emitter;
        this.parent = parent;
        this.torrentAddition = torrentAddition;
    }

    static setupAnnounceUrls() {
        const isLocal = window.location.href.includes('localhost');
        console.log('window.location.href ' + window.location.href);
        const wsUrl = isLocal ? 'ws://' + window.location.hostname + ':9000' : 'wss://' + window.location.hostname + '/ws';
        console.log('WEBTORRENT_ANNOUNCE wsUrl ' + wsUrl);
        window.WEBTORRENT_ANNOUNCE = createTorrent.announceList
            .map(function (arr) {
                return arr[0]
            })
            .filter(function (url) {
                return url.indexOf('wss://') === 0 || url.indexOf('ws://') === 0
            })
            .concat(wsUrl);

        Logger.info('window.WEBTORRENT_ANNOUNCE '+window.WEBTORRENT_ANNOUNCE);
    }

    start() {

        this.service.getRtcConfig().then(iceServers => {

            if(iceServers && Array.isArray(iceServers.iceServers)) {
                //TODO: does below make sense to add in addition to Twillio STUN?
                //seems the default of webtorrent: https://github.com/webtorrent/webtorrent/issues/831
                //https://github.com/feross/simple-peer/blob/4dcc8a7092e515297613cf2e41197aeb53986248/index.js#L161
                //iceServers.iceServers.unshift({ urls: 'stun:23.21.150.121' });
                //iceServers.iceServers.unshift({ urls: 'stun:stun.l.google.com:19302'});
            }

            const self = this;
            this.iceServers = iceServers;
            this.createWT();
            //this.emitter.emit('topStateMessage', msg + '\nRegistering Peer');
            this.service.addPeer().then(peer => {
                //this is now in Uploader
                //self.emitter.emit('topStateMessage', '');

                self.parent.me = peer;
                self.emitter.emit('addPeerDone', peer);
            });

            this.buildTopology();
        });
    }

    buildTopology() {

        const network = this.network = new NetworkTopologyFinder(this.service, this.emitter);
        network.start(this.iceServers);
    }

    createWT() {
        //const WebTorrent = window.WebTorrent;
        const client = new WebTorrent({
            tracker: {
                rtcConfig: this.iceServers
            }
        });
        Logger.error('client.peerId '+client.peerId);
        window.client = client; // for easier debugging
        this.client = client;
        this.emitter.emit('wtInitialized', client);

        const scope = this;
        client.on('error', (err, arg) => {
            Logger.error('client.error '+err);

            scope.emitter.emit('torrentError', err);

            /*
            const msg = err.message;
            const isDuplicateError = msg.indexOf('Cannot add duplicate') !== -1;
            if(!isDuplicateError) {
                return;
            }

            const torrentId = msg.substring(msg.lastIndexOf('torrent ') + 8, msg.length);
            const torrent = scope.client.get(torrentId);
            scope.emitter.emit('duplicate', {
                torrent: torrent,
                torrentId: torrentId,
                files: null});
            */
        });

        this.listenToTrackersChange(scope, client.torrents);

        client.on('torrent', torrent => {
            Logger.debug('client.torrent numPeers '+ torrent.numPeers + ' infoHash ' + torrent.infoHash);
            scope.numPeers = torrent.numPeers;
            scope.emitter.emit('numPeers', Number(scope.numPeers));

            torrent.discovery.on('peer', (peer, source) => scope.torrentAddition.peer(peer, source));
            torrent.discovery.on('trackerAnnounce', (l) => {
                scope.torrentAddition.trackerAnnounce(l)
            });
            torrent.discovery.on('warn', (err) => scope.torrentAddition.warning(torrent, err));
            torrent.discovery.on('error', (err) => scope.torrentAddition.warning(torrent, err));

            torrent.discovery.tracker._trackers.forEach(tracker => {

                if(!tracker.socket) {
                    return;
                }
                tracker.socket.on('data', data => {

                    try {
                        data = JSON.parse(data)
                    } catch (err) {
                        return
                    }
                    if(data.peer_id) {
                        data.peer_id = this.binaryToHex(data.peer_id);
                        Logger.log('socket.peerId ' + data.peer_id);
                    }
                    if(data.info_hash) {
                        data.info_hash = this.binaryToHex(data.info_hash);
                        Logger.log('socket.info_hash ' + data.info_hash);
                    }
                    if(data.answer) {
                        Logger.log('socket.answer ' + data.answer);
                    }
                    if(data.offer) {
                        Logger.log('socket.offer ' + data.offer);
                    }
                });
            });
        });

        return client;
    }

    binaryToHex(str) {
        if (typeof str !== 'string') {
            str = String(str)
        }
        return Buffer.from(str, 'binary').toString('hex')
    }

    listenToTrackersChange(self, torrents) {

        this.peers = new Map();

        /*const id = setInterval(() => {
            //this.listenToPCs(self, id, torrents);
        }, 1000);*/
    }

    listenToPCs(self, id, torrents) {

        if(torrents.length === 0) {
            return;
        }
        torrents.forEach(torrent => {

            const isReady = torrent.discovery && torrent.discovery.tracker
                && torrent.discovery.tracker._trackers && torrent.discovery.tracker._trackers.length > 0;
            if(isReady) {

                const trackers = torrent.discovery.tracker._trackers;

                //Logger.info('torrent trackers ready ' + trackers.length);

                trackers.forEach(tracker => {
                    const announceUrl = tracker.announceUrl;
                    if(tracker.peers) {
                        Object.values(tracker.peers).forEach(peer => {

                            const key = announceUrl + peer.channelName;
                            if(!self.peers.has(key)) {

                                //Logger.info('key ' + key);
                                self.peers.set(key, true);

                                const pc = peer._pc;
                                pc.addEventListener('icegatheringstatechange', event => {
                                    const state = event.target.iceGatheringState;
                                    //Logger.info(announceUrl + ' ' + event.type + ' ' + state);
                                    self.emitter.emit('pcEvent', event.type, state);
                                });
                                pc.addEventListener('signalingstatechange', event => {
                                    const state = event.target.signalingState;
                                    if(state === 'stable'
                                        && !event.target.localDescription && !event.target.remoteDescription) {
                                        //Logger.info(announceUrl + ' ' + event.type + ' new');
                                    } else if(state === 'closed') {
                                        //self.listenToTrackersChange(self, torrent);
                                    } else {
                                        //Logger.info(announceUrl + ' ' + event.type + ' ' + state);
                                    }

                                    self.emitter.emit('pcEvent', event.type, state);
                                });
                                pc.addEventListener('iceconnectionstatechange', event => {
                                    const state = event.target.iceConnectionState;
                                    //Logger.info(announceUrl + ' ' + event.type + ' ' + state);
                                    self.emitter.emit('pcEvent', event.type, state);

                                    if(state === 'connected' || state === 'completed') {
                                        self.emitter.emit('torrentDone', torrent);
                                    }
                                });
                            }
                        })
                    }
                });
            }
        });
    }
}