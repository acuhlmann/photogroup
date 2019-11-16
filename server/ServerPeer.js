//------------------Twillio ICE STUN/TURN

const IpTranslator = require("./IpTranslator");
const util = require('util');

module.exports = class ServerPeer {

    constructor(remoteLog, peers, roomManager, ice, emitter) {

        this.remoteLog = remoteLog;

        this.peers = peers;
        this.roomManager = roomManager;
        this.ice = ice;
        this.emitter = emitter;

        this.webtorrent = {};
    }

    start(room, url, request, response) {
        this.room = room;
        const webtorrent = this.webtorrent;

        if(!webtorrent.client) {
            const WebTorrent = require('webtorrent-hybrid');
            webtorrent.client = new WebTorrent({tracker: {
                    rtcConfig: this.ice.iceServers
                }});

            this.createServerPeer(webtorrent.client.peerId);
        }

        this.addTorrent(url, request, response);

        webtorrent.client.on('torrent', torrent => {
            this.remoteLog('torrent ' + torrent.dn);
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
        console.info('process.env ' + util.inspect(process.argv));
        const tracker = isProd ? 'wss://photogroup.network/ws' : 'ws://localhost:9000';
        //const tracker = 'wss://photogroup.network/ws';

        this.webtorrent.client.add(url, { 'announce': tracker }, torrent => {
            remoteLog('wt.add ' + torrent.dn);

            this.connect(torrent);

            torrent.on('download', bytes => {
                console.log('wt.download ' + torrent.dn + ' bytes ' + bytes);
                //remoteLog('wt.download ' + torrent.dn + ' bytes ' + bytes);
            });
            torrent.on('upload', bytes => {
                console.log('wt.upload ' + torrent.dn + ' bytes ' + bytes);
                //remoteLog('wt.upload ' + torrent.dn + ' bytes ' + bytes);
            });
            torrent.on('done', () => {
                remoteLog('wt.done ' + torrent.dn);

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
                remoteLog('wt.wire ' + torrent.dn + ' wire ' + wire);
            });

            torrent.on('noPeers', announceType => {
                remoteLog('wt.noPeers ' + torrent.dn + ' announceType ' + announceType);
            });
            torrent.on('warning', err => {
                remoteLog('wt.warning ' + torrent.dn + ' err ' + err);
            });
            torrent.on('error', err => {
                remoteLog('wt.error ' + torrent.dn + ' err ' + err);
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

                scope.emitter.emit('addServerPeer', result);
                return result;
            }
        });

        return peers;
    }

    removeTorrent(hash) {
        const remoteLog = this.remoteLog;
        const webtorrent = this.webtorrent;

        if(webtorrent.client && webtorrent.client.get(hash)) {
            webtorrent.client.remove(hash, () => {
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