import Logger from "js-logger";

export default class TopologyHelper {

    reset() {
        this.setState({
            graph: {nodes: [], edges: []}, options: []
        });
    }

    start() {

        this.master.service.getNetwork().then(graph => {
            if(!graph) return;
            this.graph = graph;

            this.process(graph);
        });
    }

    build() {

        //this.reset();
        this.master.service.getNetwork().then(graph => {
            if(!graph) return;
            this.graph = graph;

            this.process(graph);
        });
    }

    process(graph) {
        if(!graph.nodes[0]) {
            Logger.log('no nodes? ' + graph.nodes);
            return;
        }

        graph.nodes[0].font = {strokeWidth:2};


        if(!this.master.client) return;
        const myPeerId = this.master.client.peerId;

        /*const putItemsFirst = ({ findFunction, array }) => [
            ...array.filter(findFunction),
            ...array.filter(signer => !findFunction(signer)),
        ];

        const keys = Object.keys(peers);
        const sorted = putItemsFirst({
            array: keys,
            findFunction: peer => peer === myPeerId,
        });*/

        graph.nodes.forEach(node => {

            const isMe = node.peerId === myPeerId;

            node.color = this.isMeColor(isMe);
            node.font = {
                color: this.isMeColorBlack(isMe), strokeWidth:2
            };

            if(node.networkType === 'client') {
                this.addUserIcon(node, node.label, isMe);
            } else if(node.networkType === 'relay') {
                this.addRelayIcon(node, isMe);
            } else if(node.networkType === 'nat') {
                this.addNatIcon(node, isMe);
            } else {
                //this.addUserIcon(node, node.label, isMe);
            }
        });

        graph.edges.forEach(edge => {
            const isMe = edge.peerId === myPeerId;
            edge.color = isMe ? '#F50057' : '#000000';
        });

        this.setState({
            graph: graph, options: this.state.options
        });
    }

    get state() {
        return this.parent.state;
    }

    setState(state) {
        this.parent.setState(state);
    }

    constructor(parent, emitter, master) {

        this.parent = parent;
        this.emitter = emitter;
        this.master = master;
        this.isOpen = false;

        this.nodesByIp = new Map();
        this.nodesByIndex = new Map();
        this.connections = new Map();
        this.typeDetails = new Map();

        this.peers = [];
        this.lastIceEvent = {};

        this.graph = {
            nodes: [], edges: []
        };

        this.connectionCalls = [];
        emitter.on('connectNode', torrent => {
            this.connect(torrent);
        });

        emitter.on('disconnectNode', infoHash => {
            this.disconnect(infoHash);
        });

        emitter.on('networkTopology', graph => {
            this.process(graph);
        });

        this.options = {

            nodes: {
                font: {
                    size: 9
                },
                //fixed: false
                //size: 100
            },
            edges: {
                color: '#000000'
            },
            groups: {
                photogroupServer: {
                    shape: 'icon',
                        icon: {
                        face: 'FontAwesome',
                            code: '\uf233',
                            size: 40,
                            color: '#3F51B5'
                    }
                }
            },
            physics:{
                stabilization: {
                    enabled: false,
                        iterations: 1
                }
            },
            //physics: false,
            /*physics: {
                barnesHut: {
                    centralGravity: 0,
                    avoidOverlap: 0,
                    gravitationalConstant: 100
                }
            }*/
            //layout: { randomSeed: 504052 }
            //improvedLayout:false,
            layout: {
                hierarchical: {
                    enabled:true,
                        levelSeparation: 80,
                        nodeSpacing: 100,
                        treeSpacing: 100,
                        blockShifting: true,
                        edgeMinimization: true,
                        parentCentralization: true,
                        direction: 'UD',        // UD, DU, LR, RL
                        sortMethod: 'hubsize'   // hubsize, directed
                }
            },
            interaction:{hover:true}
        };

        const self = this;

        this.events = {
            select: event => {

                const {nodes, edges} = event;
                if(nodes && nodes.length > 0) {

                    if(!nodes[0])
                        return;

                    const id = nodes[0];

                    const node = self.state.graph.nodes.find(node => node.id === id);
                    if(!node)
                        return;

                    if(id === 'photogroup.network') {
                        self.setState({
                            selectedNodeLabel: self.createIp(node.network)
                        });
                    } else {
                        const prefix = node.originPlatform ? node.originPlatform + ' ' : '';
                        const chain = node.network ? self.createCandTitle(node.network) : node.networkType;
                        self.setState({
                            selectedNodeLabel: prefix + chain
                        });
                    }
                } else if(edges && edges.length > 0) {

                    if(!edges[0])
                        return;

                    const id = edges[0];
                    const edge = self.state.graph.edges.find(edge => edge.id === id);
                    if(edge && edge.fromAddr) {
                        this.setState({
                            selectedNodeLabel: edge.label + ' ' + edge.fromAddr + ' to ' + edge.toAddr
                        });
                    }
                }

                //const seed = self.network.getSeed();
                //console.log('select ' + seed);
            }
        }
    }

    connect(torrent) {

        if(!torrent._peers) return;

        const scope = this;
        const infoHash = torrent.infoHash;
        const fileName = torrent.name;
        const peers = Object.values(torrent._peers).map(peer => {

            const conn = peer.conn;
            const peerId = conn.id;
            const localAddr = conn.localAddress + ':' + conn.localPort;
            const remoteAddr = conn.remoteAddress + ':' + conn.remotePort;

            const result = {
                peerId: peerId,
                localAddr: localAddr,
                remoteAddr: remoteAddr,
                remoteFamily: conn.remoteFamily
            };

            const myPeerId = scope.master.client.peerId;
            const toAddress = conn.localAddress;
            const toNode = scope.state.graph.nodes
                .filter(node => node.peerId === myPeerId)
                .find(node => node.network.ip.ip === toAddress);

            const fromAddress = conn.remoteAddress;

            const fromNode = scope.state.graph.nodes
                .filter(node => node.peerId === peerId && node.network)
                .find(node => node.network.ip.ip === fromAddress);

            Logger.info('connect ' + myPeerId + '/' + toAddress + ' to ' + peerId + '/' + fromAddress
                + ' fromNode ' + fromNode + ' toNode ' + toNode
                + ' peerId ' + peerId + ' myPeerId ' + myPeerId);

            //Logger.info('connect ' + [...scope.nodesByIp.keys()].join('\n'));

            if(fromNode && toNode) {
                const edge = {
                    from: fromNode.id, to: toNode.id,
                    arrows: 'to',
                    label: fileName,
                    infoHash: infoHash,
                    fromAddr: localAddr,
                    toAddr: remoteAddr
                };
                Logger.info('connect edge ' + edge.label);
                scope.master.service.connect(edge);
            }

            return result;
        });

        return peers;
    }

    disconnect(infoHash) {

        this.master.service.disconnect(infoHash);
    }



    addNatIcon(node, isMe) {

        node.shape = 'image';
        node.image = './firewall.png';
        node.size = 15;
    }

    addRelayIcon(node, isMe) {
        node.shape = 'icon';
        node.icon = {
            face: 'FontAwesome',
            code: '\uf138',
            size: 30,
            color: this.isMeColorBlack(isMe)
        }
    }

    addUserIcon(node, platform, isMe) {
        node.shape = 'icon';
        if(this.isMobile(platform)) {
            node.icon = {
                face: 'FontAwesome',
                code: '\uf10b',
                size: 30,
                color: this.isMeColorBlack(isMe)
            }
        } else {
            node.icon = {
                face: 'FontAwesome',
                code: '\uf108',
                size: 30,
                color: this.isMeColorBlack(isMe)
            }
        }
    }

    isMobile(platform) {
        return platform.indexOf('Mobile') > -1
            || platform.indexOf('Android') > -1
            || platform.indexOf('iOS') > -1;
    }

    isMeColor(isMe) {
        return isMe ? '#F50057' : '#e0e0e0';
    }

    isMeColorBlack(isMe) {
        return isMe ? '#F50057' : '#000000';
    }

    addEmptySpaces(values) {
        return values.map(value => value && value !== null ? value + ' ' : '').join('');
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
}