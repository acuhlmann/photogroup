const IpTranslator = require('./IpTranslator');

module.exports = class Topology {

    constructor(clients, updateChannel, remoteLog, app, emitter, peersModel, tracker) {
        this.clients = clients;
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;
        this.peersModel = peersModel;
        this.tracker = tracker;

        this.peers = {};
        this.nodesByIp = new Map();
        this.nodesByIndex = new Map();
        this.connections = new Map();
        this.typeDetails = new Map();
        this.graph = { nodes: [], edges: []};

        emitter.on('iceEvent', event => {

            this.buildIceEvent(event);
        });
    }

    addServerPeer(event) {
        this.remoteLog('addServerPeer ' + event.myPeerId + ' ' + event.localAddr + ' ' + event.remoteAddress);

        const peer = this.peers[event.myPeerId];
        const conn = event.conn;
        if(peer) {

            this.updateChainNode(peer.networkChain, conn.localAddress, conn.localPort);
            this.updateChainNode(peer.networkChain, conn.remoteAddress, conn.remotePort);
        } else {

            this.peers[event.myPeerId] = {
                peerId: event.myPeerId,
                originPlatform: 'photogroup.network',
                networkChain: [
                    this.createChainNode(conn.localAddress, conn.localPort),
                    this.createChainNode(conn.remoteAddress, conn.remotePort),
                ]
            };
            this.sendUpdate();
        }
    }

    connect(connection) {

        connection.shadow = true;
        connection.width = 2;
        connection.font = {align: 'bottom'};

        this.connections.set(connection.to + '-' + connection.from, connection);
        this.graph.edges.push(connection);

        this.sendNetworkTopology(this.graph);
    }

    disconnect(infoHash) {

        const edges = this.graph.edges;
        edges.forEach((edge, index) => {
            if(edge.infoHash === infoHash) {
                edges.splice(index, 1);
                this.connections.delete(edge.to + '-' + edge.from);
                //console.info('disconnectNode ' + edge.label);
            }
        });

        this.sendNetworkTopology(this.graph);
    }

    addNetwork(response, peerId, network) {
        if(!peerId) {
            response.status(400).send();
        }

        const notTranslatedIps = network.map(ip => {
            ip.ip = IpTranslator.createEmptyIpObj(ip.ip);
            return ip;
        });
        this.updateWebPeers(notTranslatedIps, peerId);

        IpTranslator.enrichCandidateIPs(network).then(results => {

            if(this.peers[peerId]) {

                this.updateWebPeers(results, peerId);

                response.send(results);
            } else {
                response.status(400).send();
            }
        });
    }

    updateWebPeers(chain, peerId) {
        if(!peerId) return;
        if(!this.peers[peerId]) return;

        this.peers[peerId].networkChain = chain;

        let peer;
        if(this.peersModel.webPeers.has(peerId)) {
            peer = this.peersModel.webPeers.get(peerId);
        } else {
            peer = {peerId: peerId};
        }

        peer.networkChain = chain;
        this.peersModel.webPeers.set(peer.peerId, peer);

        this.peersModel.sendWebPeers();
    }

    sendNetworkTopology(graph) {

        this.updateChannel.send({
            event: 'networkTopology',
            data: graph
        }, this.clients);
    }

    reset() {
        this.peers = [];

    }

    createChainNode(ip, port) {
        return {
            ip: IpTranslator.createEmptyIpObj(ip),
            ports: [port],
            transportsLabel: 'tcp,udp',
            type: 'host'
        }
    }

    updateChainNode(chain, ip, port) {
        const node = chain.find(node => node.ip.ip === ip);
        if(node) {
            if(!node.ports.includes(port)) {
                node.ports.unshift(port);
                this.sendUpdate();
            }
        } else {
            chain.push(this.createChainNode(ip, port));
        }
    }

    sendUpdate() {
        this.rebuildPeers(this.peers);
        this.sendNetworkTopology(this.graph);
    }

    buildIceEvent(event) {

        let chain, peerId;
        if(event.type === 'iceOffer') {

            peerId = event.sharedBy.peerId;
            chain = this.mergeByIp(event.sharedBy.peerId, event.sdp);
            event.sharedBy.networkChain = chain;

            this.peers[peerId] = event.sharedBy;

            this.sendUpdate();

        } else if(event.type === 'iceAnswer' && event.event === 'update') {

            const answer = event.sdp[0];
            const route = answer.type + ' ' + answer.transport + ' ' + answer.ip.ip + ':' + answer.port;
            console.log('iceAnswer ' + event.sharedBy.peerId + ' to ' + route)

            peerId = event.sharedBy.peerId;
            chain = this.mergeByIp(event.sharedBy.peerId, event.sdp);
            console.log('chain ' + chain.length);

            if(chain.length >= this.peers[peerId].networkChain.length) {
                event.sharedBy.networkChain = chain;
                this.peers[peerId] = event.sharedBy;

                this.sendUpdate();
            }

        } else if(event.event === 'completed' || event.event === 'stopped') {
            console.log('other event ' + event.event)
        }
    }

    mergeByIp(peerId, all) {
        const uniques = [];
        const ipMap = new Map();
        all.forEach(item => {
            const ip = item.ip.ip;
            const key = peerId + '/' + ip;
            if (ipMap.has(ip)) {

                const existing = ipMap.get(item.ip.ip);
                existing.ports.push(item.port);
                existing.transportsLabel += (existing.transportsLabel
                    .indexOf(item.transport) === -1) ? ',' + item.transport : '';
                existing.type = item.type;
                if(this.typeDetails) {
                    existing.typeDetail = this.typeDetails.has(key) ? this.typeDetails.get(key) : item.type;
                } else {
                    existing.typeDetail = item.type;
                }

                delete existing.port;
                delete existing.transport;

            } else {
                item.ports = [item.port];
                item.transportsLabel = [item.transport];
                if(this.typeDetails) {
                    item.typeDetail = this.typeDetails.has(key) ? this.typeDetails.get(key) : item.type;
                } else {
                    item.typeDetail = item.type;
                }
                ipMap.set(ip, item);
                uniques.push(item);
            }
        });

        return uniques;
    }

    rebuildPeers(peers) {

        this.graph = { nodes: [], edges: []}
        this.nodesByIp = new Map();
        this.nodesByIndex = new Map();
        this.edgesByFromTo = new Map();

        Object.keys(peers).forEach(key => {
            const peer = peers[key];
            if(peer.networkChain) {
                peer.networkChain.forEach(item => {
                    if(item.typeDetail) {
                        this.typeDetails.set(peer.peerId + '/' + item.ip.ip, item.typeDetail);
                    }
                })
            }
        });

        this.buildPeers(peers, this.graph);
    }

    buildPeers(peers, graph) {

        let {nodes, edges} = graph;

        const photogroup = 'photogroup.network';
        const pgNode = nodes[0];
        if(!pgNode || pgNode.id !== photogroup) {

            const hostNetwork = this.peersModel.pgServer;
            const node = {
                id: photogroup,
                label: photogroup + '\n' + hostNetwork ? hostNetwork.hostname : '' +
                    + '\n'
                    + this.addEmptySpaces(
                        [hostNetwork.ip.city,
                            hostNetwork.ip.location ? hostNetwork.ip.location.country_flag_emoji : '',
                            hostNetwork.ip.country_code,
                            hostNetwork.ip.region_name]),
                //shape: 'star',
                //size: 15,
                shadow: true,
                //color: '#3F51B5',
                group: 'photogroupServer',
                font: {strokeWidth:2},
                network: hostNetwork
            };

            if(!this.nodesByIp.has(node.id)) {
                this.nodesByIp.set(node.id, {
                    node: node, network: hostNetwork
                });
                nodes.unshift(node);
            }
        }

        Object.keys(peers).forEach((key, index) => {
            const peer = peers[key];
            this.buildIceChain(peer, graph, index);
        });

        return {nodes: nodes, edges: edges};
    }

    buildIceChain(peer, graph) {

        let {nodes, edges} = graph;

        const peerId = peer.peerId;

        const nodesByIp = this.nodesByIp;
        const nodesByIndex = this.nodesByIndex;

        const chain = peer.networkChain;
        if(chain) {
            const lastItem = chain.length - 1;
            chain.forEach((item, index) => {

                const isClient = (index === lastItem || item.typeDetail === 'host');

                const peerIpkey = isClient ? item.ip.ip + '/' + peerId : item.ip.ip;

                const node = {
                    id: peerIpkey,
                    title: peer.peerId,
                    shape: 'box',
                    peerId: peerId,
                    peers: [peerId],
                    originPlatform: peer.originPlatform
                };

                node.id = peerIpkey;
                node.network = item || this.createChainNode('photogroup.network', 80);

                const peerIndexKey = peerId + '/' + index;

                if(!item.typeDetail) {
                    item.typeDetail = this.typeDetails.get(peer.peerId + '/' + peerIpkey);
                }

                if(!nodesByIp.has(peerIpkey)) {

                    node.network = item || this.createChainNode('photogroup.network', 80);
                    nodes.push(node);

                    nodesByIp.set(peerIpkey, {
                        node: node, index: index,
                        peerId: peerId, ip: item.ip.ip, network: item
                    });
                    const indexObj = {
                        node: node, network: item
                    };
                    nodesByIndex.set(peerIndexKey, indexObj);

                    if(isClient) {

                        const clientIndex = nodes.findIndex(node => node.id === peerId);
                        if(clientIndex && clientIndex > -1) {
                            nodes = nodes.splice(clientIndex, 1);
                        }
                        indexObj.originPlatform = peer.originPlatform;
                        node.name = peer.name ? peer.name + ' - ' : '';
                        node.label = node.name + this.slimPlatform(peer.originPlatform) + '\n' + this.createCandTitleHost(item);
                        this.createClient(node);

                    } else {

                        if(item.typeDetail === 'relay') {
                            node.label = this.createCandTitleRelay(item);
                            node.networkType = 'relay';
                            node.originPlatform = '';
                        } else {
                            node.label = this.createCandTitleShort(item);
                            node.networkType = 'nat';
                            node.originPlatform = '';
                            //this.connectPhotoGroupServer(peer, edges);
                        }
                    }
                } else {

                    if(this.isNat(item.typeDetail)) {
                        const existingNode = nodesByIp.has(peerIpkey);
                        if(existingNode.peers) {
                            existingNode.peers.push(peerId);
                        }
                    }
                }
            });

            const serverPeerNodes = nodes.filter(node => node.originPlatform === 'photogroup.network');
            if(serverPeerNodes && serverPeerNodes.length > 1) {

                serverPeerNodes.forEach((node, index) => {

                    const nextNode = serverPeerNodes[index + 1];
                    if(nextNode) {
                        this.createSingleEdge(edges,
                            node.id,
                            nextNode.id,
                            peerId, nextNode.networkType)
                    }
                });

                this.createSingleEdge(edges,
                    serverPeerNodes[serverPeerNodes.length - 1].id,
                    'photogroup.network',
                    peerId);
            } else if(serverPeerNodes && serverPeerNodes.length === 1) {

                this.createSingleEdge(edges,
                    serverPeerNodes[0].id,
                    'photogroup.network',
                    peerId);
            }

            nodes.forEach(node => {

                if(node.id === 'photogroup.network') {

                    nodes
                        .filter(node => node.networkType === 'nat')
                        .forEach(nat => this.createSingleEdge(edges,
                            nat.id,
                            node.id,
                            peerId, node.networkType));
                } else if(node.networkType === 'client' && node.originPlatform !== 'photogroup.network') {

                    let nats = nodes.filter(node2 => node2.networkType === 'nat' && node2.peers.includes(node.peerId));
                    if(nats.length === 0) {
                        nats = nodes.filter(node2 => node2.networkType === 'nat');
                    }
                    const firstNat = nats[nats.length - 1];
                    if(firstNat) {
                        this.createSingleEdge(edges,
                            node.id,
                            firstNat.id,
                            peerId, firstNat.networkType);
                    }
                } else if(node.networkType === 'relay') {

                    const idNode = nodes.find(node => node.networkType === 'nat');
                    if(idNode) {
                        this.createSingleEdge(edges,
                            idNode.id,
                            node.id,
                            peerId, node.networkType);
                    } else {
                        console.warn('No nat node type found')
                    }
                }

            });

            this.connectConnections(edges);

        } else {

            this.createInitialClient(nodes, edges, peer, peerId);
        }

        return graph;
    }

    isNat(type) {
        return type === 'srflx' || type === 'prflx'
    }

    createSingleEdge(edges, from, to, peerId, networkType) {
        const key = from + '/' + to;
        if(!this.edgesByFromTo.has(key)) {
            const edge = {
                width: 2,
                dashes: true,
                from: from,
                to: to,
                arrows: '',
                peerId: peerId,
                networkType: networkType
            };
            edges.push(edge);
            this.edgesByFromTo.set(key, edge);
        }
    }

    connectConnections(edges) {
        this.connections.forEach((value, key, map) => {
            if(this.nodesByIndex.has(value.from) && this.nodesByIndex.has(value.to)) {
                edges.push(value);
            } else {
                map.delete(key)
            }
        });
    }

    createInitialClient(nodes, edges, peer, peerId) {
        const node = {
            id: peerId,
            title: peer.peerId,
            shape: 'box',
            peerId: peerId,
            originPlatform: peer.originPlatform
        };

        nodes.push(node);
        node.label = this.slimPlatform(peer.originPlatform);
        this.createClient(node);

        const edge = {
            width: 2,
            dashes: true,
            from: node.id,
            to: 'photogroup.network',
            arrows: '',
            peerId: peerId
        };

        edges.push(edge);
    }

    createEdge(chain, nodesByIndex, peerId, edges) {
        chain.forEach((item, index) => {
            if(index < chain.length -1) {

                const node = nodesByIndex.get(peerId + '/' + (index)).node;

                const edge = {
                    width: 2,
                    dashes: true,
                    from: nodesByIndex.get(peerId + '/' + (index + 1)).node.id,
                    to: node.id,
                    arrows: '',
                    peerId: peerId
                };

                edges.push(edge);
            }
        });
    }

    createClient(node) {
        node.shadow = true;
        node.shape = 'icon';
        node.networkType = 'client';
    }

    slimPlatform(platform) {
        let slimmed = platform.replace(' Windows ', ' Win ');

        let index, extract;
        index = slimmed.indexOf('Chrome Mobile');
        if(index > -1) {
            extract = slimmed.slice(index + 16, index + 26);
            slimmed = platform.replace(extract, '');
        } else if(slimmed.indexOf('Chrome ') > -1) {
            index = slimmed.indexOf('Chrome ');
            extract = slimmed.slice(index + 9, index + 19);
            slimmed = platform.replace(extract, '');
        }


        return slimmed;
    }

    addEmptySpaces(values) {
        return values.map(value => value && value !== null ? value + ' ' : '').join('');
    }

    createCandTitleHost(item) {
        return this.addEmptySpaces([item.typeDetail, item.ip.ip]);
    }

    createIp(item) {
        return this.addEmptySpaces([item.ip, item.hostname, item.city])
            + '\n' + this.addEmptySpaces(
                [item.location ? item.location.country_flag_emoji : '',
                    item.ip.country_code, item.ip.region_name]);
    }

    createCandTitle(item) {
        return this.addEmptySpaces([item.typeDetail]) + ' ' + item.ip.ip + ':' + item.ports.join(',')
            + '\n' + this.addEmptySpaces([item.transportsLabel, item.ip.hostname, item.ip.city])
            + '\n' + this.addEmptySpaces([item.ip.location ? item.ip.location.country_flag_emoji : '', item.ip.country_code, item.ip.region_name])
    }

    createCandTitleShort(item) {
        if(!item.ip.hostname) return;
        return this.addEmptySpaces([item.typeDetail]) + ' '
            + item.ip.ip + ' ' + this.addEmptySpaces([item.ip.location ? item.ip.location.country_flag_emoji : ''])
            + '\n' + this.addEmptySpaces([item.ip.hostname.slice(item.ip.hostname.indexOf('.') + 1, item.ip.hostname.length)]);
    }

    createCandTitleRelay(item) {
        return this.addEmptySpaces([item.typeDetail]) + ' '
            + item.ip.ip + ' ' + this.addEmptySpaces([item.ip.location ? item.ip.location.country_flag_emoji : '']);
    }
};