//------------------Twillio ICE STUN/TURN

import IpTranslator from "./IpTranslator.js";
import { inspect } from 'util';
import WebTorrent from 'webtorrent';

export default class ServerPeer {

    constructor(topology, remoteLog, peers, roomManager, ice, emitter, tracker) {

        this.topology = topology;
        this.remoteLog = remoteLog;

        this.peers = peers;
        this.roomManager = roomManager;
        this.ice = ice;
        this.emitter = emitter;
        this.tracker = tracker;

        this.webtorrent = {};
    }

    start(room, url, request, response) {
        this.room = room;
        const webtorrent = this.webtorrent;

        if(!webtorrent.client) {
            webtorrent.client = new WebTorrent({tracker: {
                    rtcConfig: this.ice.iceServers
                }});

            this.createServerPeer(webtorrent.client.peerId);
        }

        this.addTorrent(url, request, response);

        webtorrent.client.on('torrent', torrent => {
            this.remoteLog('torrent ' + torrent.name);
        });

        webtorrent.client.on('error', (err) => {
            this.remoteLog('wt.error ' + err);

            const msg = err.message;
            const isDuplicateError = msg.indexOf('Cannot add duplicate') !== -1;
            if(!isDuplicateError) {
                response.status(400).send(msg);
            }

            const torrentId = msg.substring(msg.lastIndexOf('torrent ') + 8, msg.length);
            const torrent = webtorrent.client.get(torrentId);

            if(torrent && torrent.files.length === 0) {
                torrent.destroy(() => {
                    this.addTorrent(torrentId, request, response);
                });
            } else {
                if(!response.headersSent) {
                    response.status(400).send(msg);
                }
            }
        });
    }

    createServerPeer(peerId) {

        const peer = {
            peerId: peerId,
            originPlatform: 'photogroup.network',
            ips: [],
            //network: this.createChainNode('photogroup.network', 80)
        };

        IpTranslator.getLookupIp('photogroup.network').then(result => {

            console.log('photogroup.network is at ' + result.ip + ' hosted at ' + result.hostname);

            peer.network = this.createChainNode(result, 80);
            this.peers.webPeers.set(peer.peerId, peer);
        });
    }

    createChainNode(ipObj, port) {
        return {
            ip: ipObj,
            ports: [port],
            transportsLabel: 'tcp,udp',
            type: 'host'
        }
    }

    addTorrent(url, request, response) {
        const remoteLog = this.remoteLog;

        const peerId = this.webtorrent.client.peerId;
        if(!this.peers.webPeers.has(peerId)) {

            this.createServerPeer(peerId);
            //this.peers.sendWebPeers();
        }

        const isProd = process.env.args && process.env.args.includes('prod') || false;
        console.info('prd ' + isProd);
        console.info('process.env ' + inspect(process.argv));
        
        // Get tracker URL dynamically from the tracker instance, with fallbacks
        let trackerUrl;
        if (isProd) {
            trackerUrl = 'wss://photogroup.network/ws';
        } else if (this.tracker && this.tracker.getWsUrl()) {
            trackerUrl = this.tracker.getWsUrl();
            console.info('Using dynamic tracker URL: ' + trackerUrl);
        } else {
            trackerUrl = 'ws://localhost:9000';
            console.warn('Using fallback tracker URL: ' + trackerUrl);
        }

        this.webtorrent.client.add(url, { 'announce': trackerUrl }, torrent => {
            remoteLog('wt.add ' + torrent.name);

            this.connect(torrent);

            torrent.on('download', bytes => {
                console.log('wt.download ' + torrent.name + ' bytes ' + bytes);
                //remoteLog('wt.download ' + torrent.name + ' bytes ' + bytes);
            });
            torrent.on('upload', bytes => {
                console.log('wt.upload ' + torrent.name + ' bytes ' + bytes);
                //remoteLog('wt.upload ' + torrent.name + ' bytes ' + bytes);
            });
            torrent.on('done', () => {
                remoteLog('wt.done ' + torrent.name);

                if(!response.headersSent) {

                    //this.connect(torrent);
                    this.roomManager.addOwner(this.room, torrent.infoHash, this.webtorrent.client.peerId);
                    this.peers.sendWebPeers();
                    response.send(request.body);
                }
            });
            torrent.on('infoHash', torrent => {
                console.log('infoHash ');
            });
            torrent.on('metadata', torrent => {
                console.log('metadata ');
            });
            torrent.on('ready', torrent => {
                console.log('ready ');
            });
            torrent.on('wire', wire => {
                remoteLog('wt.wire ' + torrent.name + ' wire ' + wire);
            });

            torrent.on('noPeers', announceType => {
                remoteLog('wt.noPeers ' + torrent.name + ' announceType ' + announceType);
            });
            torrent.on('warning', err => {
                remoteLog('wt.warning ' + torrent.name + ' err ' + err);
            });
            torrent.on('error', err => {
                remoteLog('wt.error ' + torrent.name + ' err ' + err);
            });
        });
    }

    connect(torrent) {
        //TODO checkout torrent._peers and their IPs
        if(!torrent._peers) return;

        const scope = this;
        const infoHash = torrent.infoHash;
        const fileName = torrent.name;
        const peers = Object.values(torrent._peers).map(peer => {

            if(peer.connected) {
                const conn = peer.conn;
                const peerId = conn.id;
                const localAddr = conn.localAddress + ':' + conn.localPort;
                const remoteAddr = conn.remoteAddress + ':' + conn.remotePort;

                const myPeerId = scope.webtorrent.client.peerId;
                const result = {
                    conn: conn,
                    peerId: peerId,
                    myPeerId: myPeerId,
                    localAddr: localAddr,
                    remoteAddr: remoteAddr
                };

                /*conn._pc.addEventListener('iceconnectionstatechange', event => {
                    console.log('iceconnectionstatechange ' + event);
                });*/

                scope.topology.addServerPeer(result);
                return result;
            }
        });

        return peers;
    }

    removeTorrent(infoHash) {
        const remoteLog = this.remoteLog;
        const webtorrent = this.webtorrent;

        if(webtorrent.client && webtorrent.client.get(infoHash)) {
            webtorrent.client.remove(infoHash, () => {
                remoteLog('wt.remove ');
                if(webtorrent.client.torrents.length === 0) {
                    this.peers.webPeers.delete(webtorrent.client.peerId);
                    this.peers.sendWebPeers();
                }
            }, err => {
                remoteLog('wt.remove error ' + err);
            });
        }
    }

    hasPeerId(peerId) {
        return this.webtorrent.client && peerId === this.webtorrent.client.peerId;
    }

};