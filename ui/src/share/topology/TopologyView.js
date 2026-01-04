import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import {withStyles } from '@mui/styles';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GroupRounded from '@mui/icons-material/GroupRounded';
import { withSnackbar } from '../compatibility/withSnackbar';

import Graph from 'vis-react';
import Logger from 'js-logger';
import _ from "lodash";
import update from "immutability-helper";
import StringUtil from "../util/StringUtil";
import Badge from "@mui/material/Badge";
import Slide from "@mui/material/Slide";

const styles = theme => ({
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    heading: {
        fontSize: theme.typography.pxToRem(15),
        fontWeight: theme.typography.fontWeightRegular,
    },
    content: {
        padding: '0px 0px 0px 0px',
        width: '100%',
        overflow: 'hidden'
    },
    wordwrap: {
        wordWrap: 'break-word'
    },
});

function TopologyView(props) {
    const {master, classes} = props;
    const masterRef = useRef(master);
    masterRef.current = master;

    const [visible, setVisible] = useState(false);
    const [showTopology, setShowTopology] = useState(true);
    const [wtNumPeers, setWtNumPeers] = useState(0);
    const [expandedTopology, setExpandedTopology] = useState(() => {
        const expandedTopology = localStorage.getItem('expandedTopology');
        return expandedTopology === null ? false : String(expandedTopology) === 'true';
    });
    const [graph, setGraph] = useState({
        nodes: [], edges: []
    });
    const [selectedNodeLabel, setSelectedNodeLabel] = useState('');
    const [network, setNetwork] = useState(null);
    const graphRef = useRef(null);

    const options = useMemo(() => ({
        nodes: {
            font: {
                size: 9
            },
        },
        edges: {
            color: '#000000'
        },
        physics: true,
    }), []);

    useEffect(() => {
        const emitter = master.emitter;
        
        const handleShowTopology = (value) => {
            setShowTopology(value);
        };

        const handleReadyToUpload = () => {
            setVisible(true);
        };

        const handleWire = (wire, addr, torrent) => {
            setWtNumPeers(torrent.numPeers);
        };

        emitter.on('showTopology', handleShowTopology);
        emitter.on('readyToUpload', handleReadyToUpload);
        emitter.on('wire', handleWire);

        return () => {
            emitter.removeListener('showTopology', handleShowTopology);
            emitter.removeListener('readyToUpload', handleReadyToUpload);
            emitter.removeListener('wire', handleWire);
        };
    }, [master.emitter]);

        // Listen for localNetwork to show current user's node in topology
        // This ensures the current user's node is visible even if not yet in peers.items
        // Temporarily disabled to prevent crashes - will be re-enabled with proper error handling
        /*
        emitter.on('localNetwork', chain => {
            try {
                if(chain && chain.length > 0 && this.master && this.master.client && this.master.client.peerId) {
                    const myPeerId = this.master.client.peerId;
                    const self = this;
                    
                    this.setState(state => {
                        // Check if current user's node already exists in graph
                        const existingNode = state.graph && state.graph.nodes ? state.graph.nodes.find(n => n.id === myPeerId) : null;
                        if(!existingNode) {
                            const tempPeer = {
                                peerId: myPeerId,
                                networkChain: chain,
                                name: 'You'
                            };
                            
                            const nodes = [];
                            const edges = [];
                            const isMe = true;
                            
                            try {
                                const host = self.addHosts(tempPeer, nodes, isMe);
                                const nat = self.addNats(tempPeer, nodes, isMe);
                                const relays = self.addRelays(tempPeer, nodes, isMe);
                                
                                if(nat) {
                                    const edge = {
                                        from: tempPeer.peerId,
                                        to: nat.id || nat.ip,
                                        width: 2,
                                        dashes: true,
                                        arrows: '',
                                        color: self.isMeColor(isMe),
                                        network: host
                                    };
                                    edges.push(edge);
                                    
                                    relays.forEach(relay => {
                                        const edge = {
                                            from: nat.id || nat.ip,
                                            to: relay.id || relay.ip,
                                            width: 2,
                                            dashes: true,
                                            arrows: '',
                                            color: self.isMeColor(isMe)
                                        };
                                        edges.push(edge);
                                    });
                                }
                                
                                // Merge with existing graph
                                return {
                                    graph: {
                                        nodes: [...(state.graph?.nodes || []), ...nodes],
                                        edges: [...(state.graph?.edges || []), ...edges]
                                    }
                                };
                            } catch(e) {
                                Logger.error('Error adding local network node: ' + e);
                                return state;
                            }
                        }
                        return state;
                    });
                }
            } catch(e) {
                Logger.error('Error in localNetwork handler: ' + e);
            }
        });
        */

    // Helper methods
    const isMeColor = useCallback((isMe) => {
        return isMe ? '#F50057' : '#e0e0e0';
    }, []);

    const isMeColorBlack = useCallback((isMe) => {
        return isMe ? '#F50057' : '#000000';
    }, []);

    const isMobile = useCallback((platform) => {
        return platform.indexOf('Mobile') > -1
            || platform.indexOf('Android') > -1
            || platform.indexOf('iOS') > -1;
    }, []);

    const isNatType = useCallback((natType) => {
        return natType.includes('srflx') || natType.includes('prflx');
    }, []);

    const createShortNetworkLabel = useCallback((item) => {
        return StringUtil.addEmptySpaces([
            StringUtil.stripSrflx(item.typeDetail),
            _.get(item, 'network.location.country_flag_emoji'),
            _.truncate((_.get(item, 'network.connection.isp') || item.ip)) + '\n'
        ]);
    }, []);

    const addUserIcon = useCallback((node, platform, isMe) => {
        node.shape = 'icon';
        if(isMobile(platform)) {
            node.icon = {
                face: 'FontAwesome',
                code: '\uf10b',
                size: 30,
                color: isMeColorBlack(isMe)
            }
        } else {
            node.icon = {
                face: 'FontAwesome',
                code: '\uf108',
                size: 30,
                color: isMeColorBlack(isMe)
            }
        }
    }, [isMobile, isMeColorBlack]);

    const addRelayIcon = useCallback((node, isMe) => {
        node.shape = 'icon';
        node.icon = {
            face: 'FontAwesome',
            code: '\uf138',
            size: 30,
            color: isMeColorBlack(isMe)
        }
    }, [isMeColorBlack]);

    const addHosts = useCallback((peer, nodes, isMe) => {
        if(nodes.find(item => item.id === peer.peerId)) return;

        const hosts = peer.networkChain.filter(item => item.typeDetail === 'host');
        if(hosts.length > 1) {
            //Logger.warn('multiple hosts found ' + JSON.stringify(hosts));
        }
        // Use first host if none have label, as labels may not be set for remote peers
        const host = hosts.find(item => item.label) || hosts[0];
        if(host) {
            const platform = StringUtil.slimPlatform(peer.originPlatform);
            const node = {
                id: peer.peerId,
                label: peer.name || _.truncate(platform),
                type: 'client',
                shape: 'box',
                peer: peer,
                network: host,
                networks: hosts,
            };
            node.title = node.label;
            node.color = isMeColor(isMe);
            node.font = {
                color: isMeColorBlack(isMe), strokeWidth: 2
            };
            addUserIcon(node, peer.originPlatform, isMe);
            nodes.push(node);
            return host;
        }
    }, [isMeColor, isMeColorBlack, addUserIcon]);

    const addNats = useCallback((peer, nodes, isMe) => {
        const nats = peer.networkChain.filter(item => isNatType(item.typeDetail));
        if(nats.length > 1) {
            Logger.warn('multiple nats found '
                + nats.length + ': ' + nats.map(item => item.label || item.hostname || item.ip).join(', '));
        }
        // Use first nat if none have label, as labels may not be set for remote peers
        const nat = nats.find(item => item.label) || nats[0];
        if(nat) {
            if(nodes.find(item => item.id === nat.ip)) return nat;
            const node = {
                id: nat.ip,
                label: createShortNetworkLabel(nat),
                shape: 'box',
                network: nat,
                networks: nats,
                peer: peer,
                type: 'nat'
            };
            node.title = node.label;
            node.color = isMeColor(isMe);
            node.font = {
                color: isMeColorBlack(isMe), strokeWidth: 2
            };
            node.shape = 'image';
            node.image = './firewall.png';
            node.size = 15;
            nodes.push(node);
            return node;
        }
    }, [isNatType, createShortNetworkLabel, isMeColor, isMeColorBlack]);

    const addRelays = useCallback((peer, nodes, isMe) => {
        const relays = peer.networkChain.filter(item => item.typeDetail === 'relay');
        if(relays.length > 1) {
            //Logger.warn('multiple relays found ' + JSON.stringify(relays));
        }
        return relays.map(relay => {
            const shortName = createShortNetworkLabel(relay);
            const existing = nodes.find(item => item.id === shortName);
            if(!existing) {
                const node = {
                    id: shortName,
                    label: shortName,
                    relays: new Map([[relay.ip, relay]]),
                    type: 'relay',
                    shape: 'box',
                    network: relay,
                    networks: [relay],
                    peer: peer
                };
                node.title = node.label;
                node.color = isMeColor(isMe);
                node.font = {
                    color: isMeColorBlack(isMe), strokeWidth: 2
                };
                addRelayIcon(node, isMe);
                nodes.push(node);
                return node;
            } else {
                existing.relays.set(relay.ip, relay);
                existing.networks.push(relay);
                return existing;
            }
        }).filter(item => item);
    }, [createShortNetworkLabel, isMeColor, isMeColorBlack, addRelayIcon]);

    const events = useMemo(() => ({
        select: (event) => {
            const {nodes, edges} = event;
            if(nodes && nodes.length > 0) {
                if(!nodes[0])
                    return;

                const id = nodes[0];
                const node = graph.nodes.find(node => node.id === id);
                if(!node)
                    return;

                let label = '';
                const network = node.network;
                if(node.type === 'client') {
                    const platform = StringUtil.slimPlatform(node.peer.originPlatform);
                    label = node.peer.name + '\n' + platform + '\n'
                } else if(node.type === 'relay') {
                    const values = [...node.relays.values()];
                    const ips = values.map(item => item.ip).join(',');
                    const ports = values.map(item => item.port).join(',');
                    node.network.ip = ips;
                    label = StringUtil.createNetworkLabel(node.network, '\n');
                    label += (network.transport ? network.transport.toLowerCase() : '')
                        + ' ' + ips + ':' + ports;
                    setSelectedNodeLabel(label);
                    return;
                } else {
                    label = StringUtil.createNetworkLabel(node.network, '\n', true) + '\n';
                }

                if(node.networks) {
                    label += Object.values(_.groupBy(node.networks, 'ip')).map(ips => {
                        return ' ' + ips.map(item => item.transport).join(',')
                            + ' ' + ips[0].ip + ':'
                            + ips.map(item => item.port).join(',');
                    });
                } else {
                    label += (network.transport ? network.transport.toLowerCase() : '');
                    label += ' ' + network.ip + ':' + network.port;
                }

                setSelectedNodeLabel(label);
            } else if(edges && edges.length > 0) {
                if(!edges[0])
                    return;

                const id = edges[0];
                const edge = graph.edges.find(edge => edge.id === id);
                if(edge) {
                    let edgeLabel;
                    if(edge.network && edge.network.typeDetail && edge.network.typeDetail.includes('host')) {
                        edge.from = edge.network.ip;
                    }
                    if(edge.type === 'connection') {
                        const conn = edge.network;
                        edgeLabel = conn.connectionType + ' ' + conn.fileName + '\n';
                        edgeLabel += `\n${conn.from}:${conn.fromPort} >> ${conn.to}:${conn.toPort}`
                    } else{
                        edgeLabel = '';
                    }
                    setSelectedNodeLabel(edgeLabel);
                }
            }
        }
    }), [graph]);

    useEffect(() => {
        const emitter = master.emitter;

        const handlePeers = (event) => {
            const myPeerId = masterRef.current.client.peerId;
            const peers = masterRef.current.peers;
            const nodes = [];

            setGraph(state => {
                const edges = state.edges.filter(item => item.type === 'connection');
                peers.items.forEach(peer => {
                    if(peer.networkChain) {
                        const isMe = peer.peerId === myPeerId;
                        const host = addHosts(peer, nodes, isMe);
                        const nat = addNats(peer, nodes, isMe);
                        const relays = addRelays(peer, nodes, isMe);

                        if(nat) {
                            const edge = {
                                from: peer.peerId,
                                to: nat.id || nat.ip,
                                width: 2,
                                dashes: true,
                                arrows: '',
                                color: isMeColor(isMe),
                                network: host
                            };
                            edges.push(edge);

                            relays.forEach(relay => {
                                const edge = {
                                    from: nat.id || nat.ip,
                                    to: relay.id || relay.ip,
                                    width: 2,
                                    dashes: true,
                                    arrows: '',
                                    color: isMeColor(isMe)
                                };
                                edges.push(edge);
                            });
                        }
                    }
                });
                return {nodes : nodes, edges: edges};
            });
        };

        const handlePeerConnections = (connections) => {
            setGraph(state => {
                const nodes = state.nodes;
                let edges = state.edges;

                //remove all connection edges
                const connEdges = edges.filter(item => item.type === 'connection');
                connEdges.forEach(edge => {
                    const index = edges.findIndex(item => item.from === edge.from && item.to === edge.to);
                    edges = update(edges, {$splice: [[index, 1]]});
                });

                //add connection edges in.
                connections.forEach(conn => {
                    const from = conn.connectionType === 'p2p' ? conn.fromPeerId : conn.from;
                    const to = conn.connectionType === 'p2p' ? conn.toPeerId : conn.to;
                    const edge = {
                        id: conn.id, from: from, to: to,
                        type: 'connection',
                        network: conn,
                        width: 2,
                        arrows: 'to',
                        smooth: {type: 'curvedCW', roundness: 0.5, forceDirection: 'none'},
                        font: {
                            align: 'bottom'
                        }
                    };
                    edge.title = edge.label;
                    if(!edges.find(item => item.from === edge.from && item.to === edge.to)) {
                        edges = update(edges, {$push: [edge]});
                    }
                });

                return {nodes : nodes, edges: edges};
            });
        };

        emitter.on('peers', handlePeers);
        emitter.on('peerConnections', handlePeerConnections);

        return () => {
            emitter.removeListener('peers', handlePeers);
            emitter.removeListener('peerConnections', handlePeerConnections);
        };
    }, [master.emitter, addHosts, addNats, addRelays, isMeColor]);

    const setNetworkInstance = useCallback((nw) => {
        setNetwork(nw);
    }, []);

    const showStatusMessage = useCallback((selectedNodeLabel, classes) => {
        return <Typography variant="caption" align="center" className={classes.wordwrap}>
            <div>{selectedNodeLabel}</div>
        </Typography>
    }, []);

    const handleExpand = useCallback((panel) => (event, expanded) => {
        localStorage.setItem(panel, expanded);
        setExpandedTopology(expanded);
    }, []);

    const buildHeader = useCallback((classes, wtNumPeers) => {
        return <span className={classes.horizontal}>
            <Typography className={classes.heading}>Network Topology</Typography>
            <Badge badgeContent={wtNumPeers} color="primary" style={{
                marginLeft: '10px'
            }} >
                <GroupRounded />
            </Badge>
        </span>
    }, []);

    return (
        <Slide direction="left" in={visible && showTopology} mountOnEnter unmountOnExit>
            <Accordion expanded={expandedTopology}
                                       onChange={handleExpand('expandedTopology')}
                                       style={{
                                           marginBottom: '5px'
                                        }}>
            <AccordionSummary 
                expandIcon={<ExpandMoreIcon />}
                slotProps={{ iconButton: { component: 'div' } }}>
                {buildHeader(classes, wtNumPeers)}
            </AccordionSummary>
            <AccordionDetails className={classes.content} style={{
                display: 'flex',
                flexDirection: 'column'
            }}>
                {showStatusMessage(selectedNodeLabel, classes)}
                <Graph ref={graphRef} getNetwork={setNetworkInstance}
                       graph={graph} options={options} events={events}
                       style={{width: "100%", height: "400px"}}/>
            </AccordionDetails>
            </Accordion>
        </Slide>
    );
}

TopologyView.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withSnackbar(withStyles(styles)(TopologyView));